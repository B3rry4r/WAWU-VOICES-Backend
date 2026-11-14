import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { phonePepper } from "../me/phone";
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
/** This many named-address refusals with no mail sent between them end the run (every one of them is skipped 24 hours at once). */
export const MAX_CONSECUTIVE_REFUSALS = 10;
/** The relay's own daily allowance: TOPIC_MAIL_DAILY_MAX is never more than this. */
export const TOPIC_MAIL_MAX_CEILING = 5000;
/**
 * How long a person is left alone after the relay NAMED their address as the fault (see `relayNamesAddress` in
 * mail.service.ts): 24 hours, from the first such answer, by every topic mail (C01, C02, C14). Nothing else ever skips a
 * person: relay trouble (5xx, timeout, connection error, 429, any 4xx that does not name the address) does not.
 */
export const REFUSED_SKIP_MS = 24 * 3_600_000;
/** The templates that share one skip: a refused address is not asked again by any of them while it lasts. */
const SKIP_TEMPLATES = ["C01", "C02", "C14"];
/** After a run in which some mail failed (relay trouble: nobody is skipped for it), those people are tried again no sooner than this. */
export const FAILED_RETRY_MS = 5 * 60_000;
/**
 * Relay trouble (5xx, reset, timeout) of one person. The first trouble in a sending window always counts; a later one
 * counts only while the relay is delivering to other people (in the last RELAY_UP_MS, by the run's clock, at least one send
 * succeeded and fewer than RELAY_FAIL_SHARE of the sends failed), so a relay that is down or flaky for everybody never sets
 * anybody aside. At TROUBLES_ASIDE the person is left alone for the rest
 * of the window (a Lagos day for C01, the week for C02) and is tried again in the next one, after everyone else.
 */
export const TROUBLES_ASIDE = 2;
export const RELAY_UP_MS = 30 * 60_000;
/** ...and fewer than this share of the sends tried in that time failed: a relay failing for many people is down, not one person. */
export const RELAY_FAIL_SHARE = 0.4;
/** A trouble row is removed this long after the last trouble. */
export const TROUBLE_KEEP_MS = 14 * 24 * 3_600_000;
/** A skip row this long past its time is removed (by the run itself, at most once an hour per server). */
export const SKIP_KEEP_MS = 7 * 24 * 3_600_000;

/**
 * What is kept of an address in TopicMailSkip: a keyed hash, enough to see that the address changed and nothing more.
 * Keyed with the server secret the phone hash already uses (VOICES_PHONE_PEPPER; no new setting).
 */
export function addressKey(address: string): string {
  return createHmac("sha256", phonePepper())
    .update(`topic-mail-skip|${address}`)
    .digest("hex");
}

/** The last run of a topic mail in this process, for the admin Today numbers. */
export interface TopicMailRunInfo {
  state?: "done" | "stopped" | "budget";
  at?: string;
  sent: number;
  refused: number;
  onSkip: number;
}

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

