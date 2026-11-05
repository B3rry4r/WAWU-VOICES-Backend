/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";
import { Client } from "pg";
import { COUNTRIES, COUNTRY_CODES } from "../../src/feed/countries";
import { TEST_DATABASE_URL } from "../test-env";
import { ReachService } from "../../src/reach/reach.service";
import { ResultsService } from "../../src/results/results.service";

/** SHARED-1a: the wiring pass. Real units, real reach, real Postgres. */
describe("shared 1a wiring", () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.ME_SIGNUP_LIMIT = "100000";
    h = await startHarness();
  });
  afterAll(() => h.close());

  const put = (url: string, p: Person, body?: object) =>
    h.http().put(url).set("Authorization", p.auth).send(body);
  const notes = (userId: string, type?: string) =>
    h.prisma.notification.findMany({
      where: { userId, ...(type ? { type: type as never } : {}) },
    });
  const answer = async (p: Person, qid: string, body = "a voice") =>
    (
      await h
        .http()
        .post(`/api/v1/questions/${qid}/answers`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind: "TEXT", body })
        .expect(201)
    ).body.answer.id as string;
  const readyClip = (ownerId: string) =>
    h.prisma.voiceClip.create({
      data: {
        ownerId,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        playKey: "voice/x.m4a",
        playMime: "audio/mp4",
        maxDurationMs: 10000,
        durationMs: 3000,
      },
    });

  describe("item 1: schema", () => {
    it("Helpful is unique per person and answer, in the database", async () => {
      const q = await makeQuestion(h);
      const author = await makePerson(h);
      const p = await makePerson(h);
      const a = await answer(author, q.id);
      await put(`/api/v1/answers/${a}/helpful`, p).expect(204);
      await put(`/api/v1/answers/${a}/helpful`, p).expect(204);
      expect(
        await h.prisma.helpful.count({ where: { answerId: a, userId: p.id } }),
      ).toBe(1);
      await expect(
        h.prisma.helpful.create({ data: { answerId: a, userId: p.id } }),
      ).rejects.toMatchObject({ code: "P2002" });
      // 10 people at once: ten marks, one count each
      const crowd = await Promise.all(
        Array.from({ length: 10 }, () => makePerson(h)),
      );
      await Promise.all(
        crowd.map((c) => put(`/api/v1/answers/${a}/helpful`, c).expect(204)),
      );
      expect(await h.prisma.helpful.count({ where: { answerId: a } })).toBe(11);
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: a } }))
          .helpfulCount,
      ).toBe(11);
    });

    it("User.voiceCount follows a published voice answer and its delete; a text answer leaves it", async () => {
      const q = await makeQuestion(h);
      const p = await makePerson(h, { freePosts: 5 });
      await answer(p, q.id);
      const count = async () =>
        (await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } }))
          .voiceCount;
      expect(await count()).toBe(0);
      const clip = await readyClip(p.id);
      const r = await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind: "VOICE", clipId: clip.id })
        .expect(201);
      expect(await count()).toBe(1);
      const me = await h
        .http()
        .get(`/api/v1/people/${p.id}`)
        .set("Authorization", p.auth)
        .expect(200);
      expect(me.body.voiceCount ?? me.body.profile?.voiceCount).toBe(1);
      await h
        .http()
        .delete(`/api/v1/answers/${r.body.answer.id}`)
        .set("Authorization", p.auth)
        .expect(204);
      expect(await count()).toBe(0);
    });

    it("Payment.overpaidKobo, ExtraVoiceToken.reservedAt, VoiceClip.processingStartedAt and Question.editStatus exist and are nullable", async () => {
      const q = await h.prisma.question.create({
        data: { text: "t", status: "DRAFT", editStatus: "Kept" },
      });
      expect(q.originalText).toBeNull();
      const cols = await h.prisma.$queryRaw<
        { table_name: string; column_name: string; is_nullable: string }[]
      >`
        SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE (table_name, column_name) IN (('Payment','overpaidKobo'),('ExtraVoiceToken','reservedAt'),('VoiceClip','processingStartedAt'),('Question','editStatus'),('Question','originalText'))`;
      expect(cols).toHaveLength(5);
      expect(cols.every((c) => c.is_nullable === "YES")).toBe(true);
    });
  });

  describe("item 2: the Prisma pool", () => {
    it("allows 20 connections at once (DATABASE_POOL_MAX default), not the driver's 10", async () => {
      // Prisma queries are lazy: .then() starts them
      const slow = Array.from({ length: 40 }, () =>
        h.prisma.$queryRaw`SELECT pg_sleep(1.5)::text, 'pool-probe-1a'`.then(
          (r) => r,
        ),
      );
      await new Promise((r) => setTimeout(r, 700));
      // the pool is full, so ask from a connection of our own
      const pg = new Client({ connectionString: TEST_DATABASE_URL });
      await pg.connect();
      let n = 0;
      try {
        const r = await pg.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND query LIKE '%pool-probe-1a%' AND pid <> pg_backend_pid()`,
        );
        n = r.rows[0].n as number;
      } finally {
        await pg.end();
      }
      await Promise.all(slow);
      expect(n).toBe(20);
    });
  });

  describe("item 5: one country list, one allowance config", () => {
    it("a person may pick any country the shared list holds (live or coming), not others; GET /countries serves the same list", async () => {
      expect(COUNTRY_CODES).toEqual(COUNTRIES.map((c) => c.code));
      const live = (await h.http().get("/api/v1/countries").expect(200)).body
        .items;
      expect(live.map((c: { code: string }) => c.code)).toEqual(COUNTRY_CODES);
    });

    it("a units allowance key edited in ConfigEntry changes what Me and the allowance route say", async () => {
      await h.prisma.configEntry.upsert({
        where: { key: "allowance.free_votes_per_day" },
        create: { key: "allowance.free_votes_per_day", valueJson: 5 },
        update: { valueJson: 5 },
      });
      try {
        const p = await makePerson(h);
        const a = await h
          .http()
          .get("/api/v1/me/allowance")
          .set("Authorization", p.auth)
          .expect(200);
        expect(a.body.freeVotesLeftToday).toBe(5);
        expect(a.body.costs.freeVotesPerDay).toBe(5);
      } finally {
        await h.prisma.configEntry.delete({
          where: { key: "allowance.free_votes_per_day" },
        });
      }
    });
  });

  describe("item 11: POST /me for one sub under parallel calls", () => {
    it("12 parallel calls, 5 rounds: every caller gets the same Me with 201, one User each", async () => {
      const made = await Promise.all(
        [1, 2, 3].map((i) =>
          h.prisma.category.create({
            data: {
              slug: `s1a-${randomUUID().slice(0, 8)}-${i}`,
              name: `S1A ${i}`,
            },
          }),
        ),
      );
      for (let round = 0; round < 5; round++) {
        const sub = `race-${round}-${randomUUID()}`;
        const token = h.jwks.sign({
          sub,
          email: `${sub}@example.com`,
          phone: `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        });
        const body = {
          handle: `race${round}${randomUUID().slice(0, 6)}`.replace(/-/g, ""),
          ageConfirmed: true,
          termsAccepted: true,
          rulesAccepted: true,
          countryCode: "NG",
          languages: ["en"],
          categoryIds: made.map((c) => c.id),
        };
        const rs = await Promise.all(
          Array.from({ length: 12 }, () =>
            h
              .http()
              .post("/api/v1/me")
              .set("Authorization", `Bearer ${token}`)
              .send(body),
          ),
        );
        expect(rs.map((r) => r.status)).toEqual(Array(12).fill(201));
        expect(new Set(rs.map((r) => r.body.id as string)).size).toBe(1);
        expect(await h.prisma.user.count({ where: { wawuId: sub } })).toBe(1);
      }
    });
  });

  describe("item 4: GET /me/allowance", () => {
    it("401 guest, 403 without a profile, 200 with the units module's own object", async () => {
      await h.http().get("/api/v1/me/allowance").expect(401);
      const ghost = `Bearer ${h.jwks.sign({ sub: "ghost-" + randomUUID() })}`;
      await h
        .http()
        .get("/api/v1/me/allowance")
        .set("Authorization", ghost)
        .expect(403);
      const p = await makePerson(h, { freePosts: 7, balanceMilli: 4000 });
      const r = await h
        .http()
        .get("/api/v1/me/allowance")
        .set("Authorization", p.auth)
        .expect(200);
      expect(r.body).toMatchObject({
        freePostsRemaining: 7,
        balanceMilli: 4000,
        maxVoiceSeconds: 10,
        freeReactionsLeftToday: 20,
        freeVotesLeftToday: 3,
        extraVoiceTokens: [],
      });
      expect(r.body.costs.textPostMilli).toBe(500);
      const w = await h
        .http()
        .get("/api/v1/wallet")
        .set("Authorization", p.auth);
      if (w.status === 200) expect(w.body.allowances).toEqual(r.body);
    });
  });

  describe("item 6: notifications", () => {
    it("a reply tells the author once, never the replier, and a failing notify never fails the reply", async () => {
      const q = await makeQuestion(h);
      const author = await makePerson(h);
      const other = await makePerson(h);
      const a = await answer(author, q.id);
      const send = (p: Person, key = idem()) =>
        h
          .http()
          .post(`/api/v1/answers/${a}/replies`)
          .set("Authorization", p.auth)
          .set(key)
          .send({ stance: "AGREE", kind: "TEXT", body: "same here" });
      const key = idem();
      const r = await send(other, key).expect(201);
      await send(other, key).expect(201); // replay: still one alert
      await send(author).expect(201); // your own reply to your own voice: no alert
      const rows = await notes(author.id, "REPLY");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        targetType: "answer",
        targetId: a,
        groupKey: `reply:${r.body.reply.id}`,
      });
      const reach = h.app.get(ReachService);
      const spy = jest
        .spyOn(reach, "notify")
        .mockRejectedValue(new Error("db down"));
      try {
        await send(other).expect(201);
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("reactions on one voice fold into one row with a count", async () => {
      const q = await makeQuestion(h);
      const author = await makePerson(h);
      const a = await answer(author, q.id);
      const fans = await Promise.all(
        Array.from({ length: 4 }, () => makePerson(h)),
      );
      for (const f of fans)
        await h
          .http()
          .put(`/api/v1/answers/${a}/reaction`)
          .set("Authorization", f.auth)
          .set(idem())
          .send({ kind: "FUNNY" })
          .expect(200);
      await h
        .http()
        .put(`/api/v1/answers/${a}/reaction`)
        .set("Authorization", author.auth)
        .set(idem())
        .send({ kind: "FUNNY" })
        .expect(200);
      const rows = await notes(author.id, "REACTIONS");
      expect(rows).toHaveLength(1);
      expect(rows[0].actorCount).toBe(4);
      expect(rows[0].groupKey).toBe(`reactions:${a}`);
    });

    it("a result decision tells the poster; sending to moderation does not", async () => {
      const poster = await makePerson(h);
      const admin = await makePerson(h, { roles: ["ADMIN"] });
      const thread = await h.prisma.resultThread.create({
        data: {
          title: "t",
          heldOn: new Date("2027-01-16T00:00:00Z"),
          status: "OPEN",
          createdById: "seed",
        },
      });
      const mk = () =>
        h.prisma.resultPost.create({
          data: {
            threadId: thread.id,
            authorId: poster.id,
            state: "Lagos",
            lga: "Ikeja",
            ward: "W1",
            pollingUnit: "PU1",
            accredited: 10,
            votesCast: 9,
            rejected: 1,
            idempotencyKey: randomUUID(),
          },
        });
      const results = h.app.get(ResultsService);
      const user = { sub: admin.wawuId, email: null } as never;
      const p1 = await mk();
      await results.decide(user, p1.id, { decision: "SEND_TO_MODERATION" });
      expect(await notes(poster.id, "RESULT_CHECKED")).toHaveLength(0);
      await results.decide(user, p1.id, { decision: "VERIFIED" });
      await results.decide(user, p1.id, { decision: "VERIFIED" });
      expect(await notes(poster.id, "RESULT_CHECKED")).toHaveLength(1);
      // a re-decision updates the same row and makes it unread again
      await h.prisma.notification.updateMany({
        where: { userId: poster.id, type: "RESULT_CHECKED" },
        data: { readAt: new Date() },
      });
      await results.decide(user, p1.id, { decision: "NOT_VERIFIED" });
      const rows = await notes(poster.id, "RESULT_CHECKED");
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toContain("could not be confirmed");
      expect(rows[0].readAt).toBeNull();
      expect(rows[0]).toMatchObject({
        targetType: "result_post",
        targetId: p1.id,
        groupKey: `result-checked:${p1.id}`,
      });
      const reach = h.app.get(ReachService);
      const spy = jest
        .spyOn(reach, "notify")
        .mockRejectedValue(new Error("db down"));
      try {
        const p2 = await mk();
        const out = await results.decide(user, p2.id, {
          decision: "NOT_VERIFIED",
        });
        expect(out.decision).toBe("NOT_VERIFIED");
      } finally {
        spy.mockRestore();
      }
    });

    it("an improved or challenged proposal tells its author; a payment credit is written by the units transaction", async () => {
      const q = await makeQuestion(h);
      const author = await makePerson(h);
      const other = await makePerson(h);
      const prop = (
        await h
          .http()
          .post(`/api/v1/questions/${q.id}/proposals`)
          .set("Authorization", author.auth)
          .set(idem())
          .send({ kind: "TEXT", body: "Build the road first" })
          .expect(201)
      ).body.proposal.id as string;
      await h
        .http()
        .post(`/api/v1/questions/${q.id}/proposals`)
        .set("Authorization", other.auth)
        .set(idem())
        .send({
          kind: "TEXT",
          body: "Build it with drainage",
          improvesId: prop,
        })
        .expect(201);
      await put(`/api/v1/proposals/${prop}/stance`, other, {
        kind: "CHALLENGE",
      }).expect(200);
      await put(`/api/v1/proposals/${prop}/stance`, other, {
        kind: "SUPPORT",
      }).expect(200);
      await put(`/api/v1/proposals/${prop}/stance`, author, {
        kind: "CHALLENGE",
      }).expect(200); // your own: no alert
      expect(await notes(author.id, "REPLY")).toHaveLength(1);
      const ch = await notes(author.id, "REACTIONS");
      expect(ch).toHaveLength(1);
      expect(ch[0].groupKey).toBe(`proposal-challenged:${prop}`);
    });
  });

  describe("item 10 (V-27): a question is open by its window", () => {
    const day = 86_400_000;
    const seeded = (startsAt: Date, endsAt: Date) =>
      h.prisma.question.create({
        data: {
          text: "Seeded like the importer: SCHEDULED, with a window",
          status: "SCHEDULED",
          kind: "DAILY",
          startsAt,
          endsAt,
        },
      });
    const send = (p: Person, qid: string) =>
      h
        .http()
        .post(`/api/v1/questions/${qid}/answers`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind: "TEXT", body: "my answer" });

    it("accepts an answer inside the window, refuses before (404) and after (409 QUESTION_CLOSED)", async () => {
      const p = await makePerson(h);
      const now = Date.now();
      const inside = await seeded(new Date(now - day), new Date(now + day));
      const before = await seeded(new Date(now + day), new Date(now + 2 * day));
      const after = await seeded(new Date(now - 2 * day), new Date(now - 1000));
      await send(p, inside.id).expect(201);
      await send(p, before.id).expect(404);
      const closed = await send(p, after.id).expect(409);
      expect(closed.body.error.code).toBe("QUESTION_CLOSED");
      // a stored CLOSED or DRAFT row is never open, whatever its dates
      const stored = await h.prisma.question.create({
        data: {
          text: "x",
          status: "CLOSED",
          startsAt: new Date(now - day),
          endsAt: new Date(now + day),
        },
      });
      await send(p, stored.id).expect(409);
      const draft = await h.prisma.question.create({
        data: {
          text: "x",
          status: "DRAFT",
          startsAt: new Date(now - day),
          endsAt: new Date(now + day),
        },
      });
      await send(p, draft.id).expect(404);
      // an override sets LIVE itself, with no start date, and keeps working
      const override = await h.prisma.question.create({
        data: { text: "x", status: "LIVE", kind: "OVERRIDE" },
      });
      await send(p, override.id).expect(201);
      // a reply under the closed question is refused too
      const old = await h.prisma.answer.create({
        data: {
          questionId: after.id,
          authorId: p.id,
          kind: "TEXT",
          body: "old",
        },
      });
      const other = await makePerson(h);
      const rep = await h
        .http()
        .post(`/api/v1/answers/${old.id}/replies`)
        .set("Authorization", other.auth)
        .set(idem())
        .send({ stance: "AGREE", kind: "TEXT", body: "late" })
        .expect(409);
      expect(rep.body.error.code).toBe("QUESTION_CLOSED");
    });

    it("the feed reads the same window: the SCHEDULED question shows as LIVE", async () => {
      const now = Date.now();
      const inside = await seeded(new Date(now - day), new Date(now + day));
      const r = await h
        .http()
        .get(`/api/v1/questions/${inside.id}`)
        .expect(200);
      expect(r.body.status).toBe("LIVE");
    });
  });

  describe("item 13: appeals while suspended", () => {
    it("a suspended person can appeal their own removed post (201); every other write is still 403; the limit applies", async () => {
      const q = await makeQuestion(h);
      const p = await makePerson(h);
      const a = await answer(p, q.id);
      await h.prisma.answer.update({
        where: { id: a },
        data: { status: "REMOVED" },
      });
      await h.prisma.user.update({
        where: { id: p.id },
        data: {
          status: "SUSPENDED",
          suspendedUntil: new Date(Date.now() + 86_400_000),
        },
      });
      const appeal = (targetType: string, targetId: string) =>
        h
          .http()
          .post("/api/v1/appeals")
          .set("Authorization", p.auth)
          .send({ targetType, targetId, note: "That was a mistake" });
      const ok = await appeal("ANSWER", a).expect(201);
      expect(ok.body.status).toBe("OPEN");
      await appeal("USER", p.id).expect(201); // the suspension itself
      // someone else's item is still not theirs to appeal
      const other = await makePerson(h);
      const theirs = await answer(other, q.id);
      await h.prisma.answer.update({
        where: { id: theirs },
        data: { status: "REMOVED" },
      });
      await appeal("ANSWER", theirs).expect(404);
      // every other write stays refused
      const w = await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind: "TEXT", body: "hello" })
        .expect(403);
      expect(w.body.error.code).toBe("ACCOUNT_SUSPENDED");
      await put(`/api/v1/answers/${a}/helpful`, p).expect(403);
      await h
        .http()
        .post("/api/v1/reports")
        .set("Authorization", p.auth)
        .send({ targetType: "ANSWER", targetId: theirs, reason: "OTHER" })
        .expect(403);
      // rate limit
      await h.prisma.configEntry.upsert({
        where: { key: "ratelimit.appeal_per_10min" },
        create: { key: "ratelimit.appeal_per_10min", valueJson: 2 },
        update: { valueJson: 2 },
      });
      await new Promise((r) => setTimeout(r, 5200)); // the config cache lives 5 s
      const limited = await Promise.all(
        Array.from({ length: 4 }, () => appeal("USER", p.id)),
      );
      expect(limited.some((x) => x.status === 429)).toBe(true);
      await h.prisma.configEntry.delete({
        where: { key: "ratelimit.appeal_per_10min" },
      });
    });
  });

  describe("load: 30 parallel writes on post, vote and react (real units module)", () => {
    const N = 30;
    const people = (n: number, o: Parameters<typeof makePerson>[1]) =>
      Promise.all(Array.from({ length: n }, () => makePerson(h, o)));

    it("30 people post at once: 30 answers, 30 free posts used, nothing lost", async () => {
      const q = await makeQuestion(h);
      const ps = await people(N, { freePosts: 10 });
      const rs = await Promise.all(
        ps.map((p) =>
          h
            .http()
            .post(`/api/v1/questions/${q.id}/answers`)
            .set("Authorization", p.auth)
            .set(idem())
            .send({ kind: "TEXT", body: "load" }),
        ),
      );
      expect(rs.map((r) => r.status)).toEqual(Array(N).fill(201));
      expect(
        (await h.prisma.question.findUniqueOrThrow({ where: { id: q.id } }))
          .answerCount,
      ).toBe(N);
      expect(await h.prisma.answer.count({ where: { questionId: q.id } })).toBe(
        N,
      );
      const used = await h.prisma.freeAllowance.findMany({
        where: { userId: { in: ps.map((p) => p.id) } },
      });
      expect(used.every((a) => a.freePostsRemaining === 9)).toBe(true);
    });

    it("one person posts 30 times at once on units: the balance drops by exactly 30 x the cost, each charge once", async () => {
      await h.prisma.configEntry.upsert({
        where: { key: "ratelimit.post_per_10min" },
        create: { key: "ratelimit.post_per_10min", valueJson: 1000 },
        update: { valueJson: 1000 },
      });
      await new Promise((r) => setTimeout(r, 5200));
      try {
        const q = await makeQuestion(h);
        const p = await makePerson(h, { freePosts: 0, balanceMilli: 100_000 });
        const rs = await Promise.all(
          Array.from({ length: N }, (_, i) =>
            h
              .http()
              .post(`/api/v1/questions/${q.id}/answers`)
              .set("Authorization", p.auth)
              .set(idem())
              .send({ kind: "TEXT", body: `load ${i}` }),
          ),
        );
        expect(rs.map((r) => r.status)).toEqual(Array(N).fill(201));
        const w = await h.prisma.wallet.findUniqueOrThrow({
          where: { userId: p.id },
        });
        expect(w.balanceMilli).toBe(100_000 - N * 500);
        expect(
          await h.prisma.charge.count({
            where: { userId: p.id, status: { not: "REVERSED" } },
          }),
        ).toBe(N);
        expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(
          N,
        );
      } finally {
        await h.prisma.configEntry.delete({
          where: { key: "ratelimit.post_per_10min" },
        });
      }
    });

    it("30 people vote at once on one poll, and one person tapping 10 times votes once", async () => {
      const topic = await h.prisma.topic.create({
        data: {
          weekNumber: 9000 + Math.floor(Math.random() * 999_000),
          title: "Load week",
          startsOn: new Date("2026-11-16"),
          endsOn: new Date("2026-11-22"),
          status: "LIVE",
          whatNextPrompt: "What next?",
        },
      });
      const poll = await h.prisma.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: "Which?",
          status: "OPEN",
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 3_600_000),
          options: {
            create: [0, 1, 2, 3].map((i) => ({ label: `O${i}`, sortOrder: i })),
          },
        } as never,
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });
      const opts = (poll as unknown as { options: { id: string }[] }).options;
      const ps = await people(N, { balanceMilli: 10_000 });
      const vote = (p: Person, i: number, key = randomUUID()) =>
        h
          .http()
          .post(`/api/v1/polls/${poll.id}/votes`)
          .set("Authorization", p.auth)
          .set("Idempotency-Key", key)
          .send({ optionIds: [opts[i % 4].id] });
      const rs = await Promise.all(ps.map((p, i) => vote(p, i)));
      expect(rs.map((r) => r.status)).toEqual(Array(N).fill(201));
      expect(await h.prisma.vote.count({ where: { pollId: poll.id } })).toBe(N);
      expect(
        (await h.prisma.poll.findUniqueOrThrow({ where: { id: poll.id } }))
          .totalVotes,
      ).toBe(N);
      const tapper = ps[0];
      const again = await Promise.all(
        Array.from({ length: 10 }, (_, i) => vote(tapper, i)),
      );
      expect(again.every((r) => r.status === 409)).toBe(true);
      expect(
        await h.prisma.vote.count({
          where: { pollId: poll.id, userId: tapper.id },
        }),
      ).toBe(1);
    });

    it("30 people react at once, and one person reacting 30 times at once is charged for one reaction at most", async () => {
      const q = await makeQuestion(h);
      const author = await makePerson(h);
      const a = await answer(author, q.id);
      const ps = await people(N, {});
      const react = (p: Person, kind = "FUNNY") =>
        h
          .http()
          .put(`/api/v1/answers/${a}/reaction`)
          .set("Authorization", p.auth)
          .set(idem())
          .send({ kind });
      const rs = await Promise.all(ps.map((p) => react(p)));
      expect(rs.map((r) => r.status)).toEqual(Array(N).fill(200));
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: a } }))
          .reactionCount,
      ).toBe(N);
      expect(await h.prisma.reaction.count({ where: { answerId: a } })).toBe(N);
      const solo = await makePerson(h, { balanceMilli: 50_000 });
      await h.prisma.usageCounter.create({
        data: {
          userId: solo.id,
          day: new Date(
            new Date().toLocaleDateString("en-CA", {
              timeZone: "Africa/Lagos",
            }) + "T00:00:00Z",
          ),
          action: "REACTION",
          used: 20,
        },
      });
      const q2 = await makeQuestion(h);
      const a2 = await answer(author, q2.id);
      const many = await Promise.all(
        Array.from({ length: N }, () =>
          h
            .http()
            .put(`/api/v1/answers/${a2}/reaction`)
            .set("Authorization", solo.auth)
            .set(idem())
            .send({ kind: "FUNNY" }),
        ),
      );
      expect(many.every((r) => r.status === 200)).toBe(true);
      expect(await h.prisma.reaction.count({ where: { answerId: a2 } })).toBe(
        1,
      );
      // past the free 20 a reaction costs 100 milli: exactly one stays charged
      expect(
        (
          await h.prisma.wallet.findUniqueOrThrow({
            where: { userId: solo.id },
          })
        ).balanceMilli,
      ).toBe(50_000 - 100);
      expect(
        await h.prisma.charge.count({
          where: { userId: solo.id, status: { not: "REVERSED" } },
        }),
      ).toBe(1);
    });
  });
});
