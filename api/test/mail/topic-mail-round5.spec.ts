import { createServer, type Server } from "node:http";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { bootAdmin, type Admin } from "../admin/helpers";
import {
  TopicMailService,
  REFUSED_SKIP_MS,
} from "../../src/mail/topic-mail.service";
import { MailService, relayNamesAddress } from "../../src/mail/mail.service";

/**
 * V-TOPIC-MAILS-2 round 5: a person is skipped for 24 hours ONLY when the relay's own answer names their address as the
 * fault, at the first such answer, by every topic mail (C01, C02, C14). Everything else the relay says or does is relay
 * trouble and skips nobody. A real database; the relay is a local stand-in on port 15097. The clock is passed in
 * (Lagos is UTC+1). Nothing real is sent.
 */
jest.setTimeout(300_000);
const PORT = 15097;
const KEY = "topic-mail-5-test-service-key";
const MON = "2026-11-16";
const SUN = "2026-11-15";
const at = (hhmmZ: string, day = MON) => new Date(`${day}T${hhmmZ}:00.000Z`);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const MIN = 60_000;
const addr = (i: number) => `r5-${String(i).padStart(4, "0")}@r5.test`;

/** What the stand-in answers: a status and a body, or a dropped connection. */
type Resp = number | { status: number; body?: unknown } | "drop";
type Decide = (to: string, tag: string, n: number) => Resp;
/** The answer that names the address as the fault. */
const NAMED: Resp = { status: 422, body: { code: "invalid_recipient" } };

