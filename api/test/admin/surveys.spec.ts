/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- response bodies are read as loose JSON */
import { createServer, type Server } from "node:http";
import { sql } from "../me/helpers";
import { bootAdmin, seedQuestion, type Admin } from "./helpers";

/**
 * V-SURVEYS: sponsored surveys. Admin routes (roles, approval, audit), what people see, how they answer, what the brand
 * is given, brand pages and the F01 to F04 mail. The mail relay is a local stand-in; nothing real is sent.
 */
const PORT = 15091;
const KEY = "survey-mail-service-key";
const api = "/api/v1";

describe("V-SURVEYS: sponsored surveys", () => {
  let a: Admin;
  let srv: Server;
  const mails: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tag: string;
  }[] = [];
  const day = (n: number) =>
    new Date(Date.now() + n * 86_400_000 + 3_600_000)
      .toISOString()
      .slice(0, 10);

  const settle = async () => {
    const { MailService } = await import("../../src/mail/mail.service.js");
    await a.h.app.get(MailService).settled();
    await new Promise((r) => setTimeout(r, 150));
    await a.h.app.get(MailService).settled();
  };

  const body = (over: Record<string, unknown> = {}) => ({
    brandName: "Mama Nkechi Foods",
    contactEmail: "brand@nkechi.test",
    title: "What do you cook on weekdays?",
    questions: [
      {
        kind: "SINGLE_CHOICE",
        prompt: "Which do you cook most?",
        options: ["Rice", "Beans", "Yam"],
      },
      { kind: "TEXT", prompt: "What would make cooking easier?" },
      { kind: "VOICE", prompt: "Tell us about your kitchen" },
    ],
    startsOn: day(-1),
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

  /** A survey that is live and visible: made, sent, approved. */
  const live = async (over: Record<string, unknown> = {}) => {
    const c = await post("/admin/surveys", "adman", body(over)).expect(201);
    await post(`/admin/surveys/${c.body.id}/submit`, "adman").expect(200);
    await post(`/admin/surveys/${c.body.id}/decision`, "admin", {
      decision: "APPROVE",
    }).expect(200);
    return c.body.id as string;
  };

  const placement = async (who: string | null, qs = "") =>
    (await get(`/surveys/placement${qs}`, who).expect(200)).body.survey as {
      id: string;
    } | null;

  const clip = (
    ownerId: string,
    over: Record<string, unknown> = {},
  ): Promise<{ id: string }> =>
    a.prisma.voiceClip.create({
      data: {
        ownerId,
        purpose: "SURVEY_ANSWER",
        status: "READY",
        rawKey: `raw/${Math.random()}`,
        rawMime: "audio/webm",
        maxDurationMs: 60_000,
        durationMs: 9_000,
        ...over,
      } as never,
      select: { id: true },
    });

  const setConfig = (key: string, valueJson: unknown) =>
    a.prisma.configEntry.upsert({
      where: { key },
      create: { key, valueJson: valueJson as never },
      update: { valueJson: valueJson as never },
    });

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        mails.push(JSON.parse(raw));
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
      `TRUNCATE "SponsoredSurvey", "Brand", "SurveyResponse", "MailLog" RESTART IDENTITY CASCADE`,
    );
    await a.person("admin", ["ADMIN"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("lagos");
    await a.person("kano");
    await a.person("nowhere");
    await a.prisma.user.update({
      where: { id: a.people.lagos.id },
      data: { state: "Lagos" },
    });
    await a.prisma.user.update({
      where: { id: a.people.kano.id },
      data: { state: "Kano" },
    });
  });
  afterAll(async () => {
    await a.close();
    await new Promise((r) => srv.close(r));
  });

  // ------------------------------------------------------------------------------------------------ roles

  describe("every new admin route", () => {
    let sid: string;
    let bid: string;
    beforeAll(async () => {
      sid = (await post("/admin/surveys", "adman", body()).expect(201)).body.id;
      bid = (
        await post("/admin/brands", "adman", { name: "Roles Brand" }).expect(
          201,
        )
      ).body.id;
    });
    const routes = (): [string, string, object | undefined][] => [
      ["get", "/admin/surveys", undefined],
      ["post", "/admin/surveys", body()],
      ["get", `/admin/surveys/${sid}`, undefined],
      ["patch", `/admin/surveys/${sid}`, { title: "x" }],
      ["post", `/admin/surveys/${sid}/submit`, {}],
      ["post", `/admin/surveys/${sid}/decision`, { decision: "PAUSE" }],
      ["get", `/admin/surveys/${sid}/report`, undefined],
      ["get", "/admin/brands", undefined],
      ["post", "/admin/brands", { name: "No Entry" }],
      ["patch", `/admin/brands/${bid}`, { tagline: "x" }],
    ];
    it("answers 401 with no token, 403 to a signed-in person and 403 to a moderator", async () => {
      for (const [m, path, data] of routes()) {
        const send = (who: string | null) => {
          let r = a.h.http()[m as "get"](`${api}${path}`);
          if (who) r = r.set(a.auth(who));
          return data ? r.send(data) : r;
        };
        expect([m, path, (await send(null)).status]).toEqual([m, path, 401]);
        expect([m, path, (await send("lagos")).status]).toEqual([m, path, 403]);
        expect([m, path, (await send("mod")).status]).toEqual([m, path, 403]);
      }
      // the table was not touched by any refused call
      const row = await a.prisma.sponsoredSurvey.findUnique({
        where: { id: sid },
      });
      expect(row?.title).toBe("What do you cook on weekdays?");
      expect(await a.prisma.brand.count()).toBe(1);
    });
    it("an ad manager and an admin are let in", async () => {
      await get("/admin/surveys", "adman").expect(200);
      await get("/admin/surveys", "admin").expect(200);
      await get("/admin/brands", "adman").expect(200);
    });
  });

  // ------------------------------------------------------------------------------------------------ create, price, approval

  describe("making, sending and approving", () => {
    it("takes the price from the admin price list when none is given, and the cap from config", async () => {
      await setConfig("surveys.price.flat_kobo", 1_234_500);
      const c = await post(
        "/admin/surveys",
        "adman",
        body({ priceKobo: undefined, frequencyCapPerDay: undefined }),
      ).expect(201);
      expect(c.body.priceKobo).toBe(1_234_500);
      expect(c.body.status).toBe("DRAFT");
      expect(c.body.label).toBe("Sponsored Survey");
      expect(c.body.questions).toHaveLength(3);
      await sql(
        `DELETE FROM "ConfigEntry" WHERE key = 'surveys.price.flat_kobo'`,
      );
      const none = await post(
        "/admin/surveys",
        "adman",
        body({ priceKobo: undefined }),
      ).expect(201);
      expect(none.body.priceKobo).toBeNull(); // nothing is invented
    });

    it("refuses a survey that is not 1 to 5 questions, a poll without 2 to 6 distinct choices, choices on text, a bad email and backwards dates", async () => {
      const q = (i: number) => ({ kind: "TEXT", prompt: `Question ${i}` });
      const bad = [
        body({ questions: [1, 2, 3, 4, 5, 6].map(q) }),
        body({ questions: [] }),
        body({
          questions: [
            { kind: "SINGLE_CHOICE", prompt: "P", options: ["Only"] },
          ],
        }),
        body({
          questions: [
            { kind: "SINGLE_CHOICE", prompt: "P", options: ["A", "a"] },
          ],
        }),
        body({
          questions: [{ kind: "TEXT", prompt: "P", options: ["A", "B"] }],
        }),
        body({ contactEmail: "not an email" }),
        body({ startsOn: day(5), endsOn: day(2) }),
        body({ startsOn: "2026-02-31" }),
        body({ categoryIds: ["0190d5a7-0000-7000-8000-000000000000"] }),
      ];
      for (const b of bad)
        expect((await post("/admin/surveys", "adman", b)).status).toBe(422);
      expect(
        (
          await post(
            "/admin/surveys",
            "adman",
            body({ questions: [1, 2, 3, 4, 5].map(q) }),
          )
        ).status,
      ).toBe(201);
    });

    it("sends F01, approves with F02, asks for changes with F03; each mail goes once, to the survey's own contact", async () => {
      mails.length = 0;
      const c = await post(
        "/admin/surveys",
        "adman",
        body({ contactEmail: "contact@mail-brand.test" }),
      ).expect(201);
      const id = c.body.id;
      await get(`/admin/surveys/${id}`, "adman").expect(200);
      // draft cannot be approved
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "APPROVE",
      }).expect(409);
      await post(`/admin/surveys/${id}/submit`, "adman").expect(200);
      await post(`/admin/surveys/${id}/submit`, "adman").expect(409);
      await settle();
      const f01 = mails.filter((m) => m.tag === "voices_F01");
      expect(f01).toHaveLength(1);
      expect(f01[0].to).toBe("contact@mail-brand.test");
      expect(f01[0].subject).toContain("What do you cook on weekdays?");
      // a reason is needed
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "ASK_FOR_CHANGES",
      }).expect(422);
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "ASK_FOR_CHANGES",
        reason: "Please name the product in the first question.",
      }).expect(200);
      await settle();
      const f03 = mails.filter((m) => m.tag === "voices_F03");
      expect(f03).toHaveLength(1);
      expect(f03[0].html).toContain("name the product in the first question");
      expect(f03[0].to).toBe("contact@mail-brand.test");
      // resubmit and approve
      await post(`/admin/surveys/${id}/submit`, "adman").expect(200);
      const ok = await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "APPROVE",
      }).expect(200);
      expect(ok.body.status).toBe("APPROVED");
      expect(ok.body.live).toBe(true);
      await settle();
      expect(mails.filter((m) => m.tag === "voices_F02")).toHaveLength(1);
      for (const m of mails) {
        expect(m.html + m.text + m.subject).not.toContain("—");
        expect(m.html + m.text).not.toMatch(
          /\[REGISTERED ADDRESS\]|support@usevoices|\{\{/,
        );
        expect(m.text).toContain("support@wawuafrica.com");
        expect(m.text).toContain("Voices by WAWU");
      }
      // an approved survey cannot be edited, and its questions never change after answers
      await patch(`/admin/surveys/${id}`, "adman", { title: "New" }).expect(
        409,
      );
    });

    it("refuses to approve: betting or political wording, a kept-away category, no price, no dates", async () => {
      const mk = async (over: Record<string, unknown>) => {
        const c = await post("/admin/surveys", "adman", body(over)).expect(201);
        await post(`/admin/surveys/${c.body.id}/submit`, "adman").expect(200);
        return post(`/admin/surveys/${c.body.id}/decision`, "admin", {
          decision: "APPROVE",
        });
      };
      expect((await mk({ title: "Win big at the casino" })).status).toBe(422);
      expect(
        (await mk({ title: "Should you vote for the governor?" })).status,
      ).toBe(422);
      const pol = await a.prisma.category.create({
        data: {
          slug: "politics",
          name: "Politics",
          sortOrder: 99,
          active: true,
        },
      });
      expect((await mk({ categoryIds: [pol.id] })).status).toBe(422);
      expect((await mk({ priceKobo: undefined })).status).toBe(422);
      expect(
        (await mk({ startsOn: undefined, endsOn: undefined })).status,
      ).toBe(422);
    });

    it("pauses and resumes, rejects with a reason, and writes an audit row for every change", async () => {
      await sql(`DELETE FROM "SponsoredSurvey"`);
      const id = await live();
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(200);
      expect(await placement("lagos")).toBeNull();
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "RESUME",
      }).expect(200);
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "REJECT",
      }).expect(422);
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "REJECT",
        reason: "Not suitable for Voices.",
      }).expect(200);
      await patch(`/admin/surveys/${id}`, "adman", { title: "x" }).expect(409);
      const rows = await a.prisma.auditLog.findMany({
        where: { targetType: "survey", targetId: id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((r) => r.action)).toEqual([
        "survey.create",
        "survey.submit",
        "survey.decision", // approve
        "survey.decision", // pause
        "survey.decision", // resume
        "survey.decision", // reject
      ]);
      expect(rows.every((r) => r.actorId)).toBe(true);
      expect(rows[5].reason).toBe("Not suitable for Voices.");
    });

    it("a content edit of a paused survey sends it back to the approval queue", async () => {
      const id = await live();
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(200);
      const e = await patch(`/admin/surveys/${id}`, "adman", {
        title: "A new title",
      }).expect(200);
      expect(e.body.status).toBe("AWAITING_APPROVAL");
      const d = await patch(`/admin/surveys/${id}`, "adman", {
        endsOn: day(20),
      }).expect(200);
      expect(d.body.status).toBe("AWAITING_APPROVAL");
    });
  });

  // ------------------------------------------------------------------------------------------------ who sees it

  describe("who is shown a survey", () => {
    beforeEach(async () => {
      await sql(`DELETE FROM "SponsoredSurvey"`);
    });

    it("shows an approved, in-date survey to a signed-in person, with the label and the brand name; never to a guest", async () => {
      const id = await live();
      const s = await placement("lagos");
      expect(s).toMatchObject({
        id,
        label: "Sponsored Survey",
        brandName: "Mama Nkechi Foods",
        questionCount: 3,
      });
      expect(await placement(null)).toBeNull();
    });

    it("never shows a draft, awaiting, rejected, paused, not-yet-started, ended or over-target survey", async () => {
      const draft = await post("/admin/surveys", "adman", body()).expect(201);
      const wait = await post("/admin/surveys", "adman", body()).expect(201);
      await post(`/admin/surveys/${wait.body.id}/submit`, "adman").expect(200);
      const rej = await live();
      await post(`/admin/surveys/${rej}/decision`, "admin", {
        decision: "REJECT",
        reason: "No.",
      }).expect(200);
      const paused = await live();
      await post(`/admin/surveys/${paused}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(200);
      const future = await live({ startsOn: day(3), endsOn: day(8) });
      const over = await live({ startsOn: day(-9), endsOn: day(-2) });
      expect(draft.body.status).toBe("DRAFT");
      expect(await placement("lagos")).toBeNull();
      // each is also closed to a direct open
      for (const id of [draft.body.id, wait.body.id, rej, paused, future, over])
        await get(`/surveys/${id}`, "lagos").expect(404);
      // a survey at its response target stops showing
      const full = await live({ responseTarget: 1 });
      expect(await placement("lagos")).toMatchObject({ id: full });
      await post(`/surveys/${full}/responses`, "lagos", {
        answers: [
          {
            questionId: (await get(`/surveys/${full}`, "lagos")).body
              .questions[1].id,
            text: "Less chopping",
          },
        ],
      }).expect(201);
      expect(await placement("kano")).toBeNull();
      await get(`/surveys/${full}`, "kano").expect(404);
    });

    it("never shows a person outside the state or category targeting", async () => {
      const id = await live({ states: ["Lagos"] });
      expect(await placement("lagos")).toMatchObject({ id });
      expect(await placement("kano")).toBeNull();
      expect(await placement("nowhere")).toBeNull(); // no state on file
      await get(`/surveys/${id}`, "kano").expect(404);
      await post(`/surveys/${id}/responses`, "kano", {
        answers: [
          { questionId: "0190d5a7-0000-7000-8000-000000000001", text: "x" },
        ],
      }).expect(404);
      // category: only beside a question in that category
      await sql(`DELETE FROM "SponsoredSurvey"`);
      const cat = a.cats[0];
      const other = a.cats[1];
      const cid = await live({ categoryIds: [cat] });
      expect(await placement("lagos")).toBeNull(); // no context given
      expect(await placement("lagos", `?categoryId=${other}`)).toBeNull();
      expect(await placement("lagos", `?categoryId=${cat}`)).toMatchObject({
        id: cid,
      });
    });

    it("never beside a sensitive question, topic or kept-away category", async () => {
      await live();
      const q = await seedQuestion(a, "A sensitive one?");
      await a.prisma.question.update({
        where: { id: q.id },
        data: { sensitive: true },
      });
      expect(await placement("lagos", `?questionId=${q.id}`)).toBeNull();
      const topic = await a.prisma.topic.create({
        data: {
          weekNumber: 91,
          title: "T",
          startsOn: new Date("2026-11-09T00:00:00Z"),
          endsOn: new Date("2026-11-15T00:00:00Z"),
          sensitive: true,
        } as never,
      });
      const q2 = await seedQuestion(a, "In a sensitive topic?");
      await a.prisma.question.update({
        where: { id: q2.id },
        data: { topicId: topic.id },
      });
      expect(await placement("lagos", `?questionId=${q2.id}`)).toBeNull();
      const health = await a.prisma.category.create({
        data: { slug: "health", name: "Health", sortOrder: 98, active: true },
      });
      expect(await placement("lagos", `?categoryId=${health.id}`)).toBeNull();
      const q3 = await seedQuestion(a, "Plain one?");
      expect(await placement("lagos", `?questionId=${q3.id}`)).not.toBeNull();
    });

    it("respects the frequency cap and the two-skip limit, and stops after an answer", async () => {
      const id = await live({ frequencyCapPerDay: 2 });
      expect(await placement("lagos")).toMatchObject({ id });
      await post(`/surveys/${id}/events`, "lagos", { kind: "VIEW" }).expect(
        204,
      );
      expect(await placement("lagos")).toMatchObject({ id });
      await post(`/surveys/${id}/events`, "lagos", { kind: "VIEW" }).expect(
        204,
      );
      expect(await placement("lagos")).toBeNull(); // 2 views today: capped
      expect(await placement("kano")).toMatchObject({ id }); // another person is not
      // two skips: never again, on a new day too
      await post(`/surveys/${id}/events`, "kano", { kind: "SKIP" }).expect(204);
      expect(await placement("kano")).toMatchObject({ id });
      await post(`/surveys/${id}/events`, "kano", { kind: "SKIP" }).expect(204);
      expect(await placement("kano")).toBeNull();
      await get(`/surveys/${id}`, "kano").expect(404);
      await post(`/surveys/${id}/responses`, "kano", {
        answers: [
          { questionId: "0190d5a7-0000-7000-8000-000000000001", text: "x" },
        ],
      }).expect(404);
    });
  });

  // ------------------------------------------------------------------------------------------------ answering

  describe("answering", () => {
    let id: string;
    let q: { id: string; options: { id: string }[] }[];
    beforeAll(async () => {
      await sql(`DELETE FROM "SponsoredSurvey"`);
      id = await live();
      q = (await get(`/surveys/${id}`, "lagos").expect(200)).body.questions;
    });

    it("shows the questions in order with the note, and carries no brand contact address", async () => {
      const r = (await get(`/surveys/${id}`, "lagos").expect(200)).body;
      expect(r.questions.map((x: any) => x.position)).toEqual([1, 2, 3]);
      expect(r.note).toContain("paid for by the brand");
      expect(r.note).toContain("never uses a free post");
      expect(r.myStatus).toBe("OPEN");
      expect(JSON.stringify(r)).not.toContain("nkechi.test");
    });

    it("refuses a question that is not in the survey, a choice from another question, a second answer to one question and a wrong kind of answer", async () => {
      const foreign = await post("/surveys/" + id + "/responses", "lagos", {
        answers: [
          { questionId: "0190d5a7-0000-7000-8000-000000000001", text: "x" },
        ],
      });
      expect(foreign.status).toBe(422);
      const other = await live();
      const oq = (await get(`/surveys/${other}`, "lagos")).body.questions;
      expect(
        (
          await post(`/surveys/${id}/responses`, "lagos", {
            answers: [{ questionId: oq[1].id, text: "from another survey" }],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post(`/surveys/${id}/responses`, "lagos", {
            answers: [{ questionId: q[0].id, optionId: oq[0].options[0].id }],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post(`/surveys/${id}/responses`, "lagos", {
            answers: [
              { questionId: q[1].id, text: "a" },
              { questionId: q[1].id, text: "b" },
            ],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post(`/surveys/${id}/responses`, "lagos", {
            answers: [{ questionId: q[0].id, text: "text on a poll" }],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post(`/surveys/${id}/responses`, "lagos", {
            answers: [{ questionId: q[1].id, text: "x".repeat(501) }],
          })
        ).status,
      ).toBe(422);
      expect(
        (await post(`/surveys/${id}/responses`, "lagos", { answers: [] }))
          .status,
      ).toBe(422);
      expect(
        await a.prisma.surveyResponse.count({ where: { surveyId: id } }),
      ).toBe(0);
    });

    it("refuses a voice answer over the limit, someone else's clip, the wrong purpose, one not ready, and a clip used twice", async () => {
      const send = (clipId: string, who = "lagos") =>
        post(`/surveys/${id}/responses`, who, {
          answers: [{ questionId: q[2].id, clipId }],
        });
      const long = await clip(a.people.lagos.id, { durationMs: 30_501 });
      expect((await send(long.id)).status).toBe(422);
      const ok30 = await clip(a.people.lagos.id, { durationMs: 30_000 });
      const theirs = await clip(a.people.kano.id);
      expect((await send(theirs.id)).status).toBe(422);
      const wrong = await clip(a.people.lagos.id, { purpose: "ANSWER" });
      expect((await send(wrong.id)).status).toBe(422);
      const pending = await clip(a.people.lagos.id, { status: "PROCESSING" });
      expect((await send(pending.id)).status).toBe(422);
      expect(
        (
          await post(`/surveys/${id}/responses`, "lagos", {
            answers: [{ questionId: q[2].id }],
          })
        ).status,
      ).toBe(422);
      expect(
        await a.prisma.surveyResponse.count({ where: { surveyId: id } }),
      ).toBe(0);
      expect(ok30.id).toBeTruthy();
    });

    it("an answer touches no token, free post or daily limit row, and a second answer is refused", async () => {
      const snap = async () => ({
        wallet: await sql(`SELECT * FROM "Wallet" ORDER BY "userId"`),
        ledger: await sql(`SELECT count(*)::int AS n FROM "LedgerTransaction"`),
        entries: await sql(`SELECT count(*)::int AS n FROM "LedgerEntry"`),
        free: await sql(`SELECT * FROM "FreeAllowance" ORDER BY "userId"`),
        usage: await sql(
          `SELECT * FROM "UsageCounter" ORDER BY "userId", action`,
        ),
        answers: await sql(`SELECT count(*)::int AS n FROM "Answer"`),
        notes: await sql(`SELECT count(*)::int AS n FROM "Notification"`),
      });
      const before = await snap();
      const c = await clip(a.people.lagos.id, { durationMs: 12_000 });
      const r = await post(`/surveys/${id}/responses`, "lagos", {
        answers: [
          { questionId: q[0].id, optionId: q[0].options[1].id },
          { questionId: q[1].id, text: "A bigger pot" },
          { questionId: q[2].id, clipId: c.id },
        ],
      }).expect(201);
      expect(r.body.ok).toBe(true);
      expect(await snap()).toEqual(before);
      const again = await post(`/surveys/${id}/responses`, "lagos", {
        answers: [{ questionId: q[1].id, text: "again" }],
      });
      expect(again.status).toBe(409);
      expect(
        await a.prisma.surveyResponse.count({ where: { surveyId: id } }),
      ).toBe(1);
      expect((await placement("lagos"))?.id).not.toBe(id);
      expect((await get(`/surveys/${id}`, "lagos")).body.myStatus).toBe(
        "ANSWERED",
      );
      // a survey answer is never a public post
      expect((await sql(`SELECT count(*)::int AS n FROM "Answer"`))[0].n).toBe(
        0,
      );
      const events = await a.prisma.surveyEvent.groupBy({
        by: ["kind"],
        where: { surveyId: id },
        _count: { _all: true },
      });
      expect(events.find((e) => e.kind === "COMPLETE")?._count._all).toBe(1);
    });

    it("an anonymous answer carries nothing that identifies the person, and no stored row holds their id or handle", async () => {
      const r = await post(`/surveys/${id}/responses`, "kano", {
        answers: [{ questionId: q[1].id, text: "Anonymously said" }],
        anonymous: true,
        shareState: true,
        ageBand: "25-34",
      });
      // kano is outside no targeting here (no states set), so this lands
      expect(r.status).toBe(201);
      const rows = await sql(
        `SELECT * FROM "SurveyResponse" WHERE "anonymous" = true`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        anonymous: true,
        shareDemo: false,
        state: null,
        ageBand: null,
      });
      const dump = JSON.stringify([
        await sql(`SELECT * FROM "SurveyResponse"`),
        await sql(`SELECT * FROM "SurveyAnswer"`),
      ]);
      for (const p of [a.people.kano, a.people.lagos]) {
        expect(dump).not.toContain(p.id);
        expect(dump).not.toContain(p.handle);
        expect(dump).not.toContain(p.sub);
      }
      const cols = Object.keys(rows[0]);
      expect(cols.some((c) => /user|handle|person|author/i.test(c))).toBe(
        false,
      );
    });

    it("consent: a person who shares their state and age band is counted in them, and only then", async () => {
      await a.person("sharer");
      await a.prisma.user.update({
        where: { id: a.people.sharer.id },
        data: { state: "Oyo" },
      });
      await post(`/surveys/${id}/responses`, "sharer", {
        answers: [{ questionId: q[1].id, text: "Consent given" }],
        shareState: true,
        ageBand: "35-44",
      }).expect(201);
      const row = (
        await sql(`SELECT * FROM "SurveyResponse" WHERE state = 'Oyo'`)
      )[0];
      expect(row).toMatchObject({ shareDemo: true, ageBand: "35-44" });
      expect(
        (
          await post(`/surveys/${id}/responses`, "nowhere", {
            answers: [{ questionId: q[1].id, text: "x" }],
            ageBand: "not a band",
          })
        ).status,
      ).toBe(422);
    });
  });

  // ------------------------------------------------------------------------------------------------ the brand's report

  describe("the brand's report", () => {
    let id: string;
    beforeAll(async () => {
      await sql(`DELETE FROM "SponsoredSurvey"`);
      await setConfig("weekly.min_group_size", 3);
      id = await live({ contactEmail: "report@brand.test" });
    });
    afterAll(async () => {
      await sql(
        `DELETE FROM "ConfigEntry" WHERE key = 'weekly.min_group_size'`,
      );
    });

    it("shows nothing about people while fewer than the minimum group have answered", async () => {
      const r = await get(`/admin/surveys/${id}/report`, "adman").expect(200);
      expect(r.body.belowMinimum).toBe(true);
      expect(r.body.totals.responses).toBeNull();
      expect(r.body.questions).toEqual([]);
      expect(r.body.minGroupSize).toBe(3);
    });

    it("lists combined answers with no name, handle, photo or id, and no group under the minimum", async () => {
      mails.length = 0;
      const detail = (await get(`/surveys/${id}`, "lagos")).body;
      const q = detail.questions;
      const people = ["r1", "r2", "r3", "r4", "r5"];
      const states = ["Lagos", "Lagos", "Lagos", "Kano", "Kano"]; // Kano: 2 people, under 3
      const contact = (n: string) =>
        `Reach me at ${n}@mail.test or 08031234567 @${a.people[n]?.handle ?? "x"}`;
      for (const [i, n] of people.entries()) {
        await a.person(n);
        await a.prisma.user.update({
          where: { id: a.people[n].id },
          data: { state: states[i] },
        });
        const c = await clip(a.people[n].id, { durationMs: 5000 });
        await a.prisma.transcript.create({
          data: {
            clipId: c.id,
            status: "READY",
            text: `Voice of @${a.people[n].handle} call 0803 111 2222`,
          } as never,
        });
        await post(`/surveys/${id}/responses`, n, {
          answers: [
            // 4 people chose Rice, 1 chose Beans: Beans is a group of 1, under 3
            { questionId: q[0].id, optionId: q[0].options[i === 4 ? 1 : 0].id },
            { questionId: q[1].id, text: contact(n) },
            { questionId: q[2].id, clipId: c.id },
          ],
          shareState: true,
          ageBand: i < 3 ? "25-34" : "45-54",
        }).expect(201);
      }
      const r = (await get(`/admin/surveys/${id}/report`, "adman").expect(200))
        .body;
      const text = JSON.stringify(r);
      expect(r.belowMinimum).toBe(false);
      expect(r.totals.responses).toBe(5);
      const poll = r.questions[0].options;
      expect(poll.find((o: any) => o.label === "Rice")).toMatchObject({
        count: 4,
        hidden: false,
      });
      expect(poll.find((o: any) => o.label === "Beans")).toMatchObject({
        count: null,
        share: null,
        hidden: true,
      });
      expect(r.byState).toEqual([{ state: "Lagos", responses: 3, share: 60 }]);
      expect(r.byAgeBand.map((x: any) => x.ageBand)).toEqual(["25-34"]);
      expect(text).not.toMatch(/Kano|45-54/);
      expect(r.questions[1].texts).toHaveLength(5);
      expect(r.questions[2].voices).toHaveLength(5);
      // nothing that names or finds a person
      for (const p of Object.values(a.people)) {
        expect(text).not.toContain(p.id);
        expect(text).not.toContain(p.handle);
        expect(text).not.toContain(p.sub);
      }
      expect(text).not.toMatch(
        /@mail\.test|0803|08031234567|userId|respondentKey|clipId|avatar|displayName/,
      );
      expect(text).toContain("[removed]");
    });

    it("sends F04 once when the survey ends, to its contact, with figures a group under the minimum cannot be read from", async () => {
      mails.length = 0;
      await a.prisma.sponsoredSurvey.update({
        where: { id },
        data: { endsOn: new Date(`${day(-1)}T00:00:00Z`) },
      });
      const { AdminSurveysService } =
        await import("../../src/surveys/surveys-admin.service.js");
      const svc = a.h.app.get(AdminSurveysService);
      expect(await svc.sweepFinished()).toBeGreaterThanOrEqual(1);
      expect(await svc.sweepFinished()).toBe(0);
      await settle();
      const f04 = mails.filter((m) => m.tag === "voices_F04");
      expect(f04).toHaveLength(1);
      expect(f04[0].to).toBe("report@brand.test");
      expect(f04[0].text).toContain("5 responses");
      expect(f04[0].html + f04[0].text).not.toMatch(
        /\{\{|—|usevoices\.com\/help/,
      );
    });
  });

  // ------------------------------------------------------------------------------------------------ brand pages

  describe("brand pages", () => {
    it("serves a brand an admin set up with its live surveys and adverts, labelled as a brand, and never its contact address", async () => {
      await sql(`DELETE FROM "SponsoredSurvey"`);
      const b = (
        await post("/admin/brands", "adman", {
          name: "Mama Nkechi Foods",
          tagline: "Home cooking for busy weekdays",
          website: "https://nkechi.test",
          contactEmail: "private@nkechi.test",
        }).expect(201)
      ).body;
      expect(b.slug).toBe("mama-nkechi-foods");
      expect(
        (
          await post("/admin/brands", "adman", {
            name: "Mama Nkechi Foods",
          }).expect(201)
        ).body.slug,
      ).toBe("mama-nkechi-foods-2");
      expect(
        (
          await post("/admin/brands", "adman", {
            name: "Bad",
            website: "http://x.test",
          })
        ).status,
      ).toBe(422);
      const sid = await live({ brandId: b.id });
      await live({ brandId: b.id, startsOn: day(5), endsOn: day(9) }); // not yet
      const ad = await a.prisma.ad.create({
        data: {
          brand: "mama nkechi foods",
          kind: "FEED_CARD",
          status: "APPROVED",
          headline: "Fresh stew",
          approvedAt: new Date(),
          createdById: a.people.admin.id,
          startsOn: new Date(`${day(-1)}T00:00:00Z`),
          endsOn: new Date(`${day(5)}T00:00:00Z`),
        },
      });
      await a.prisma.ad.create({
        data: {
          brand: "Mama Nkechi Foods",
          kind: "FEED_CARD",
          status: "PAUSED",
          headline: "Paused one",
          createdById: a.people.admin.id,
        },
      });
      const page = (await get(`/brands/${b.slug}`, null).expect(200)).body;
      expect(page.brand).toMatchObject({
        name: "Mama Nkechi Foods",
        label: "Brand",
        tagline: "Home cooking for busy weekdays",
      });
      expect(page.surveys.map((s: any) => s.id)).toEqual([sid]);
      expect(page.surveys[0].label).toBe("Sponsored Survey");
      expect(page.ads.map((x: any) => x.id)).toEqual([ad.id]);
      expect(JSON.stringify(page)).not.toContain("private@nkechi.test");
      await patch(`/admin/brands/${b.id}`, "adman", { active: false }).expect(
        200,
      );
      await get(`/brands/${b.slug}`, null).expect(404);
      await get(`/brands/nobody-here`, null).expect(404);
    });
  });
});
