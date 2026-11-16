import { createServer, type Server } from "node:http";
import { ConfigService } from "@nestjs/config";
import { bootAdmin, type Admin } from "../admin/helpers";
import {
  TopicMailService,
  REFUSED_SKIP_MS,
} from "../../src/mail/topic-mail.service";
import { MailService } from "../../src/mail/mail.service";

/**
 * V-TOPIC-MAILS-2: C02 holds to half the day's budget until C01's window has closed; a refused address is skipped for
 * 24 hours and does not stop the run; a blank TOPIC_MAIL_DAILY_MAX is "not set"; the value is clamped to 5000.
 * A real database; the relay is a local stand-in on port 15092. Nothing real is sent. Lagos is UTC+1.
 */
const PORT = 15092;
const KEY = "topic-mail-2-test-service-key";
const MON = "2026-11-16";
const at = (hhmmZ: string, day = MON) => new Date(`${day}T${hhmmZ}:00.000Z`);
const lagosStart = (day: string) =>
  new Date(`${day}T00:00:00.000Z`).getTime() - 3_600_000;

describe("V-TOPIC-MAILS-2: budget split, refusals, blank and clamped value", () => {
  let a: Admin;
  let srv: Server;
  let svc: TopicMailService;
  let mailSvc: MailService;
  let sentTo: string[] = [];
  let tried: string[] = [];
  /** to-address to the status the relay answers with; `all` answers every address. */
  let refuse = new Map<string, number>();
  let all = 0;
  let overHttp = 0;
  const N = 40;
  const names = Array.from({ length: N }, (_, i) => `p${i + 1}`);
  const id = (n: string) => a.people[n].id;
  const rows = (t: string) =>
    a.prisma.mailLog.count({ where: { template: t } });

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
        text: "What is one thing you would change about payday?",
        status: "SCHEDULED",
        kind: "DAILY",
        scheduledFor: new Date(`${MON}T00:00:00.000Z`),
        startsAt: new Date(lagosStart(MON)),
        endsAt: new Date(lagosStart(MON) + 86_400_000),
        voiceCount: 1,
      } as never,
    });
  const second = () => {
    const s = new TopicMailService(
      a.prisma,
      mailSvc,
      a.h.app.get(ConfigService),
    );
    jest.spyOn(s, "pause").mockResolvedValue();
    return s;
  };
  const forget = (s: TopicMailService) => {
    (s as unknown as { finished: Set<string> }).finished.clear();
    (s as unknown as { cappedOn: Map<string, string> }).cappedOn.clear();
    (s as unknown as { rescanAt: Map<string, number> }).rescanAt.clear();
  };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const to = (JSON.parse(raw) as { to: string }).to;
        tried.push(to);
        overHttp++;
        const st = all || refuse.get(to) || 200;
        res.writeHead(st, { "content-type": "application/json" });
        if (st === 200) sentTo.push(to);
        res.end(
          JSON.stringify(
            st === 200
              ? { id: "x" }
              : all
                ? { error: "no" }
                : { code: "invalid_recipient" },
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
    for (const n of names) await a.person(n);
    svc = a.h.app.get(TopicMailService);
    mailSvc = a.h.app.get(MailService);
    jest.spyOn(svc, "pause").mockResolvedValue();
  });

  beforeEach(async () => {
    sentTo = [];
    tried = [];
    refuse = new Map();
    all = 0;
    overHttp = 0;
    (svc as unknown as { pausedUntil: number }).pausedUntil = 0;
    (svc as unknown as { pauses: Map<string, number> }).pauses.clear();
    delete process.env.TOPIC_MAIL_ENABLED;
    process.env.TOPIC_MAIL_DAILY_MAX = "12";
    await a.prisma.mailLog.deleteMany();
    await a.prisma.topicMailSkip.deleteMany();
    await a.prisma.topicMailTrouble.deleteMany();
    (
      svc as unknown as { windowRefusals: Map<string, unknown> }
    ).windowRefusals?.clear();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    await a.prisma.user.updateMany({
      where: { id: { in: names.map(id) } },
      data: { status: "ACTIVE" },
    });
    for (const n of names)
      await a.prisma.user.update({
        where: { id: id(n) },
        data: { mailTo: `${n}@tm2.test` },
      });
    forget(svc);
  });

  afterAll(async () => {
    delete process.env.TOPIC_MAIL_DAILY_MAX;
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  describe("M1: C02 may use at most half until C01's window has closed", () => {
    it("budget 12, 40 people, topic and question the same day: C02 at 06:30 sends 6 and stops, C01 at 07:00 sends 6", async () => {
      await topic();
      await question();
      expect(await svc.runWeeklyTopic(at("05:30"))).toEqual({
        state: "budget-reached",
        sent: 6,
      });
      expect(await rows("C02")).toBe(6);
      expect(await svc.runDailyQuestion(at("06:00"))).toEqual({
        state: "budget-reached",
        sent: 6,
      });
      expect(await rows("C01")).toBe(6);
      expect(await rows("C02")).toBe(6);
      expect(await svc.budgetLeft()).toBe(0);
      expect(sentTo).toHaveLength(12);
    });

    it("C02 on its own is held to half every tick until the window closes, then may use what remains", async () => {
      await topic();
      expect((await svc.runWeeklyTopic(at("05:30"))).sent).toBe(6);
      const before = overHttp;
      // later ticks inside the window: nothing more, and no mail is attempted
      expect(await svc.runWeeklyTopic(at("08:00"))).toEqual({
        state: "budget-reached",
        sent: 0,
      }); // 09:00 Lagos, no question that day
      expect(await svc.runWeeklyTopic(at("10:59"))).toEqual({
        state: "budget-reached",
        sent: 0,
      }); // 11:59 Lagos
      expect(overHttp).toBe(before);
      // 12:00 Lagos: the window is closed, C02 may use the rest
      expect(await svc.runWeeklyTopic(at("11:00"))).toEqual({
        state: "budget-reached",
        sent: 6,
      });
      expect(await rows("C02")).toBe(12);
    });

    it("after the window closes C02 uses only what C01 left", async () => {
      await topic();
      await question();
      await svc.runWeeklyTopic(at("05:30"));
      await svc.runDailyQuestion(at("06:00"));
      expect(await svc.runWeeklyTopic(at("11:00"))).toEqual({
        state: "budget-reached",
        sent: 0,
      });
      expect(sentTo).toHaveLength(12);
    });

    it("C01 may use all that is left of the whole budget", async () => {
      await topic();
      await question();
      await svc.runWeeklyTopic(at("05:30")); // 6
      process.env.TOPIC_MAIL_DAILY_MAX = "12";
      const r = await svc.runDailyQuestion(at("06:00"));
      expect(r.sent).toBe(6);
      // and with nothing from C02, C01 alone may take the whole budget
      await a.prisma.mailLog.deleteMany();
      forget(svc);
      expect((await svc.runDailyQuestion(at("06:10"))).sent).toBe(12);
    });

    it("half is rounded down: budget 5 gives C02 2", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "5";
      await topic();
      expect(await svc.runWeeklyTopic(at("05:30"))).toEqual({
        state: "budget-reached",
        sent: 2,
      });
    });

    it("the edge: at 11:59 Lagos C02 is still held to half, at 12:00 Lagos it is not", async () => {
      await topic();
      expect((await svc.runWeeklyTopic(at("10:59"))).sent).toBe(6);
      expect((await svc.runWeeklyTopic(at("11:00"))).sent).toBe(6);
    });

    it("two instances at once never pass either limit (C02 alone, then C02 and C01 racing)", async () => {
      await topic();
      const s2 = second();
      const runs = await Promise.all([
        svc.runWeeklyTopic(at("05:30")),
        s2.runWeeklyTopic(at("05:30")),
      ]);
      expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(6);
      expect(await rows("C02")).toBe(6);
      expect(new Set(sentTo).size).toBe(6);

      await a.prisma.mailLog.deleteMany();
      forget(svc);
      forget(s2);
      sentTo = [];
      await question();
      const s3 = second();
      const s4 = second();
      await Promise.all([
        svc.runWeeklyTopic(at("05:30")),
        s2.runWeeklyTopic(at("05:30")),
        s3.runDailyQuestion(at("06:00")),
        s4.runDailyQuestion(at("06:00")),
      ]);
      expect(await rows("C02")).toBeLessThanOrEqual(6);
      expect((await rows("C01")) + (await rows("C02"))).toBeLessThanOrEqual(12);
      expect(sentTo.length).toBe((await rows("C01")) + (await rows("C02")));
    });
  });

  describe("M2: a refused address is not an outage", () => {
    const order = async (): Promise<string[]> => {
      await topic();
      // the order the run will use: never mailed, then by id
      return names
        .map((n) => ({ n, id: id(n) }))
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map((x) => `${x.n}@tm2.test`);
    };

    it("the first 5 in order refused with 422: all the others are mailed in the same run, and only real sends use the budget", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "5000";
      const ord = await order();
      const bad = ord.slice(0, 5);
      for (const b of bad) refuse.set(b, 422);
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "done", sent: N - 5 });
      expect(new Set(sentTo)).toEqual(new Set(ord.slice(5)));
      expect(await rows("C02")).toBe(N - 5);
      expect(await svc.budgetLeft()).toBe(5000 - (N - 5));
      // each refused person was asked once (a 4xx is not retried)
      for (const b of bad) expect(tried.filter((t) => t === b)).toHaveLength(1);
    });

    it("a refused person is not asked again inside 24 hours, and is tried again after them", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "5000";
      const ord = await order();
      const bad = ord[0];
      refuse.set(bad, 400);
      await svc.runWeeklyTopic(at("11:00"));
      expect(tried.filter((t) => t === bad)).toHaveLength(1);
      // the same process, a later run (only the finished marker is cleared, the skip list stays)
      (svc as unknown as { finished: Set<string> }).finished.clear();
      refuse.delete(bad);
      await svc.runWeeklyTopic(at("11:30")); // 30 minutes later
      expect(tried.filter((t) => t === bad)).toHaveLength(1);
      expect(sentTo).not.toContain(bad);
      (svc as unknown as { finished: Set<string> }).finished.clear();
      const r = await svc.runWeeklyTopic(
        new Date(at("11:00").getTime() + REFUSED_SKIP_MS + 1000),
      );
      expect(r.sent).toBe(1);
      expect(sentTo).toContain(bad);
    });

    it("a refused address is skipped for every topic mail: the same person is not asked C01 while skipped for C02", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "5000";
      const ord = await order();
      await question();
      refuse.set(ord[0], 422);
      await svc.runWeeklyTopic(at("11:00"));
      refuse.delete(ord[0]);
      const asked = tried.filter((t) => t === ord[0]).length;
      const r = await svc.runDailyQuestion(at("06:00"));
      expect(r.sent).toBe(N - 1);
      expect(sentTo).not.toContain(ord[0]);
      expect(tried.filter((t) => t === ord[0]).length).toBe(asked); // not asked again
    });

    it("five 503s in a row still stop the run, and no budget is used", async () => {
      await topic();
      all = 503;
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "stopped", sent: 0 });
      expect(await rows("C02")).toBe(0);
      expect(await svc.budgetLeft()).toBe(12);
    });

    it("a refusal in between does not reset or add to the count of 503s", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "5000";
      const ord = await order();
      // 4 outages, a refusal, then the 5th outage: the run stops after the 5th outage
      for (const [i, st] of [503, 503, 422, 503, 503, 503].entries())
        refuse.set(ord[i], st);
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r.state).toBe("stopped");
      expect(r.sent).toBe(0);
      expect(tried.filter((t) => ord.slice(0, 6).includes(t)).length).toBe(
        5 * 3 + 1,
      );
    });

    it("a bare 429 is a rate limit (round 6): the run waits, nobody is lost, the row of the refused call is given back", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "5000";
      const ord = await order();
      refuse.set(ord[2], 429);
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "waiting", sent: 2 });
      expect(await rows("C02")).toBe(2);
    });

    it("other mails keep their meaning: a 422 on B11 is still a plain failure, and B11 is not counted, delayed or blocked", async () => {
      const bad = `${names[0]}@tm2.test`;
      const job = (uid: string, key: string) => ({
        template: "B11" as const,
        userId: uid,
        eventKey: key,
        vars: {
          idea_text: "a",
          improver_name: "@k",
          improvement_text: "b",
          idea_url: "https://x.test",
        },
      });
      refuse.set(bad, 422);
      expect(await mailSvc.send(job(id(names[0]), "i-1"))).toBe("failed");
      // budget spent: B11 goes anyway and is not counted
      process.env.TOPIC_MAIL_DAILY_MAX = "0";
      expect(await mailSvc.send(job(id(names[1]), "i-2"))).toBe("sent");
      expect(await svc.budgetLeft()).toBe(0);
      process.env.TOPIC_MAIL_DAILY_MAX = "12";
      expect(await svc.budgetLeft()).toBe(12);
    });
  });

  describe("L1 and L2: TOPIC_MAIL_DAILY_MAX", () => {
    afterEach(() => {
      process.env.TOPIC_MAIL_DAILY_MAX = "12";
    });
    it.each([
      ["", 2500],
      ["   ", 2500],
      ["0", 0],
      [" 0 ", 0],
      ["7", 7],
      ["5000", 5000],
      ["5001", 5000],
      ["1e9", 5000],
      ["99999999999999999999", 5000],
      ["abc", 2500],
      ["-1", 2500],
    ])("%j gives %d", (v, want) => {
      process.env.TOPIC_MAIL_DAILY_MAX = v;
      expect(svc.dailyMax()).toBe(want);
    });
    it("unset gives 2500", () => {
      delete process.env.TOPIC_MAIL_DAILY_MAX;
      expect(svc.dailyMax()).toBe(2500);
    });
    it("a blank value sends mail (it does not mean 0)", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = " ";
      await topic();
      expect((await svc.runWeeklyTopic(at("11:00"))).sent).toBe(N);
    });
  });

  describe("L3: the index", () => {
    it("the budget count has an index on (template, createdAt)", async () => {
      const r = await a.prisma.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE tablename='MailLog' AND indexname='MailLog_template_createdAt_idx'`,
      );
      expect(r[0].indexdef).toMatch(/\(template, "createdAt"\)/);
    });
  });
});
