import { appendFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import request from "supertest";
import type { App } from "supertest/types";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { bootAdmin, type Admin } from "../admin/helpers";
import { TopicMailService } from "../../src/mail/topic-mail.service";
import {
  MailService,
  classify429,
  DEFAULT_PAUSE_MS,
} from "../../src/mail/mail.service";
import {
  REFUSED_WAITS_MS,
  MAX_PAUSES,
} from "../../src/mail/topic-mail.service";
import {
  signUnsubscribe,
  verifyUnsubscribe,
} from "../../src/mail/mail-unsubscribe";

/**
 * V-TOPIC-MAILS-2 round 6. People the relay keeps failing never stop the mail for everybody (HIGH-1), the wait after a
 * named refusal grows with a brake (MEDIUM-1), a rate-limit 429 does not end the day (MEDIUM-2), unsubscribe links made
 * with either key work (LOW-1), quiet logs (LOW-3). A real database; the relay is a local stand-in on port 15098.
 * The clock is passed in (Lagos is UTC+1). Nothing real is sent. The numbers go to /tmp/r6-numbers.txt for the report.
 */
jest.setTimeout(600_000);
const PORT = 15098;
const KEY = "topic-mail-6-test-service-key";
const DAYS = ["2026-11-16", "2026-11-17", "2026-11-18"];
const MIN = 60_000;
const at = (hhmmZ: string, day: string) => new Date(`${day}T${hhmmZ}:00.000Z`);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const addr = (i: number) => `r6-${String(i).padStart(4, "0")}@r6.test`;
const note = (line: string) =>
  appendFileSync("/tmp/r6-numbers.txt", line + "\n");

type Resp =
  | number
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | "drop";
type Decide = (to: string, tag: string, n: number) => Resp;

describe("V-TOPIC-MAILS-2 round 6", () => {
  let a: Admin;
  let srv: Server;
  let svc: TopicMailService;
  let mailSvc: MailService;
  let cfg: ConfigService;
  let calls = new Map<string, number>();
  let decide: Decide = () => 200;
  let n = 0;
  let errors: string[] = [];
  let warns: string[] = [];
  let debugs: string[] = [];
  const tried = () => [...calls.values()].reduce((x, y) => x + y, 0);
  const people = async (count: number) => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r6-" } } });
    await a.prisma.user.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        id: `r6-${String(i).padStart(4, "0")}`,
        wawuId: `r6-w-${i}`,
        handle: `r6.u${i}`,
        referralCode: `R6${i}`,
        status: "ACTIVE" as const,
        mailTo: addr(i),
        createdAt: new Date("2026-11-01T09:00:00.000Z"),
      })),
    });
  };
  const question = (day: string) =>
    a.prisma.question.create({
      data: {
        text: `What would you change about payday? ${day}`,
        status: "SCHEDULED",
        kind: "DAILY",
        scheduledFor: new Date(`${day}T00:00:00.000Z`),
        startsAt: new Date(`${day}T00:00:00.000Z`),
        endsAt: new Date(
          new Date(`${day}T00:00:00.000Z`).getTime() + 2 * 86_400_000,
        ),
        voiceCount: 1,
      } as never,
    });
  const topic = () =>
    a.prisma.topic.create({
      data: {
        weekNumber: 46,
        title: "Are You Really Fine?",
        blurb: "Money, mood and Monday.",
        startsOn: new Date("2026-11-15T00:00:00.000Z"),
        endsOn: new Date("2026-11-22T00:00:00.000Z"),
        status: "SCHEDULED",
      } as never,
    });
  const inst = () => {
    const s = new TopicMailService(a.prisma, mailSvc, cfg);
    jest.spyOn(s, "pause").mockResolvedValue();
    return s;
  };
  const snap = () => new Map(calls);
  /** HTTP requests made to these people since `before`. */
  const callsSince = (before: Map<string, number>, idx: number[]) =>
    idx.map((i) => (calls.get(addr(i)) ?? 0) - (before.get(addr(i)) ?? 0));
  /** How many MailLog rows (template, eventKey) each of these people has. */
  const rowsOf = async (tpl: string, eventKey: string) => {
    const r = await a.prisma.mailLog.groupBy({
      by: ["userId"],
      where: { template: tpl, eventKey, userId: { startsWith: "r6-" } },
      _count: true,
    });
    return new Map(r.map((x) => [x.userId, x._count]));
  };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const b = JSON.parse(raw) as { to: string; tag: string };
        calls.set(b.to, (calls.get(b.to) ?? 0) + 1);
        const r = decide(b.to, b.tag, ++n);
        if (r === "drop") return req.socket.destroy();
        const st = typeof r === "number" ? r : r.status;
        const body =
          typeof r === "object"
            ? r.body
            : st === 200
              ? { id: "x" }
              : { error: "no" };
        res.writeHead(st, {
          "content-type": "application/json",
          ...(typeof r === "object" ? r.headers : {}),
        });
        res.end(body === undefined ? "" : JSON.stringify(body));
      });
    });
    await new Promise<void>((r) => srv.listen(PORT, "127.0.0.1", r));
    process.env.WAWU_ID_BASE_URL = `http://127.0.0.1:${PORT}`;
    process.env.INTERNAL_SERVICE_KEY = KEY;
    process.env.MAIL_RETRY_MS = "5";
    process.env.TOPIC_MAIL_PER_SECOND = "1000";
    a = await bootAdmin();
    svc = a.h.app.get(TopicMailService);
    mailSvc = a.h.app.get(MailService);
    cfg = a.h.app.get(ConfigService);
    jest.spyOn(svc, "pause").mockResolvedValue();
    jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation((m: unknown) => void errors.push(String(m)));
    jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation((m: unknown) => void warns.push(String(m)));
    jest
      .spyOn(Logger.prototype, "debug")
      .mockImplementation((m: unknown) => void debugs.push(String(m)));
  });

  beforeEach(async () => {
    calls = new Map();
    decide = () => 200;
    n = 0;
    errors = [];
    warns = [];
    debugs = [];
    process.env.TOPIC_MAIL_DAILY_MAX = "5000";
    svc = inst();
    await a.prisma.mailLog.deleteMany();
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    await a.prisma.user.updateMany({
      where: { id: { not: { startsWith: "r6-" } } },
      data: { mailTo: null },
    });
  });

  afterAll(async () => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r6-" } } });
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    delete process.env.TOPIC_MAIL_DAILY_MAX;
    jest.restoreAllMocks();
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  // ------------------------------------------------------------ HIGH-1
  describe("HIGH-1: people the relay keeps failing never stop the mail for everybody", () => {
    const cases: Array<[string, number, (i: number) => boolean]> = [
      ["5 always-500 addresses first of 200", 200, (i) => i < 5],
      ["5 in the middle of 200", 200, (i) => i >= 100 && i < 105],
      ["every 7th of 210 (30 addresses)", 210, (i) => i % 7 === 6],
    ];
    it.each(cases)(
      "%s: every good person once a day on three days, the failing ones at most 2 sends a day",
      async (name, total, isBad) => {
        await people(total);
        const bad = [...Array(total).keys()].filter(isBad);
        const good = [...Array(total).keys()].filter((i) => !isBad(i));
        const badAddr = new Set(bad.map(addr));
        decide = (to) => (badAddr.has(to) ? 500 : 200);
        const out: string[] = [];
        for (const day of DAYS) {
          const q = await question(day);
          const before = snap();
          const t0 = at("06:00", day);
          for (let k = 0; k < 60; k++)
            await svc.runDailyQuestion(plus(t0, k * MIN));
          const got = await rowsOf("C01", `question:${q.id}`);
          // every good person exactly once, no failing person ever
          for (const i of good)
            expect(got.get(`r6-${String(i).padStart(4, "0")}`)).toBe(1);
          for (const i of bad)
            expect(got.get(`r6-${String(i).padStart(4, "0")}`)).toBeUndefined();
          const c = callsSince(before, bad);
          // two sends: the first with 3 tries, the second with 1
          expect(Math.max(...c)).toBeLessThanOrEqual(4);
          const aside = await a.prisma.topicMailTrouble.count({
            where: { template: "C01", window: day, asideAt: { not: null } },
          });
          expect(aside).toBe(bad.length);
          out.push(
            `${day}: mailed ${got.size}/${good.length}, relay requests to failing people max ${Math.max(...c)} each (total ${c.reduce((x, y) => x + y, 0)}), set aside ${aside}, requests all ${tried() - [...before.values()].reduce((x, y) => x + y, 0)}`,
          );
        }
        note(`HIGH-1 ${name}\n  ${out.join("\n  ")}`);
      },
    );

    it("on the second day the failing people are tried after everybody else", async () => {
      await people(60);
      const badAddr = new Set([0, 1, 2, 3, 4].map(addr));
      const order: string[] = [];
      decide = (to) => {
        order.push(to);
        return badAddr.has(to) ? 500 : 200;
      };
      for (const day of DAYS.slice(0, 2)) {
        await question(day);
        order.length = 0;
        const t0 = at("06:00", day);
        for (let k = 0; k < 10; k++)
          await svc.runDailyQuestion(plus(t0, k * MIN));
        if (day === DAYS[1]) {
          const firstBad = order.findIndex((to) => badAddr.has(to));
          expect(firstBad).toBe(55); // all 55 good people first
        }
      }
    });

    it.each([
      ["nobody has been mailed yet", 0],
      ["50 people were mailed just before it went down", 50],
    ])(
      "the relay is down for 20 minutes, then fine (%s): everyone due is mailed once, nobody is set aside",
      async (_n, okFirst) => {
        await people(200);
        const q = await question(DAYS[0]);
        let down = true;
        let sends = 0;
        decide = () => {
          if (okFirst && sends < okFirst) {
            sends++;
            return 200;
          }
          return down ? 500 : 200;
        };
        const t0 = at("06:00", DAYS[0]);
        for (let k = 0; k < 60; k++) {
          if (k === 20 + (okFirst ? 1 : 0)) down = false;
          await svc.runDailyQuestion(plus(t0, k * MIN));
        }
        const got = await rowsOf("C01", `question:${q.id}`);
        expect(got.size).toBe(200);
        expect([...got.values()].every((v) => v === 1)).toBe(true);
        const aside = await a.prisma.topicMailTrouble.count({
          where: { asideAt: { not: null } },
        });
        expect(aside).toBe(0);
        note(
          `HIGH-1 relay down 20 minutes (${_n}): mailed ${got.size}/200 once each, set aside ${aside}, requests ${tried()}`,
        );
      },
    );

    it("a run stopped by five failures does not make the next tick start at the same five (C02 too)", async () => {
      await people(40);
      await topic();
      const badAddr = new Set([0, 1, 2, 3, 4].map(addr));
      decide = (to) => (badAddr.has(to) ? 500 : 200);
      const seen: string[] = [];
      const base = decide;
      decide = (to, tag, k) => {
        seen.push(to);
        return base(to, tag, k);
      };
      const t0 = at("05:30", "2026-11-16");
      const r1 = await svc.runWeeklyTopic(t0);
      expect(r1.state).toBe("stopped");
      seen.length = 0;
      const r2 = await svc.runWeeklyTopic(plus(t0, MIN));
      // the second run begins after the fifth person tried
      expect(seen[0]).toBe(addr(5));
      expect(r2.sent).toBe(35);
      expect(await a.prisma.mailLog.count({ where: { template: "C02" } })).toBe(
        35,
      );
    });
  });

  // ------------------------------------------------------------ MEDIUM-1
  describe("MEDIUM-1: the wait after a named refusal grows, with a brake", () => {
    const NAMED: Resp = { status: 422, body: { code: "invalid_recipient" } };
    it("1 hour, 6 hours, 24 hours, 7 days, and it stays at 7 days; a sent mail clears it", async () => {
      expect(REFUSED_WAITS_MS).toEqual([
        3_600_000, 21_600_000, 86_400_000, 604_800_000,
      ]);
      await people(30);
      await a.prisma.topic.create({
        data: {
          weekNumber: 46,
          title: "Long topic",
          blurb: "x",
          startsOn: new Date("2026-11-01T00:00:00.000Z"),
          endsOn: new Date("2026-12-31T00:00:00.000Z"),
          status: "SCHEDULED",
        } as never,
      });
      decide = (to) => (to === addr(7) ? NAMED : 200);
      const row = () =>
        a.prisma.topicMailSkip.findFirstOrThrow({
          where: { userId: "r6-0007" },
        });
      let t = at("11:00", "2026-11-16");
      const seen: Array<[number, number]> = [];
      for (let k = 0; k < 6; k++) {
        const before = calls.get(addr(7)) ?? 0;
        // a fresh service each time: nothing is kept in memory, only the database
        await inst().runWeeklyTopic(t);
        expect(calls.get(addr(7))).toBe(before + 1);
        const r = await row();
        seen.push([r.strikes, r.until.getTime() - t.getTime()]);
        // inside the wait: not asked
        await inst().runWeeklyTopic(
          plus(t, r.until.getTime() - t.getTime() - 2 * MIN),
        );
        expect(calls.get(addr(7))).toBe(before + 1);
        t = plus(r.until, 60_000);
      }
      const want = [1, 2, 3, 4, 4, 4];
      const waits = [0, 1, 2, 3, 3, 3].map((i) => REFUSED_WAITS_MS[i]);
      seen.forEach(([st, w], i) => {
        expect(st).toBe(want[i]);
        expect(w).toBeGreaterThanOrEqual(waits[i]);
        expect(w).toBeLessThan(waits[i] + 5000);
      });
      note(
        `MEDIUM-1 ladder (strikes, wait hours): ${seen.map(([a1, w]) => `${a1}:${Math.round(w / 3.6e6)}h`).join(" ")}`,
      );
      // a sent mail clears the row
      decide = () => 200;
      const ok = await inst().runWeeklyTopic(plus(t, 8 * 86_400_000));
      expect(ok.sent).toBe(1);
      expect(await a.prisma.topicMailSkip.count()).toBe(0);
    });

    it("the brake: 600 people, the relay names every address for an hour, then is fine: everybody is mailed in the window, nobody carries a wait", async () => {
      await people(600);
      const q = await question(DAYS[0]);
      let named = true;
      decide = () => (named ? NAMED : 200);
      const t0 = at("06:00", DAYS[0]);
      let outageCalls = 0;
      for (let k = 0; k < 120; k++) {
        if (k === 60) {
          outageCalls = tried();
          named = false;
        }
        await svc.runDailyQuestion(plus(t0, k * MIN));
        expect(await a.prisma.topicMailSkip.count()).toBe(0);
      }
      const got = await rowsOf("C01", `question:${q.id}`);
      expect(got.size).toBe(600);
      expect([...got.values()].every((v) => v === 1)).toBe(true);
      expect(warns.filter((w) => /taken back/.test(w)).length).toBeGreaterThan(
        0,
      );
      expect(errors).toHaveLength(0);
      note(
        `MEDIUM-1 600 people refused for an hour: mailed ${got.size}/600, requests during the hour ${outageCalls} (10 a tick), skip rows 0, requests in all ${tried()}`,
      );
    });

    it("a real dead address among good people: 1 call, nothing for an hour, then the next wait; fewer calls on later days", async () => {
      await people(30);
      decide = (to) => (to === addr(3) ? NAMED : 200);
      const per: number[] = [];
      let prev = 0;
      for (const day of DAYS) {
        await question(day);
        const t0 = at("06:00", day);
        for (let k = 0; k < 300; k++) {
          await svc.runDailyQuestion(plus(t0, k * MIN));
          if (day === DAYS[0] && k === 59) expect(calls.get(addr(3))).toBe(1); // nothing for the first hour
        }
        per.push((calls.get(addr(3)) ?? 0) - prev);
        prev = calls.get(addr(3)) ?? 0;
      }
      // day 1: the first answer and the one an hour later; day 2: one; day 3: one
      expect(per[0]).toBe(2);
      expect(per[1]).toBeLessThanOrEqual(1);
      expect(per[2]).toBeLessThanOrEqual(1);
      note(
        `MEDIUM-1 one dead address, requests per day over 3 days: ${per.join(", ")}`,
      );
    });

    it("quiet logs: ten refusals in a row in the steady state log at debug, no error, and the run shows done", async () => {
      await people(80);
      await question(DAYS[0]);
      // 40 good people mailed first, then 10 dead in a row, then good: not the brake (10 of 50 tried is 20%)
      const dead = new Set(Array.from({ length: 10 }, (_, i) => addr(40 + i)));
      decide = (to) => (dead.has(to) ? NAMED : 200);
      const r = await svc.runDailyQuestion(at("06:00", DAYS[0]));
      expect(r.state).toBe("stopped");
      expect(errors).toHaveLength(0);
      expect(debugs.some((d) => /addresses in a row/.test(d))).toBe(true);
      const info = await svc.runInfo(at("06:00", DAYS[0]));
      expect(info.c01.state).toBe("done");
      expect(info.c01.refused).toBe(10);
      expect(info.c01.onSkip).toBe(10);
    });
  });

  // ------------------------------------------------------------ MEDIUM-2
  describe("MEDIUM-2: a 429 that is a rate limit does not end the day", () => {
    it("classify429 tells the daily allowance from a rate limit", () => {
      expect(classify429("daily_cap", null)).toEqual({ kind: "daily" });
      expect(classify429("provider_monthly_quota", "30")).toEqual({
        kind: "daily",
      });
      expect(classify429("rate_limited", "30")).toEqual({
        kind: "pause",
        ms: 30_000,
      });
      expect(classify429("", "600")).toEqual({ kind: "pause", ms: 600_000 });
      expect(classify429("", null)).toEqual({
        kind: "pause",
        ms: DEFAULT_PAUSE_MS,
      });
      expect(classify429("something_new", null)).toEqual({
        kind: "pause",
        ms: 120_000,
      });
      expect(classify429("", "999999")).toEqual({
        kind: "pause",
        ms: 1_800_000,
      });
    });

    it.each([
      ["a bare 429", { status: 429 }],
      [
        "a 429 with Retry-After 600",
        { status: 429, headers: { "retry-after": "600" } },
      ],
      [
        "a 429 coded rate_limited",
        { status: 429, body: { code: "rate_limited" } },
      ],
    ])(
      "%s after the 101st mail, fine ten minutes later: all 300 mailed that day",
      async (name, limit) => {
        await people(300);
        const q = await question(DAYS[0]);
        let sent = 0;
        let minute = 0;
        let limited = 0;
        decide = () => {
          if (sent >= 100 && minute < 10) {
            limited++;
            return limit;
          }
          sent++;
          return 200;
        };
        const t0 = at("06:00", DAYS[0]);
        for (minute = 0; minute < 60; minute++)
          await svc.runDailyQuestion(plus(t0, minute * MIN));
        const got = await rowsOf("C01", `question:${q.id}`);
        expect(got.size).toBe(300);
        expect([...got.values()].every((v) => v === 1)).toBe(true);
        note(
          `MEDIUM-2 ${name}: mailed ${got.size}/300 once each, requests that were rate limited ${limited}`,
        );
      },
    );

    it("the relay's own daily limit code ends the Lagos day for that mail", async () => {
      await people(300);
      const q = await question(DAYS[0]);
      let sent = 0;
      decide = () =>
        sent >= 100
          ? { status: 429, body: { code: "daily_cap" } }
          : (sent++, 200);
      const t0 = at("06:00", DAYS[0]);
      for (let k = 0; k < 30; k++)
        await svc.runDailyQuestion(plus(t0, k * MIN));
      expect((await rowsOf("C01", `question:${q.id}`)).size).toBe(100);
      expect(tried()).toBe(101);
    });

    it("a relay that rate limits all the time: 5 pauses, then the day is over for that mail", async () => {
      await people(50);
      await question(DAYS[0]);
      decide = () => ({ status: 429 });
      const t0 = at("06:00", DAYS[0]);
      for (let k = 0; k < 40; k++)
        await svc.runDailyQuestion(plus(t0, k * MIN));
      expect(tried()).toBe(MAX_PAUSES + 1);
      note(
        `MEDIUM-2 relay rate limits all hour: ${tried()} requests, then capped for the day`,
      );
    });
  });

  // ------------------------------------------------------------ LOW-1
  describe("LOW-1: unsubscribe links signed with either key keep working", () => {
    afterEach(() => {
      delete process.env.MAIL_UNSUBSCRIBE_SECRET;
    });
    it("verification accepts one key or several; a wrong key or an empty list is refused", () => {
      const tok = signUnsubscribe("k1", "u1", "dq");
      expect(verifyUnsubscribe("k1", tok)).toEqual({
        userId: "u1",
        kind: "dq",
      });
      expect(verifyUnsubscribe(["k2", "k1"], tok)).toEqual({
        userId: "u1",
        kind: "dq",
      });
      expect(verifyUnsubscribe(["k2"], tok)).toBeNull();
      expect(verifyUnsubscribe([], tok)).toBeNull();
      expect(verifyUnsubscribe("", tok)).toBeNull();
    });
    it("a link made before the secret was set still turns the switch off after it is set; new links use the secret", async () => {
      await people(2);
      delete process.env.MAIL_UNSUBSCRIBE_SECRET;
      const old = signUnsubscribe(KEY, "r6-0000", "dq"); // signed with the service key, as before the secret existed
      process.env.MAIL_UNSUBSCRIBE_SECRET = "a-later-secret-for-links";
      expect(mailSvc.unsubscribeSecret()).toBe("a-later-secret-for-links");
      const fresh = signUnsubscribe(
        mailSvc.unsubscribeSecret(),
        "r6-0001",
        "dq",
      );
      const http = () => request(a.h.app.getHttpServer() as App);
      await http()
        .post(`/api/v1/mail/unsubscribe?t=${encodeURIComponent(old)}`)
        .expect(201);
      await http()
        .post(`/api/v1/mail/unsubscribe?t=${encodeURIComponent(fresh)}`)
        .expect(201);
      for (const id of ["r6-0000", "r6-0001"])
        expect(
          (await a.prisma.userSettings.findUnique({ where: { userId: id } }))
            ?.notifyDailyQuestion,
        ).toBe(false);
      await http()
        .post(
          `/api/v1/mail/unsubscribe?t=${encodeURIComponent(signUnsubscribe("other", "r6-0000", "dq"))}`,
        )
        .expect(400);
    });
  });
});
