import { createServer, type Server } from "node:http";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { bootAdmin, type Admin } from "../admin/helpers";
import {
  TopicMailService,
  REFUSED_SKIP_MS,
  addressKey,
} from "../../src/mail/topic-mail.service";
import { MailService } from "../../src/mail/mail.service";
import { DeletionService } from "../../src/me/deletion.service";

/**
 * V-TOPIC-MAILS-2 round 4 (lead rulings 1 to 5 and 7). A real database; the relay is a local stand-in on port 15095
 * whose answer is decided by the test (per address and mail tag). The clock is passed in (Lagos is UTC+1; a tick a minute of
 * simulated time). Nothing real is sent.
 */
// Heavy runs (hundreds of simulated ticks, ten instances): more than the default 30 s when the machine is busy.
jest.setTimeout(300_000);
const PORT = 15095;
const KEY = "topic-mail-4-test-service-key";
const MON = "2026-11-16";
const at = (hhmmZ: string, day = MON) => new Date(`${day}T${hhmmZ}:00.000Z`);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MIN = 60_000;
const addr = (i: number) => `r4-${String(i).padStart(4, "0")}@r4.test`;

type Decide = (to: string, tag: string, n: number) => number;

describe("V-TOPIC-MAILS-2 round 4: one hour first, ten in a row always stop, no address kept", () => {
  let a: Admin;
  let srv: Server;
  let svc: TopicMailService;
  let mailSvc: MailService;
  let cfg: ConfigService;
  let sentTo: Array<{ to: string; tag: string }> = [];
  let calls = new Map<string, number>();
  let decide: Decide = () => 200;
  let n = 0;
  let errors: string[] = [];
  const tried = () => [...calls.values()].reduce((x, y) => x + y, 0);
  const rows = (t: string) =>
    a.prisma.mailLog.count({ where: { template: t } });
  const skipRows = (reason?: string) =>
    a.prisma.topicMailSkip.count(reason ? { where: { reason } } : undefined);
  const goodPeople = async (count: number) => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r4-" } } });
    await a.prisma.user.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        id: `r4-${String(i).padStart(4, "0")}`,
        wawuId: `r4-w-${i}`,
        handle: `r4.u${i}`,
        referralCode: `R4${i}`,
        status: "ACTIVE" as const,
        mailTo: addr(i),
      })),
    });
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
  const question = () =>
    a.prisma.question.create({
      data: {
        text: "What would you change about payday?",
        status: "SCHEDULED",
        kind: "DAILY",
        scheduledFor: new Date(`${MON}T00:00:00.000Z`),
        startsAt: new Date(`${MON}T00:00:00.000Z`),
        endsAt: new Date(
          new Date(`${MON}T00:00:00.000Z`).getTime() + 2 * 86_400_000,
        ),
        voiceCount: 1,
      } as never,
    });
  const inst = () => {
    const s = new TopicMailService(a.prisma, mailSvc, cfg);
    jest.spyOn(s, "pause").mockResolvedValue();
    return s;
  };
  const run = (s: TopicMailService, tpl: "C01" | "C02", t: Date) =>
    tpl === "C01" ? s.runDailyQuestion(t) : s.runWeeklyTopic(t);
  /** C01 starts 06:00Z (07:00 Lagos, window to 11:00Z); C02 starts 05:30Z and stays open all day. */
  const T0 = (tpl: "C01" | "C02") => at(tpl === "C01" ? "06:00" : "05:30");

  /** A tick a minute from `from` to `to` minutes after t0; returns what happened. */
  const drive = async (
    s: TopicMailService,
    tpl: "C01" | "C02",
    t0: Date,
    from: number,
    to: number,
    each?: (m: number) => Promise<void> | void,
  ) => {
    let maxCalls = 0;
    let stopped = 0;
    const before = tried();
    for (let m = from; m <= to; m++) {
      await each?.(m);
      const c = tried();
      const r = await run(s, tpl, plus(t0, m * MIN));
      maxCalls = Math.max(maxCalls, tried() - c);
      if (r.state === "stopped") stopped++;
    }
    return { maxCalls, stopped, calls: tried() - before };
  };
  /** The minute (after t0) when the template had been sent to `count` people, or null. */
  const doneAt = async (
    s: TopicMailService,
    tpl: "C01" | "C02",
    t0: Date,
    from: number,
    to: number,
    count: number,
    each?: (m: number) => Promise<void> | void,
  ) => {
    let maxCalls = 0;
    let stopped = 0;
    let first: number | null = null;
    const before = tried();
    for (let m = from; m <= to; m++) {
      await each?.(m);
      const c = tried();
      const r = await run(s, tpl, plus(t0, m * MIN));
      maxCalls = Math.max(maxCalls, tried() - c);
      if (r.state === "stopped") stopped++;
      if (first === null && (await rows(tpl)) >= count) first = m;
    }
    return { maxCalls, stopped, calls: tried() - before, first };
  };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const b = JSON.parse(raw) as { to: string; tag: string };
        calls.set(b.to, (calls.get(b.to) ?? 0) + 1);
        const st = decide(b.to, b.tag, ++n);
        res.writeHead(st, { "content-type": "application/json" });
        if (st === 200) sentTo.push({ to: b.to, tag: b.tag });
        res.end(
          JSON.stringify(
            st === 200
              ? { id: "x" }
              : st === 422
                ? { code: "invalid_recipient" }
                : { error: "no" },
          ),
        );
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
    decide = () => 200;
    n = 0;
    errors = [];
    delete process.env.TOPIC_MAIL_ENABLED;
    process.env.TOPIC_MAIL_DAILY_MAX = "5000";
    const mem = svc as unknown as {
      finished: Set<string>;
      cappedOn: Map<string, string>;
      rescanAt: Map<string, unknown>;
      lastRun: Map<string, unknown>;
    };
    mem.lastRun.clear();
    mem.finished.clear();
    mem.cappedOn.clear();
    mem.rescanAt.clear();
    await a.prisma.mailLog.deleteMany();
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    await a.prisma.user.updateMany({
      where: { id: { not: { startsWith: "r4-" } } },
      data: { mailTo: null },
    });
  });

  afterAll(async () => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r4-" } } });
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    delete process.env.TOPIC_MAIL_DAILY_MAX;
    jest.restoreAllMocks();
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  // ---------------------------------------------------------------- ruling 3: S2
  describe.each(["C01", "C02"] as const)(
    "S2 %s: the relay refuses only C01 and C02 from the 101st topic mail on, and is put right two hours later",
    (tpl) => {
      it("each tick costs at most 10 calls, relay trouble skips nobody, everybody has the mail at the first tick after the fix, with no restart", async () => {
        await goodPeople(505);
        await topic();
        await question();
        let topicSent = 0;
        let fixed = false;
        decide = (_to, tag) => {
          if (fixed || !/^voices_C0[12]$/.test(tag)) return 200;
          if (topicSent < 100) {
            topicSent++;
            return 200;
          }
          return 404;
        };
        const t0 = T0(tpl);
        const FIX = 120;
        // account mail goes through and is logged all the time (it must not lengthen anything)
        const acct = async (m: number) => {
          await a.prisma.mailLog.create({
            data: {
              userId: "someone",
              template: "B03",
              eventKey: `acct-${m}`,
              createdAt: plus(t0, m * MIN),
            },
          });
        };
        await acct(0);
        const c0 = tried();
        const first = await run(svc, tpl, t0);
        expect(first).toEqual({ state: "stopped", sent: 100 });
        // relay trouble (a bare 404 names no address): five failures in a row end the run, nobody is skipped
        expect(tried() - c0).toBe(105); // 100 sent, then five failures in a row
        const before = await drive(svc, tpl, t0, 1, FIX - 1, acct);
        expect(before.maxCalls).toBe(5); // every later tick: at most 5 calls
        expect(before.stopped).toBe(119);
        expect(before.calls).toBe(595);
        expect(await rows(tpl)).toBe(100);
        expect(await skipRows()).toBe(0); // nobody on a skip, of any kind
        fixed = true;
        const after = await doneAt(svc, tpl, t0, FIX, 299, 505, acct);
        expect(await rows(tpl)).toBe(505);
        expect(await skipRows()).toBe(0);
        expect(after.calls).toBe(405); // one call each, all good
        // put right at minute 120: everybody is mailed by the very next tick, no restart
        expect((after.first ?? 9999) - FIX).toBe(0);
      });
    },
  );

  // ---------------------------------------------------------------- ruling 3: S3
  describe("S3: relay shapes, C01, 200 people, a tick a minute over the window", () => {
    const shape = async (d: (i: number) => Decide) => {
      await goodPeople(200);
      await topic();
      await question();
      let k = 0;
      decide = (to, tag) => d(k++)(to, tag, 0);
      const t0 = T0("C01");
      const r = await drive(svc, "C01", t0, 0, 299);
      return {
        ...r,
        mailed: await rows("C01"),
        again: await skipRows("again"),
        rowsNow: await skipRows(),
      };
    };
    // Relay trouble in three shapes (H1 of the fourth check): a 404 with no address named is the relay's trouble, so
    // every good person is mailed and nobody is skipped.
    it("in turns (404, 200, 404, 200, ...): everybody is mailed, nobody is skipped", async () => {
      const r = await shape((i) => () => (i % 2 === 0 ? 404 : 200));
      expect(r).toMatchObject({ mailed: 200, again: 0, rowsNow: 0 });
    });
    it("nine refused then one accepted, repeating: everybody is mailed, nobody is skipped", async () => {
      const r = await shape((i) => () => (i % 10 === 9 ? 200 : 404));
      expect(r).toMatchObject({ mailed: 200, again: 0, rowsNow: 0 });
    });
    it("the first nine refused, then good: everybody is mailed, nobody is skipped", async () => {
      const r = await shape((i) => () => (i < 9 ? 404 : 200));
      expect(r).toMatchObject({ mailed: 200, again: 0, rowsNow: 0 });
    });
  });

  // ---------------------------------------------------------------- ruling 1
  describe("ruling 1 (round 5): an address the relay names as the fault is skipped 24 hours at the first answer", () => {
    it("one refusal among good people: one 24 hour row at once, whatever was sent before or after it", async () => {
      await goodPeople(20);
      await topic();
      decide = (to) => (to === addr(5) ? 422 : 200);
      await a.prisma.mailLog.create({
        data: {
          userId: "someone",
          template: "B03",
          eventKey: "e",
          createdAt: plus(at("11:00"), -MIN),
        },
      });
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "done", sent: 19 });
      const row = await a.prisma.topicMailSkip.findFirstOrThrow();
      expect(row.reason).toBe("refused");
      expect(row.until.getTime() - at("11:00").getTime()).toBeLessThanOrEqual(
        REFUSED_SKIP_MS + 5000,
      );
      expect(
        row.until.getTime() - at("11:00").getTime(),
      ).toBeGreaterThanOrEqual(REFUSED_SKIP_MS);
    });

    it("a real dead address (fewer than 10 due together): 1 call a day, from the first day", async () => {
      await goodPeople(30);
      await question();
      const bad = [3, 14, 25];
      decide = (to) => (bad.map(addr).includes(to) ? 422 : 200);
      const t0 = at("06:00");
      const day1 = await drive(svc, "C01", t0, 0, 299);
      const per = bad.map((b) => calls.get(addr(b)) ?? 0);
      expect(per).toEqual([1, 1, 1]); // skipped 24 hours at the first answer
      expect(await rows("C01")).toBe(27);
      expect(await skipRows("refused")).toBe(3);
      void day1;
      // the next question, a day later
      const day2 = "2026-11-17";
      await a.prisma.question.create({
        data: {
          text: "Day two?",
          status: "SCHEDULED",
          kind: "DAILY",
          scheduledFor: new Date(`${day2}T00:00:00.000Z`),
          startsAt: new Date(`${day2}T00:00:00.000Z`),
          endsAt: new Date(`${day2}T00:00:00.000Z`).getTime()
            ? new Date(
                new Date(`${day2}T00:00:00.000Z`).getTime() + 2 * 86_400_000,
              )
            : undefined,
          voiceCount: 1,
        } as never,
      });
      const mid = per.reduce((x, y) => x + y, 0);
      for (let m = 0; m < 300; m++)
        await svc.runDailyQuestion(plus(at("06:00", day2), m * MIN));
      const per2 = bad.map((b) => calls.get(addr(b)) ?? 0);
      expect(per2.reduce((x, y) => x + y, 0) - mid).toBe(3); // one call each
      expect(await skipRows("refused")).toBe(3);
      expect(await rows("C01")).toBe(54);
    });

    it("a second refusal with nobody mailed since the first (a relay fault) is one hour again, not 24", async () => {
      await goodPeople(15);
      await topic();
      decide = () => 404;
      for (const m of [0, 1, 61, 62, 122, 123])
        await svc.runWeeklyTopic(plus(at("11:00"), m * MIN));
      expect(await skipRows("again")).toBe(0);
      expect(await rows("C02")).toBe(0);
      decide = () => 200;
      await svc.runWeeklyTopic(plus(at("11:00"), 185 * MIN));
      expect(await rows("C02")).toBe(15);
    });

    it("a refusal for a changed address is a new 24 hour row", async () => {
      await goodPeople(5);
      await topic();
      decide = (to) => (to === addr(1) || to === "r4-new@r4.test" ? 422 : 200);
      await svc.runWeeklyTopic(at("11:00"));
      await a.prisma.user.update({
        where: { id: "r4-0001" },
        data: { mailTo: "r4-new@r4.test" },
      });
      await svc.runWeeklyTopic(plus(at("11:00"), 2 * MIN));
      const row = await a.prisma.topicMailSkip.findFirstOrThrow();
      expect(row.reason).toBe("refused");
    });
  });

  // ---------------------------------------------------------------- ruling 2
  describe("ruling 2: ten refusals in a row always end the run, also after mails went out", () => {
    it("5 sent, 10 refused: stopped with an error line, sent 5, ten 24 hour rows, the next tick goes on", async () => {
      await goodPeople(40);
      await topic();
      decide = (to) =>
        Number(to.slice(3, 7)) >= 5 && Number(to.slice(3, 7)) < 15 ? 422 : 200;
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "stopped", sent: 5 });
      expect(errors).toHaveLength(1);
      expect(tried()).toBe(15);
      expect(await skipRows("refused")).toBe(10);
      const r2 = await svc.runWeeklyTopic(at("11:01"));
      expect(r2).toEqual({ state: "done", sent: 25 });
      expect(tried()).toBe(40);
    });

    it("a sent mail breaks the streak: nine refused, one sent, nine refused, one sent: never stopped", async () => {
      await goodPeople(40);
      await topic();
      decide = (to) => (Number(to.slice(3, 7)) % 10 === 9 ? 200 : 422);
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "done", sent: 4 });
      expect(errors).toHaveLength(0);
      expect(await skipRows("refused")).toBe(36);
    });
  });

  // ---------------------------------------------------------------- ruling 4
  describe("ruling 4: no address is stored", () => {
    it("the table holds a keyed hash, not the address; a changed address is told apart by it", async () => {
      await goodPeople(4);
      await topic();
      decide = (to) => (to === addr(2) ? 422 : 200);
      await svc.runWeeklyTopic(at("11:00"));
      const row = await a.prisma.topicMailSkip.findFirstOrThrow();
      expect(row.addressHash).toBe(addressKey(addr(2)));
      expect(row.addressHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain("r4.test");
      expect(JSON.stringify(row)).not.toContain("@");
      const cols = await a.prisma.$queryRaw<
        Array<{ column_name: string }>
      >`SELECT column_name FROM information_schema.columns WHERE table_name = 'TopicMailSkip'`;
      expect(cols.map((c) => c.column_name).sort()).toEqual(
        [
          "addressHash",
          "createdAt",
          "id",
          "reason",
          "refusedAt",
          "strikes",
          "template",
          "until",
          "userId",
        ].sort(),
      );
    });

    it("starting a deletion removes the person's rows; the purge removes any left", async () => {
      const p = await a.person("r4del");
      const q = await a.person("r4pur");
      for (const id of [p.id, q.id])
        await a.prisma.topicMailSkip.createMany({
          data: ["C01", "C02"].map((template) => ({
            userId: id,
            template,
            addressHash: addressKey("x@y.test"),
            until: plus(new Date(), 3_600_000),
            reason: "first",
          })),
        });
      await a.prisma.topicMailSkip.create({
        data: {
          userId: "other-person",
          template: "C01",
          addressHash: "h",
          until: plus(new Date(), 3_600_000),
          reason: "first",
        },
      });
      await a.h
        .http()
        .delete("/api/v1/me")
        .set(a.auth("r4del"))
        .send({ confirmHandle: p.handle, understandUnitsForfeited: true })
        .expect(202);
      expect(
        await a.prisma.topicMailSkip.count({ where: { userId: p.id } }),
      ).toBe(0);
      // a row written after the deletion began (a run that was already going) goes with the purge
      await a.prisma.topicMailSkip.create({
        data: {
          userId: p.id,
          template: "C01",
          addressHash: "late",
          until: plus(new Date(), 3_600_000),
          reason: "first",
        },
      });
      await a.prisma.user.update({
        where: { id: p.id },
        data: { deletionRequestedAt: new Date(Date.now() - 15 * 86_400_000) },
      });
      await a.h.app.get(DeletionService).purge(p.id);
      expect(
        await a.prisma.topicMailSkip.count({ where: { userId: p.id } }),
      ).toBe(0);
      // the other people's rows are untouched
      expect(
        await a.prisma.topicMailSkip.count({ where: { userId: q.id } }),
      ).toBe(2);
      expect(
        await a.prisma.topicMailSkip.count({
          where: { userId: "other-person" },
        }),
      ).toBe(1);
    });
  });

  // ---------------------------------------------------------------- ruling 5
  describe("ruling 5: a corrected address is asked on the next tick in a running server", () => {
    it("one refusal among 20, the address is corrected: the next minute, same process, the new address is asked", async () => {
      await goodPeople(20);
      await topic();
      decide = (to) => (to === addr(7) ? 422 : 200);
      const r1 = await svc.runWeeklyTopic(at("11:00"));
      expect(r1).toEqual({ state: "done", sent: 19 });
      // the skip is on and the run is waiting for it: nothing is asked while nobody corrects anything
      const n1 = tried();
      expect(await svc.runWeeklyTopic(at("11:01"))).toEqual({
        state: "done",
        sent: 0,
      });
      expect(tried()).toBe(n1);
      await a.prisma.user.update({
        where: { id: "r4-0007" },
        data: { mailTo: "r4-fixed@r4.test" },
      });
      const r2 = await svc.runWeeklyTopic(at("11:02"));
      expect(r2).toEqual({ state: "done", sent: 1 });
      expect(sentTo.map((s) => s.to)).toContain("r4-fixed@r4.test");
    });

    it("same for C01", async () => {
      await goodPeople(20);
      await question();
      decide = (to) => (to === addr(7) ? 422 : 200);
      await svc.runDailyQuestion(at("06:00"));
      await a.prisma.user.update({
        where: { id: "r4-0007" },
        data: { mailTo: "r4-fixed@r4.test" },
      });
      const r2 = await svc.runDailyQuestion(at("06:01"));
      expect(r2).toEqual({ state: "done", sent: 1 });
    });
  });

  // ---------------------------------------------------------------- S5 other shapes
  describe("S5: a person on a skip who changes in some other way", () => {
    it("unsubscribed while skipped, suspended, deletion pending: never asked again, nothing written for them", async () => {
      await goodPeople(10);
      await topic();
      decide = (to) => ([1, 2, 3].map(addr).includes(to) ? 422 : 200);
      await svc.runWeeklyTopic(at("11:00"));
      expect(await skipRows()).toBe(3);
      await a.prisma.userSettings.create({
        data: { userId: "r4-0001", notifyWeeklyTopic: false } as never,
      });
      await a.prisma.user.update({
        where: { id: "r4-0002" },
        data: { status: "SUSPENDED" },
      });
      await a.prisma.user.update({
        where: { id: "r4-0003" },
        data: { status: "DELETION_PENDING" },
      });
      decide = () => 200;
      const before = tried();
      for (const m of [61, 62, 125, 1500])
        await svc.runWeeklyTopic(plus(at("11:00"), m * MIN));
      expect(tried()).toBe(before);
      expect(await rows("C02")).toBe(7);
    });
  });

  // ---------------------------------------------------------------- S4
  describe.each([2, 5, 10] as const)(
    "S4: %i instances on one database",
    (k) => {
      it("budget 500: nobody mailed twice, C02 within its half, one skip row per person and template", async () => {
        await goodPeople(400);
        const badIdx = [0, 3, 7, 11, 20, 33, 50, 60, 70, 80, 90, 100];
        decide = (to) => (badIdx.map(addr).includes(to) ? 422 : 200);
        await topic();
        await question();
        process.env.TOPIC_MAIL_DAILY_MAX = "500";
        const insts = Array.from({ length: k }, () => inst());
        for (let round = 0; round < 4; round++) {
          const t = plus(at("10:00"), round * MIN);
          await Promise.all(
            insts.flatMap((s) => [s.runWeeklyTopic(t), s.runDailyQuestion(t)]),
          );
        }
        const c01 = await rows("C01");
        const c02 = await rows("C02");
        expect(c01 + c02).toBe(500);
        expect(c02).toBeLessThanOrEqual(250);
        const dup = new Map<string, number>();
        for (const s of sentTo) {
          const key = `${s.to}|${s.tag}`;
          dup.set(key, (dup.get(key) ?? 0) + 1);
        }
        expect([...dup.values()].filter((x) => x > 1)).toHaveLength(0);
        const g = await a.prisma.topicMailSkip.groupBy({
          by: ["userId", "template"],
          _count: { _all: true },
        });
        expect(g.every((x) => x._count._all === 1)).toBe(true);
        expect(await skipRows("again")).toBe(0);
        const badCalls = badIdx.reduce(
          (x, b) => x + (calls.get(addr(b)) ?? 0),
          0,
        );
        console.info(
          `R4 S4 ${k} instances: C01 ${c01} C02 ${c02}, skip rows ${await skipRows()}, calls on the 12 bad ${badCalls} (24 needed), errors ${errors.length}`,
        );
      });
    },
  );

  // ---------------------------------------------------------------- sign-in / account mail
  it("account mail: a 422 for B11 is a plain failure and writes no skip row", async () => {
    await goodPeople(2);
    decide = () => 422;
    const b11 = await mailSvc.send({
      template: "B11" as const,
      userId: "r4-0000",
      eventKey: "r4-1",
      vars: {
        idea_text: "a",
        improver_name: "@k",
        improvement_text: "b",
        idea_url: "https://x.test",
      },
    });
    expect(b11).toBe("failed");
    expect(await skipRows()).toBe(0);
  });

  // ---------------------------------------------------------------- ruling 7
  describe("ruling 7: the admin Today numbers", () => {
    it("runInfo gives the last run's state, sent, refused and how many are on a skip now", async () => {
      await goodPeople(30);
      await topic();
      decide = (to) => (Number(to.slice(3, 7)) < 12 ? 422 : 200);
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r.state).toBe("stopped");
      let info = await svc.runInfo(at("11:00"));
      expect(info.c02).toMatchObject({
        state: "stopped",
        sent: 0,
        refused: 10,
        onSkip: 10,
      });
      // round 5: a person skipped for C02 is skipped for C01 too, so both numbers count the same people
      expect(info.c01).toMatchObject({ sent: 0, refused: 0, onSkip: 10 });
      await svc.runWeeklyTopic(at("11:01"));
      info = await svc.runInfo(at("11:01"));
      expect(info.c02).toMatchObject({
        state: "done",
        sent: 18,
        refused: 2,
        onSkip: 12,
      });
    });

    it("the Today service (GET /admin/today) carries the fields", async () => {
      await goodPeople(3);
      await topic();
      decide = () => 422;
      await svc.runWeeklyTopic(at("11:00"));
      const { TodayAdminService } =
        await import("../../src/admin/today.service.js");
      const t = (await a.h.app.get(TodayAdminService).today()) as {
        stats: Record<
          string,
          { state?: string; sent: number; refused: number; onSkip: number }
        >;
      };
      expect(t.stats.weeklyTopicMailRun.state).toBe("done");
      expect(t.stats.weeklyTopicMailRun.refused).toBe(3);
      expect(typeof t.stats.dailyQuestionMailRun.onSkip).toBe("number");
    });
  });
});
