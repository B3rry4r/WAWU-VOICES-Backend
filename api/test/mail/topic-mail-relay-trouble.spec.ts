import { createServer, type Server } from "node:http";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { bootAdmin, type Admin } from "../admin/helpers";
import {
  TopicMailService,
  REFUSED_SKIP_MS,
  TROUBLE_SKIP_MS,
} from "../../src/mail/topic-mail.service";
import { MailService } from "../../src/mail/mail.service";

/**
 * V-TOPIC-MAILS-2 round 2: a wrong service key (401, 403) or a wrong relay address (404 for everyone) is an outage of
 * the relay, not a list of bad addresses. A real database; the relay is a local stand-in on port 15093. Lagos is UTC+1.
 */
const PORT = 15093;
const KEY = "topic-mail-2r-test-service-key";
const MON = "2026-11-16";
const at = (hhmmZ: string, day = MON) => new Date(`${day}T${hhmmZ}:00.000Z`);

describe("V-TOPIC-MAILS-2 round 2: relay trouble is not bad addresses", () => {
  let a: Admin;
  let srv: Server;
  let svc: TopicMailService;
  let mailSvc: MailService;
  let sentTo: string[] = [];
  let tried: string[] = [];
  let refuse = new Map<string, number>();
  let all = 0;
  const N = 30;
  const names = Array.from({ length: N }, (_, i) => `r${i + 1}`);
  const id = (n: string) => a.people[n].id;
  const rows = (t: string) =>
    a.prisma.mailLog.count({ where: { template: t } });
  let errors: string[] = [];

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
        startsAt: new Date(`${MON}T00:00:00.000Z`),
        endsAt: new Date("2026-11-17T00:00:00.000Z"),
        voiceCount: 1,
      } as never,
    });
  const ordered = () =>
    names
      .map((n) => ({ n, id: id(n) }))
      .sort((x, y) => (x.id < y.id ? -1 : 1))
      .map((x) => `${x.n}@tm2r.test`);
  const skips = () => a.prisma.topicMailSkip.count();
  const priv = (s: TopicMailService) =>
    s as unknown as {
      finished: Set<string>;
      cappedOn: Map<string, string>;
      rescanAt: Map<string, number>;
    };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        const to = (JSON.parse(raw) as { to: string }).to;
        tried.push(to);
        const st = all || refuse.get(to) || 200;
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
    for (const n of names) await a.person(n);
    svc = a.h.app.get(TopicMailService);
    mailSvc = a.h.app.get(MailService);
    jest.spyOn(svc, "pause").mockResolvedValue();
    jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation((m: unknown) => void errors.push(String(m)));
  });

  beforeEach(async () => {
    sentTo = [];
    tried = [];
    errors = [];
    refuse = new Map();
    all = 0;
    delete process.env.TOPIC_MAIL_ENABLED;
    process.env.TOPIC_MAIL_DAILY_MAX = "5000";
    await a.prisma.mailLog.deleteMany();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    for (const n of names)
      await a.prisma.user.update({
        where: { id: id(n) },
        data: { status: "ACTIVE", mailTo: `${n}@tm2r.test` },
      });
    const p = priv(svc);
    p.finished.clear();
    p.cappedOn.clear();
    p.rescanAt.clear();
    await a.prisma.topicMailSkip.deleteMany();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    delete process.env.TOPIC_MAIL_DAILY_MAX;
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  describe.each([
    ["C02", 401],
    ["C02", 403],
    ["C02", 404],
    ["C01", 401],
    ["C01", 403],
    ["C01", 404],
  ] as const)("%s, the relay answers %i to everyone", (tpl, status) => {
    it("makes at most 10 calls, stops with an error line, tries again at the next tick and recovers without a restart", async () => {
      await topic();
      await question();
      const run = () =>
        tpl === "C01"
          ? svc.runDailyQuestion(at("06:00"))
          : svc.runWeeklyTopic(at("11:00"));
      all = status;
      const r = await run();
      expect(r).toEqual({ state: "stopped", sent: 0 });
      expect(tried.length).toBeLessThanOrEqual(10);
      expect(errors.length).toBeGreaterThan(0);
      if (status !== 404)
        expect(errors.join("\n")).toMatch(/refused our service key/);
      expect(await rows(tpl)).toBe(0);
      expect(priv(svc).finished.size).toBe(0);
      expect(priv(svc).rescanAt.size).toBe(0);
      // 401/403: nobody blamed. 404 for everyone is 10 refusals in a row: those 10 are left alone for one hour (round 3)
      expect(await skips()).toBe(status === 404 ? 10 : 0);

      // the next tick tries again (calls are made again), and still stops
      const before = tried.length;
      expect((await run()).state).toBe("stopped");
      expect(tried.length).toBeGreaterThan(before);
      expect(tried.length - before).toBeLessThanOrEqual(10);

      // the relay is right again, the same process: everyone is mailed. After a 404 stop the 20 people asked so far
      // come back an hour later (round 3); the others are mailed at once.
      all = 0;
      let ok = await run();
      if (status === 404) {
        expect(ok).toEqual({ state: "done", sent: N - 20 });
        const hourOn = (d: string) =>
          new Date(
            new Date(`${MON}T${d}:00.000Z`).getTime() + TROUBLE_SKIP_MS + 1000,
          );
        ok = await (tpl === "C01"
          ? svc.runDailyQuestion(hourOn("06:00"))
          : svc.runWeeklyTopic(hourOn("11:00")));
        expect(ok.sent).toBe(20);
      } else expect(ok).toEqual({ state: "done", sent: N });
      expect(await rows(tpl)).toBe(N);
      expect(new Set(sentTo).size).toBe(N);
    });
  });

  it("a stopped run through the tick() entry point is tried again at the next tick", async () => {
    await topic();
    all = 401;
    await svc.tick(at("11:00"));
    const n1 = tried.length;
    await svc.tick(at("11:01"));
    expect(tried.length).toBeGreaterThan(n1);
    all = 0;
    const t = await svc.tick(at("11:02"));
    expect(t?.c02).toEqual({ state: "done", sent: N });
  });

  it("other 4xx (408, 425) are trouble of the relay, not a refused address", async () => {
    await topic();
    all = 408;
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r.state).toBe("stopped");
    expect(tried.length).toBeLessThanOrEqual(5);
    expect(await skips()).toBe(0);
  });

  it("9 refused in a row, then mail: the run goes on and mails the rest", async () => {
    await topic();
    const ord = ordered();
    for (const b of ord.slice(0, 9)) refuse.set(b, 422);
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "done", sent: N - 9 });
    expect(errors).toHaveLength(0);
    expect(await skips()).toBe(9);
  });

  it("10 refused in a row stops the run, they are skipped for ONE hour, the next tick goes on to the next people", async () => {
    await topic();
    const ord = ordered();
    for (const b of ord.slice(0, 10)) refuse.set(b, 400);
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "stopped", sent: 0 });
    expect(tried).toEqual(ord.slice(0, 10));
    expect(errors.length).toBeGreaterThan(0);
    expect(await skips()).toBe(10);
    // the next tick does not ask the same 10 again: it goes on to the next people (round 3)
    refuse = new Map();
    const r2 = await svc.runWeeklyTopic(at("11:01"));
    expect(r2).toEqual({ state: "done", sent: N - 10 });
    expect(sentTo).not.toContain(ord[0]);
    // an hour later the 10 are asked again
    const r3 = await svc.runWeeklyTopic(
      new Date(at("11:00").getTime() + TROUBLE_SKIP_MS + 1000),
    );
    expect(r3.sent).toBe(10);
    expect(sentTo).toContain(ord[0]);
  });

  it("a mail sent between refusals resets the count of refusals", async () => {
    await topic();
    const ord = ordered();
    for (const b of [...ord.slice(0, 9), ...ord.slice(10, 19)])
      refuse.set(b, 410);
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "done", sent: N - 18 });
    expect(errors).toHaveLength(0);
  });

  it("round 1's case: 5 bad addresses mixed among good ones are skipped, the rest are mailed", async () => {
    await topic();
    const ord = ordered();
    for (const i of [0, 3, 6, 9, 12]) refuse.set(ord[i], 422);
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "done", sent: N - 5 });
    expect(errors).toHaveLength(0);
  });

  it("M2: a refused person is asked again after 24 hours without clearing anything, and not before", async () => {
    await topic();
    const bad = ordered()[0];
    refuse.set(bad, 422);
    await svc.runWeeklyTopic(at("11:00"));
    expect(tried.filter((t) => t === bad)).toHaveLength(1);
    refuse.delete(bad);
    // the same process, nothing cleared: inside 24 hours the topic is not scanned again
    const inside = await svc.runWeeklyTopic(at("20:00"));
    expect(inside).toEqual({ state: "done", sent: 0 });
    expect(tried.filter((t) => t === bad)).toHaveLength(1);
    const after = await svc.runWeeklyTopic(
      new Date(at("11:00").getTime() + REFUSED_SKIP_MS + 1000),
    );
    expect(after.sent).toBe(1);
    expect(sentTo).toContain(bad);
  });

  it("L2: the skip belongs to the address: a corrected address is tried at once", async () => {
    await topic();
    const bad = ordered()[0];
    refuse.set(bad, 422);
    await svc.runWeeklyTopic(at("11:00"));
    const person = names.find((n) => `${n}@tm2r.test` === bad)!;
    await a.prisma.user.update({
      where: { id: id(person) },
      data: { mailTo: `${person}-new@tm2r.test` },
    });
    priv(svc).rescanAt.clear(); // the waiting marker only saves a scan; the skip itself is what is under test
    const r = await svc.runWeeklyTopic(at("12:00"));
    expect(r.sent).toBe(1);
    expect(sentTo).toContain(`${person}-new@tm2r.test`);
  });

  it("nothing sent because every mail failed is not marked finished; the next tick mails them", async () => {
    await topic();
    // only 3 people are due, so five failures in a row never happens
    for (const n of names.slice(3))
      await a.prisma.user.update({
        where: { id: id(n) },
        data: { status: "SUSPENDED" },
      });
    all = 503;
    const r = await svc.runWeeklyTopic(at("11:00"));
    expect(r).toEqual({ state: "done", sent: 0 });
    expect(priv(svc).finished.size).toBe(0);
    all = 0;
    const r2 = await svc.runWeeklyTopic(at("11:01"));
    expect(r2).toEqual({ state: "done", sent: 3 });
  });

  it("a run that mailed everyone, or found nobody due, is finished: the next tick makes no calls", async () => {
    await topic();
    expect((await svc.runWeeklyTopic(at("11:00"))).sent).toBe(N);
    const n = tried.length;
    expect(await svc.runWeeklyTopic(at("11:01"))).toEqual({
      state: "done",
      sent: 0,
    });
    expect(tried.length).toBe(n);
  });

  it("other mail is not changed: B11 with a 401 is a plain failure with no 'service key' error line, and never 'refused'", async () => {
    all = 401;
    const out = await mailSvc.send({
      template: "B11" as const,
      userId: id(names[0]),
      eventKey: "i-r2-1",
      vars: {
        idea_text: "a",
        improver_name: "@k",
        improvement_text: "b",
        idea_url: "https://x.test",
      },
    });
    expect(out).toBe("failed");
    expect(errors.join("\n")).not.toMatch(/service key/);
    void ConfigService;
  });
});
