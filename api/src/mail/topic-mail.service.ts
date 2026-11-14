import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { questionOpenWhere } from "../feed/question-window";
import { LAUNCH_QUESTION } from "../feed/launch-question";
import { PrismaService } from "../common/prisma/prisma.service";
import { dateOnly, lagosDayStart, lagosDayString } from "../admin/support";
import {
  MailService,
  count,
  utcDayStart,
  type MailOutcome,
} from "./mail.service";

/**
 * V-TOPIC-MAILS (owner, 14 Nov 2026): C01 "Today's question" once a day and C02 "Topic of the week starts" once a week,
 * to every member with a mail address who has not turned that mail off.
 *
 * Rules that make a mass send safe:
 * - Once only. Each mail is one MailLog row, unique per (person, template, event key); the key is `question:<id>` for
 *   C01 and `topic:<id>` for C02. The row is written before the relay is asked, so a second run, a restart or two
 *   servers cannot send the same person the same mail twice. (A server that dies between the row and the relay loses
 *   that one mail; it is never sent twice.)
 * - Paced. One mail every 1000 / TOPIC_MAIL_PER_SECOND ms, through MailService (the existing relay client).
 * - A 429 from the relay (daily_cap, provider_daily_quota, provider_monthly_quota) ends the run at once. The mail that
 *   was refused gets its row back, so nobody is marked as sent who was not. C01 is not tried again: it is only
 *   ever sent between TOPIC_MAIL_DAILY_AT and TOPIC_MAIL_DAILY_UNTIL, of the day's own question, so the people not
 *   reached simply miss that day (yesterday's question is never sent tomorrow). C02 is tried again at the next
 *   tick after the next Lagos day starts, for as long as the topic is open, and only for people without a row.
 * - Nothing goes for a question or topic that is not open (V-27, V-29): the same window rule the feed uses.
 * - Only ACTIVE accounts with an address, and not the ones who turned the mail off (MailService checks again).
 */
/** The launch mail gives up (for this process) after this many follow-up runs in a row that sent nothing. */
const LAUNCH_MAX_STALLED_RUNS = 6;
export const TOPIC_MAIL_TICK_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 5;

export type TopicMailState =
  | "off"
  | "not-yet"
  | "too-late"
  | "nothing-open"
  | "already-mailed-other"
  | "done"
  | "capped"
  | "budget-reached"
  | "stopped"
  | "waiting";

export interface TopicMailRun {
  state: TopicMailState;
  sent: number;
}

/** "07:00" to minutes after midnight; a bad value gives the fallback. */
export function clockMinutes(v: string | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? "").trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : fallback;
}