/** The order people are mailed in: no earlier trouble first, then never mailed first, then by id. */
function orderOf(
  x: { g: number; last: number; id: string },
  y: { g: number; last: number; id: string },
): number {
  return (
    x.g - y.g || x.last - y.last || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
  );
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
  /** When the old skip rows were last removed (ms): at most once an hour. */
  private skipsSweptAt = 0;
  /**
   * Event keys gone through to the end with some people refused: not scanned again before the first skip runs out (ms),
   * unless a person on a skip corrected the address (looked for each tick: `scanned` is the real time of the last look).
   */
  private readonly rescanAt = new Map<
    string,
    { at: number; scanned: number }
  >();
  private readonly lastRun = new Map<
    string,
    {
      state: "done" | "stopped" | "budget";
      at: string;
      sent: number;
      refused: number;
    }
  >();
  /** Where the last run of a window stopped: the next run starts after this person (the order key of the last one tried). */
  private readonly cursor = new Map<
    string,
    { g: number; last: number; id: string }
  >();
  /** What the relay answered to the last sends (run clock ms, took the mail or not): tells "this person" from "the relay is down". */
  private readonly recent: Array<{ t: number; ok: boolean }> = [];
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
    now: Date;
    /** Only people whose account was made before this moment (the launch mail). */
    createdBefore?: Date;
    /** The sending window (C01 and C02): people set aside in it are left out, people with trouble in an earlier one come last. */
    window?: string;
  }): Promise<{
    people: Array<{ id: string; mailTo: string; g: number; last: number }>;
    /** Troubles each person has had in this window (only people with at least one). */
    troubles: Map<string, number>;
    /** People who have any trouble row (to remove it when they are mailed). */
    hasRows: Set<string>;
    /** The first time (ms) a person left out for a refusal comes back; Infinity when nobody was left out. */
    skipEnd: number;
  }> {
    let skipEnd = Infinity;
    const troubles = new Map<string, number>();
    const hasRows = new Set<string>();
    const earlier = new Set<string>();
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
            ...(p.createdBefore
              ? [{ createdAt: { lt: p.createdBefore } }]
              : []),
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
      // Skipped people are not asked at all until their time is up (and a corrected address is asked at once).
      const skips = await this.prisma.topicMailSkip.findMany({
        where: {
          template: { in: SKIP_TEMPLATES },
          until: { gt: p.now },
          userId: { in: page.map((u) => u.id) },
        },
        select: { userId: true, addressHash: true, until: true },
      });
      const aside = new Set<string>();
      if (p.window !== undefined) {
        const rows = await this.prisma.topicMailTrouble.findMany({
          where: {
            template: p.template,
            userId: { in: page.map((u) => u.id) },
          },
          select: { userId: true, window: true, troubles: true, asideAt: true },
        });
        for (const r of rows) {
          hasRows.add(r.userId);
          if (r.window === p.window) {
            troubles.set(r.userId, r.troubles);
            if (r.asideAt) aside.add(r.userId);
          } else earlier.add(r.userId);
        }
      }
      for (const u of page)
        if (!had.has(u.id) && !aside.has(u.id)) {
          // A refused address is skipped for every topic mail, not only the one that was refused.
          const key = addressKey(u.mailTo ?? "");
          const live = skips.filter(
            (r) => r.userId === u.id && r.addressHash === key,
          );
          if (live.length > 0) {
            skipEnd = Math.min(skipEnd, ...live.map((r) => r.until.getTime()));
            continue;
          }
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
    // People with no trouble in an earlier window first, those who had trouble last; inside each group
    // "never mailed first, then by id".
    const people = ids
      .map((id) => ({
        id,
        mailTo: addr.get(id) ?? "",
        g: earlier.has(id) ? 1 : 0,
        last: last.get(id) ?? -1,
      }))
      .sort((x, y) => orderOf(x, y));
    return { people, troubles, hasRows, skipEnd };
  }

  /** Writes or extends the skip row of each person: one row per (person, template), never a second one. */
  private async writeSkips(
    template: string,
    rows: Array<{ userId: string; address: string; at: Date }>,
    until: Date,
    reason: "refused",
  ): Promise<void> {
    for (const r of rows) {
      const data = {
        addressHash: addressKey(r.address),
        until,
        reason,
        refusedAt: r.at,
      };
      try {
        await this.prisma.topicMailSkip.upsert({
          where: { userId_template: { userId: r.userId, template } },
          create: { userId: r.userId, template, ...data },
          update: data,
        });
      } catch (e) {
        // Two servers writing the same person at once: the other one's row is the same row.
        if ((e as { code?: string }).code !== "P2002") throw e;
        await this.prisma.topicMailSkip.updateMany({
          where: { userId: r.userId, template },
          data,
        });
      }
    }
  }

  /** Removes skip rows whose time is long past, so the table does not grow without end. */
  private async sweepSkips(now: Date): Promise<void> {
    if (now.getTime() - this.skipsSweptAt < 3_600_000) return;
    this.skipsSweptAt = now.getTime();
    await this.prisma.topicMailSkip.deleteMany({
      where: { until: { lt: new Date(now.getTime() - SKIP_KEEP_MS) } },
    });
    await this.prisma.topicMailTrouble.deleteMany({
      where: {
        lastTroubleAt: { lt: new Date(now.getTime() - TROUBLE_KEEP_MS) },
      },
    });
  }

  private note(t: number, ok: boolean): void {
    this.recent.push({ t, ok });
    if (this.recent.length > 8000) this.recent.splice(0, 2000);
  }

  /** In the last RELAY_UP_MS the relay took some mail and fewer than RELAY_FAIL_SHARE of the sends failed. */
  private relayLooksUp(t: number): boolean {
    let ok = 0;
    let bad = 0;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const r = this.recent[i];
      if (r.t < t - RELAY_UP_MS) break;
      if (r.t > t) continue;
      if (r.ok) ok++;
      else bad++;
    }
    return ok > 0 && bad < RELAY_FAIL_SHARE * (ok + bad);
  }

  /**
   * One person's send hit relay trouble. The first trouble in the window is written; a later one only while the relay is
   * delivering to others (see TROUBLES_ASIDE). At two the person is set aside for the rest of the window. Keyed by user id,
   * template and window: no address, no hash. Returns the person's count in this window.
   */
  private async noteTrouble(
    template: string,
    window: string,
    userId: string,
    had: number,
    t: Date,
  ): Promise<number> {
    if (had > 0 && !this.relayLooksUp(t.getTime())) return had;
    const n = had + 1;
    const data = {
      troubles: n,
      lastTroubleAt: t,
      asideAt: n >= TROUBLES_ASIDE ? t : null,
    };
    await this.prisma.topicMailTrouble.upsert({
      where: { userId_template_window: { userId, template, window } },
      create: { userId, template, window, ...data },
      update: data,
    });
    return n;
  }

  /** A person on a skip corrected the address since `since` (real time): the run is looked at again at once. */
  private async addressCorrected(since: number, now: Date): Promise<boolean> {
    let after: string | undefined;
    for (;;) {
      const page = await this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          mailTo: { not: "" },
          updatedAt: { gte: new Date(since) },
          AND: [
            { mailTo: { not: null } },
            ...(after ? [{ id: { gt: after } }] : []),
          ],
        },
        orderBy: { id: "asc" },
        take: 2000,
        select: { id: true, mailTo: true },
      });
      if (page.length === 0) return false;
      after = page[page.length - 1].id;
      const skips = await this.prisma.topicMailSkip.findMany({
        where: {
          template: { in: SKIP_TEMPLATES },
          until: { gt: now },
          userId: { in: page.map((u) => u.id) },
        },
        select: { userId: true, addressHash: true },
      });
      const mine = new Map(page.map((u) => [u.id, u.mailTo ?? ""]));
      for (const sk of skips)
        if (sk.addressHash !== addressKey(mine.get(sk.userId) ?? ""))
          return true;
    }
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
    if (await this.isFinished(`C01|${eventKey}`, "C01", now))
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
    if (await this.isFinished(`C02|${eventKey}`, "C02", now))
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

  /** Gone through to the end, or only waiting for a refused address's skip to pass (and nobody corrected an address). */
  private async isFinished(
    key: string,
    template: string,
    now: Date,
  ): Promise<boolean> {
    if (this.finished.has(key)) return true;
    const m = this.rescanAt.get(key);
    if (m === undefined) return false;
    if (m.at <= now.getTime()) {
      this.rescanAt.delete(key);
      return false;
    }
    const looked = Date.now();
    if (await this.addressCorrected(m.scanned, now)) {
      this.rescanAt.delete(key);
      return false;
    }
    m.scanned = looked - 2000;
    return true;
  }

  /** Runs the audience and keeps what the admin Today numbers show of it. */
  private async sendAll(
    now: Date,
    p: Parameters<TopicMailService["sendAllInner"]>[1],
  ): Promise<TopicMailRun> {
    const stats = { refused: 0 };
    const run = await this.sendAllInner(now, p, stats);
    const state =
      run.state === "stopped"
        ? "stopped"
        : run.state === "capped" || run.state === "budget-reached"
          ? "budget"
          : "done";
    this.lastRun.set(p.template, {
      state,
      at: new Date().toISOString(),
      sent: run.sent,
      refused: stats.refused,
    });
    return run;
  }

  /** The last run of C01 and C02 in this process and how many people are on a skip now (optional in the contract). */
  async runInfo(
    now = new Date(),
  ): Promise<{ c01: TopicMailRunInfo; c02: TopicMailRunInfo }> {
    const one = async (t: "C01" | "C02"): Promise<TopicMailRunInfo> => ({
      ...(this.lastRun.get(t) ?? { sent: 0, refused: 0 }),
      onSkip: (
        await this.prisma.topicMailSkip.findMany({
          where: { template: { in: SKIP_TEMPLATES }, until: { gt: now } },
          distinct: ["userId"],
          select: { userId: true },
        })
      ).length,
    });
    return { c01: await one("C01"), c02: await one("C02") };
  }

  private async sendAllInner(
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
    stats: { refused: number },
  ): Promise<TopicMailRun> {
    // The run's own clock: `now` plus the time spent since it began (the same as new Date(), but a test can start it anywhere).
    const began = Date.now();
    const clock = () => new Date(now.getTime() + Date.now() - began);
    let sent = 0;
    let failures = 0;
    let refusals = 0;
    let failedAny = false;
    let refusedAny = false;
    /** The first time someone left out comes back (ms): the run is looked at again then, not before. */
    let waitUntil = Infinity;
    /** Real time this run began to look at the audience: corrected addresses are looked for from here on. */
    const scanned = Date.now() - 2000;
    const max = this.dailyMax();
    const budgeted = p.useBudget !== false;
    if (budgeted && (await this.usedToday()) >= max)
      return { state: "budget-reached", sent };
    // C02 holds to half the budget until C01's window has closed; C01 may always use what is left of the whole.
    const half = this.c02HalfMax();
    if (
      p.template === "C02" &&
      !this.c01WindowClosed(clock()) &&
      (await this.usedBy("C02")) >= half
    )
      return { state: "budget-reached", sent };
    await this.sweepSkips(now).catch((e: unknown) =>
      this.logger.warn(`topic mail skip sweep: ${String(e)}`),
    );
    // C01 and C02 keep per-person relay trouble for the window and a cursor; the launch mail (C14) runs as it always did.
    const watch = p.template !== "C14";
    const win = watch ? p.scopeKey : undefined;
    const due = await this.due({ ...p, now: clock(), window: win });
    const { skipEnd, troubles, hasRows } = due;
    waitUntil = Math.min(waitUntil, skipEnd);
    const ck = `${p.template}|${p.eventKey}|${p.scopeKey}`;
    let people = due.people;
    const from = watch ? this.cursor.get(ck) : undefined;
    // The next run starts after the person the last run ended on, goes to the end and then round to the start.
    if (from)
      people = [
        ...people.filter((x) => orderOf(x, from) > 0),
        ...people.filter((x) => orderOf(x, from) <= 0),
      ];
    try {
      for (const person of people) {
        const { id: userId, mailTo } = person;
        // Nothing goes for a question or topic that has closed, or been pulled, since the run began: asked before every mail.
        if (!(await p.stillOpen(clock())))
          return { state: "nothing-open", sent };
        const t = clock();
        const outcome: MailOutcome = await this.mail.send({
          tellRefused: true,
          template: p.template,
          userId,
          eventKey: p.eventKey,
          scopeKey: p.scopeKey,
          vars: p.vars(t),
          // A person who already had trouble in this window gets one try, not three: two calls is the most they cost.
          ...((troubles.get(userId) ?? 0) > 0 ? { attempts: 1 } : {}),
          budget: budgeted
            ? {
                templates: ["C01", "C02"],
                max,
                ...(p.template === "C02" && !this.c01WindowClosed(t)
                  ? { ownMax: half }
                  : {}),
              }
            : undefined,
        });
        if (watch && outcome !== "budget" && outcome !== "capped")
          this.cursor.set(ck, { g: person.g, last: person.last, id: userId });
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
        if (outcome === "refused") {
          // The relay's own answer names this address as the fault: skipped 24 hours at once, by every topic mail. Not
          // counted as a failure. Ten of these in a row (no mail sent between) end the run; each of the ten is already
          // on its 24 hours. Only a sent mail breaks the streak.
          stats.refused++;
          refusedAny = true;
          const until = t.getTime() + REFUSED_SKIP_MS;
          waitUntil = Math.min(waitUntil, until);
          await this.writeSkips(
            p.template,
            [{ userId, address: mailTo, at: t }],
            new Date(until),
            "refused",
          );
          this.logger.warn(
            `${p.template} ${p.eventKey}: relay named one address as the fault, left alone for 24 hours`,
          );
          if (++refusals >= MAX_CONSECUTIVE_REFUSALS) {
            this.logger.error(
              `${p.template} ${p.eventKey}: the relay named ${refusals} addresses in a row (${sent} mails sent in this run): run stopped, those ${refusals} are left alone for 24 hours`,
            );
            return { state: "stopped", sent };
          }
          await this.pause();
          continue;
        }
        if (outcome === "failed") {
          failedAny = true;
          this.note(t.getTime(), false);
          if (win !== undefined)
            troubles.set(
              userId,
              await this.noteTrouble(
                p.template,
                win,
                userId,
                troubles.get(userId) ?? 0,
                t,
              ).catch((e: unknown) => {
                this.logger.warn(`topic mail trouble note: ${String(e)}`);
                return troubles.get(userId) ?? 0;
              }),
            );
          if (++failures >= MAX_CONSECUTIVE_FAILURES) {
            this.logger.error(
              `${p.template} ${p.eventKey}: ${failures} mails in a row failed, run stopped`,
            );
            return { state: "stopped", sent };
          }
        } else if (outcome === "sent") {
          failures = 0;
          refusals = 0;
          sent++;
          this.note(t.getTime(), true);
          if (hasRows.has(userId) && win !== undefined) {
            hasRows.delete(userId);
            await this.prisma.topicMailTrouble
              .deleteMany({ where: { userId, template: p.template } })
              .catch(() => undefined);
          }
          // A success clears any skip of this person (a corrected address that works).
          await this.prisma.topicMailSkip
            .deleteMany({ where: { userId } })
            .catch(() => undefined);
        }
        if (outcome === "sent" || outcome === "failed") await this.pause();
      }
    } finally {
      // nothing pending: every refusal is written at once
    }
    // The whole list was gone through: the next run starts at the beginning.
    this.cursor.delete(ck);
    // Nothing sent and someone failed or was refused: the run did not do its job, so it is never marked finished.
    // The refused are on the skip table, so the next tick asks the people who are left, and the refused when their time is up.
    if (sent === 0 && (failedAny || refusedAny)) return { state: "done", sent };
    const key = `${p.template}|${p.eventKey}`;
    // Someone's mail failed (relay trouble): they were not skipped, so the audience is looked at again soon, not never.
    if (failedAny)
      waitUntil = Math.min(waitUntil, clock().getTime() + FAILED_RETRY_MS);
    // Marked finished only when everyone due was mailed or nobody was due. Someone left out because the relay refused
    // their address is asked again once their time passes (the next tick after that), not never.
    if (waitUntil === Infinity) this.finished.add(key);
    else this.rescanAt.set(key, { at: waitUntil, scanned });
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
          now: new Date(),
        })
      ).people.length;
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
