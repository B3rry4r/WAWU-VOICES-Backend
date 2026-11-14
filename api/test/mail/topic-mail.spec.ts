/* eslint-disable @typescript-eslint/no-unsafe-member-access -- tests read untyped JSON bodies */
import { createServer, type Server } from "node:http";
import { bootAdmin, type Admin } from "../admin/helpers";
import { TopicMailService } from "../../src/mail/topic-mail.service";
import { MailService } from "../../src/mail/mail.service";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import type { App } from "supertest/types";

/**
 * V-TOPIC-MAILS: C01 (today's question) and C02 (topic of the week starts). A real database; WAWU ID's relay is a
 * local stand-in on port 15091 that records every call. Nothing real is sent. The clock is passed in (Lagos is UTC+1).
 */
const PORT = 15091;
const KEY = "topic-mail-test-service-key";

interface Got {
  idem?: string;
  body: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tag: string;
    app?: string;
    headers?: Record<string, string>;
  };
}

// Monday 16 Nov 2026. 06:30Z is 07:30 Lagos.
const MON = "2026-11-16";
const at = (hhmmZ: string, day = MON) => new Date(`${day}T${hhmmZ}:00.000Z`);
const lagosStart = (day: string) =>
  new Date(`${day}T00:00:00.000Z`).getTime() - 3_600_000;

