import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { questionOpenWhere } from "../feed/question-window";
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
export const TOPIC_MAIL_TICK_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 5;
/** This many refusals with no mail sent between them: the relay is in trouble, not the addresses. */
export const MAX_CONSECUTIVE_REFUSALS = 10;
/** The relay's own daily allowance: TOPIC_MAIL_DAILY_MAX is never more than this. */
export const TOPIC_MAIL_MAX_CEILING = 5000;
/** How long a person the relay refused is left alone for that template. */
export const REFUSED_SKIP_MS = 24 * 3_600_000;

export type TopicMailState =
  | "off"
  | "not-yet"
  | "too-late"
  | "nothing-open"
  | "already-mailed-other"
  | "done"
  | "capped"
  | "budget-reached"
  | "stopped";

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
  /** `template|userId|address` to the time (ms) until which the person is skipped after the relay refused that address. Kept in memory only: a restart forgets it. */
  private readonly refusedUntil = new Map<string, number>();
  /** Event keys gone through to the end with some people refused: not scanned again before the first skip runs out (ms). */
  private readonly rescanAt = new Map<string, number>();

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
    const raw = this.config.get<string | number | null>("TOPIC_MAIL_DAILY_MAX");
    // Blank (empty or spaces) is "not set", not 0. An explicit 0 still means send nothing.
    if (raw === undefined || raw === null || String(raw).trim() === "")
      return 2500;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 2500;
    return Math.min(Math.floor(n), TOPIC_MAIL_MAX_CEILING);
  }

  /** The most C02 may send in a UTC day while C01's window for the Lagos day is still open: half the budget, rounded down. */
  private c02HalfMax(): number {
    return Math.floor(this.dailyMax() / 2);
  }

  /** C01's window for this Lagos day has closed (at or after TOPIC_MAIL_DAILY_UNTIL). */
  private c01WindowClosed(t: Date): boolean {
    return (
      this.lagosMinutes(t) >=
      clockMinutes(this.config.get("TOPIC_MAIL_DAILY_UNTIL"), 12 * 60)
    );
  }

  private usedBy(template: string): Promise<number> {
    return this.prisma.mailLog.count({
      where: { template, createdAt: { gte: utcDayStart(new Date()) } },
    });
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
  }): Promise<Array<{ id: string; mailTo: string }>> {
    const ids: string[] = [];
    const addr = new Map<string, string>();
    let after: string | undefined;
    for (;;) {
      const page = await this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          mailTo: { not: "" },
          AND: [
            { mailTo: { not: null } },
            { OR: [{ settings: null }, { settings: { [p.field]: true } }] },
            ...(after ? [{ id: { gt: after } }] : []),
          ],
        },
        orderBy: { id: "asc" },
        take: 2000,
        select: { id: true, mailTo: true },
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
      for (const u of page)
        if (!had.has(u.id)) {
          ids.push(u.id);
          addr.set(u.id, u.mailTo ?? "");
        }
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
    return ids
      .sort((x, y) => {
        const a = last.get(x) ?? -1;
        const b = last.get(y) ?? -1;
        return a - b || (x < y ? -1 : x > y ? 1 : 0);
      })
      .map((id) => ({ id, mailTo: addr.get(id) ?? "" }));
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
    if (this.isFinished(`C01|${eventKey}`, now))
      return { state: "done", sent: 0 };
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
    if (this.isFinished(`C02|${eventKey}`, now))
      return { state: "done", sent: 0 };

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

  /** Gone through to the end, or only waiting for a refused address's 24 hours to pass. */
  private isFinished(key: string, now: Date): boolean {
    if (this.finished.has(key)) return true;
    const at = this.rescanAt.get(key);
    if (at === undefined) return false;
    if (at > now.getTime()) return true;
    this.rescanAt.delete(key);
    return false;
  }

  private async sendAll(
    now: Date,
    p: {
      template: "C01" | "C02";
      field: "notifyDailyQuestion" | "notifyWeeklyTopic";
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
    let refusals = 0;
    let failedAny = false;
    /** Refused in this run: put on the skip list only when the run ends for any reason but relay trouble. */
    const refusedNow = new Map<string, number>();
    const commitSkips = () => {
      for (const [k, v] of refusedNow) this.refusedUntil.set(k, v);
    };
    let waitUntil = Infinity;
    const max = this.dailyMax();
    if ((await this.usedToday()) >= max)
      return { state: "budget-reached", sent };
    // C02 holds to half the budget until C01's window has closed; C01 may always use what is left of the whole.
    const half = this.c02HalfMax();
    if (
      p.template === "C02" &&
      !this.c01WindowClosed(clock()) &&
      (await this.usedBy("C02")) >= half
    )
      return { state: "budget-reached", sent };
    {
      for (const { id: userId, mailTo } of await this.due(p)) {
        // Nothing goes for a question or topic that has closed, or been pulled, since the run began: asked before every mail.
        if (!(await p.stillOpen(clock())))
          return { state: "nothing-open", sent };
        const t = clock();
        const skipKey = `${p.template}|${userId}|${mailTo}`;
        const skipUntil = this.refusedUntil.get(skipKey);
        if (skipUntil !== undefined) {
          if (skipUntil > t.getTime()) {
            waitUntil = Math.min(waitUntil, skipUntil);
            continue;
          }
          this.refusedUntil.delete(skipKey);
        }
        const outcome: MailOutcome = await this.mail.send({
          template: p.template,
          userId,
          eventKey: p.eventKey,
          scopeKey: p.scopeKey,
          vars: p.vars(t),
          budget: {
            templates: ["C01", "C02"],
            max,
            ...(p.template === "C02" && !this.c01WindowClosed(t)
              ? { ownMax: half }
              : {}),
          },
        });
        if (outcome === "capped") {
          commitSkips();
          this.cappedOn.set(p.template, lagosDayString(t));
          this.logger.warn(
            `${p.template} ${p.eventKey}: relay cap reached after ${sent} mails, run stopped`,
          );
          return { state: "capped", sent };
        }
        if (outcome === "budget") {
          commitSkips();
          this.logger.warn(
            `${p.template} ${p.eventKey}: daily budget of ${max} topic mails reached after ${sent}, run stopped`,
          );
          return { state: "budget-reached", sent };
        }
        if (outcome === "unconfigured" || outcome === "bad-mail")
          return { state: "stopped", sent };
        if (outcome === "refused") {
          // The relay says this address will not work: leave this person alone for 24 hours; not an outage, so not
          // counted as a failure. But a run in which the relay refuses 10 in a row, with no mail sent between, is
          // relay trouble (wrong address, wrong key): stop, and do not blame the people.
          const until = t.getTime() + REFUSED_SKIP_MS;
          refusedNow.set(skipKey, until);
          waitUntil = Math.min(waitUntil, until);
          this.logger.warn(
            `${p.template} ${p.eventKey}: relay refused one address, skipped for 24 hours`,
          );
          if (++refusals >= MAX_CONSECUTIVE_REFUSALS) {
            this.logger.error(
              `${p.template} ${p.eventKey}: the relay refused ${refusals} addresses in a row with no mail sent between, so it is relay trouble and not the addresses: run stopped, nobody was put on the skip list`,
            );
            return { state: "stopped", sent };
          }
          await this.pause();
          continue;
        }
        if (outcome === "failed") {
          failedAny = true;
          if (++failures >= MAX_CONSECUTIVE_FAILURES) {
            this.logger.error(
              `${p.template} ${p.eventKey}: ${failures} mails in a row failed, run stopped`,
            );
            commitSkips();
            return { state: "stopped", sent };
          }
        } else if (outcome === "sent") {
          failures = 0;
          refusals = 0;
        }
        if (outcome === "sent") sent++;
        if (outcome === "sent" || outcome === "failed") await this.pause();
      }
    }
    commitSkips();
    // Nothing sent and someone failed: the run did not do its job, so it is tried again at the next tick.
    if (sent === 0 && failedAny) return { state: "done", sent };
    const key = `${p.template}|${p.eventKey}`;
    // Marked finished only when everyone due was mailed or nobody was due. Someone left out because the relay refused
    // their address is asked again once the 24 hours pass (the next tick after that), not never.
    if (waitUntil === Infinity) this.finished.add(key);
    else this.rescanAt.set(key, waitUntil);
    return { state: "done", sent };
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