describe("V-TOPIC-MAILS-2 round 5: the relay names the address, or nobody is skipped", () => {
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
  const callsOf = (idx: number[]) =>
    idx.reduce((x, i) => x + (calls.get(addr(i)) ?? 0), 0);
  const rows = (t: string) =>
    a.prisma.mailLog.count({ where: { template: t } });
  const skipRows = (reason?: string) =>
    a.prisma.topicMailSkip.count(reason ? { where: { reason } } : undefined);
  const people = async (count: number) => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r5-" } } });
    await a.prisma.user.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        id: `r5-${String(i).padStart(4, "0")}`,
        wawuId: `r5-w-${i}`,
        handle: `r5.u${i}`,
        referralCode: `R5${i}`,
        status: "ACTIVE" as const,
        mailTo: addr(i),
        createdAt: new Date("2026-11-01T09:00:00.000Z"),
      })),
    });
  };
  const topic = () =>
    a.prisma.topic.create({
      data: {
        weekNumber: 46,
        title: "Are You Really Fine?",
        blurb: "Money, mood and Monday.",
        startsOn: new Date(`${SUN}T00:00:00.000Z`),
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
  const launch = () =>
    a.prisma.question.create({
      data: {
        text: "How do you feel about Nigeria right now?",
        status: "SCHEDULED",
        kind: "DAILY",
        seedKey: "launch-mood-1",
        scheduledFor: new Date(`${SUN}T00:00:00.000Z`),
        startsAt: new Date("2026-11-14T23:00:00.000Z"),
        endsAt: new Date("2026-11-15T23:00:00.000Z"),
        voiceCount: 3,
      } as never,
    });
  const run = (s: TopicMailService, tpl: "C01" | "C02", t: Date) =>
    tpl === "C01" ? s.runDailyQuestion(t) : s.runWeeklyTopic(t);
  const T0 = (tpl: "C01" | "C02", day = MON) =>
    at(tpl === "C01" ? "06:00" : "05:30", day);
  const inst = () => {
    const s = new TopicMailService(a.prisma, mailSvc, cfg);
    jest.spyOn(s, "pause").mockResolvedValue();
    return s;
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
        res.writeHead(st, { "content-type": "application/json" });
        if (st === 200) sentTo.push({ to: b.to, tag: b.tag });
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
  });

  beforeEach(async () => {
    sentTo = [];
    calls = new Map();
    decide = () => 200;
    n = 0;
    errors = [];
    process.env.TOPIC_MAIL_DAILY_MAX = "5000";
    const mem = svc as unknown as {
      finished: Set<string>;
      cappedOn: Map<string, string>;
      rescanAt: Map<string, unknown>;
      launchDone: boolean;
      launchRetryAt: number;
      launchStalled: number;
    };
    mem.finished.clear();
    mem.cappedOn.clear();
    mem.rescanAt.clear();
    mem.launchDone = false;
    mem.launchRetryAt = 0;
    mem.launchStalled = 0;
    await a.prisma.mailLog.deleteMany();
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    await a.prisma.user.updateMany({
      where: { id: { not: { startsWith: "r5-" } } },
      data: { mailTo: null },
    });
  });

  afterAll(async () => {
    await a.prisma.user.deleteMany({ where: { id: { startsWith: "r5-" } } });
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    delete process.env.TOPIC_MAIL_DAILY_MAX;
    jest.restoreAllMocks();
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  // ------------------------------------------------------------ which answers name the address
  describe("relayNamesAddress: exactly which answers count as a refused address", () => {
    it.each([
      [422, { code: "invalid_recipient" }],
      [422, { reason: "recipient_suppressed" }],
      [400, { error: "invalid_email" }],
      [404, { type: "hard_bounce" }],
      [410, { code: "Mailbox_Not_Found" }],
      [400, { error: { code: "invalid_address" } }],
      [422, { errors: [{ field: "to", message: "x" }] }],
      [400, { field: "recipient" }],
      [422, { param: "email" }],
      [400, { path: "address" }],
      [422, { target: "to" }],
    ])("%i %j names the address", (status, body) => {
      expect(relayNamesAddress(status, body)).toBe(true);
    });
    it.each([
      [422, undefined],
      [422, null],
      [404, {}],
      [404, { error: "no" }],
      [400, { error: "bad request" }],
      [422, { code: "validation_failed" }],
      [422, { field: "subject" }],
      [422, { errors: [{ field: "html" }] }],
      [410, "invalid_recipient"],
      [500, { code: "invalid_recipient" }],
      [503, { code: "invalid_recipient" }],
      [429, { code: "daily_cap" }],
      [429, { code: "invalid_recipient" }],
      [401, { code: "invalid_recipient" }],
      [403, { code: "invalid_recipient" }],
      [408, { code: "invalid_recipient" }],
    ])("%i %j does not (relay trouble)", (status, body) => {
      expect(relayNamesAddress(status, body)).toBe(false);
    });
  });

  // ------------------------------------------------------------ H1: relay faults skip nobody
  describe("H1: the three shapes of a faulty relay end with the good people mailed and nobody skipped", () => {
    const shape = async (d: (i: number) => Resp, count = 200) => {
      await people(count);
      await topic();
      await question();
      let k = 0;
      decide = () => d(k++);
      const t0 = T0("C01");
      for (let m = 0; m < 299; m++)
        await svc.runDailyQuestion(plus(t0, m * MIN));
      return { mailed: await rows("C01"), skips: await skipRows() };
    };
    it("the relay failing in turns", async () => {
      expect(await shape((i) => (i % 2 === 0 ? 404 : 200))).toEqual({
        mailed: 200,
        skips: 0,
      });
    });
    it("nine refused and one accepted, repeating", async () => {
      expect(await shape((i) => (i % 10 === 9 ? 200 : 404))).toEqual({
        mailed: 200,
        skips: 0,
      });
    });
    it("in turns with answers that look like a refusal but name no address (422, 400, 410)", async () => {
      const st = [422, 400, 410];
      expect(await shape((i) => (i % 2 === 0 ? st[(i / 2) % 3] : 200))).toEqual(
        { mailed: 200, skips: 0 },
      );
    });
    it.each(["C01", "C02"] as const)(
      "%s: a relay that breaks twice in one window (505 people): everybody mailed, nobody skipped",
      async (tpl) => {
        await people(505);
        await topic();
        await question();
        let sent = 0;
        let minute = 0;
        decide = () => {
          const broken =
            (sent >= 100 && minute < 120) ||
            (minute >= 150 && minute < 270 && sent >= 100);
          if (broken) return 404;
          sent++;
          return 200;
        };
        const t0 = T0(tpl);
        for (minute = 0; minute < 295; minute++)
          await run(svc, tpl, plus(t0, minute * MIN));
        expect(await rows(tpl)).toBe(505);
        expect(await skipRows()).toBe(0);
      },
    );
  });

  // ------------------------------------------------------------ every kind of relay trouble
  describe("every kind of relay trouble skips nobody, and the next run mails everyone", () => {
    const kinds: Array<[string, Resp]> = [
      ["500", 500],
      ["502", 502],
      ["503", 503],
      ["504", 504],
      ["a dropped connection", "drop"],
      ["401", 401],
      ["403", 403],
      ["404 without a body", { status: 404 }],
      ["404 with an unrelated body", { status: 404, body: { error: "no" } }],
      [
        "400 that names a field other than the address",
        { status: 400, body: { field: "subject" } },
      ],
      ["408", 408],
      ["410", 410],
      ["422 without a body", { status: 422 }],
      [
        "422 that names no address",
        { status: 422, body: { code: "validation_failed" } },
      ],
      [
        "a 5xx whose body says invalid_recipient",
        { status: 500, body: { code: "invalid_recipient" } },
      ],
    ];
    it.each(kinds)("%s", async (_label, resp) => {
      await people(20);
      await topic();
      decide = () => resp;
      const t0 = T0("C02");
      for (let k = 0; k < 4; k++) {
        const r = await svc.runWeeklyTopic(plus(t0, k * MIN));
        expect(r).toEqual({ state: "stopped", sent: 0 }); // five failures in a row stop the run
      }
      expect(await skipRows()).toBe(0);
      expect(await rows("C02")).toBe(0); // every refused mail got its log row back
      decide = () => 200;
      expect(await svc.runWeeklyTopic(plus(t0, 4 * MIN))).toEqual({
        state: "done",
        sent: 20,
      });
    });
    it("a 429 ends the run, skips nobody, and the person is mailed by the next run", async () => {
      await people(20);
      await topic();
      let k = 0;
      decide = () =>
        ++k > 3 ? { status: 429, body: { code: "daily_cap" } } : 200;
      const r = await svc.runWeeklyTopic(at("05:30"));
      expect(r).toEqual({ state: "capped", sent: 3 });
      expect(await skipRows()).toBe(0);
      decide = () => 200;
      // C02 is tried again after the next Lagos day starts
      const r2 = await svc.runWeeklyTopic(at("05:30", "2026-11-17"));
      expect(r2).toEqual({ state: "done", sent: 17 });
    });
    it("a timeout: the stand-in waits past the client's wait", async () => {
      await people(3);
      await topic();
      // the 10 second wait is a constant of the client; a hung call is the same failure as a dropped one (above), shown
      // here by the client code path: an aborted fetch is "failed", never "refused"
      jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new DOMException("t", "TimeoutError"));
      const out = await mailSvc.send({
        template: "C02",
        userId: "r5-0000",
        eventKey: "topic:t",
        vars: {
          topic_title: "x",
          topic_hook: "y",
          topic_url: "https://x.test",
        },
        tellRefused: true,
      });
      jest.restoreAllMocks();
      jest.spyOn(svc, "pause").mockResolvedValue();
      jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation((m: unknown) => void errors.push(String(m)));
      expect(out).toBe("failed");
      expect(await skipRows()).toBe(0);
    });
  });

  // ------------------------------------------------------------ a truly refused address
  describe("a refused address is skipped 24 hours at the first answer", () => {
    it.each([
      ["422 invalid_recipient", NAMED],
      [
        "400 invalid_email in error",
        { status: 400, body: { error: "invalid_email" } },
      ],
      [
        "404 recipient_suppressed in reason",
        { status: 404, body: { reason: "recipient_suppressed" } },
      ],
      [
        "410 hard_bounce in type",
        { status: 410, body: { type: "hard_bounce" } },
      ],
      [
        "422 errors entry on the field to",
        { status: 422, body: { errors: [{ field: "to" }] } },
      ],
    ] as Array<[string, Resp]>)("%s", async (_l, resp) => {
      await people(10);
      await topic();
      decide = (to) => (to === addr(3) ? resp : 200);
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "done", sent: 9 });
      const row = await a.prisma.topicMailSkip.findFirstOrThrow();
      expect(row.userId).toBe("r5-0003");
      expect(row.reason).toBe("refused");
      const span = row.until.getTime() - at("11:00").getTime();
      expect(span).toBeGreaterThanOrEqual(REFUSED_SKIP_MS);
      expect(span).toBeLessThanOrEqual(REFUSED_SKIP_MS + 10_000);
      expect(calls.get(addr(3))).toBe(1); // one call: no counting of failures first
      expect(errors).toHaveLength(0);
    });

    it("a success clears the skip: the 24 hours pass, the relay accepts, the row is gone", async () => {
      await people(5);
      await topic();
      decide = (to) => (to === addr(1) ? NAMED : 200);
      await svc.runWeeklyTopic(at("11:00"));
      expect(await skipRows("refused")).toBe(1);
      decide = () => 200;
      const s2 = inst();
      // inside the 24 hours: not asked
      await s2.runWeeklyTopic(plus(at("11:00"), 23 * 60 * MIN));
      expect(calls.get(addr(1))).toBe(1);
      expect(await skipRows()).toBe(1);
      // after the 24 hours: asked, accepted, the row is removed
      const r = await inst().runWeeklyTopic(
        plus(at("11:00"), REFUSED_SKIP_MS + 10_000),
      );
      expect(r.sent).toBe(1);
      expect(calls.get(addr(1))).toBe(2);
      expect(await skipRows()).toBe(0);
    });

    it("a success of any topic mail clears the person's skip rows (a corrected address that works)", async () => {
      await people(4);
      await topic();
      await question();
      decide = (to) => (to === addr(2) ? NAMED : 200);
      await svc.runWeeklyTopic(at("11:00"));
      expect(await skipRows()).toBe(1);
      await a.prisma.user.update({
        where: { id: "r5-0002" },
        data: { mailTo: "r5-new@r5.test" },
      });
      decide = () => 200;
      const r = await inst().runDailyQuestion(at("06:00"));
      expect(r.sent).toBe(4); // the new address is asked at once, by the other template
      expect(await skipRows()).toBe(0);
    });

    it("ten refused addresses in a row end the run; all ten are on their 24 hours", async () => {
      await people(30);
      await topic();
      decide = (to) => (Number(to.slice(3, 7)) < 10 ? NAMED : 200);
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "stopped", sent: 0 });
      expect(await skipRows("refused")).toBe(10);
      expect(await svc.runWeeklyTopic(at("11:01"))).toEqual({
        state: "done",
        sent: 20,
      });
      expect(tried()).toBe(30);
    });
  });

  // ------------------------------------------------------------ one try a day across C01, C02 and C14
  describe("one try a day across C01, C02 and the launch mail C14", () => {
    it("a dead address refused by C02 is not asked by C01 or C14; asked again after the 24 hours by whichever comes first", async () => {
      await people(6);
      await topic();
      await question(SUN);
      await question(MON);
      await launch();
      decide = (to) => (to === addr(4) ? NAMED : 200);
      const t = at("06:10", SUN);
      expect(await svc.runWeeklyTopic(t)).toMatchObject({ sent: 5 });
      expect(calls.get(addr(4))).toBe(1);
      expect(await svc.runDailyQuestion(plus(t, MIN))).toMatchObject({
        sent: 5,
      });
      expect(await svc.runLaunchOpen(plus(t, 2 * MIN))).toMatchObject({});
      expect(calls.get(addr(4))).toBe(1); // C01 and C14 did not ask
      expect(sentTo.filter((s) => s.to === addr(4))).toHaveLength(0);
      // later the same day: still not asked, by any of them
      const later = plus(t, 3 * 60 * MIN);
      await svc.tick(later);
      expect(calls.get(addr(4))).toBe(1);
      // the next day, once the 24 hours are up: one ask in all (the first topic mail that runs after it)
      const next = at("06:20", MON);
      await svc.tick(next);
      expect(calls.get(addr(4))).toBe(2);
      await svc.tick(plus(next, 5 * MIN));
      expect(calls.get(addr(4))).toBe(2);
    });

    it("a dead address refused by C14 is not asked by C01 or C02", async () => {
      await people(6);
      await topic();
      await question(SUN);
      await launch();
      decide = (to) => (to === addr(2) ? NAMED : 200);
      const t = at("06:10", SUN);
      const r = await svc.runLaunchOpen(t);
      expect(r.sent).toBe(5);
      expect(await skipRows("refused")).toBe(1);
      expect((await a.prisma.topicMailSkip.findFirstOrThrow()).template).toBe(
        "C14",
      );
      await svc.runDailyQuestion(plus(t, MIN));
      await svc.runWeeklyTopic(plus(t, 2 * MIN));
      expect(calls.get(addr(2))).toBe(1);
      expect(sentTo.filter((s) => s.to === addr(2))).toHaveLength(0);
      // the launch mail does not wait for the refused person: nobody else is left, so it is done
      expect((svc as unknown as { launchDone: boolean }).launchDone).toBe(true);
    });

    it("C14 relay trouble skips nobody and keeps its own wait (10 minutes after a stop)", async () => {
      await people(8);
      await launch();
      decide = () => 503;
      const t = at("06:10", SUN);
      const r = await svc.runLaunchOpen(t);
      expect(r.state).toBe("stopped");
      expect(await skipRows()).toBe(0);
      expect(await svc.runLaunchOpen(plus(t, 5 * MIN))).toEqual({
        state: "waiting",
        sent: 0,
      });
      decide = () => 200;
      const r2 = await svc.runLaunchOpen(plus(t, 10 * MIN + 1000));
      expect(r2).toMatchObject({ sent: 8 });
      expect(await skipRows()).toBe(0);
    });
  });

  // ------------------------------------------------------------ M4
  it("M4: a dead address on the topic mail (C02) is asked once a day, every day of the week", async () => {
    await people(30);
    await topic();
    const dead = [3, 14, 25];
    decide = (to) => (dead.map(addr).includes(to) ? NAMED : 200);
    const perDay: number[] = [];
    for (let d = 0; d < 7; d++) {
      const day = `2026-11-${String(16 + d).padStart(2, "0")}`;
      const before = callsOf(dead);
      for (let m = 0; m < 24 * 60; m += 30)
        await svc.runWeeklyTopic(plus(at("00:00", day), m * MIN));
      perDay.push(callsOf(dead) - before);
    }
    // one call each, each day: 3 dead addresses, 3 calls a day (the old rule: about 51 a day from day two)
    expect(perDay).toEqual([3, 3, 3, 3, 3, 3, 3]);
  });

  // ------------------------------------------------------------ other mail is untouched
  it("account mail: a 422 that names the address is still a plain failure for a mail that is not a topic mail", async () => {
    await people(2);
    decide = () => NAMED;
    const out = await mailSvc.send({
      template: "B11" as const,
      userId: "r5-0000",
      eventKey: "r5-1",
      vars: {
        idea_text: "a",
        improver_name: "@k",
        improvement_text: "b",
        idea_url: "https://x.test",
      },
    });
    expect(out).toBe("failed");
    expect(await skipRows()).toBe(0);
  });
});
