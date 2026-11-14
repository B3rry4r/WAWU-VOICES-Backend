import { appendFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { bootAdmin, type Admin } from "../admin/helpers";
import { TopicMailService } from "../../src/mail/topic-mail.service";
import { MailService } from "../../src/mail/mail.service";

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
});
