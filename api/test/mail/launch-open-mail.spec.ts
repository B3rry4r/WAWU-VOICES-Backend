import { createServer, type Server } from "node:http";
import request from "supertest";
import type { App } from "supertest/types";
import { bootAdmin, type Admin } from "../admin/helpers";
import { TopicMailService } from "../../src/mail/topic-mail.service";

/**
 * The one-time "VOICES is open" mail (C14). A real database; WAWU ID's relay is a local stand-in on port 15092 that
 * records every call. Nothing real is sent.
 */
const PORT = 15092;
const KEY = "launch-mail-test-service-key";
const SUBJECT = "VOICES is open. Add your voice now";
const TEXT = "How do you feel about Nigeria right now?";

interface Got {
  body: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tag: string;
    headers?: Record<string, string>;
  };
}

// The launch question opens 00:00 Lagos on Sunday 15 Nov 2026 (23:00Z on the 14th).
const DAY = "2026-11-15";
const STARTS = new Date("2026-11-14T23:00:00.000Z");
const ENDS = new Date(STARTS.getTime() + 86_400_000);
const AFTER_OPEN = new Date("2026-11-15T06:00:00.000Z");
const BEFORE_OPEN = new Date("2026-11-14T22:00:00.000Z");

describe("launch open mail (C14)", () => {
  let a: Admin;
  let srv: Server;
  let got: Got[] = [];
  let relay = { status: 200, after: Infinity };
  let calls = 0;
  let svc: TopicMailService;
  let pause: jest.SpyInstance;
  const names = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"];
  const id = (n: string) => a.people[n].id;
  const c14 = () => got.filter((g) => g.body.tag === "voices_C14");
  const rows = (t: string) =>
    a.prisma.mailLog.count({ where: { template: t } });

  const launchQuestion = (over: Record<string, unknown> = {}) =>
    a.prisma.question.create({
      data: {
        text: TEXT,
        status: "SCHEDULED",
        kind: "DAILY",
        seedKey: "launch-mood-1",
        scheduledFor: new Date(`${DAY}T00:00:00.000Z`),
        startsAt: STARTS,
        endsAt: ENDS,
        voiceCount: 3,
        ...over,
      } as never,
    });

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        calls++;
        if (calls > relay.after) {
          res.writeHead(relay.status, { "content-type": "application/json" });
          return res.end(JSON.stringify({ code: "daily_cap" }));
        }
        got.push({ body: JSON.parse(raw) as Got["body"] });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "stand-in" }));
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
    pause = jest.spyOn(svc, "pause").mockResolvedValue();
  });

  beforeEach(async () => {
    got = [];
    calls = 0;
    relay = { status: 200, after: Infinity };
    delete process.env.LAUNCH_OPEN_MAIL;
    await a.prisma.mailLog.deleteMany();
    await a.prisma.question.deleteMany();
    await a.prisma.userSettings.deleteMany();
    for (const n of names) {
      await a.prisma.user.update({
        where: { id: id(n) },
        data: {
          mailTo: `${n}@lm.test`,
          status: "ACTIVE",
          createdAt: new Date("2026-11-10T09:00:00.000Z"),
        },
      });
    }
    // u4 registered after the question started: it never met the fault
    await a.prisma.user.update({
      where: { id: id("u4") },
      data: { createdAt: new Date("2026-11-15T03:00:00.000Z") },
    });
    // the audience of these tests is u1 to u3 (and u4 as the late one); the rest are switched out unless a test uses them
    for (const n of names.slice(4))
      await a.prisma.user.update({
        where: { id: id(n) },
        data: { mailTo: null },
      });
    const s = svc as unknown as {
      finished: Set<string>;
      cappedOn: Map<string, string>;
      launchDone: boolean;
      launchRetryAt: number;
      launchStalled: number;
    };
    s.finished.clear();
    s.cappedOn.clear();
    s.launchDone = false;
    s.launchRetryAt = 0;
    s.launchStalled = 0;
    pause.mockClear();
  });

  afterAll(async () => {
    pause.mockRestore();
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it("mails the three who registered before the start, once each, and not the one who came after", async () => {
    const q = await launchQuestion();
    const r = await svc.runLaunchOpen(AFTER_OPEN);
    expect(r).toEqual({ state: "done", sent: 3 });
    const m = c14();
    expect(m.map((g) => g.body.to).sort()).toEqual([
      "u1@lm.test",
      "u2@lm.test",
      "u3@lm.test",
    ]);
    const one = m[0].body;
    expect(one.subject).toBe(SUBJECT);
    expect(one.html).toContain(TEXT);
    expect(one.text).toContain(TEXT);
    expect(one.text).toContain("Today's question is open.");
    expect(one.text).toContain(`https://usevoices.com/q/${q.id}/speak`);
    expect(one.html).toContain(`href="https://usevoices.com/q/${q.id}/speak"`);
    expect(one.html).toContain("Add your voice");
    expect(one.html).not.toMatch(/\{\{/);
    expect(one.text).not.toMatch(/\{\{/);
    expect(one.html + one.text).not.toMatch(/[—–]|Rant/);
    // a working unsubscribe link, in the headers and in both bodies
    const url = /^<(.+)>$/.exec(one.headers!["List-Unsubscribe"])![1];
    expect(one.html).toContain(`href="${url.replace(/&/g, "&amp;")}"`);
    expect(one.text).toContain(url);
    const path = url.replace("https://usevoices.com", "");
    const http = () => request(a.h.app.getHttpServer() as App);
    await http().get(path).expect(200);
    await http()
      .post(path)
      .type("form")
      .send("List-Unsubscribe=One-Click")
      .expect(201);
    expect(await rows("C14")).toBe(3);
  });

  it("run twice, or two at once, leaves one mail and one row per person", async () => {
    await launchQuestion();
    await Promise.all([
      svc.runLaunchOpen(AFTER_OPEN),
      svc.runLaunchOpen(AFTER_OPEN),
    ]);
    expect(c14()).toHaveLength(3);
    expect(await rows("C14")).toBe(3);
    (svc as unknown as { launchDone: boolean }).launchDone = false; // a restart forgets
    expect((await svc.runLaunchOpen(AFTER_OPEN)).sent).toBe(0);
    expect(await svc.runLaunchOpen(AFTER_OPEN)).toEqual({
      state: "done",
      sent: 0,
    });
    expect(c14()).toHaveLength(3);
    expect(await rows("C14")).toBe(3);
    const per = await a.prisma.mailLog.groupBy({
      by: ["userId"],
      where: { template: "C14" },
      _count: true,
    });
    expect(per.every((p) => p._count === 1)).toBe(true);
  });

  it("a run stopped by the relay's 429 gives the row back; the next run sends to the rest, nobody twice", async () => {
    const q = await launchQuestion();
    relay = { status: 429, after: 1 };
    const r1 = await svc.runLaunchOpen(AFTER_OPEN);
    expect(r1).toEqual({ state: "capped", sent: 1 });
    expect(await rows("C14")).toBe(1); // the refused person has no row
    // the stop holds the next ticks off for a while, then the run goes on
    expect((await svc.runLaunchOpen(AFTER_OPEN)).state).toBe("waiting");
    (svc as unknown as { launchRetryAt: number }).launchRetryAt = 0;
    relay = { status: 200, after: Infinity };
    const r2 = await svc.runLaunchOpen(AFTER_OPEN);
    expect(r2).toEqual({ state: "done", sent: 2 });
    const to = c14().map((g) => g.body.to);
    expect(new Set(to).size).toBe(3);
    expect(await rows("C14")).toBe(3);
    expect(
      await a.prisma.mailLog.count({
        where: { template: "C14", eventKey: `launch-open:${q.id}` },
      }),
    ).toBe(3);
  });

  it("sends nothing while the question is not open, and sends once it is", async () => {
    await launchQuestion();
    expect(await svc.runLaunchOpen(BEFORE_OPEN)).toEqual({
      state: "nothing-open",
      sent: 0,
    });
    expect(got).toHaveLength(0);
    expect(await rows("C14")).toBe(0);
    expect((await svc.runLaunchOpen(AFTER_OPEN)).sent).toBe(3);
    // closed again (past its end): nothing for a run that had not finished
    await a.prisma.mailLog.deleteMany();
    (svc as unknown as { launchDone: boolean }).launchDone = false;
    got = [];
    expect((await svc.runLaunchOpen(new Date(ENDS.getTime() + 1))).sent).toBe(
      0,
    );
    expect(got).toHaveLength(0);
  });

  it("never mails a person who turned the daily question mail off, a deleted, a suspended account or one with no address", async () => {
    await launchQuestion();
    for (const n of ["u5", "u6", "u7", "u8", "u9"])
      await a.prisma.user.update({
        where: { id: id(n) },
        data: { mailTo: `${n}@lm.test` },
      });
    await a.prisma.userSettings.create({
      data: { userId: id("u1"), notifyDailyQuestion: false },
    });
    await a.prisma.user.update({
      where: { id: id("u2") },
      data: { status: "DELETED", mailTo: null },
    });
    await a.prisma.user.update({
      where: { id: id("u3") },
      data: { status: "SUSPENDED" },
    });
    await a.prisma.user.update({
      where: { id: id("u5") },
      data: { mailTo: null },
    });
    await a.prisma.user.update({
      where: { id: id("u6") },
      data: { mailTo: "" },
    });
    const r = await svc.runLaunchOpen(AFTER_OPEN);
    expect(r.sent).toBe(3);
    expect(
      c14()
        .map((g) => g.body.to)
        .sort(),
    ).toEqual(["u7@lm.test", "u8@lm.test", "u9@lm.test"]);
    const to = c14().map((g) => g.body.to);
    for (const bad of ["u1", "u2", "u3", "u4", "u5", "u6"])
      expect(to).not.toContain(`${bad}@lm.test`);
  });

  it("does not use up C01 for the same question, and C01 does not stop it", async () => {
    const q = await launchQuestion();
    // launch mail first, then C01 on the question's own day
    expect((await svc.runLaunchOpen(AFTER_OPEN)).sent).toBe(3);
    const c = await svc.runDailyQuestion(AFTER_OPEN); // 07:00 Lagos
    expect(c).toEqual({ state: "done", sent: 4 }); // u1 to u4: C01 has no "created before" limit
    expect(got.filter((g) => g.body.tag === "voices_C01")).toHaveLength(4);
    expect(await rows("C14")).toBe(3);
    expect(await rows("C01")).toBe(4);
    expect(await svc.budgetLeft()).toBe(2500 - 4); // the C01/C02 budget never counted C14

    // the other way round
    await a.prisma.mailLog.deleteMany();
    got = [];
    (svc as unknown as { finished: Set<string> }).finished.clear();
    (svc as unknown as { launchDone: boolean }).launchDone = false;
    expect((await svc.runDailyQuestion(AFTER_OPEN)).sent).toBe(4);
    expect((await svc.runLaunchOpen(AFTER_OPEN)).sent).toBe(3);
    expect(await rows("C01")).toBe(4);
    expect(await rows("C14")).toBe(3);
    expect(q.id).toBeTruthy();
  });

  it("LAUNCH_OPEN_MAIL=off sends nothing", async () => {
    await launchQuestion();
    process.env.LAUNCH_OPEN_MAIL = "off";
    expect(await svc.runLaunchOpen(AFTER_OPEN)).toEqual({
      state: "off",
      sent: 0,
    });
    expect(got).toHaveLength(0);
    expect(await rows("C14")).toBe(0);
  });

  describe("a person whose mail fails", () => {
    const fill = async () => {
      for (const n of names.slice(4))
        await a.prisma.user.update({
          where: { id: id(n) },
          data: { mailTo: `${n}@lm.test` },
        });
      for (let i = 10; i <= 20; i++) {
        const n = `x${i}`;
        await a.person(n);
        await a.prisma.user.update({
          where: { id: id(n) },
          data: {
            mailTo: `${n}@lm.test`,
            status: "ACTIVE",
            createdAt: new Date("2026-11-10T09:00:00.000Z"),
          },
        });
      }
    };
    // the relay refuses one address on every try, accepts the rest
    let refuse = "";
    let refusing: Server;
    beforeAll(async () => {
      refusing = createServer((req, res) => {
        let raw = "";
        req.on("data", (c: Buffer) => (raw += c.toString()));
        req.on("end", () => {
          const b = JSON.parse(raw) as Got["body"];
          if (b.to === refuse) {
            res.writeHead(500);
            return res.end("{}");
          }
          got.push({ body: b });
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        });
      });
      await new Promise<void>((r) => refusing.listen(PORT + 1, "127.0.0.1", r));
    });
    afterAll(async () => {
      await new Promise<void>((r) => refusing.close(() => r()));
    });
    const T0 = AFTER_OPEN.getTime();
    const min = (m: number) => new Date(T0 + m * 60_000);

    it("is tried again after 10 minutes, then it is done and no more audience queries run", async () => {
      await launchQuestion();
      await fill();
      refuse = "u1@lm.test";
      const cfg = a.h.app.get(TopicMailService)["mail"] as unknown as {
        relayBase: () => string;
      };
      const spy = jest
        .spyOn(cfg, "relayBase")
        .mockReturnValue(`http://127.0.0.1:${PORT + 1}`);
      const total = await a.prisma.user.count({
        where: {
          mailTo: { not: null },
          status: "ACTIVE",
          createdAt: { lt: STARTS },
        },
      });
      const r1 = await svc.runLaunchOpen(min(0));
      expect(r1.sent).toBe(total - 1);
      expect(r1.state).not.toBe("done");
      expect((svc as unknown as { launchDone: boolean }).launchDone).toBe(
        false,
      );
      expect(await rows("C14")).toBe(total - 1);
      expect((await svc.runLaunchOpen(min(5))).state).toBe("waiting");
      refuse = "";
      const r2 = await svc.runLaunchOpen(min(11));
      expect(r2.sent).toBe(1);
      expect((svc as unknown as { launchDone: boolean }).launchDone).toBe(true);
      expect(await rows("C14")).toBe(total);
      const find = jest.spyOn(a.prisma.user, "findMany");
      expect(await svc.runLaunchOpen(min(70))).toEqual({
        state: "done",
        sent: 0,
      });
      expect(find).not.toHaveBeenCalled();
      find.mockRestore();
      spy.mockRestore();
    });

    it("gives up after 6 follow-up runs that sent nothing; nobody else is mailed twice", async () => {
      await launchQuestion();
      await fill();
      refuse = "u1@lm.test";
      const spy = jest
        .spyOn(a.h.app.get(TopicMailService)["mail"] as never, "relayBase")
        .mockReturnValue(`http://127.0.0.1:${PORT + 1}` as never);
      const total = await a.prisma.user.count({
        where: {
          mailTo: { not: null },
          status: "ACTIVE",
          createdAt: { lt: STARTS },
        },
      });
      await svc.runLaunchOpen(min(0));
      const state = () =>
        (svc as unknown as { launchDone: boolean }).launchDone;
      for (let i = 1; i <= 5; i++) {
        await svc.runLaunchOpen(min(11 * i));
        expect(state()).toBe(false);
      }
      await svc.runLaunchOpen(min(11 * 6));
      expect(state()).toBe(true);
      expect(await rows("C14")).toBe(total - 1);
      expect(
        await a.prisma.mailLog.count({
          where: { template: "C14", userId: id("u1") },
        }),
      ).toBe(0);
      const per = await a.prisma.mailLog.groupBy({
        by: ["userId"],
        where: { template: "C14" },
        _count: true,
      });
      expect(per.every((p) => p._count === 1)).toBe(true);
      expect(got).toHaveLength(total - 1);
      spy.mockRestore();
    });
  });
});