describe("V-TOPIC-MAILS: daily question and topic of the week emails", () => {
  let a: Admin;
  let srv: Server;
  let got: Got[] = [];
  let relay: { status: number; body: unknown; after: number } = {
    status: 200,
    body: { id: "x" },
    after: Infinity,
  };
  let calls = 0;
  let svc: TopicMailService;
  let pause: jest.SpyInstance;
  const names = ["u1", "u2", "u3", "u4", "u5", "u6"];
  const id = (n: string) => a.people[n].id;
  const tags = (t: string) => got.filter((g) => g.body.tag === `voices_${t}`);
  const logRows = (t: string) =>
    a.prisma.mailLog.count({ where: { template: t } });

  const topic = (over: Record<string, unknown> = {}) =>
    a.prisma.topic.create({
      data: {
        weekNumber: 46,
        title: "Are You Really Fine?",
        blurb: "Money, mood and Monday.",
        startsOn: new Date(`${MON}T00:00:00.000Z`),
        endsOn: new Date("2026-11-22T00:00:00.000Z"),
        status: "SCHEDULED",
        ...over,
      } as never,
    });
  const question = (over: Record<string, unknown> = {}) =>
    a.prisma.question.create({
      data: {
        text: "What is one thing you would change about payday?",
        status: "SCHEDULED",
        kind: "DAILY",
        scheduledFor: new Date(`${MON}T00:00:00.000Z`),
        startsAt: new Date(lagosStart(MON)),
        endsAt: new Date(lagosStart(MON) + 86_400_000),
        voiceCount: 1250,
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
          return res.end(JSON.stringify(relay.body));
        }
        got.push({
          idem: req.headers["idempotency-key"] as string | undefined,
          body: JSON.parse(raw) as Got["body"],
        });
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
    relay = { status: 200, body: { id: "x" }, after: Infinity };
    delete process.env.TOPIC_MAIL_ENABLED;
    await a.prisma.mailLog.deleteMany();
    await a.prisma.question.deleteMany();
    await a.prisma.topic.deleteMany();
    await a.prisma.userSettings.deleteMany();
    for (const n of names) {
      await a.prisma.user.update({
        where: { id: id(n) },
        data: { mailTo: `${n}@tm.test`, status: "ACTIVE" },
      });
    }
    // fresh in-process memory of finished runs and caps
    (svc as unknown as { finished: Set<string> }).finished.clear();
    (svc as unknown as { cappedOn: Map<string, string> }).cappedOn.clear();
    pause.mockClear();
  });

  afterAll(async () => {
    pause.mockRestore();
    await a?.close();
    await new Promise<void>((r) => srv.close(() => r()));
  });

  describe("C01 today's question", () => {
    it("sends the real question with its links to every member, once, from 07:00 Lagos", async () => {
      const q = await question();
      expect((await svc.runDailyQuestion(at("05:59"))).state).toBe("not-yet"); // 06:59 Lagos
      expect(got).toHaveLength(0);
      const r = await svc.runDailyQuestion(at("06:00")); // 07:00 Lagos
      expect(r).toEqual({ state: "done", sent: 6 });
      const m = tags("C01");
      expect(m).toHaveLength(6);
      expect(m.map((g) => g.body.to).sort()).toEqual(
        names.map((n) => `${n}@tm.test`),
      );
      const one = m[0].body;
      expect(one.app).toBe("voices");
      expect(one.subject).toBe(
        "Today’s question: What is one thing you would change about payday?",
      );
      expect(one.html).toContain(
        "What is one thing you would change about payday?",
      );
      expect(one.html).toContain("1,250 voices so far");
      expect(one.html).toContain(`https://usevoices.com/q/${q.id}/speak`);
      expect(one.text).toContain(`https://usevoices.com/q/${q.id}`);
      expect(one.html).not.toMatch(/\{\{/);
      expect(one.html + one.text).not.toMatch(/[—–]/);
    });

    it("sends each person at most once: a second run, a restart and two servers add nothing", async () => {
      const q = await question();
      await svc.runDailyQuestion(at("06:00"));
      expect(got).toHaveLength(6);
      expect((await svc.runDailyQuestion(at("06:30"))).sent).toBe(0); // same process
      (svc as unknown as { finished: Set<string> }).finished.clear(); // a restart forgets what it finished
      expect((await svc.runDailyQuestion(at("06:31"))).sent).toBe(0);
      // two servers at the same moment
      await a.prisma.mailLog.deleteMany({
        where: { userId: { in: [id("u5"), id("u6")] } },
      });
      got = [];
      const [x, y] = await Promise.all([
        svc.runDailyQuestion(at("06:32")),
        (async () => {
          const ms = a.h.app.get(MailService);
          return Promise.all(
            ["u5", "u6"].map((n) =>
              ms.send({
                template: "C01",
                userId: id(n),
                eventKey: `question:${q.id}`,
                scopeKey: MON,
                vars: {
                  question_text: "x",
                  question_short: "x",
                  voice_count: "1",
                  closes_in: "1 hour",
                  topic_url: "u",
                  listen_url: "u",
                },
              }),
            ),
          );
        })(),
      ]);
      void x;
      void y;
      expect(await logRows("C01")).toBe(6);
      expect(
        tags("C01")
          .map((g) => g.body.to)
          .filter((t) => t === "u5@tm.test"),
      ).toHaveLength(1);
      const key = (await a.prisma.mailLog.findFirst({
        where: { template: "C01" },
      }))!;
      expect(key.eventKey).toBe(`question:${q.id}`);
      expect(key.scopeKey).toBe(MON);
    });

    it("is paced: one pause between mails, at the configured rate", async () => {
      await question();
      await svc.runDailyQuestion(at("06:00"));
      expect(pause).toHaveBeenCalledTimes(6);
      pause.mockRestore();
      process.env.TOPIC_MAIL_PER_SECOND = "20"; // 50 ms apart
      await a.prisma.mailLog.deleteMany();
      got = [];
      (svc as unknown as { finished: Set<string> }).finished.clear();
      const t0 = Date.now();
      await svc.runDailyQuestion(at("06:00"));
      const took = Date.now() - t0;
      process.env.TOPIC_MAIL_PER_SECOND = "1000";
      pause = jest.spyOn(svc, "pause").mockResolvedValue();
      expect(got).toHaveLength(6);
      expect(took).toBeGreaterThanOrEqual(6 * 50 - 20);
    });

    it("stops at once on a 429 without marking anyone as sent, and never tries again that day or the next", async () => {
      for (const code of [
        "daily_cap",
        "provider_daily_quota",
        "provider_monthly_quota",
      ]) {
        await a.prisma.mailLog.deleteMany();
        got = [];
        calls = 0;
        (svc as unknown as { cappedOn: Map<string, string> }).cappedOn.clear();
        (svc as unknown as { finished: Set<string> }).finished.clear();
        await a.prisma.question.deleteMany();
        await question();
        relay = { status: 429, body: { code }, after: 2 };
        const r = await svc.runDailyQuestion(at("06:00"));
        expect(r).toEqual({ state: "capped", sent: 2 });
        expect(got).toHaveLength(2);
        expect(calls).toBe(3); // the refused call was the last: no retries, nobody after
        expect(await logRows("C01")).toBe(2); // the refused person has no row
        // later the same day: no new calls
        calls = 0;
        expect((await svc.runDailyQuestion(at("08:00"))).state).toBe("capped");
        expect(calls).toBe(0);
      }
    });

    it("skip rule: the people not reached are skipped, and the day's question is never sent the next day", async () => {
      await question();
      relay = { status: 429, body: { code: "daily_cap" }, after: 3 };
      await svc.runDailyQuestion(at("06:00"));
      expect(got).toHaveLength(3);
      relay = { status: 200, body: {}, after: Infinity };
      // Tuesday 07:30 Lagos: Monday's question is over, no question for Tuesday exists yet
      (svc as unknown as { cappedOn: Map<string, string> }).cappedOn.clear();
      const next = await svc.runDailyQuestion(at("06:30", "2026-11-17"));
      expect(next.state).toBe("nothing-open");
      // after the cut-off on the same day nothing more goes either
      const late = await svc.runDailyQuestion(at("11:30")); // 12:30 Lagos
      expect(late.state).toBe("too-late");
      expect(got).toHaveLength(3);
      expect(await logRows("C01")).toBe(3);
    });

    it("sends nothing for a question that is not open yet, however it is labelled", async () => {
      // tomorrow's question, already LIVE by label, starts in the future
      await question({
        status: "LIVE",
        scheduledFor: new Date("2026-11-17T00:00:00.000Z"),
        startsAt: new Date(lagosStart("2026-11-17")),
        endsAt: new Date(lagosStart("2026-11-17") + 86_400_000),
        text: "Tomorrow only",
      });
      // today's is a draft
      await question({ status: "DRAFT", text: "Draft" });
      expect((await svc.runDailyQuestion(at("06:00"))).state).toBe(
        "nothing-open",
      );
      // today's question closed by the team
      await question({ status: "CLOSED", text: "Closed" });
      expect((await svc.runDailyQuestion(at("06:00"))).state).toBe(
        "nothing-open",
      );
      expect(got).toHaveLength(0);
      // a calendar change moves it in the middle of a run: a question that closes stops the run
      const q = await question({ text: "Moved" });
      const spy = jest
        .spyOn(a.h.app.get(MailService), "send")
        .mockImplementation(async () => {
          await a.prisma.question.update({
            where: { id: q.id },
            data: { status: "CLOSED" },
          });
          return "sent";
        });
      const r = await svc.runDailyQuestion(at("06:00"));
      const sends = spy.mock.calls.length;
      spy.mockRestore();
      expect(r.state).toBe("nothing-open");
      expect(sends).toBe(1);
    });

    it("the 12:00 Lagos cut-off holds inside a run: a run started at 11:59:58 sends nothing after 12:00:00", async () => {
      await question();
      // 10:59:58Z is 11:59:58 Lagos; each mail takes real time, so the run's own clock crosses 12:00:00 Lagos.
      const start = new Date(`${MON}T10:59:58.000Z`);
      const ms = a.h.app.get(MailService);
      const real = ms.send.bind(ms);
      const spy = jest.spyOn(ms, "send").mockImplementation(async (job) => {
        await new Promise((r) => setTimeout(r, 900));
        return real(job);
      });
      const r = await svc.runDailyQuestion(start);
      spy.mockRestore();
      expect(r.state).toBe("nothing-open");
      expect(got.length).toBeGreaterThanOrEqual(1);
      expect(got.length).toBeLessThanOrEqual(3); // 11:59:58, 11:59:59, then 12:00:00 and later: none
      expect(got.length).toBeLessThan(6);
    });

    it("an override that comes up later in the day does not send a second daily mail", async () => {
      await question();
      await svc.runDailyQuestion(at("06:00"));
      await a.prisma.question.create({
        data: {
          text: "Breaking",
          kind: "OVERRIDE",
          status: "LIVE",
          startsAt: at("08:00"),
          endsAt: at("20:00"),
        },
      });
      const r = await svc.runDailyQuestion(at("09:00"));
      expect(r.state).toBe("already-mailed-other");
      expect(tags("C01")).toHaveLength(6);
    });

    it("leaves out people who turned it off, deleted, suspended, banned and deleting accounts, and no address", async () => {
      await question();
      await a.prisma.userSettings.create({
        data: { userId: id("u1"), notifyDailyQuestion: false },
      });
      await a.prisma.user.update({
        where: { id: id("u2") },
        data: { status: "SUSPENDED" },
      });
      await a.prisma.user.update({
        where: { id: id("u3") },
        data: { status: "BANNED" },
      });
      await a.prisma.user.update({
        where: { id: id("u4") },
        data: { status: "DELETION_PENDING" },
      });
      await a.prisma.user.update({
        where: { id: id("u5") },
        data: { status: "DELETED", mailTo: null },
      });
      await a.prisma.user.update({
        where: { id: id("u6") },
        data: { mailTo: null },
      });
      const r = await svc.runDailyQuestion(at("06:00"));
      expect(r.sent).toBe(0);
      expect(got).toHaveLength(0);
      (svc as unknown as { finished: Set<string> }).finished.clear();
      // a person with a settings row that leaves it on still gets it
      await a.prisma.user.update({
        where: { id: id("u6") },
        data: { mailTo: "u6@tm.test" },
      });
      await a.prisma.userSettings.create({
        data: { userId: id("u6"), notifyDailyQuestion: true },
      });
      expect((await svc.runDailyQuestion(at("06:05"))).sent).toBe(1);
      // the send itself also refuses a suspended or switched-off person (a person changed between the list and the send)
      const ms = a.h.app.get(MailService);
      const job = (u: string) => ({
        template: "C01" as const,
        userId: id(u),
        eventKey: "question:other",
        vars: {
          question_text: "x",
          question_short: "x",
          voice_count: "1",
          closes_in: "1 hour",
          topic_url: "u",
          listen_url: "u",
        },
      });
      expect(await ms.send(job("u2"))).toBe("no-address");
      expect(await ms.send(job("u1"))).toBe("switched-off");
    });

    it("carries the unsubscribe headers and footer link, and the link turns the switch off", async () => {
      await question();
      await svc.runDailyQuestion(at("06:00"));
      const mail = tags("C01").find((g) => g.body.to === "u1@tm.test")!;
      const h = mail.body.headers!;
      expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      const url = /^<(.+)>$/.exec(h["List-Unsubscribe"])![1];
      expect(url).toMatch(
        /^https:\/\/usevoices\.com\/api\/v1\/mail\/unsubscribe\?t=/,
      );
      const esc = url.replace(/&/g, "&amp;");
      expect(mail.body.html).toContain(`href="${esc}"`);
      expect(mail.body.text).toContain(url);
      const path = url.replace("https://usevoices.com", "");
      const http = () => request(a.h.app.getHttpServer() as App);
      // GET only shows a page: a link scanner changes nothing
      const page = await http().get(path).expect(200);
      expect(page.text).toContain("Turn them off");
      expect(
        await a.prisma.userSettings.findUnique({ where: { userId: id("u1") } }),
      ).toBeNull();
      // one click from the mail client
      await http()
        .post(path)
        .type("form")
        .send("List-Unsubscribe=One-Click")
        .expect(201);
      const s = await a.prisma.userSettings.findUnique({
        where: { userId: id("u1") },
      });
      expect(s?.notifyDailyQuestion).toBe(false);
      expect(s?.notifyWeeklyTopic).toBe(true); // only this kind of mail
      // a tampered or other-kind token does nothing
      await http()
        .post(path.replace(/.$/, (c) => (c === "A" ? "B" : "A")))
        .expect(400);
      await http().get("/api/v1/mail/unsubscribe").expect(400);
      // and the next day's run leaves this person out
      await a.prisma.mailLog.deleteMany({ where: { userId: id("u1") } });
      got = [];
      (svc as unknown as { finished: Set<string> }).finished.clear();
      await svc.runDailyQuestion(at("06:10"));
      expect(got.map((g) => g.body.to)).not.toContain("u1@tm.test");
    });

    it("the off switch sends nothing, and the admin Today numbers count what went out today", async () => {
      await question();
      process.env.TOPIC_MAIL_ENABLED = "false";
      expect((await svc.runDailyQuestion(at("06:00"))).state).toBe("off");
      expect((await svc.runWeeklyTopic(at("06:00"))).state).toBe("off");
      expect(got).toHaveLength(0);
      delete process.env.TOPIC_MAIL_ENABLED;
      await svc.runDailyQuestion(at("06:00"));
      const today = await svc.sentToday();
      expect(today).toEqual({ c01: 6, c02: 0 });
    });
  });

  describe("C02 topic of the week starts", () => {
    it("sends the topic to every member, once, with the unsubscribe link, from 06:30 Lagos on its first day", async () => {
      await topic();
      expect((await svc.runWeeklyTopic(at("05:29"))).state).toBe("not-yet"); // 06:29 Lagos
      const r = await svc.runWeeklyTopic(at("05:30"));
      expect(r).toEqual({ state: "done", sent: 6 });
      const m = tags("C02");
      expect(m).toHaveLength(6);
      expect(m[0].body.subject).toBe("New topic: Are You Really Fine?");
      expect(m[0].body.html).toContain("Money, mood and Monday.");
      expect(m[0].body.headers!["List-Unsubscribe-Post"]).toBe(
        "List-Unsubscribe=One-Click",
      );
      expect(m[0].body.html + m[0].body.text).not.toMatch(/[—–]|\{\{/);
      expect((await svc.runWeeklyTopic(at("07:00"))).sent).toBe(0);
      const row = (await a.prisma.mailLog.findFirst({
        where: { template: "C02" },
      }))!;
      expect(row.eventKey).toMatch(/^topic:/);
      expect(await logRows("C02")).toBe(6);
    });

    it("carries on the next day after a 429, only for people without a row, while the topic is open", async () => {
      await topic();
      relay = { status: 429, body: { code: "provider_daily_quota" }, after: 4 };
      expect(await svc.runWeeklyTopic(at("05:30"))).toEqual({
        state: "capped",
        sent: 4,
      });
      expect(await logRows("C02")).toBe(4);
      relay = { status: 200, body: {}, after: Infinity };
      calls = 0;
      expect((await svc.runWeeklyTopic(at("12:00"))).state).toBe("capped"); // same Lagos day: no new try
      expect(calls).toBe(0);
      const next = await svc.runWeeklyTopic(at("05:30", "2026-11-17"));
      expect(next).toEqual({ state: "done", sent: 2 });
      expect(await logRows("C02")).toBe(6);
      const to = tags("C02").map((g) => g.body.to);
      expect(new Set(to).size).toBe(6); // nobody twice
      // the topic closes: no carry-on after its last day
      await a.prisma.mailLog.deleteMany({ where: { userId: id("u6") } });
      (svc as unknown as { finished: Set<string> }).finished.clear();
      expect((await svc.runWeeklyTopic(at("05:30", "2026-11-23"))).state).toBe(
        "nothing-open",
      );
    });

    it("sends nothing for a topic that is not open yet, or is a draft or closed", async () => {
      await topic({
        weekNumber: 47,
        startsOn: new Date("2026-11-23T00:00:00.000Z"),
        endsOn: new Date("2026-11-29T00:00:00.000Z"),
        status: "SCHEDULED",
      });
      await topic({ weekNumber: 48, status: "DRAFT" });
      await topic({ weekNumber: 49, status: "CLOSED" });
      await topic({ weekNumber: 50, status: "IN_REVIEW" });
      expect((await svc.runWeeklyTopic(at("05:30"))).state).toBe(
        "nothing-open",
      );
      expect(got).toHaveLength(0);
    });

    it("respects its own switch (notifyWeeklyTopic), and leaves out suspended, banned and deleted accounts", async () => {
      await topic();
      await a.prisma.userSettings.create({
        data: { userId: id("u1"), notifyWeeklyTopic: false },
      });
      await a.prisma.userSettings.create({
        data: { userId: id("u2"), notifyDailyQuestion: false },
      }); // the daily switch is not this one
      await a.prisma.user.update({
        where: { id: id("u3") },
        data: { status: "SUSPENDED" },
      });
      await a.prisma.user.update({
        where: { id: id("u4") },
        data: { status: "BANNED" },
      });
      await a.prisma.user.update({
        where: { id: id("u5") },
        data: { status: "DELETED", mailTo: null },
      });
      const r = await svc.runWeeklyTopic(at("05:30"));
      expect(r.sent).toBe(2);
      expect(
        tags("C02")
          .map((g) => g.body.to)
          .sort(),
      ).toEqual(["u2@tm.test", "u6@tm.test"]);
    });

    it("the settings route shows and saves the new switch, and one-click unsubscribe turns it off", async () => {
      const http = () => request(a.h.app.getHttpServer() as App);
      const auth = a.auth("u1");
      const before = await http()
        .get("/api/v1/me/settings")
        .set(auth)
        .expect(200);
      expect(before.body.notifyWeeklyTopic).toBe(true);
      expect(before.body.notifyDailyQuestion).toBe(true);
      const after = await http()
        .patch("/api/v1/me/settings")
        .set(auth)
        .send({ notifyWeeklyTopic: false })
        .expect(200);
      expect(after.body.notifyWeeklyTopic).toBe(false);
      expect(after.body.notifyDailyQuestion).toBe(true);
      await topic();
      await svc.runWeeklyTopic(at("05:30"));
      expect(tags("C02").map((g) => g.body.to)).not.toContain("u1@tm.test");
      // and the other direction: turn it on, then the mail's own link turns it off again
      await http()
        .patch("/api/v1/me/settings")
        .set(auth)
        .send({ notifyWeeklyTopic: true })
        .expect(200);
      const mail = tags("C02")[0];
      const url = /^<(.+)>$/.exec(mail.body.headers!["List-Unsubscribe"])![1];
      const who = (await a.prisma.user.findFirst({
        where: { mailTo: mail.body.to },
      }))!;
      await http().post(url.replace("https://usevoices.com", "")).expect(201);
      expect(
        (await a.prisma.userSettings.findUnique({ where: { userId: who.id } }))
          ?.notifyWeeklyTopic,
      ).toBe(false);
    });
  });

  describe("daily budget (TOPIC_MAIL_DAILY_MAX)", () => {
    const resetMemory = () => {
      (svc as unknown as { finished: Set<string> }).finished.clear();
      (svc as unknown as { cappedOn: Map<string, string> }).cappedOn.clear();
    };
    /** Makes everything in the log a day older, so the real UTC day's budget is free again. */
    const nextUtcDay = () =>
      a.prisma.$executeRawUnsafe(
        `UPDATE "MailLog" SET "createdAt" = "createdAt" - interval '1 day'`,
      );
    afterEach(() => {
      delete process.env.TOPIC_MAIL_DAILY_MAX;
    });

    it("ends the run as budget-reached with exactly N sent and nobody marked beyond", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "4";
      await topic();
      const r = await svc.runWeeklyTopic(at("11:00"));
      expect(r).toEqual({ state: "budget-reached", sent: 4 });
      expect(got).toHaveLength(4);
      expect(await logRows("C02")).toBe(4);
      expect(await svc.budgetLeft()).toBe(0);
      // C01 shares the same budget
      await question();
      expect((await svc.runDailyQuestion(at("06:00"))).state).toBe(
        "budget-reached",
      );
      expect(got).toHaveLength(4);
      expect(await logRows("C01")).toBe(0);
    });

    it("two processes together cannot go past it", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "4";
      await topic();
      const other = new TopicMailService(
        a.prisma,
        a.h.app.get(MailService),
        a.h.app.get(ConfigService),
      );
      jest.spyOn(other, "pause").mockResolvedValue();
      const runs = await Promise.all([
        svc.runWeeklyTopic(at("11:00")),
        other.runWeeklyTopic(at("11:00")),
      ]);
      expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(4);
      expect(await logRows("C02")).toBe(4);
      expect(got).toHaveLength(4);
      expect(new Set(got.map((g) => g.body.to)).size).toBe(4);
    });

    it("the next day's C02 run picks up the people who were skipped", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "4";
      await topic();
      await svc.runWeeklyTopic(at("11:00"));
      expect((await svc.runWeeklyTopic(at("08:00"))).state).toBe(
        "budget-reached",
      );
      await nextUtcDay();
      resetMemory();
      const r = await svc.runWeeklyTopic(at("11:00", "2026-11-17"));
      expect(r).toEqual({ state: "done", sent: 2 });
      expect(await logRows("C02")).toBe(6);
      expect(new Set(tags("C02").map((g) => g.body.to)).size).toBe(6);
    });

    it("mails the people who waited longest first, over three days with 3 people and a budget of 2", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "2";
      for (const n of ["u4", "u5", "u6"])
        await a.prisma.user.update({
          where: { id: id(n) },
          data: { status: "SUSPENDED" },
        });
      const ordered = ["u1", "u2", "u3"].sort((x, y) =>
        id(x) < id(y) ? -1 : 1,
      );
      const [p1, p2, p3] = ordered;
      const days = ["2026-11-16", "2026-11-17", "2026-11-18"];
      const to: string[][] = [];
      for (const day of days) {
        await question({
          text: `Q ${day}`,
          scheduledFor: new Date(`${day}T00:00:00.000Z`),
          startsAt: new Date(lagosStart(day)),
          endsAt: new Date(lagosStart(day) + 86_400_000),
        });
        got = [];
        resetMemory();
        const r = await svc.runDailyQuestion(at("06:00", day));
        expect(r.sent).toBe(2);
        to.push(got.map((g) => g.body.to));
        await nextUtcDay();
      }
      const addr = (n: string) => `${n}@tm.test`;
      expect(to[0]).toEqual([addr(p1), addr(p2)]); // never mailed: by id
      expect(to[1]).toEqual([addr(p3), addr(p1)]); // the never-mailed one, then the oldest
      expect(to[2]).toEqual([addr(p2), addr(p3)]); // p2 waited longest, then p3 before p1
    });

    it("TOPIC_MAIL_DAILY_MAX=0 sends nothing", async () => {
      process.env.TOPIC_MAIL_DAILY_MAX = "0";
      await topic();
      await question();
      expect(await svc.runWeeklyTopic(at("05:30"))).toEqual({
        state: "budget-reached",
        sent: 0,
      });
      expect(await svc.runDailyQuestion(at("06:00"))).toEqual({
        state: "budget-reached",
        sent: 0,
      });
      expect(got).toHaveLength(0);
      expect(await logRows("C01")).toBe(0);
      expect(await logRows("C02")).toBe(0);
    });
  });

  it("the admin Today response counts the mails sent today", async () => {
    // exercised through the service the admin controller calls
    const { TodayAdminService } =
      await import("../../src/admin/today.service.js");
    await topic();
    await svc.runWeeklyTopic(at("05:30"));
    await a.prisma.mailLog.updateMany({ data: { createdAt: new Date() } });
    const t = (await a.h.app.get(TodayAdminService).today()) as {
      stats: Record<string, number>;
    };
    expect(t.stats.weeklyTopicMailsToday).toBe(6);
    expect(t.stats.dailyQuestionMailsToday).toBe(0);
    expect(t.stats.topicMailBudgetLeftToday).toBe(2500 - 6);
  });
});
