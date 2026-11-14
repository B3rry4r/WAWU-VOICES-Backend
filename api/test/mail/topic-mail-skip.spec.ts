import { createServer, type Server } from "node:http";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { bootAdmin, type Admin } from "../admin/helpers";
import {
  TopicMailService,
  REFUSED_SKIP_MS,
  TROUBLE_SKIP_MS,
  SKIP_KEEP_MS,
} from "../../src/mail/topic-mail.service";
import { MailService } from "../../src/mail/mail.service";

/**
 * V-TOPIC-MAILS-2 round 3: a refused address is remembered in the database (TopicMailSkip), not in memory. Refused
 * people are not asked until their time is up; 10 refusals in a row with nothing sent put those 10 on a one hour skip
 * so the next tick goes on to the next people. A real database; the relay is a local stand-in on port 15094.
 * Nothing real is sent. Lagos is UTC+1.
 */
const PORT = 15094;
const KEY = "topic-mail-3-test-service-key";
const MON = "2026-11-16";
const TUE = "2026-11-17";
const at = (hhmmZ: string, day = MON) => new Date(`${day}T${hhmmZ}:00.000Z`);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const addr = (i: number) => `sk-${String(i).padStart(4, "0")}@sk3.test`;

describe("V-TOPIC-MAILS-2 round 3: refusals are remembered in the database", () => {
  let a: Admin;
  let srv: Server;
  let svc: TopicMailService;
  let mailSvc: MailService;
  let cfg: ConfigService;
  let sentTo: string[] = [];
  let calls = new Map<string, number>();
  let bad = new Set<string>();
  let badStatus = 422;
  let all = 0;
  let errors: string[] = [];
  const tried = () => [...calls.values()].reduce((x, y) => x + y, 0);
  const callsOn = (set: Set<string>) =>
    [...set].reduce((x, b) => x + (calls.get(b) ?? 0), 0);
  const skips = () => a.prisma.topicMailSkip.count();
  const rows = (t: string) =>
    a.prisma.mailLog.count({ where: { template: t } });

  const people = async (n: number, badIdx: number[] = []) => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "sk-" } } });
    await a.prisma.user.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        id: `sk-${String(i).padStart(4, "0")}`,
        wawuId: `sk3-w-${i}`,
        handle: `sk3.u${i}`,
        referralCode: `SK3${i}`,
        status: "ACTIVE" as const,
        mailTo: addr(i),
      })),
    });
    bad = new Set(badIdx.map(addr));
  };
  const topic = () =>
    a.prisma.topic.create({
      data: {
        weekNumber: 46,
        title: "Are You Really Fine?",
        blurb: "Money, mood and Monday.",
        startsOn: new Date(`${MON}T00:00:00.000Z`),
        endsOn: new Date("2026-11-22T00:00:00.000Z"),
        status: "SCHEDULED",
      } as never,
    });
  const question = (day = MON, text = "What would you change about payday?") =>
    a.prisma.question.create({
      data: {
        text,
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
  const inst = () => {
    const s = new TopicMailService(a.prisma, mailSvc, cfg);
    jest.spyOn(s, "pause").mockResolvedValue();
    return s;
  };
  const restart = () => inst(); // a restart is a new service object: nothing in memory
  const run = (s: TopicMailService, tpl: "C01" | "C02", t: Date) =>
    tpl === "C01" ? s.runDailyQuestion(t) : s.runWeeklyTopic(t);
  /** C01 runs at 06:00Z (07:00 Lagos), C02 at 11:00Z; both are inside their windows. */
  const T0 = (tpl: "C01" | "C02") => at(tpl === "C01" ? "06:00" : "11:00");

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const to = (JSON.parse(raw) as { to: string }).to;
        calls.set(to, (calls.get(to) ?? 0) + 1);
        const st = all || (bad.has(to) ? badStatus : 200);
        res.writeHead(st, { "content-type": "application/json" });
        if (st === 200) sentTo.push(to);
        res.end(JSON.stringify(st === 200 ? { id: "x" } : { error: "no" }));
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
  });

  beforeEach(async () => {
    sentTo = [];
    calls = new Map();
    bad = new Set();
    badStatus = 422;
    all = 0;
    errors = [];
    delete process.env.TOPIC_MAIL_ENABLED;
    process.env.TOPIC_MAIL_DAILY_MAX = "5000";
    const mem = svc as unknown as {
      finished: Set<string>;
      cappedOn: Map<string, string>;
      rescanAt: Map<string, number>;
    };
    mem.finished.clear();
    mem.cappedOn.clear();
    mem.rescanAt.clear();
    await a.prisma.mailLog.deleteMany();
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    // only this spec's people are due
    await a.prisma.user.updateMany({
      where: { id: { not: { startsWith: "sk-" } } },
      data: { mailTo: null },
    });
  });

  afterAll(async () => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "sk-" } } });
    await a.prisma.topicMailSkip.deleteMany();
    delete process.env.TOPIC_MAIL_DAILY_MAX;
    jest.restoreAllMocks();
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  describe.each(["C01", "C02"] as const)(
    "%s: 10 bad addresses first among 500 good ones",
    (tpl) => {
      it("the first tick stops on the 10 (one hour skip), the second tick mails all 500, the 10 come back only after their hour", async () => {
        await people(510, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        await topic();
        await question();
        const t0 = T0(tpl);
        const r1 = await run(svc, tpl, t0);
        expect(r1).toEqual({ state: "stopped", sent: 0 });
        expect(tried()).toBe(10);
        expect(errors.length).toBeGreaterThan(0);
        expect(await skips()).toBe(10);
        const row = await a.prisma.topicMailSkip.findFirstOrThrow();
        expect(row.reason).toBe("relay-trouble");
        expect(row.until.getTime() - t0.getTime()).toBeLessThanOrEqual(
          TROUBLE_SKIP_MS + 5000,
        );
        expect(row.until.getTime() - t0.getTime()).toBeGreaterThan(
          TROUBLE_SKIP_MS - 5000,
        );
        // second tick: the good people
        const r2 = await run(svc, tpl, plus(t0, 60_000));
        expect(r2).toEqual({ state: "done", sent: 500 });
        expect(await rows(tpl)).toBe(500);
        expect(new Set(sentTo).size).toBe(500);
        expect(callsOn(bad)).toBe(10); // not asked again
        // 30 minutes on: still not asked; an hour on: asked once more
        await run(svc, tpl, plus(t0, 30 * 60_000));
        expect(callsOn(bad)).toBe(10);
        const r3 = await run(svc, tpl, plus(t0, TROUBLE_SKIP_MS + 5000));
        expect(callsOn(bad)).toBe(20);
        expect(r3.sent).toBe(0);
        expect(await skips()).toBe(10); // the same 10 rows, extended
      });
    },
  );

  describe.each([
    ["with a restart between the days", true],
    ["without a restart", false],
  ] as const)(
    "12 bad among 288 good, day one then day two, %s",
    (label, restartIt) => {
      it("everyone good is mailed each day, no tick stops for ever, and the calls on bad addresses stay bounded", async () => {
        const badIdx = Array.from({ length: 12 }, (_, i) => 5 + i * 24);
        await people(300, badIdx);
        await question(MON, "Day one question?");
        await question(TUE, "Day two question?");
        let s = svc;
        // A tick every 5 minutes from 06:00Z to 10:55Z (the window ends 11:00Z).
        const day = async (d: string) => {
          const before = callsOn(bad);
          let stopped = 0;
          let ticks = 0;
          for (let m = 0; m < 300; m += 5) {
            const r = await s.runDailyQuestion(
              plus(at("06:00", d), m * 60_000),
            );
            ticks++;
            if (r.state === "stopped") stopped++;
          }
          return { calls: callsOn(bad) - before, stopped, ticks };
        };
        const d1 = await day(MON);
        expect(sentTo.filter((x) => !bad.has(x))).toHaveLength(288);
        expect(await rows("C01")).toBe(288);
        expect(d1.calls).toBe(12); // each bad address asked once on day one
        expect(d1.stopped).toBe(0);
        if (restartIt) s = restart();
        const mailedD1 = sentTo.length;
        const d2 = await day(TUE);
        expect(sentTo.length - mailedD1).toBe(288); // everyone good is mailed on day two too
        expect(await rows("C01")).toBe(576);
        // Bound: a bad address is asked when the day starts (its 24 h are up) and then, because nothing is sent in
        // the later ticks, at most once an hour while the window is open: 6 asks each, 12 x 6 = 72 calls a day.
        expect(d2.calls).toBeLessThanOrEqual(12 * 6);
        expect(d2.stopped).toBeLessThanOrEqual(6);
        expect(d2.stopped).toBeLessThan(d2.ticks / 5);
        console.info(
          `skip spec, ${label}: day one bad calls ${d1.calls}, day two bad calls ${d2.calls}, stopped ticks ${d2.stopped} of ${d2.ticks}`,
        );
      });
    },
  );

  it("100 people with 10 bad in a row in the middle: all 90 good are mailed in the same run", async () => {
    await people(
      100,
      Array.from({ length: 10 }, (_, i) => 40 + i),
    );
    await topic();
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "done", sent: 90 });
    expect(errors).toHaveLength(0);
    expect(await rows("C02")).toBe(90);
    expect(await skips()).toBe(10);
    expect((await a.prisma.topicMailSkip.findFirstOrThrow()).reason).toBe(
      "refused",
    );
    // the next tick asks nobody
    const n = tried();
    await svc.runWeeklyTopic(at("11:01"));
    expect(tried()).toBe(n);
    // and they stay out until their 24 hours are up
    await svc.runWeeklyTopic(plus(at("11:00"), REFUSED_SKIP_MS - 60_000));
    expect(tried()).toBe(n);
    await svc.runWeeklyTopic(plus(at("11:00"), REFUSED_SKIP_MS + 5000));
    expect(callsOn(bad)).toBe(20);
  });

  it("after a mail has gone out, any number of refusals only skip those people (24 hours) and the run goes on", async () => {
    await people(
      60,
      Array.from({ length: 25 }, (_, i) => 1 + i),
    );
    await topic();
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "done", sent: 35 });
    expect(errors).toHaveLength(0);
    expect(await skips()).toBe(25);
  });

  describe.each(["C01", "C02"] as const)(
    "%s: the relay answers 404 to everyone (a wrong relay address)",
    (tpl) => {
      it("at most 10 calls a tick, stopped, an error line; when healthy, everyone is mailed within the hour with no restart", async () => {
        await people(60);
        await topic();
        await question();
        all = 404;
        const t0 = T0(tpl);
        for (let k = 0; k < 6; k++) {
          const before = tried();
          const r = await run(svc, tpl, plus(t0, k * 60_000));
          expect(r).toEqual({ state: "stopped", sent: 0 });
          expect(tried() - before).toBe(10);
        }
        expect(errors.length).toBe(6);
        expect(await rows(tpl)).toBe(0);
        expect(await skips()).toBe(60);
        all = 0;
        // healthy again: the 60 are all out for their hour; nothing is asked meanwhile
        const calm = tried();
        const r7 = await run(svc, tpl, plus(t0, 6 * 60_000));
        expect(r7).toEqual({ state: "done", sent: 0 });
        expect(tried()).toBe(calm);
        // an hour after the first stop the first 10 are mailed, and so on: all within an hour of the last stop
        let total = 0;
        for (let m = 61; m <= 67; m++)
          total += (await run(svc, tpl, plus(t0, m * 60_000 + 5000))).sent;
        expect(total).toBe(60);
        expect(await rows(tpl)).toBe(60);
        expect(new Set(sentTo).size).toBe(60);
      });
    },
  );

  describe.each([401, 403] as const)(
    "the relay answers %i to everyone",
    (st) => {
      it("at most 5 calls, stopped, retried every tick, recovers at once, nobody skipped", async () => {
        await people(40);
        await topic();
        all = st;
        for (let k = 0; k < 3; k++) {
          const before = tried();
          const r = await svc.runWeeklyTopic(plus(at("11:00"), k * 60_000));
          expect(r).toEqual({ state: "stopped", sent: 0 });
          expect(tried() - before).toBeLessThanOrEqual(5);
          expect(tried() - before).toBeGreaterThan(0);
        }
        expect(await skips()).toBe(0);
        all = 0;
        expect(await svc.runWeeklyTopic(at("11:10"))).toEqual({
          state: "done",
          sent: 40,
        });
      });
    },
  );

  describe.each([2, 5] as const)("%i instances at once", (k) => {
    it("nobody is mailed twice, the budget and the half rule hold, skip rows are not duplicated", async () => {
      await people(120, [0, 3, 7, 11, 20, 33, 50, 60, 70, 80, 90, 100]);
      await topic();
      await question();
      process.env.TOPIC_MAIL_DAILY_MAX = "40";
      const insts = Array.from({ length: k }, () => inst());
      // 10:00Z is 11:00 Lagos, before C01's window closes, so C02 holds to half the budget (20)
      const t = at("10:00");
      await Promise.all(
        insts.flatMap((s) => [s.runWeeklyTopic(t), s.runDailyQuestion(t)]),
      );
      const c01 = await rows("C01");
      const c02 = await rows("C02");
      expect(c01 + c02).toBeLessThanOrEqual(40);
      expect(c02).toBeLessThanOrEqual(20);
      expect(c01 + c02).toBe(40);
      // one person may get C01 and C02 (two mails); nobody gets the same mail twice
      const keys = await a.prisma.mailLog.groupBy({
        by: ["userId", "template", "eventKey"],
        _count: { _all: true },
      });
      expect(keys).toHaveLength(c01 + c02);
      const skipRows = await a.prisma.topicMailSkip.groupBy({
        by: ["userId", "template"],
        _count: { _all: true },
      });
      expect(skipRows.every((x) => x._count._all === 1)).toBe(true);
      expect(skipRows.length).toBe(await skips());
    });
  });

  it("a skipped person uses no budget place and is never marked as mailed", async () => {
    await people(5);
    await topic();
    const t = at("11:00");
    for (const i of [0, 1])
      await a.prisma.topicMailSkip.create({
        data: {
          userId: `sk-000${i}`,
          template: "C02",
          address: addr(i),
          until: plus(t, 3_600_000),
          reason: "refused",
        },
      });
    process.env.TOPIC_MAIL_DAILY_MAX = "3";
    const r = await svc.runWeeklyTopic(t);
    // 3 places, 3 people not skipped: all three mailed; the skipped asked 0 times and have no row
    expect(r).toEqual({ state: "done", sent: 3 });
    expect(calls.get(addr(0))).toBeUndefined();
    expect(calls.get(addr(1))).toBeUndefined();
    expect(
      await a.prisma.mailLog.count({
        where: { userId: { in: ["sk-0000", "sk-0001"] } },
      }),
    ).toBe(0);
    expect(await rows("C02")).toBe(3);
  });

  it("a person whose address changed is not skipped (the skip belongs to the address)", async () => {
    await people(3, [0]);
    await topic();
    await svc.runWeeklyTopic(at("11:00"));
    expect(await skips()).toBe(1);
    await a.prisma.user.update({
      where: { id: "sk-0000" },
      data: { mailTo: "sk-new@sk3.test" },
    });
    const r = await restart().runWeeklyTopic(at("11:05"));
    expect(r.sent).toBe(1);
    expect(sentTo).toContain("sk-new@sk3.test");
  });

  it("a small audience refused by a relay that never delivered is not marked finished and is asked again within the hour (N2)", async () => {
    await people(8);
    await topic();
    all = 404;
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "done", sent: 0 });
    expect(tried()).toBe(8);
    expect((svc as unknown as { finished: Set<string> }).finished.size).toBe(0);
    expect((await a.prisma.topicMailSkip.findFirstOrThrow()).reason).toBe(
      "relay-trouble",
    );
    all = 0;
    const r2 = await svc.runWeeklyTopic(
      plus(at("11:00"), TROUBLE_SKIP_MS + 5000),
    );
    expect(r2).toEqual({ state: "done", sent: 8 });
  });

  it("the same kind of run, when mail went out lately, skips for 24 hours (the addresses are the fault)", async () => {
    await people(3, [0, 1, 2]);
    await topic();
    await a.prisma.mailLog.create({
      data: {
        userId: "someone",
        template: "B03",
        eventKey: "e",
        createdAt: plus(at("11:00"), -3_600_000),
      },
    });
    await svc.runWeeklyTopic(at("11:00"));
    const rowsNow = await a.prisma.topicMailSkip.findMany();
    expect(rowsNow).toHaveLength(3);
    expect(rowsNow.every((x) => x.reason === "refused")).toBe(true);
    expect((svc as unknown as { finished: Set<string> }).finished.size).toBe(0);
  });

  it("the run removes skip rows whose time is long past, and keeps the rest", async () => {
    await people(3);
    await topic();
    const t = at("11:00");
    await a.prisma.topicMailSkip.createMany({
      data: [
        {
          userId: "old",
          template: "C02",
          address: "o@x.test",
          until: plus(t, -SKIP_KEEP_MS - 3_600_000),
          reason: "refused",
        },
        {
          userId: "recent",
          template: "C02",
          address: "r@x.test",
          until: plus(t, -3_600_000),
          reason: "refused",
        },
      ],
    });
    await inst().runWeeklyTopic(t);
    const left = (await a.prisma.topicMailSkip.findMany()).map((x) => x.userId);
    expect(left).toEqual(["recent"]);
  });

  it("sign-in and account mails: a 422 is a plain failure, no skip row is written", async () => {
    await people(2);
    all = 422;
    const b11 = await mailSvc.send({
      template: "B11" as const,
      userId: "sk-0000",
      eventKey: "i-r3-1",
      vars: {
        idea_text: "a",
        improver_name: "@k",
        improvement_text: "b",
        idea_url: "https://x.test",
      },
    });
    expect(b11).toBe("failed");
    const a10 = await mailSvc.sendNotice({
      template: "A10",
      userId: "sk-0001",
      wawuId: "sk3-w-1",
      kind: "account_deletion_started",
      data: {},
      eventKey: "r3-a10",
    });
    expect(a10).toBe("failed");
    expect(await skips()).toBe(0);
  });
});
