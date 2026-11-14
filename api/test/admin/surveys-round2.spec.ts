/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- response bodies are read as loose JSON */
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { sql } from "../me/helpers";
import { bootAdmin, type Admin } from "./helpers";

/**
 * V-SURVEYS round 2: a refused or capped brand mail is retried, F04 is sent only after release and never lost or doubled,
 * results are fixed when the survey is over, no hidden group follows from a total, free answers are read by staff before
 * a brand sees them, nothing joins a completed survey to a person, state targeting needs consent, brand pages hold only
 * their own adverts. The mail relay is a local stand-in with a mode; nothing real is sent.
 */
const PORT = 15092;
const KEY = "survey-r2-service-key";
const api = "/api/v1";

describe("V-SURVEYS round 2", () => {
  let a: Admin;
  let srv: Server;
  let mode: "ok" | "500" | "429" | "429daily" = "ok";
  let calls = 0;
  const delivered: { to: string; tag: string; text: string }[] = [];
  const day = (n: number) =>
    new Date(Date.now() + n * 86_400_000 + 3_600_000)
      .toISOString()
      .slice(0, 10);

  const body = (over: Record<string, unknown> = {}) => ({
    brandName: "Round Two Foods",
    contactEmail: "r2@brand.test",
    title: "What do you cook?",
    questions: [
      {
        kind: "SINGLE_CHOICE",
        prompt: "Which do you cook most?",
        options: ["Rice", "Beans", "Yam"],
      },
      { kind: "TEXT", prompt: "What would make cooking easier?" },
      { kind: "VOICE", prompt: "Tell us about your kitchen" },
    ],
    startsOn: day(-3),
    endsOn: day(10),
    frequencyCapPerDay: 1,
    priceKobo: 5_000_000,
    ...over,
  });

  const post = (path: string, who: string | null, data?: object) => {
    const r = a.h.http().post(`${api}${path}`);
    return (who ? r.set(a.auth(who)) : r).send(data ?? {});
  };
  const get = (path: string, who: string | null) => {
    const r = a.h.http().get(`${api}${path}`);
    return who ? r.set(a.auth(who)) : r;
  };
  const patch = (path: string, who: string, data: object) =>
    a.h.http().patch(`${api}${path}`).set(a.auth(who)).send(data);

  const live = async (over: Record<string, unknown> = {}) => {
    const c = await post("/admin/surveys", "adman", body(over)).expect(201);
    await post(`/admin/surveys/${c.body.id}/submit`, "adman").expect(200);
    await post(`/admin/surveys/${c.body.id}/decision`, "admin", {
      decision: "APPROVE",
    }).expect(200);
    return c.body.id as string;
  };
  const questions = async (id: string) =>
    (await get(`/admin/surveys/${id}`, "adman").expect(200)).body.questions as {
      id: string;
      kind: string;
      options: { id: string; label: string }[];
    }[];

  /** Stored answers written straight into the tables (the people are not needed for what is read back). */
  const store = async (
    id: string,
    picks: number[],
    extra: (i: number) => Record<string, unknown> = () => ({}),
    texts: (string | null)[] = [],
  ) => {
    const q = await questions(id);
    for (const [i, p] of picks.entries()) {
      const r = await a.prisma.surveyResponse.create({
        data: { surveyId: id, respondentKey: randomUUID(), ...extra(i) },
      });
      await a.prisma.surveyAnswer.create({
        data: {
          responseId: r.id,
          questionId: q[0].id,
          optionId: q[0].options[p].id,
        },
      });
      if (texts[i])
        await a.prisma.surveyAnswer.create({
          data: { responseId: r.id, questionId: q[1].id, text: texts[i] },
        });
    }
  };
  const finish = (id: string) =>
    a.prisma.sponsoredSurvey.update({
      where: { id },
      data: { endsOn: new Date(`${day(-1)}T00:00:00Z`) },
    });
  const report = async (id: string) =>
    (await get(`/admin/surveys/${id}/report`, "adman").expect(200)).body;
  const settle = async () => {
    const { MailService } = await import("../../src/mail/mail.service.js");
    await a.h.app.get(MailService).settled();
  };
  const f04vars = {
    responses: 5,
    completionRate: "50%",
    topAnswer: "Rice",
    topAnswerPct: "60%",
    daysLive: 3,
  };

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        calls++;
        if (mode === "500") {
          res.writeHead(500, { "content-type": "application/json" });
          return res.end("{}");
        }
        if (mode === "429") {
          res.writeHead(429, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "daily_cap" }));
        }
        if (mode === "429daily") {
          res.writeHead(429, { "content-type": "application/json" });
          return res.end(JSON.stringify({ code: "daily_cap" }));
        }
        delivered.push(JSON.parse(raw));
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((r) => srv.listen(PORT, "127.0.0.1", r));
    process.env.WAWU_ID_BASE_URL = `http://127.0.0.1:${PORT}`;
    process.env.INTERNAL_SERVICE_KEY = KEY;
    process.env.MAIL_RETRY_MS = "5";
    a = await bootAdmin();
    await sql(
      `TRUNCATE "SponsoredSurvey", "Brand", "SurveyResponse", "MailLog", "Ad", "UserSettings" RESTART IDENTITY CASCADE`,
    );
    await a.person("admin", ["ADMIN"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("lagos");
    await a.person("plain");
    await a.prisma.user.update({
      where: { id: a.people.lagos.id },
      data: { state: "Lagos" },
    });
    await a.prisma.configEntry.upsert({
      where: { key: "weekly.min_group_size" },
      create: { key: "weekly.min_group_size", valueJson: 3 },
      update: { valueJson: 3 },
    });
  });
  afterAll(async () => {
    delete process.env.BRAND_MAIL_DAILY_MAX;
    await a.close();
    await new Promise((r) => srv.close(r));
  });

  // ---------------------------------------------------------------------------------------- B1 and M5: the brand mail

  describe("brand mail and the relay's answer", () => {
    it("a relay that answers 500 drops the mail without logging it as sent; the retry delivers it", async () => {
      const { MailEvents } = await import("../../src/mail/mail-events.js");
      const ev = a.h.app.get(MailEvents);
      const id = (await post("/admin/surveys", "adman", body()).expect(201))
        .body.id as string;
      mode = "500";
      calls = 0;
      expect(await ev.surveyResultsReady(id, f04vars)).toBe("failed");
      expect(calls).toBe(3); // three tries on a 5xx
      expect(
        await a.prisma.mailLog.count({ where: { userId: `brand:${id}` } }),
      ).toBe(0);
      mode = "ok";
      delivered.length = 0;
      expect(await ev.surveyResultsReady(id, f04vars)).toBe("sent");
      expect(delivered).toHaveLength(1);
      expect(delivered[0].to).toBe("r2@brand.test");
      // and not twice
      expect(await ev.surveyResultsReady(id, f04vars)).toBe("limited");
      expect(delivered).toHaveLength(1);
    });

    // Round 7 (lead ruling): this spec expected "capped" for a bare 429 (body {error:"daily_cap"}, no code). Main's rule
    // (classify429) makes a bare 429 a rate limit, so it now expects "paused": still not logged, no allowance used, sent later.
    it("a relay that answers a bare 429 is paused, not logged, and sends later", async () => {
      const { MailEvents } = await import("../../src/mail/mail-events.js");
      const ev = a.h.app.get(MailEvents);
      const id = (await post("/admin/surveys", "adman", body()).expect(201))
        .body.id as string;
      mode = "429";
      calls = 0;
      expect(await ev.surveyResultsReady(id, f04vars)).toBe("paused");
      expect(calls).toBe(1);
      expect(
        await a.prisma.mailLog.count({ where: { userId: `brand:${id}` } }),
      ).toBe(0);
      mode = "ok";
      delivered.length = 0;
      expect(await ev.surveyResultsReady(id, f04vars)).toBe("sent");
      expect(delivered).toHaveLength(1);
    });

    it("the named daily cap ends the day for brand mail; nothing is lost and it goes the next day", async () => {
      const { MailEvents } = await import("../../src/mail/mail-events.js");
      const ev = a.h.app.get(MailEvents);
      const id = (await post("/admin/surveys", "adman", body()).expect(201))
        .body.id as string;
      mode = "429daily";
      calls = 0;
      expect(await ev.surveyResultsReady(id, f04vars)).toBe("capped");
      expect(calls).toBe(1);
      // the same day: the relay is not asked again, and the mail is not logged
      mode = "ok";
      delivered.length = 0;
      expect(await ev.surveyResultsReady(id, f04vars)).toBe("capped");
      expect(calls).toBe(1);
      expect(delivered).toHaveLength(0);
      expect(
        await a.prisma.mailLog.count({ where: { userId: `brand:${id}` } }),
      ).toBe(0);
      // the next UTC day it goes
      const real = Date.now();
      const spy = jest.spyOn(Date, "now").mockReturnValue(real + 25 * 3600_000);
      try {
        expect(await ev.surveyResultsReady(id, f04vars)).toBe("sent");
      } finally {
        spy.mockRestore();
      }
      expect(delivered).toHaveLength(1);
    });

    it("a failed F01 is tried again by the next submit event, and goes once", async () => {
      const c = await post("/admin/surveys", "adman", body()).expect(201);
      mode = "500";
      delivered.length = 0;
      await post(`/admin/surveys/${c.body.id}/submit`, "adman").expect(200);
      await settle();
      expect(delivered).toHaveLength(0);
      mode = "ok";
      const { MailEvents } = await import("../../src/mail/mail-events.js");
      await a.h.app.get(MailEvents).surveySubmitted(c.body.id);
      await settle();
      expect(delivered.filter((m) => m.tag === "voices_F01")).toHaveLength(1);
    });

    it("brand mail has its own daily limit from BRAND_MAIL_DAILY_MAX (default 50), counted over F01 to F04 per UTC day", async () => {
      const { MailService } = await import("../../src/mail/mail.service.js");
      const { MailEvents } = await import("../../src/mail/mail-events.js");
      expect(a.h.app.get(MailService).brandDailyMax()).toBe(50);
      const used = await a.prisma.mailLog.count({
        where: {
          template: { in: ["F01", "F02", "F03", "F04"] },
          createdAt: {
            gte: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
          },
        },
      });
      expect(used).toBeGreaterThanOrEqual(3);
      process.env.BRAND_MAIL_DAILY_MAX = String(used);
      const id = (await post("/admin/surveys", "adman", body()).expect(201))
        .body.id as string;
      calls = 0;
      expect(
        await a.h.app.get(MailEvents).surveyResultsReady(id, f04vars),
      ).toBe("budget");
      expect(calls).toBe(0); // the relay was not asked
      expect(
        await a.prisma.mailLog.count({ where: { userId: `brand:${id}` } }),
      ).toBe(0);
      process.env.BRAND_MAIL_DAILY_MAX = String(used + 1);
      expect(
        await a.h.app.get(MailEvents).surveyResultsReady(id, f04vars),
      ).toBe("sent");
      delete process.env.BRAND_MAIL_DAILY_MAX;
    });
  });

  // ---------------------------------------------------------------------------------------- H3, M1, M5: results

  describe("results are fixed when the survey is over, read by staff, then released", () => {
    it("F04 is never sent before release; a failed F04 is kept and tried again; it goes once", async () => {
      const id = await live({ contactEmail: "f04@brand.test" });
      await store(id, [0, 0, 1], () => ({}), ["fine", "ok", "so so"]);
      await finish(id);
      delivered.length = 0;
      const { AdminSurveysService } =
        await import("../../src/surveys/surveys-admin.service.js");
      const svc = a.h.app.get(AdminSurveysService);
      expect(await svc.sweepFinished()).toBe(0); // over, fixed, not released: no mail
      await settle();
      expect(delivered.filter((m) => m.tag === "voices_F04")).toHaveLength(0);
      expect(
        (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
          .snapshotAt,
      ).not.toBeNull();
      await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200); // round 3: the list is read before release
      mode = "500";
      const rel = (
        await post(`/admin/surveys/${id}/release`, "adman").expect(200)
      ).body;
      expect(rel).toMatchObject({ released: true, mailed: false });
      expect(
        (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
          .resultsMailedAt,
      ).toBeNull();
      mode = "ok";
      expect(await svc.sweepFinished()).toBe(1);
      expect(await svc.sweepFinished()).toBe(0);
      expect(delivered.filter((m) => m.tag === "voices_F04")).toHaveLength(1);
      expect(
        (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
          .resultsMailedAt,
      ).not.toBeNull();
    });

    it("nothing is worked out while it runs: the report is only a count, before and after another answer", async () => {
      const id = await live();
      await store(id, [0, 0, 0, 1], () => ({}), ["a", "b", "c", "d"]);
      const one = await report(id);
      expect(one).toMatchObject({
        stage: "RUNNING",
        ready: false,
        answeredSoFar: 4,
      });
      await store(id, [0]);
      const two = await report(id);
      expect(two).toMatchObject({ ready: false, answeredSoFar: 5 });
      // the only difference between the two reads is the count: no choice, share or text moved
      expect({ ...two, answeredSoFar: 4 }).toEqual(one);
      await get(`/admin/surveys/${id}/free-answers`, "adman").expect(409);
      await post(`/admin/surveys/${id}/release`, "adman").expect(409);
      // a paused survey is still running
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(200);
      expect(await report(id)).toMatchObject({ ready: false });
    });

    it("reaching the response target fixes the results with the last answer; no answer follows; the survey cannot be edited or reopened", async () => {
      const id = await live({ responseTarget: 3 });
      const q = await questions(id);
      for (const n of ["lagos", "plain", "adman"]) {
        await post(`/surveys/${id}/responses`, n, {
          answers: [{ questionId: q[0].id, optionId: q[0].options[0].id }],
        }).expect(201);
      }
      const row = await a.prisma.sponsoredSurvey.findUniqueOrThrow({
        where: { id },
      });
      expect(row.snapshotAt).not.toBeNull();
      expect(
        await a.prisma.surveyResponse.count({ where: { surveyId: id } }),
      ).toBe(3);
      // round 3 (L-I): the answer that arrives after the target is reached is "closed", not "not found"
      const late = await post(`/surveys/${id}/responses`, "mod", {
        answers: [{ questionId: q[0].id, optionId: q[0].options[0].id }],
      }).expect(409);
      expect(late.body.error.message).toBe("This survey has closed.");
      await get(`/surveys/${id}`, "mod").expect(404);
      await post(`/surveys/${id}/events`, "mod", { kind: "VIEW" }).expect(404);
      expect(await report(id)).toMatchObject({
        stage: "REVIEW",
        ready: true,
        released: false,
      });
      await patch(`/admin/surveys/${id}`, "adman", { title: "new" }).expect(
        409,
      );
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(409);
    });

    it("a survey whose end date passed is fixed on the first read, and a late answer is refused", async () => {
      const id = await live();
      await store(id, [0, 0, 1]);
      await finish(id);
      const q = await questions(id);
      await post(`/surveys/${id}/responses`, "lagos", {
        answers: [{ questionId: q[0].id, optionId: q[0].options[0].id }],
      }).expect(409); // round 3 (L-I): closed, was 404
      await report(id); // fixes it
      const snap = await a.prisma.sponsoredSurvey.findUniqueOrThrow({
        where: { id },
      });
      expect(snap.snapshotAt).not.toBeNull();
      // a row slipped in behind the snapshot cannot change what is stored or released
      await store(id, [1, 1, 1, 1, 1]);
      await post(`/admin/surveys/${id}/release`, "adman").expect(200);
      const out = await report(id);
      expect(out.totals.responses).toBe(3);
      expect(out).toEqual(await report(id));
    });

    it("no hidden group follows from a total: 19, 20 and 21 answers, and 20 with 1", async () => {
      // the floor here is the shipped 20
      await a.prisma.configEntry.update({
        where: { key: "weekly.min_group_size" },
        data: { valueJson: 20 },
      });
      try {
        const run = async (picks: number[]) => {
          const id = await live();
          await store(id, picks);
          await finish(id);
          await post(`/admin/surveys/${id}/release`, "adman").expect(200);
          return report(id);
        };
        const r19 = await run(Array(19).fill(0));
        expect(r19).toMatchObject({ belowMinimum: true, questions: [] });
        expect(r19.totals.responses).toBeNull();
        const r20 = await run(Array(20).fill(0));
        // round 4 (L-A): a group under twice the floor is folded into Other, so 20 with nobody else is one Other line
        expect(r20.questions[0].options[0]).toMatchObject({
          count: null,
          hidden: true,
        });
        expect(r20.questions[0].other).toEqual({
          label: "Other",
          count: 20,
          share: 100,
        });
        const r21 = await run([...Array(20).fill(0), 1]);
        const q = r21.questions[0];
        expect(q.options.map((o: any) => o.count)).toEqual([null, null, null]);
        expect(q.options.every((o: any) => o.hidden)).toBe(true);
        expect(q.other).toEqual({ label: "Other", count: 21, share: 100 });
        const text = JSON.stringify(r21);
        expect(text).not.toMatch(/"count":(20|1)[,}]/);
        const r3 = await run([
          ...Array(30).fill(0),
          ...Array(5).fill(1),
          ...Array(4).fill(2),
        ]);
        expect(r3.questions[0].options.map((o: any) => o.count)).toEqual([
          null,
          null,
          null,
        ]);
        expect(r3.questions[0].other.count).toBe(39);
        // 20 shared Lagos and 1 shared Kano: the breakdown is one Other line, never Lagos 20
        const id = await live();
        await store(id, Array(21).fill(0), (i) => ({
          shareDemo: true,
          state: i < 20 ? "Lagos" : "Kano",
        }));
        await finish(id);
        await post(`/admin/surveys/${id}/release`, "adman").expect(200);
        const st = await report(id);
        expect(st.byState).toEqual([]);
        expect(st.byStateOther).toEqual({ responses: 21, share: 100 });
      } finally {
        await a.prisma.configEntry.update({
          where: { key: "weekly.min_group_size" },
          data: { valueJson: 3 },
        });
      }
    });

    it("staff read every free answer scrubbed, hide one, release once; the brand sees only what is left", async () => {
      const id = await live();
      const texts = [
        "my insta is kemi_ng",
        "email me chidi at gmail dot com",
        "t.me/chidi is me",
        "call zero eight zero three one two three four five six",
        "plain and useful",
      ];
      await store(id, [0, 0, 0, 1, 1], () => ({}), texts);
      await finish(id);
      const list = (
        await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200)
      ).body;
      expect(list.total).toBe(5);
      const words = JSON.stringify(list);
      // round 4 (ruling 3): the shared scrub does not remove a number spelt in words, so "zero eight" is no longer asserted
      expect(words).not.toMatch(/kemi_ng|chidi|gmail/);
      expect(words).toContain("plain and useful");
      const keep = list.items.find((x: any) => x.text === "plain and useful");
      const drop = list.items.find((x: any) => x.text.includes("[removed]"));
      await patch(`/admin/surveys/${id}/free-answers/${drop.id}`, "admin", {
        hidden: true,
      }).expect(200);
      await patch(
        `/admin/surveys/${id}/free-answers/${randomUUID()}`,
        "admin",
        { hidden: true },
      ).expect(404);
      await patch(`/admin/surveys/${id}/free-answers/${keep.id}`, "admin", {
        hidden: "yes",
      }).expect(422);
      expect(
        (await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200))
          .body.hiddenCount,
      ).toBe(1);
      const rel = (
        await post(`/admin/surveys/${id}/release`, "admin").expect(200)
      ).body;
      expect(rel).toMatchObject({ released: true, hiddenCount: 1 });
      const r = await report(id);
      // round 3: 5 answers, 1 hidden: the 1 left out would be a group under the floor (3), so the list is not shown
      expect(r.questions[1].texts).toHaveLength(0);
      expect(r.questions[1].answered).toBeNull();
      const audit = await a.prisma.auditLog.findMany({
        where: { targetType: "survey", targetId: id, action: "survey.release" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: a.people.admin.id,
        after: { hiddenCount: 1 },
      });
    });

    it("the new routes answer 401 to a guest, 403 to a person and a moderator", async () => {
      const id = await live();
      const aid = randomUUID();
      const routes: [string, string, object | undefined][] = [
        ["get", `/admin/surveys/${id}/free-answers`, undefined],
        ["patch", `/admin/surveys/${id}/free-answers/${aid}`, { hidden: true }],
        ["post", `/admin/surveys/${id}/release`, {}],
        ["get", `/admin/surveys/${id}/report`, undefined],
      ];
      for (const [m, path, data] of routes) {
        for (const [who, code] of [
          [null, 401],
          ["lagos", 403],
          ["mod", 403],
        ] as const) {
          let r = a.h.http()[m as "get"](`${api}${path}`);
          if (who) r = r.set(a.auth(who));
          const res = await (data ? r.send(data) : r);
          expect([m, path, who, res.status]).toEqual([m, path, who, code]);
        }
      }
    });

    it("every read of a report and of the free answers writes an audit row with who and which survey, never the words", async () => {
      const id = await live();
      await store(id, [0, 0, 0], () => ({}), ["secret words here", "b", "c"]);
      await finish(id);
      const before = await a.prisma.auditLog.count({ where: { targetId: id } });
      await report(id);
      await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200);
      const rows = await a.prisma.auditLog.findMany({
        where: {
          targetId: id,
          action: { in: ["survey.report.read", "survey.free.read"] },
        },
      });
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((x) => x.actorId === a.people.adman.id)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("secret");
      expect(
        await a.prisma.auditLog.count({ where: { targetId: id } }),
      ).toBeGreaterThan(before);
    });
  });

  // ---------------------------------------------------------------------------------------- M2: who completed

  describe("nothing stores who completed a survey", () => {
    it("the COMPLETE event has no user id, and the response and answers carry none", async () => {
      const id = await live();
      const q = await questions(id);
      await post(`/surveys/${id}/events`, "lagos", { kind: "VIEW" }).expect(
        204,
      );
      await post(`/surveys/${id}/responses`, "lagos", {
        answers: [{ questionId: q[0].id, optionId: q[0].options[0].id }],
      }).expect(201);
      const rows = await sql(
        `SELECT kind, "userId" FROM "SurveyEvent" WHERE "surveyId" = '${id}' ORDER BY kind`,
      );
      expect(rows.find((r: any) => r.kind === "COMPLETE")).toMatchObject({
        userId: null,
      });
      expect(rows.find((r: any) => r.kind === "VIEW")?.userId).toBe(
        a.people.lagos.id,
      );
    });

    it("one person cannot inflate the counts: one START, views up to the day's cap", async () => {
      const id = await live({ frequencyCapPerDay: 2 });
      for (let i = 0; i < 5; i++) {
        await post(`/surveys/${id}/events`, "plain", { kind: "START" }).expect(
          204,
        );
        await post(`/surveys/${id}/events`, "plain", { kind: "VIEW" }).expect(
          204,
        );
      }
      const n = async (k: string) =>
        (
          await sql(
            `SELECT count(*)::int AS c FROM "SurveyEvent" WHERE "surveyId" = '${id}' AND kind = '${k}'`,
          )
        )[0].c;
      expect(await n("START")).toBe(1);
      expect(await n("VIEW")).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------------------- M3, M4

  describe("brand pages", () => {
    it("an advert is on a brand page only when the ad manager tied it to that brand by id", async () => {
      const b = (
        await post("/admin/brands", "adman", { name: "Tied Brand" }).expect(201)
      ).body;
      const other = (
        await post("/admin/brands", "adman", { name: "Other Brand" }).expect(
          201,
        )
      ).body;
      const ad = (
        await post("/admin/ads", "adman", {
          brand: "Tied Brand",
          brandId: b.id,
          kind: "FEED_CARD",
          headline: "Tied ad",
        }).expect(201)
      ).body;
      expect(ad.brandId).toBe(b.id);
      const loose = (
        await post("/admin/ads", "adman", {
          brand: "Tied Brand",
          kind: "FEED_CARD",
          headline: "Same name, not tied",
        }).expect(201)
      ).body;
      expect(loose.brandId).toBeNull();
      await post("/admin/ads", "adman", {
        brand: "X",
        brandId: randomUUID(),
        kind: "FEED_CARD",
        headline: "Bad brand",
      }).expect(422);
      await a.prisma.ad.updateMany({
        where: { id: { in: [ad.id, loose.id] } },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      expect(
        (await get(`/brands/${b.slug}`, null).expect(200)).body.ads.map(
          (x: any) => x.id,
        ),
      ).toEqual([ad.id]);
      expect(
        (await get(`/brands/${other.slug}`, null).expect(200)).body.ads,
      ).toEqual([]);
      // the ad manager moves it, and a paused ad's brand edit goes back to the queue
      await post(`/admin/ads/${ad.id}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(200);
      const moved = (
        await patch(`/admin/ads/${ad.id}`, "adman", {
          brandId: other.id,
        }).expect(200)
      ).body;
      expect(moved).toMatchObject({
        brandId: other.id,
        status: "AWAITING_APPROVAL",
      });
      expect(
        (
          await patch(`/admin/ads/${ad.id}`, "adman", { brandId: null }).expect(
            200,
          )
        ).body.brandId,
      ).toBeNull();
    });

    it("a brand's link has no space, and a contact address is one plain address", async () => {
      await post("/admin/brands", "adman", {
        name: "Space Link",
        website: "https://ok.test/a b",
      }).expect(422);
      for (const bad of [
        '"a b"@b.test',
        "a@b.test, c@d.test",
        "<a@b.test>",
        "a b@c.test",
      ]) {
        await post("/admin/brands", "adman", {
          name: "Bad Mail",
          contactEmail: bad,
        }).expect(422);
        await post(
          "/admin/surveys",
          "adman",
          body({ contactEmail: bad }),
        ).expect(422);
      }
      await post(
        "/admin/surveys",
        "adman",
        body({ contactEmail: "ok.name+x@brand.test" }),
      ).expect(201);
    });

    it("a slug that cannot be a brand answers 404, never 500", async () => {
      for (const slug of [
        "%00",
        "..%2f%27",
        "a%00b",
        "x".repeat(61),
        "UPPER_CASE",
        "a b",
        "nobody-here",
      ])
        expect([slug, (await get(`/brands/${slug}`, null)).status]).toEqual([
          slug,
          404,
        ]);
    });
  });

  // ---------------------------------------------------------------------------------------- M6: consent for state

  describe("state targeting needs the person's consent", () => {
    it("the setting is off by default, can be turned on and off, and shows in the settings", async () => {
      const first = (await get("/me/settings", "lagos").expect(200)).body;
      expect(first.useMyStateForSurveys).toBe(false);
      const on = (
        await patch("/me/settings", "lagos", {
          useMyStateForSurveys: true,
        }).expect(200)
      ).body;
      expect(on.useMyStateForSurveys).toBe(true);
      expect(
        (await get("/me/settings", "lagos").expect(200)).body
          .useMyStateForSurveys,
      ).toBe(true);
      await patch("/me/settings", "lagos", {
        useMyStateForSurveys: "yes",
      }).expect(422);
      await patch("/me/settings", "lagos", {
        useMyStateForSurveys: false,
      }).expect(200);
    });

    it("a survey with states is shown only to a person who turned it on and whose state matches; one with no states is unaffected", async () => {
      await sql(`DELETE FROM "SponsoredSurvey"`);
      const targeted = await live({ states: ["Lagos"] });
      const open = await live();
      const seen = async (who: string) =>
        (await get("/surveys/placement", who).expect(200)).body.survey?.id ??
        null;
      // off: the targeted survey is not shown and cannot be opened or answered
      await get(`/surveys/${targeted}`, "lagos").expect(404);
      await get(`/surveys/${open}`, "lagos").expect(200);
      expect(await seen("lagos")).toBe(open);
      await patch("/me/settings", "lagos", {
        useMyStateForSurveys: true,
      }).expect(200);
      await get(`/surveys/${targeted}`, "lagos").expect(200);
      expect(await seen("lagos")).toBe(targeted);
      // the person without a state, switch on or off, never sees it
      await patch("/me/settings", "plain", {
        useMyStateForSurveys: true,
      }).expect(200);
      await get(`/surveys/${targeted}`, "plain").expect(404);
      await get(`/surveys/${open}`, "plain").expect(200);
      await patch("/me/settings", "lagos", {
        useMyStateForSurveys: false,
      }).expect(200);
      await get(`/surveys/${targeted}`, "lagos").expect(404);
    });
  });
});