/** "17 hours", "45 minutes": what is left until a question closes. */
export function closesIn(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} ${mins === 1 ? "minute" : "minutes"}`;
  const h = Math.round(mins / 60);
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

function short(text: string, max = 70): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

@Injectable()
export class TopicMailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TopicMailService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Event keys whose audience has been gone through to the end in this process: not scanned again. */
  private readonly finished = new Set<string>();
  /** The Lagos day a run was refused with a 429: no more tries that day. */
  private readonly cappedOn = new Map<string, string>();
  /** The launch mail: no new run before this time after a relay 429 or a stop (epoch ms), so a tick does not hammer. */
  private launchRetryAt = 0;
  /** The launch mail has gone through its whole audience in this process: no more scans. */
  private launchDone = false;
  /** Follow-up launch runs in a row that ended with people left and sent nothing. */
  private launchStalled = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const every = Number(
      this.config.get("TOPIC_MAIL_TICK_MS") ?? TOPIC_MAIL_TICK_MS,
    );
    if (process.env.NODE_ENV === "test" || !(every > 0)) return;
    this.timer = setInterval(() => {
      this.tick().catch((e: unknown) =>
        this.logger.error(`topic mail tick: ${String(e)}`),
      );
    }, every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The off switch: TOPIC_MAIL_ENABLED=false (or 0, off, no) and a restart. Default on. */
  enabled(): boolean {
    const v = String(this.config.get("TOPIC_MAIL_ENABLED") ?? "true")
      .trim()
      .toLowerCase();
    return !["false", "0", "off", "no"].includes(v);
  }

  private perSecond(): number {
    const n = Number(this.config.get("TOPIC_MAIL_PER_SECOND") ?? 5);
    return n > 0 ? n : 5;
  }

  /** Waits between two mails. A method of its own so a test can watch it. */
  async pause(): Promise<void> {
    await new Promise((r) => setTimeout(r, Math.ceil(1000 / this.perSecond())));
  }

  /** One pass over both mails. Never throws; overlapping passes are dropped. */
  async tick(
    now = new Date(),
  ): Promise<{ c01: TopicMailRun; c02: TopicMailRun } | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const c01 = await this.runDailyQuestion(now).catch(
        (e: unknown): TopicMailRun => {
          this.logger.error(`C01 run: ${String(e)}`);
          return { state: "stopped", sent: 0 };
        },
      );
      const c02 = await this.runWeeklyTopic(now).catch(
        (e: unknown): TopicMailRun => {
          this.logger.error(`C02 run: ${String(e)}`);
          return { state: "stopped", sent: 0 };
        },
      );
      // The one-time launch mail. Its own guard inside: cheap once done, never throws.
      await this.runLaunchOpen(now).catch((e: unknown) =>
        this.logger.error(`launch mail run: ${String(e)}`),
      );
      return { c01, c02 };
    } finally {
      this.running = false;
    }
  }

  /** Minutes since midnight on the Lagos clock. */
  private lagosMinutes(now: Date): number {
    return Math.floor(
      (now.getTime() - lagosDayStart(lagosDayString(now)).getTime()) / 60_000,
    );
  }

  /** The most topic mails (C01 and C02 together) one UTC day may hold: TOPIC_MAIL_DAILY_MAX, default 2500. */
  dailyMax(): number {
    const n = Number(this.config.get("TOPIC_MAIL_DAILY_MAX") ?? 2500);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2500;
  }

  private usedToday(): Promise<number> {
    return this.prisma.mailLog.count({
      where: {
        template: { in: ["C01", "C02"] },
        createdAt: { gte: utcDayStart(new Date()) },
      },
    });
  }

  /** What is left of today's budget (the relay's UTC day), for the admin Today numbers. */
  async budgetLeft(): Promise<number> {
    return Math.max(0, this.dailyMax() - (await this.usedToday()));
  }

  /**
   * Who is still due this mail, in the order they get it. The person's own switch is part of the query. When the budget
   * cannot cover everyone, the ones who went longest without a topic mail come first (never mailed first), then by id,
   * so the same first people are not mailed every day.
   */
  private async due(p: {
    template: string;
    eventKey: string;
    field: "notifyDailyQuestion" | "notifyWeeklyTopic";
    /** Only people whose account was made before this moment (the launch mail). */
    createdBefore?: Date;
  }): Promise<string[]> {
    const ids: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          mailTo: { not: "" },
          AND: [
            { mailTo: { not: null } },
            { OR: [{ settings: null }, { settings: { [p.field]: true } }] },
            ...(p.createdBefore
              ? [{ createdAt: { lt: p.createdBefore } }]
              : []),
            ...(after ? [{ id: { gt: after } }] : []),
          ],
        },
        orderBy: { id: "asc" },
        take: 2000,
        select: { id: true },
      });
      if (page.length === 0) break;
      after = page[page.length - 1].id;
      const had = new Set(
        (
          await this.prisma.mailLog.findMany({
            where: {
              template: p.template,
              eventKey: p.eventKey,
              userId: { in: page.map((u) => u.id) },
            },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      );
      for (const u of page) if (!had.has(u.id)) ids.push(u.id);
    }
    const last = new Map<string, number>();
    for (let i = 0; i < ids.length; i += 2000) {
      const rows = await this.prisma.mailLog.groupBy({
        by: ["userId"],
        where: {
          template: { in: ["C01", "C02"] },
          userId: { in: ids.slice(i, i + 2000) },
        },
        _max: { createdAt: true },
      });
      for (const r of rows)
        if (r._max.createdAt) last.set(r.userId, r._max.createdAt.getTime());
    }
    return ids.sort((x, y) => {
      const a = last.get(x) ?? -1;
      const b = last.get(y) ?? -1;
      return a - b || (x < y ? -1 : x > y ? 1 : 0);
    });
  }

  /** C01. The day's question, to everyone, between TOPIC_MAIL_DAILY_AT and TOPIC_MAIL_DAILY_UNTIL (Lagos). */
  async runDailyQuestion(now = new Date()): Promise<TopicMailRun> {
    if (!this.enabled()) return { state: "off", sent: 0 };
    const at = clockMinutes(this.config.get("TOPIC_MAIL_DAILY_AT"), 7 * 60);
    const until = clockMinutes(
      this.config.get("TOPIC_MAIL_DAILY_UNTIL"),
      12 * 60,
    );
    const mins = this.lagosMinutes(now);
    if (mins < at) return { state: "not-yet", sent: 0 };
    if (mins >= until) return { state: "too-late", sent: 0 };

    const day = lagosDayString(now);
    if (this.cappedOn.get("C01") === day) return { state: "capped", sent: 0 };
    // The day's question: the override when one is open, else the day's own daily question. Both must be open now.
    const q =
      (await this.prisma.question.findFirst({
        where: { kind: "OVERRIDE", ...questionOpenWhere(now) },
        orderBy: { startsAt: "desc" },
      })) ??
      (await this.prisma.question.findFirst({
        where: {
          kind: "DAILY",
          isSpare: false,
          scheduledFor: dateOnly(day),
          ...questionOpenWhere(now),
        },
        orderBy: { pinned: "desc" },
      }));
    if (!q) return { state: "nothing-open", sent: 0 };

    const eventKey = `question:${q.id}`;
    if (this.finished.has(`C01|${eventKey}`)) return { state: "done", sent: 0 };
    // One daily question mail a day: when the day's mail already went out for another question (an override came up
    // later), this one is not sent on top of it.
    const first = await this.prisma.mailLog.findFirst({
      where: { template: "C01", scopeKey: day },
      select: { eventKey: true },
    });
    if (first && first.eventKey !== eventKey)
      return { state: "already-mailed-other", sent: 0 };

    const web = this.mail.webBase();
    const run = await this.sendAll(now, {
      template: "C01",
      field: "notifyDailyQuestion",
      eventKey,
      scopeKey: day,
      // The cut-off holds for the whole run, not only its start: nothing goes at or after TOPIC_MAIL_DAILY_UNTIL.
      stillOpen: async (t) =>
        this.lagosMinutes(t) < until &&
        (await this.prisma.question.count({
          where: { id: q.id, ...questionOpenWhere(t) },
        })) > 0 &&
        lagosDayString(t) === day,
      vars: (t) => ({
        question_text: q.text,
        question_short: short(q.text),
        voice_count: count(q.voiceCount),
        closes_in: q.endsAt
          ? closesIn(q.endsAt.getTime() - t.getTime())
          : "a day",
        topic_url: `${web}/q/${q.id}/speak`,
        listen_url: `${web}/q/${q.id}`,
      }),
    });
    return run;
  }

  /** C02. The open week's topic, to everyone, from TOPIC_MAIL_TOPIC_AT on the first day and on every day after while it is open. */
  async runWeeklyTopic(now = new Date()): Promise<TopicMailRun> {
    if (!this.enabled()) return { state: "off", sent: 0 };
    const at = clockMinutes(
      this.config.get("TOPIC_MAIL_TOPIC_AT"),
      6 * 60 + 30,
    );
    if (this.lagosMinutes(now) < at) return { state: "not-yet", sent: 0 };
    const day = lagosDayString(now);
    if (this.cappedOn.get("C02") === day) return { state: "capped", sent: 0 };

    const openTopic = (t: Date) => ({
      status: { in: ["SCHEDULED" as const, "LIVE" as const] },
      startsOn: { lte: dateOnly(lagosDayString(t)) },
      endsOn: { gte: dateOnly(lagosDayString(t)) },
    });
    const topic = await this.prisma.topic.findFirst({
      where: openTopic(now),
      orderBy: { startsOn: "desc" },
    });
    if (!topic) return { state: "nothing-open", sent: 0 };
    const eventKey = `topic:${topic.id}`;
    if (this.finished.has(`C02|${eventKey}`)) return { state: "done", sent: 0 };

    const web = this.mail.webBase();
    return this.sendAll(now, {
      template: "C02",
      field: "notifyWeeklyTopic",
      eventKey,
      scopeKey: `week:${topic.weekNumber}`,
      stillOpen: async (t) =>
        (await this.prisma.topic.count({
          where: { id: topic.id, ...openTopic(t) },
        })) > 0,
      vars: () => ({
        topic_title: topic.title,
        topic_hook:
          topic.blurb?.trim() || "Join the conversation on Voices this week.",
        topic_url: `${web}/`,
      }),
    });
  }

  private async sendAll(
    now: Date,
    p: {
      template: "C01" | "C02" | "C14";
      field: "notifyDailyQuestion" | "notifyWeeklyTopic";
      /** Only people made before this moment. */
      createdBefore?: Date;
      /** false: the run neither counts against nor is stopped by the C01 and C02 daily budget (the launch mail). */
      useBudget?: boolean;
      eventKey: string;
      scopeKey: string;
      stillOpen: (now: Date) => Promise<boolean>;
      vars: (now: Date) => Record<string, string>;
    },
  ): Promise<TopicMailRun> {
    // The run's own clock: `now` plus the time spent since it began (the same as new Date(), but a test can start it anywhere).
    const began = Date.now();
    const clock = () => new Date(now.getTime() + Date.now() - began);
    let sent = 0;
    let failures = 0;
    const max = this.dailyMax();
    const budgeted = p.useBudget !== false;
    if (budgeted && (await this.usedToday()) >= max)
      return { state: "budget-reached", sent };
    {
      for (const userId of await this.due(p)) {
        // Nothing goes for a question or topic that has closed, or been pulled, since the run began: asked before every mail.
        if (!(await p.stillOpen(clock())))
          return { state: "nothing-open", sent };
        const t = clock();
        const outcome: MailOutcome = await this.mail.send({
          template: p.template,
          userId,
          eventKey: p.eventKey,
          scopeKey: p.scopeKey,
          vars: p.vars(t),
          budget: budgeted ? { templates: ["C01", "C02"], max } : undefined,
        });
        if (outcome === "capped") {
          this.cappedOn.set(p.template, lagosDayString(t));
          this.logger.warn(
            `${p.template} ${p.eventKey}: relay cap reached after ${sent} mails, run stopped`,
          );
          return { state: "capped", sent };
        }
        if (outcome === "budget") {
          this.logger.warn(
            `${p.template} ${p.eventKey}: daily budget of ${max} topic mails reached after ${sent}, run stopped`,
          );
          return { state: "budget-reached", sent };
        }
        if (outcome === "unconfigured" || outcome === "bad-mail")
          return { state: "stopped", sent };
        if (outcome === "failed") {
          if (++failures >= MAX_CONSECUTIVE_FAILURES) {
            this.logger.error(
              `${p.template} ${p.eventKey}: ${failures} mails in a row failed, run stopped`,
            );
            return { state: "stopped", sent };
          }
        } else if (outcome === "sent") failures = 0;
        if (outcome === "sent") sent++;
        if (outcome === "sent" || outcome === "failed") await this.pause();
      }
    }
    this.finished.add(`${p.template}|${p.eventKey}`);
    return { state: "done", sent };
  }

  /** The off switch of the launch mail: LAUNCH_OPEN_MAIL=off (and a restart). Default on. */
  launchEnabled(): boolean {
    return (
      String(this.config.get("LAUNCH_OPEN_MAIL") ?? "on")
        .trim()
        .toLowerCase() !== "off"
    );
  }

  /**
   * "VOICES is open" (C14), once, to everyone who could have met the closed-question fault: ACTIVE accounts with an
   * address, made before the launch question's start, who have not turned the daily question mail off. It goes once
   * the launch question is open by the window rule; until then nothing is sent and the next tick looks again.
   * Once only: one MailLog row per person (template C14, key `launch-open:<questionId>`) written before the relay is
   * asked (MailService.reserve, unique per person, template and key), so a second run, a restart or a second server
   * cannot mail anyone twice. The rows are C14's own: C01's "one mail a day" check and the C01/C02 budget never see them.
   */
  async runLaunchOpen(now = new Date()): Promise<TopicMailRun> {
    if (!this.launchEnabled()) return { state: "off", sent: 0 };
    if (this.launchDone) return { state: "done", sent: 0 };
    if (now.getTime() < this.launchRetryAt)
      return { state: "waiting", sent: 0 };
    const q = await this.prisma.question.findFirst({
      where: { seedKey: LAUNCH_QUESTION.seedKey, ...questionOpenWhere(now) },
    });
    if (!q || !q.startsAt) return { state: "nothing-open", sent: 0 };
    const startsAt = q.startsAt;
    const eventKey = `launch-open:${q.id}`;
    const web = this.mail.webBase();
    const run = await this.sendAll(now, {
      template: "C14",
      field: "notifyDailyQuestion",
      createdBefore: startsAt,
      useBudget: false,
      eventKey,
      scopeKey: "launch-open",
      stillOpen: async (t) =>
        (await this.prisma.question.count({
          where: { id: q.id, ...questionOpenWhere(t) },
        })) > 0,
      vars: () => ({
        question_text: q.text,
        topic_url: `${web}/q/${q.id}/speak`,
      }),
    });
    let result = run;
    let left = 0;
    if (run.state === "done") {
      // Done is only final when nobody is left without a row. A person whose mail failed got the row back: they are
      // tried again in 10 minutes, until 6 follow-up runs in a row have sent nothing.
      left = await this.launchLeft(eventKey, startsAt);
      if (left === 0) this.launchDone = true;
      else {
        this.launchStalled = run.sent > 0 ? 0 : this.launchStalled + 1;
        if (this.launchStalled >= LAUNCH_MAX_STALLED_RUNS) {
          this.launchDone = true;
          this.logger.warn(
            `launch mail ${eventKey}: giving up for this process, ${left} people left without a mail`,
          );
        } else {
          this.launchRetryAt = now.getTime() + 10 * 60_000;
          result = { state: "waiting", sent: run.sent };
        }
      }
    } else if (run.state === "capped")
      this.launchRetryAt = now.getTime() + 30 * 60_000;
    else if (run.state === "stopped")
      this.launchRetryAt = now.getTime() + 10 * 60_000;
    if (run.state !== "done") left = await this.launchLeft(eventKey, startsAt);
    this.logger.log(
      `launch mail ${eventKey}: ${run.state}, ${run.sent} sent, ${left} left`,
    );
    return result;
  }

  /** How many people are still due the launch mail (for the run's log line). */
  private async launchLeft(eventKey: string, startsAt: Date): Promise<number> {
    try {
      return (
        await this.due({
          template: "C14",
          eventKey,
          field: "notifyDailyQuestion",
          createdBefore: startsAt,
        })
      ).length;
    } catch {
      return -1;
    }
  }

  /** What went out on this Lagos day, for the admin Today numbers. */
  async sentToday(now = new Date()): Promise<{ c01: number; c02: number }> {
    const since = lagosDayStart(lagosDayString(now));
    const [c01, c02] = await Promise.all([
      this.prisma.mailLog.count({
        where: { template: "C01", createdAt: { gte: since } },
      }),
      this.prisma.mailLog.count({
        where: { template: "C02", createdAt: { gte: since } },
      }),
    ]);
    return { c01, c02 };
  }
}
