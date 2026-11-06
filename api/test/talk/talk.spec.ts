/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  guestAuth,
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

describe("talk", () => {
  let h: Harness;
  let q: { id: string };
  let me: Person;
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    me = await makePerson(h);
  });
  afterAll(() => h.close());

  const post = (
    url: string,
    p: Person | null,
    body: object,
    key: Record<string, string> = idem(),
  ) => {
    const r = h.http().post(url).set(key).send(body);
    return p ? r.set("Authorization", p.auth) : r;
  };
  const answers = (p: Person, body: object, qid = q.id, key = idem()) =>
    post(`/api/v1/questions/${qid}/answers`, p, body, key);
  const balance = async (p: Person) =>
    (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
      ?.balanceMilli ?? 0;

  describe("answers", () => {
    it("401 guest, 400 without Idempotency-Key, 403 without a profile", async () => {
      await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set(idem())
        .send({ kind: "TEXT", body: "x" })
        .expect(401);
      const r = await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", me.auth)
        .send({ kind: "TEXT", body: "x" })
        .expect(400);
      expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      const ghost = `Bearer ${h.jwks.sign({ sub: "ghost-" + randomUUID() })}`;
      const g = await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", ghost)
        .set(idem())
        .send({ kind: "TEXT", body: "x" })
        .expect(403);
      expect(g.body.error.details.reason).toBe("PROFILE_REQUIRED");
    });

    it("a text answer uses a free post, bumps the counters, and returns the receipt read back from the database", async () => {
      const p = await makePerson(h);
      const r = await answers(p, {
        kind: "TEXT",
        body: "  Salary goes in two hours.  ",
      }).expect(201);
      expect(r.body.answer).toMatchObject({
        kind: "TEXT",
        body: "Salary goes in two hours.",
        status: "PUBLISHED",
        isMine: true,
        iLiked: false,
        myReaction: null,
        news: null,
      });
      expect(r.body.answer.author.id).toBe(p.id);
      expect(r.body.charge).toMatchObject({
        costMilli: 0,
        usedFreePost: true,
        usedFreeDaily: false,
      });
      expect(r.body.allowances.freePostsRemaining).toBe(9);
      expect(r.body.allowances.costs.textPostMilli).toBe(500);
      const row = await h.prisma.answer.findUniqueOrThrow({
        where: { id: r.body.answer.id },
      });
      expect(row.authorId).toBe(p.id);
      expect(
        (
          await h.prisma.freeAllowance.findUniqueOrThrow({
            where: { userId: p.id },
          })
        ).freePostsRemaining,
      ).toBe(9);
      const charges = await h.prisma.charge.findMany({
        where: { userId: p.id },
      });
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({
        action: "POST_TEXT",
        usedFreePost: true,
        costMilli: 0,
      });
    });

    it("question counters follow the posts", async () => {
      const q2 = await makeQuestion(h);
      const p = await makePerson(h);
      await answers(p, { kind: "TEXT", body: "one" }, q2.id).expect(201);
      await answers(p, { kind: "TEXT", body: "two" }, q2.id).expect(201);
      expect(
        (await h.prisma.question.findUniqueOrThrow({ where: { id: q2.id } }))
          .answerCount,
      ).toBe(2);
    });

    it("same Idempotency-Key replays the first answer, charges once, creates one row; another body is 409", async () => {
      const p = await makePerson(h);
      const key = idem();
      const a = await answers(
        p,
        { kind: "TEXT", body: "twice" },
        q.id,
        key,
      ).expect(201);
      const b = await answers(
        p,
        { kind: "TEXT", body: "twice" },
        q.id,
        key,
      ).expect(201);
      expect(b.headers["idempotent-replay"]).toBe("true");
      expect(b.body.answer.id).toBe(a.body.answer.id);
      expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(
        1,
      );
      expect(await h.prisma.charge.count({ where: { userId: p.id } })).toBe(1);
      const c = await answers(
        p,
        { kind: "TEXT", body: "different" },
        q.id,
        key,
      ).expect(409);
      expect(c.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("double tap in parallel: one answer, one charge", async () => {
      const p = await makePerson(h);
      const key = idem();
      const rs = await Promise.all(
        [1, 2, 3].map(() =>
          answers(p, { kind: "TEXT", body: "tap" }, q.id, key),
        ),
      );
      expect(rs.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(
        1,
      );
      expect(rs.every((r) => [201, 409].includes(r.status))).toBe(true);
      expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(
        1,
      );
      expect(await h.prisma.charge.count({ where: { userId: p.id } })).toBe(1);
    });

    it("after the free posts: 402 with cost, nothing saved, then the same key works once units arrive", async () => {
      const p = await makePerson(h, { freePosts: 0 });
      const key = idem();
      const r = await answers(
        p,
        { kind: "TEXT", body: "need units" },
        q.id,
        key,
      ).expect(402);
      expect(r.body.error.code).toBe("FREE_POSTS_EXHAUSTED");
      expect(r.body.error.details).toMatchObject({
        costMilli: 500,
        balanceMilli: 0,
        minPackKobo: 13800,
      });
      expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(
        0,
      );
      await h.prisma.wallet.upsert({
        where: { userId: p.id },
        create: { userId: p.id, balanceMilli: 2000 },
        update: { balanceMilli: 2000 },
      });
      const ok = await answers(
        p,
        { kind: "TEXT", body: "need units" },
        q.id,
        key,
      ).expect(201);
      expect(ok.body.charge).toMatchObject({
        costMilli: 500,
        usedFreePost: false,
        balanceMilli: 1500,
      });
      expect(await balance(p)).toBe(1500);
    });

    it("a failed write reverses the charge (the clip is on another post)", async () => {
      // an answer whose voice clip is already used loses the race on the unique clipId: the spend comes back
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 5000 });
      const clip = await h.prisma.voiceClip.create({
        data: {
          ownerId: p.id,
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
      await h.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: p.id,
          kind: "VOICE",
          clipId: clip.id,
        },
      });
      const r = await answers(p, { kind: "VOICE", clipId: clip.id }).expect(
        409,
      );
      expect(r.body.error.code).toBe("CONFLICT");
      expect(await balance(p)).toBe(5000);
      const c = await h.prisma.charge.findFirstOrThrow({
        where: { userId: p.id },
      });
      expect(c.status).toBe("REVERSED");
    });

    it("validation: empty, too long, voice with text, text with a clip, bad kind, unknown field", async () => {
      const p = await makePerson(h);
      for (const body of [
        { kind: "TEXT", body: "   " },
        { kind: "TEXT", body: "x".repeat(501) },
        { kind: "TEXT" },
        { kind: "VOICE", body: "hi" },
        { kind: "VOICE" },
        { kind: "TEXT", body: "a", clipId: randomUUID() },
        { kind: "SHOUT", body: "a" },
        { kind: "TEXT", body: "a", extra: 1 },
        { kind: "TEXT", body: "a", newsTag: "GOSSIP" },
      ])
        expect((await answers(p, body).expect(422)).body.error.code).toBe(
          "VALIDATION_FAILED",
        );
      expect(await h.prisma.charge.count({ where: { userId: p.id } })).toBe(0);
    });

    it("voice answer with a missing clip is 404 CLIP_NOT_FOUND", async () => {
      const p = await makePerson(h);
      expect(
        (await answers(p, { kind: "VOICE", clipId: randomUUID() }).expect(404))
          .body.error.code,
      ).toBe("CLIP_NOT_FOUND");
    });

    it("question states: closed 409 QUESTION_CLOSED, draft or unknown 404", async () => {
      const p = await makePerson(h);
      const closed = await makeQuestion(h, "CLOSED");
      expect(
        (
          await answers(p, { kind: "TEXT", body: "late" }, closed.id).expect(
            409,
          )
        ).body.error.code,
      ).toBe("QUESTION_CLOSED");
      const draft = await makeQuestion(h, "DRAFT");
      await answers(p, { kind: "TEXT", body: "x" }, draft.id).expect(404);
      await answers(p, { kind: "TEXT", body: "x" }, randomUUID()).expect(404);
    });

    it("news: TAG_REQUIRED, VERIFIED_NEWS_FORBIDDEN for a user, SOURCE_REQUIRED for an editor, and the label is stored", async () => {
      const p = await makePerson(h);
      expect(
        (
          await answers(p, { kind: "TEXT", body: "n", isNews: true }).expect(
            422,
          )
        ).body.error.code,
      ).toBe("TAG_REQUIRED");
      expect(
        (
          await answers(p, {
            kind: "TEXT",
            body: "n",
            isNews: true,
            newsTag: "VERIFIED_NEWS",
            newsSourceName: "BBC",
          }).expect(403)
        ).body.error.code,
      ).toBe("VERIFIED_NEWS_FORBIDDEN");
      const ed = await makePerson(h, { roles: ["EDITOR"] });
      expect(
        (
          await answers(ed, {
            kind: "TEXT",
            body: "n",
            isNews: true,
            newsTag: "VERIFIED_NEWS",
          }).expect(422)
        ).body.error.code,
      ).toBe("SOURCE_REQUIRED");
      const ok = await answers(ed, {
        kind: "TEXT",
        body: "n",
        isNews: true,
        newsTag: "VERIFIED_NEWS",
        newsSourceName: "BBC",
        newsSourceUrl: "https://bbc.com/x",
      }).expect(201);
      expect(ok.body.answer.news).toMatchObject({
        tag: "VERIFIED_NEWS",
        sourceName: "BBC",
      });
      const g = await answers(p, {
        kind: "TEXT",
        body: "heard it",
        isNews: true,
        newsTag: "GOSSIP",
      }).expect(201);
      expect(g.body.answer.news.tag).toBe("GOSSIP");
      expect(
        (
          await h.prisma.answer.findUniqueOrThrow({
            where: { id: g.body.answer.id },
          })
        ).newsTag,
      ).toBe("GOSSIP");
    });

    it("anonymous answers carry author null; the author still sees isMine", async () => {
      const p = await makePerson(h);
      const r = await answers(p, {
        kind: "TEXT",
        body: "shh",
        anonymous: true,
      }).expect(201);
      expect(r.body.answer.author).toBeNull();
      expect(r.body.answer.isMine).toBe(true);
      const guest = await h
        .http()
        .get(`/api/v1/answers/${r.body.answer.id}`)
        .expect(200);
      expect(guest.body.author).toBeNull();
      expect(guest.body.isMine).toBe(false);
    });

    it("rate limit: 20 posts per 10 minutes per account, 429 with Retry-After", async () => {
      await h.prisma.configEntry.upsert({
        where: { key: "ratelimit.post_per_10min" },
        create: { key: "ratelimit.post_per_10min", valueJson: 3 },
        update: { valueJson: 3 },
      });
      h.app
        .get(
          (await import("../../src/talk/shared/config-reader.js")).ConfigReader,
        )
        .invalidate();
      try {
        const p = await makePerson(h);
        for (let i = 0; i < 3; i++)
          await answers(p, { kind: "TEXT", body: "r" + i }).expect(201);
        const r = await answers(p, { kind: "TEXT", body: "r4" }).expect(429);
        expect(r.body.error.code).toBe("RATE_LIMITED");
        expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
        expect(r.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
        await answers(await makePerson(h), {
          kind: "TEXT",
          body: "other",
        }).expect(201);
      } finally {
        await h.prisma.configEntry.delete({
          where: { key: "ratelimit.post_per_10min" },
        });
        h.app
          .get(
            (await import("../../src/talk/shared/config-reader.js"))
              .ConfigReader,
          )
          .invalidate();
      }
    });

    it("GET: guest sees it, a stranger does not see a held one, 404 unknown or bad id; the author's own held one is visible", async () => {
      const p = await makePerson(h);
      const a = (
        await answers(p, { kind: "TEXT", body: "visible" }).expect(201)
      ).body.answer;
      expect(
        (await h.http().get(`/api/v1/answers/${a.id}`).expect(200)).body.body,
      ).toBe("visible");
      await h.prisma.answer.update({
        where: { id: a.id },
        data: { status: "HELD" },
      });
      await h.http().get(`/api/v1/answers/${a.id}`).expect(404);
      await h
        .http()
        .get(`/api/v1/answers/${a.id}`)
        .set("Authorization", me.auth)
        .expect(404);
      expect(
        (
          await h
            .http()
            .get(`/api/v1/answers/${a.id}`)
            .set("Authorization", p.auth)
            .expect(200)
        ).body.status,
      ).toBe("HELD");
      await h.http().get(`/api/v1/answers/${randomUUID()}`).expect(404);
      await h.http().get(`/api/v1/answers/nope`).expect(404);
    });

    it("edit: inside 5 minutes by the author only; EDIT_WINDOW_PASSED after; voice cannot be edited", async () => {
      const p = await makePerson(h);
      const a = (await answers(p, { kind: "TEXT", body: "first" }).expect(201))
        .body.answer;
      const e = await h
        .http()
        .patch(`/api/v1/answers/${a.id}`)
        .set("Authorization", p.auth)
        .send({ body: "second" })
        .expect(200);
      expect(e.body.body).toBe("second");
      expect(e.body.editedAt).not.toBeNull();
      await h
        .http()
        .patch(`/api/v1/answers/${a.id}`)
        .set("Authorization", me.auth)
        .send({ body: "hijack" })
        .expect(403);
      await h
        .http()
        .patch(`/api/v1/answers/${a.id}`)
        .set("Authorization", p.auth)
        .send({ body: "" })
        .expect(422);
      await h
        .http()
        .patch(`/api/v1/answers/${a.id}`)
        .send({ body: "x" })
        .expect(401);
      await h.prisma.answer.update({
        where: { id: a.id },
        data: { createdAt: new Date(Date.now() - 6 * 60_000) },
      });
      expect(
        (
          await h
            .http()
            .patch(`/api/v1/answers/${a.id}`)
            .set("Authorization", p.auth)
            .send({ body: "late" })
            .expect(409)
        ).body.error.code,
      ).toBe("EDIT_WINDOW_PASSED");
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } })).body,
      ).toBe("second");
    });

    it("delete: author only, hides it, the free post is not given back, counters drop, second delete is 204", async () => {
      const q3 = await makeQuestion(h);
      const p = await makePerson(h);
      const a = (
        await answers(p, { kind: "TEXT", body: "gone" }, q3.id).expect(201)
      ).body.answer;
      await h
        .http()
        .delete(`/api/v1/answers/${a.id}`)
        .set("Authorization", me.auth)
        .expect(403);
      await h.http().delete(`/api/v1/answers/${a.id}`).expect(401);
      await h
        .http()
        .delete(`/api/v1/answers/${a.id}`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/answers/${a.id}`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .get(`/api/v1/answers/${a.id}`)
        .set("Authorization", p.auth)
        .expect(404);
      expect(
        (await h.prisma.question.findUniqueOrThrow({ where: { id: q3.id } }))
          .answerCount,
      ).toBe(0);
      expect(
        (
          await h.prisma.freeAllowance.findUniqueOrThrow({
            where: { userId: p.id },
          })
        ).freePostsRemaining,
      ).toBe(9);
      await h
        .http()
        .delete(`/api/v1/answers/${randomUUID()}`)
        .set("Authorization", p.auth)
        .expect(404);
    });

    it("listen counts a play for a visitor who sends an id; a finish needs the clip's time to have passed (LS8); bad body is 422", async () => {
      const p = await makePerson(h);
      const clip = await h.prisma.voiceClip.create({
        data: {
          ownerId: p.id,
          purpose: "ANSWER",
          status: "READY",
          rawKey: "raw/y",
          rawMime: "audio/webm",
          playKey: "voice/y.m4a",
          maxDurationMs: 10000,
        },
      });
      const a = await h.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: p.id,
          kind: "VOICE",
          clipId: clip.id,
        },
      });
      const visitor = randomUUID();
      await h
        .http()
        .post(`/api/v1/answers/${a.id}/listen`)
        .set(guestAuth())
        .set("X-Visitor-Id", visitor)
        .send({ completed: false })
        .expect(204);
      // lead ruling LS, 6 Nov (LS8): a report with no visitor id records nothing, and "completed" straight after the
      // start is not a finish (the clip has not had the time to play)
      await h
        .http()
        .post(`/api/v1/answers/${a.id}/listen`)
        .send({ completed: true, positionMs: 3000 })
        .expect(204);
      await h
        .http()
        .post(`/api/v1/answers/${a.id}/listen`)
        .set("X-Visitor-Id", visitor)
        .send({ completed: true, positionMs: 3000 })
        .expect(204);
      const row = await h.prisma.answer.findUniqueOrThrow({
        where: { id: a.id },
      });
      expect([row.listenCount, row.listenThroughCount]).toEqual([2, 0]);
      await h
        .http()
        .post(`/api/v1/answers/${a.id}/listen`)
        .send({ completed: "yes" })
        .expect(422);
    });

    it("save and unsave an answer and a question: idempotent, counted once on the profile", async () => {
      const p = await makePerson(h);
      const a = (
        await answers(await makePerson(h), {
          kind: "TEXT",
          body: "keep",
        }).expect(201)
      ).body.answer;
      await h.http().put(`/api/v1/answers/${a.id}/save`).expect(401);
      await h
        .http()
        .put(`/api/v1/answers/${a.id}/save`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .put(`/api/v1/answers/${a.id}/save`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .put(`/api/v1/questions/${q.id}/save`)
        .set("Authorization", p.auth)
        .expect(204);
      expect(
        (await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } }))
          .savedCount,
      ).toBe(2);
      expect(
        (
          await h
            .http()
            .get(`/api/v1/answers/${a.id}`)
            .set("Authorization", p.auth)
            .expect(200)
        ).body.iSaved,
      ).toBe(true);
      await h
        .http()
        .put(`/api/v1/answers/${randomUUID()}/save`)
        .set("Authorization", p.auth)
        .expect(404);
      await h
        .http()
        .delete(`/api/v1/answers/${a.id}/save`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/answers/${a.id}/save`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/questions/${q.id}/save`)
        .set("Authorization", p.auth)
        .expect(204);
      expect(
        (await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } }))
          .savedCount,
      ).toBe(0);
    });

    it("helpful: one mark per person, not on your own answer, counted in the database", async () => {
      const author = await makePerson(h);
      const p = await makePerson(h);
      const a = (
        await answers(author, { kind: "TEXT", body: "useful" }).expect(201)
      ).body.answer;
      await h.http().put(`/api/v1/answers/${a.id}/helpful`).expect(401);
      await h
        .http()
        .put(`/api/v1/answers/${a.id}/helpful`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .put(`/api/v1/answers/${a.id}/helpful`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .put(`/api/v1/answers/${a.id}/helpful`)
        .set("Authorization", author.auth)
        .expect(204);
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } }))
          .helpfulCount,
      ).toBe(1);
      await h
        .http()
        .delete(`/api/v1/answers/${a.id}/helpful`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/answers/${a.id}/helpful`)
        .set("Authorization", p.auth)
        .expect(204);
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: a.id } }))
          .helpfulCount,
      ).toBe(0);
      await h
        .http()
        .put(`/api/v1/answers/${randomUUID()}/helpful`)
        .set("Authorization", p.auth)
        .expect(404);
    });
  });

  describe("replies", () => {
    let author: Person;
    let ans: string;
    beforeAll(async () => {
      author = await makePerson(h);
      ans = (
        await answers(author, { kind: "TEXT", body: "Root answer" }).expect(201)
      ).body.answer.id;
    });
    const reply = (p: Person | null, body: object, id = ans, key = idem()) =>
      post(`/api/v1/answers/${id}/replies`, p, body, key);

    it("401 guest; creates agree, disagree and experience replies; counters and receipt", async () => {
      await reply(null, { stance: "AGREE", kind: "TEXT", body: "yes" }).expect(
        401,
      );
      const p = await makePerson(h);
      const r = await reply(p, {
        stance: "AGREE",
        kind: "TEXT",
        body: "I agree",
      }).expect(201);
      expect(r.body.reply).toMatchObject({
        stance: "AGREE",
        body: "I agree",
        isMine: true,
        status: "PUBLISHED",
        answerId: ans,
      });
      expect(r.body.charge.usedFreePost).toBe(true);
      expect(r.body.allowances.freePostsRemaining).toBe(9);
      await reply(await makePerson(h), {
        stance: "DISAGREE",
        kind: "TEXT",
        body: "no",
      }).expect(201);
      await reply(await makePerson(h), {
        stance: "EXPERIENCE",
        kind: "TEXT",
        body: "once I...",
      }).expect(201);
      const a = await h.prisma.answer.findUniqueOrThrow({ where: { id: ans } });
      expect([
        a.replyCount,
        a.agreeCount,
        a.disagreeCount,
        a.experienceCount,
      ]).toEqual([3, 1, 1, 1]);
      expect(
        (await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } }))
          .replyCount,
      ).toBe(1);
    });

    it("list: oldest first, stance filter, cursor pages with no repeats, counts, guest allowed", async () => {
      const a2 = (
        await answers(author, { kind: "TEXT", body: "Thread root" }).expect(201)
      ).body.answer.id;
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await reply(
          await makePerson(h),
          { stance: i % 2 ? "AGREE" : "DISAGREE", kind: "TEXT", body: "r" + i },
          a2,
        ).expect(201);
        ids.push(r.body.reply.id);
      }
      const p1 = await h
        .http()
        .get(`/api/v1/answers/${a2}/replies?limit=2`)
        .expect(200);
      expect(p1.body.items.map((r: { id: string }) => r.id)).toEqual(
        ids.slice(0, 2),
      );
      expect(p1.body.counts).toEqual({ agree: 2, disagree: 3, experience: 0 });
      const p2 = await h
        .http()
        .get(
          `/api/v1/answers/${a2}/replies?limit=2&cursor=${p1.body.nextCursor}`,
        )
        .expect(200);
      const p3 = await h
        .http()
        .get(
          `/api/v1/answers/${a2}/replies?limit=2&cursor=${p2.body.nextCursor}`,
        )
        .expect(200);
      expect(
        [...p1.body.items, ...p2.body.items, ...p3.body.items].map(
          (r: { id: string }) => r.id,
        ),
      ).toEqual(ids);
      expect(p3.body.nextCursor).toBeNull();
      const f = await h
        .http()
        .get(`/api/v1/answers/${a2}/replies?stance=AGREE`)
        .expect(200);
      expect(f.body.items).toHaveLength(2);
      await h
        .http()
        .get(`/api/v1/answers/${a2}/replies?stance=MAYBE`)
        .expect(422);
      await h
        .http()
        .get(`/api/v1/answers/${a2}/replies?cursor=junk`)
        .expect(422);
      await h.http().get(`/api/v1/answers/${randomUUID()}/replies`).expect(404);
    });

    it("replies from a person the viewer blocked are hidden from that viewer", async () => {
      const a2 = (
        await answers(author, { kind: "TEXT", body: "root" }).expect(201)
      ).body.answer.id;
      const rude = await makePerson(h);
      await reply(
        rude,
        { stance: "DISAGREE", kind: "TEXT", body: "rude" },
        a2,
      ).expect(201);
      const viewer = await makePerson(h);
      await h.prisma.block.create({
        data: { blockerId: viewer.id, blockedId: rude.id },
      });
      expect(
        (
          await h
            .http()
            .get(`/api/v1/answers/${a2}/replies`)
            .set("Authorization", viewer.auth)
            .expect(200)
        ).body.items,
      ).toHaveLength(0);
      expect(
        (await h.http().get(`/api/v1/answers/${a2}/replies`).expect(200)).body
          .items,
      ).toHaveLength(1);
    });

    it("404 (no hint of the block) when the answer's author blocked you; CONTENT_REMOVED on a removed answer; 404 on a deleted one", async () => {
      const a2 = (
        await answers(author, { kind: "TEXT", body: "root" }).expect(201)
      ).body.answer.id;
      const blocked = await makePerson(h);
      await h.prisma.block.create({
        data: { blockerId: author.id, blockedId: blocked.id },
      });
      // F4 (lead ruling WF, fix round 1): the block is not revealed: the same 404 as the GET.
      expect(
        (
          await reply(
            blocked,
            { stance: "AGREE", kind: "TEXT", body: "x" },
            a2,
          ).expect(404)
        ).body.error.code,
      ).toBe("NOT_FOUND");
      await h.prisma.answer.update({
        where: { id: a2 },
        data: { status: "REMOVED" },
      });
      expect(
        (
          await reply(
            await makePerson(h),
            { stance: "AGREE", kind: "TEXT", body: "x" },
            a2,
          ).expect(403)
        ).body.error.code,
      ).toBe("CONTENT_REMOVED");
      await reply(
        await makePerson(h),
        { stance: "AGREE", kind: "TEXT", body: "x" },
        randomUUID(),
      ).expect(404);
    });

    it("402 after the free posts keeps the draft and the same key works after buying; idempotent replay", async () => {
      const p = await makePerson(h, { freePosts: 0 });
      const key = idem();
      expect(
        (
          await reply(
            p,
            { stance: "AGREE", kind: "TEXT", body: "pay" },
            ans,
            key,
          ).expect(402)
        ).body.error.code,
      ).toBe("FREE_POSTS_EXHAUSTED");
      await h.prisma.wallet.create({
        data: { userId: p.id, balanceMilli: 600 },
      });
      const ok = await reply(
        p,
        { stance: "AGREE", kind: "TEXT", body: "pay" },
        ans,
        key,
      ).expect(201);
      const again = await reply(
        p,
        { stance: "AGREE", kind: "TEXT", body: "pay" },
        ans,
        key,
      ).expect(201);
      expect(again.body.reply.id).toBe(ok.body.reply.id);
      expect(await balance(p)).toBe(100);
    });

    it("validation 422 (stance, empty body) and no stance change by unknown field", async () => {
      const p = await makePerson(h);
      await reply(p, { stance: "MEH", kind: "TEXT", body: "x" }).expect(422);
      await reply(p, { stance: "AGREE", kind: "TEXT", body: "" }).expect(422);
      await reply(p, { kind: "TEXT", body: "x" }).expect(422);
    });

    it("delete: author only; counters drop; the list hides it", async () => {
      const p = await makePerson(h);
      const a2 = (
        await answers(author, { kind: "TEXT", body: "root" }).expect(201)
      ).body.answer.id;
      const r = (
        await reply(
          p,
          { stance: "EXPERIENCE", kind: "TEXT", body: "mine" },
          a2,
        ).expect(201)
      ).body.reply;
      await h
        .http()
        .delete(`/api/v1/replies/${r.id}`)
        .set("Authorization", author.auth)
        .expect(403);
      await h.http().delete(`/api/v1/replies/${r.id}`).expect(401);
      await h
        .http()
        .delete(`/api/v1/replies/${r.id}`)
        .set("Authorization", p.auth)
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/replies/${r.id}`)
        .set("Authorization", p.auth)
        .expect(204);
      const a = await h.prisma.answer.findUniqueOrThrow({ where: { id: a2 } });
      expect([a.replyCount, a.experienceCount]).toEqual([0, 0]);
      expect(
        (await h.http().get(`/api/v1/answers/${a2}/replies`).expect(200)).body
          .items,
      ).toHaveLength(0);
      await h
        .http()
        .delete(`/api/v1/replies/${randomUUID()}`)
        .set("Authorization", p.auth)
        .expect(404);
    });
  });

  describe("likes", () => {
    let a: string;
    beforeAll(async () => {
      a = (
        await answers(await makePerson(h), {
          kind: "TEXT",
          body: "like me",
        }).expect(201)
      ).body.answer.id;
    });
    const likeCount = async () =>
      (await h.prisma.answer.findUniqueOrThrow({ where: { id: a } })).likeCount;

    it("a guest likes with X-Guest-Id: idempotent, counted once; needs a valid guest id", async () => {
      const g = guestAuth();
      expect(
        (await h.http().put(`/api/v1/answers/${a}/like`).set(g).expect(200))
          .body,
      ).toMatchObject({ iLiked: true, likeCount: 1 });
      await h.http().put(`/api/v1/answers/${a}/like`).set(g).expect(200);
      expect(await likeCount()).toBe(1);
      await h.http().put(`/api/v1/answers/${a}/like`).expect(422);
      await h
        .http()
        .put(`/api/v1/answers/${a}/like`)
        .set("X-Guest-Id", "nope")
        .expect(422);
      expect(
        (await h.http().delete(`/api/v1/answers/${a}/like`).set(g).expect(200))
          .body,
      ).toMatchObject({ iLiked: false, likeCount: 0 });
      await h.http().delete(`/api/v1/answers/${a}/like`).set(g).expect(200);
      expect(await likeCount()).toBe(0);
    });

    it("signing in moves the guest like to the account: still one like", async () => {
      const g = guestAuth();
      const p = await makePerson(h);
      await h.http().put(`/api/v1/answers/${a}/like`).set(g).expect(200);
      expect(await likeCount()).toBe(1);
      const r = await h
        .http()
        .put(`/api/v1/answers/${a}/like`)
        .set(g)
        .set("Authorization", p.auth)
        .expect(200);
      expect(r.body.likeCount).toBe(1);
      expect(
        await h.prisma.like.count({
          where: { answerId: a, guestId: g["X-Guest-Id"] },
        }),
      ).toBe(0);
      expect(
        await h.prisma.like.count({ where: { answerId: a, userId: p.id } }),
      ).toBe(1);
      expect(
        (
          await h
            .http()
            .get(`/api/v1/answers/${a}`)
            .set("Authorization", p.auth)
            .expect(200)
        ).body.iLiked,
      ).toBe(true);
      await h
        .http()
        .delete(`/api/v1/answers/${a}/like`)
        .set("Authorization", p.auth)
        .expect(200);
      expect(await likeCount()).toBe(0);
    });

    it("a bad token is 401, an unknown answer 404, a removed answer cannot be liked", async () => {
      await h
        .http()
        .put(`/api/v1/answers/${a}/like`)
        .set("Authorization", "Bearer bad")
        .expect(401);
      await h
        .http()
        .put(`/api/v1/answers/${randomUUID()}/like`)
        .set(guestAuth())
        .expect(404);
      const removed = await h.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: me.id,
          kind: "TEXT",
          body: "r",
          status: "REMOVED",
        },
      });
      await h
        .http()
        .put(`/api/v1/answers/${removed.id}/like`)
        .set(guestAuth())
        .expect(404);
    });

    it("rate limit: 120 a minute per account or guest", async () => {
      await h.prisma.configEntry.upsert({
        where: { key: "ratelimit.like_per_min" },
        create: { key: "ratelimit.like_per_min", valueJson: 2 },
        update: { valueJson: 2 },
      });
      h.app
        .get(
          (await import("../../src/talk/shared/config-reader.js")).ConfigReader,
        )
        .invalidate();
      try {
        const g = guestAuth();
        await h.http().put(`/api/v1/answers/${a}/like`).set(g).expect(200);
        await h.http().delete(`/api/v1/answers/${a}/like`).set(g).expect(200);
        expect(
          (await h.http().put(`/api/v1/answers/${a}/like`).set(g).expect(429))
            .body.error.code,
        ).toBe("RATE_LIMITED");
        await h
          .http()
          .put(`/api/v1/answers/${a}/like`)
          .set(guestAuth())
          .expect(200);
      } finally {
        await h.prisma.configEntry.delete({
          where: { key: "ratelimit.like_per_min" },
        });
        h.app
          .get(
            (await import("../../src/talk/shared/config-reader.js"))
              .ConfigReader,
          )
          .invalidate();
      }
    });
  });

  describe("reactions", () => {
    let a: string;
    let author: Person;
    beforeAll(async () => {
      author = await makePerson(h);
      a = (
        await answers(author, { kind: "TEXT", body: "react to me" }).expect(201)
      ).body.answer.id;
    });
    const react = (p: Person | null, kind: string, id = a, key = idem()) => {
      const r = h
        .http()
        .put(`/api/v1/answers/${id}/reaction`)
        .set(key)
        .send({ kind });
      return p ? r.set("Authorization", p.auth) : r;
    };

    it("lists the 10 reactions to anyone, in order, with emoji", async () => {
      const r = await h.http().get("/api/v1/reactions").expect(200);
      expect(r.body.items.map((i: { kind: string }) => i.kind)).toEqual([
        "POWERFUL",
        "WILD",
        "RELATABLE",
        "FUNNY",
        "SURPRISING",
        "SAD",
        "WELL_SAID",
        "THOUGHT_PROVOKING",
        "EXACTLY",
        "DISAGREE",
      ]);
      expect(r.body.items[6]).toEqual({
        kind: "WELL_SAID",
        emoji: "\u{1F44F}",
        name: "Well said",
      });
    });

    it("401 guest, 400 no key, 422 bad kind, 404 unknown", async () => {
      await react(null, "FUNNY").expect(401);
      const p = await makePerson(h);
      expect(
        (
          await h
            .http()
            .put(`/api/v1/answers/${a}/reaction`)
            .set("Authorization", p.auth)
            .send({ kind: "FUNNY" })
            .expect(400)
        ).body.error.code,
      ).toBe("IDEMPOTENCY_KEY_REQUIRED");
      await react(p, "ANGRY").expect(422);
      await react(p, "FUNNY", randomUUID()).expect(404);
    });

    it("one per person: set, change for free, remove, counts and breakdown read from the database", async () => {
      const p = await makePerson(h);
      const s = await react(p, "FUNNY").expect(200);
      expect(s.body).toMatchObject({
        myReaction: "FUNNY",
        reactionCount: 1,
        reactionBreakdown: [{ kind: "FUNNY", count: 1 }],
      });
      expect(s.body.charge).toMatchObject({
        costMilli: 0,
        usedFreeDaily: true,
      });
      const c = await react(p, "SAD").expect(200);
      expect(c.body).toMatchObject({
        myReaction: "SAD",
        reactionCount: 1,
        reactionBreakdown: [{ kind: "SAD", count: 1 }],
      });
      expect(c.body.charge).toBeUndefined();
      expect(
        await h.prisma.reaction.count({ where: { answerId: a, userId: p.id } }),
      ).toBe(1);
      expect(
        await h.prisma.charge.count({
          where: { userId: p.id, action: "REACTION" },
        }),
      ).toBe(1);
      expect(
        (
          await h
            .http()
            .get(`/api/v1/answers/${a}`)
            .set("Authorization", p.auth)
        ).body.myReaction,
      ).toBe("SAD");
      const r = await h
        .http()
        .delete(`/api/v1/answers/${a}/reaction`)
        .set("Authorization", p.auth)
        .expect(200);
      expect(r.body).toMatchObject({ myReaction: null, reactionBreakdown: [] });
      await h
        .http()
        .delete(`/api/v1/answers/${a}/reaction`)
        .set("Authorization", p.auth)
        .expect(200);
      const row = await h.prisma.answer.findUniqueOrThrow({ where: { id: a } });
      expect(row.reactionCount).toBe(0);
      expect(
        (await h.prisma.user.findUniqueOrThrow({ where: { id: author.id } }))
          .reactionsReceived,
      ).toBe(0);
    });

    it("the same key replays; two taps in parallel make one reaction and one charge", async () => {
      const p = await makePerson(h);
      const key = idem();
      await react(p, "WILD", a, key).expect(200);
      const again = await react(p, "WILD", a, key).expect(200);
      expect(again.headers["idempotent-replay"]).toBe("true");
      const p2 = await makePerson(h);
      const rs = await Promise.all([
        react(p2, "EXACTLY"),
        react(p2, "EXACTLY"),
      ]);
      expect(
        rs.map((r) => r.status + JSON.stringify(r.body.error ?? "")),
      ).toEqual([200, 200].map((s) => s + JSON.stringify("")));
      expect(
        await h.prisma.reaction.count({
          where: { answerId: a, userId: p2.id },
        }),
      ).toBe(1);
      const charges = await h.prisma.charge.findMany({
        where: { userId: p2.id, action: "REACTION" },
      });
      expect(charges.filter((c) => c.status === "COMMITTED")).toHaveLength(1);
    });

    it("the 21st reaction of the day costs 0.1 unit; a short balance is 402 and nothing is saved; changing stays free", async () => {
      const p = await makePerson(h);
      const answersList: string[] = [];
      for (let i = 0; i < 22; i++)
        answersList.push(
          (
            await h.prisma.answer.create({
              data: {
                questionId: q.id,
                authorId: author.id,
                kind: "TEXT",
                body: "b" + i,
              },
            })
          ).id,
        );
      for (let i = 0; i < 20; i++) {
        const r = await react(p, "POWERFUL", answersList[i]).expect(200);
        expect(r.body.charge.costMilli).toBe(0);
      }
      const broke = await react(p, "POWERFUL", answersList[20]).expect(402);
      expect(broke.body.error.code).toBe("INSUFFICIENT_UNITS");
      expect(
        await h.prisma.reaction.count({
          where: { answerId: answersList[20], userId: p.id },
        }),
      ).toBe(0);
      await h.prisma.wallet.upsert({
        where: { userId: p.id },
        create: { userId: p.id, balanceMilli: 150 },
        update: { balanceMilli: 150 },
      });
      const paid = await react(p, "POWERFUL", answersList[20]).expect(200);
      expect(paid.body.charge).toMatchObject({
        costMilli: 100,
        usedFreeDaily: false,
        balanceMilli: 50,
      });
      await react(p, "WILD", answersList[20]).expect(200);
      await react(p, "SAD", answersList[0]).expect(200);
      expect(await balance(p)).toBe(50);
      const row = await h.prisma.reaction.findFirstOrThrow({
        where: { answerId: answersList[20], userId: p.id },
      });
      expect(row.kind).toBe("WILD");
      expect(row.chargeId).not.toBeNull();
      // removing never refunds
      await h
        .http()
        .delete(`/api/v1/answers/${answersList[20]}/reaction`)
        .set("Authorization", p.auth)
        .expect(200);
      expect(await balance(p)).toBe(50);
    });

    it("rate limit: 60 a minute per account", async () => {
      await h.prisma.configEntry.upsert({
        where: { key: "ratelimit.reaction_per_min" },
        create: { key: "ratelimit.reaction_per_min", valueJson: 2 },
        update: { valueJson: 2 },
      });
      h.app
        .get(
          (await import("../../src/talk/shared/config-reader.js")).ConfigReader,
        )
        .invalidate();
      try {
        const p = await makePerson(h);
        await react(p, "FUNNY").expect(200);
        await react(p, "SAD").expect(200);
        expect((await react(p, "WILD").expect(429)).body.error.code).toBe(
          "RATE_LIMITED",
        );
      } finally {
        await h.prisma.configEntry.delete({
          where: { key: "ratelimit.reaction_per_min" },
        });
        h.app
          .get(
            (await import("../../src/talk/shared/config-reader.js"))
              .ConfigReader,
          )
          .invalidate();
      }
    });
  });

  describe("reports, appeals, support", () => {
    let author: Person;
    let a: string;
    const report = (p: Person | null, body: object) => {
      const r = h.http().post("/api/v1/reports").send(body);
      return p ? r.set("Authorization", p.auth) : r;
    };
    beforeAll(async () => {
      author = await makePerson(h);
      a = (
        await answers(author, { kind: "TEXT", body: "reportable" }).expect(201)
      ).body.answer.id;
    });

    it("401 guest; 201 receipt, a report row and a REPORTED moderation item; the author is not told", async () => {
      const p = await makePerson(h);
      const body = {
        targetType: "ANSWER",
        targetId: a,
        reason: "SCAM_OR_SPAM",
        note: "looks like spam",
      };
      await report(null, body).expect(401);
      const r = await report(p, body).expect(201);
      expect(r.body).toMatchObject({ status: "OPEN", blocked: false });
      const row = await h.prisma.report.findUniqueOrThrow({
        where: { id: r.body.id },
      });
      expect(row).toMatchObject({
        reporterId: p.id,
        targetId: a,
        reason: "SCAM_OR_SPAM",
        priority: false,
      });
      const item = await h.prisma.moderationItem.findFirstOrThrow({
        where: { targetId: a, queue: "REPORTED" },
      });
      expect(item.reportCount).toBe(1);
      expect(
        await h.prisma.notification.count({ where: { userId: author.id } }),
      ).toBe(0);
      // a second reporter raises the count; the same reporter again is 409
      await report(await makePerson(h), body).expect(201);
      expect(
        (
          await h.prisma.moderationItem.findFirstOrThrow({
            where: { targetId: a, queue: "REPORTED" },
          })
        ).reportCount,
      ).toBe(2);
      expect((await report(p, body).expect(409)).body.error.code).toBe(
        "CONFLICT",
      );
    });

    it("ABOUT_ME takes the priority route; alsoBlock blocks the author", async () => {
      const p = await makePerson(h);
      const r = await report(p, {
        targetType: "ANSWER",
        targetId: a,
        reason: "ABOUT_ME",
        alsoBlock: true,
      }).expect(201);
      expect(r.body.blocked).toBe(true);
      expect(
        (await h.prisma.report.findUniqueOrThrow({ where: { id: r.body.id } }))
          .priority,
      ).toBe(true);
      expect(
        await h.prisma.moderationItem.count({
          where: { targetId: a, queue: "PRIORITY", priority: true },
        }),
      ).toBe(1);
      expect(
        await h.prisma.block.count({
          where: { blockerId: p.id, blockedId: author.id },
        }),
      ).toBe(1);
    });

    it("MISLEADING_NEWS_TAG needs a news post and sends it to news review", async () => {
      const p = await makePerson(h);
      await report(p, {
        targetType: "ANSWER",
        targetId: a,
        reason: "MISLEADING_NEWS_TAG",
      }).expect(422);
      const n = (
        await answers(author, {
          kind: "TEXT",
          body: "news",
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        }).expect(201)
      ).body.answer.id;
      await report(p, {
        targetType: "ANSWER",
        targetId: n,
        reason: "MISLEADING_NEWS_TAG",
      }).expect(201);
      const row = await h.prisma.answer.findUniqueOrThrow({ where: { id: n } });
      // C-M3 (lead ruling WF, 6 Nov): the report counts as a news flag; news.flag_threshold decides when it reaches the editors.
      expect([row.newsFlagCount, row.newsReviewStatus]).toEqual([1, "NONE"]);
    });

    it("targets: replies and users work; unknown 404; yourself 422; bad reason 422", async () => {
      const p = await makePerson(h);
      const rep = await h.prisma.reply.create({
        data: {
          answerId: a,
          authorId: author.id,
          stance: "AGREE",
          kind: "TEXT",
          body: "x",
        },
      });
      await report(p, {
        targetType: "REPLY",
        targetId: rep.id,
        reason: "OTHER",
      }).expect(201);
      await report(p, {
        targetType: "USER",
        targetId: author.id,
        reason: "HATE_OR_HARASSMENT",
      }).expect(201);
      await report(p, {
        targetType: "ANSWER",
        targetId: randomUUID(),
        reason: "OTHER",
      }).expect(404);
      await report(author, {
        targetType: "ANSWER",
        targetId: a,
        reason: "OTHER",
      }).expect(422);
      await report(p, {
        targetType: "ANSWER",
        targetId: a,
        reason: "RUDE",
      }).expect(422);
    });

    it("appeal: only your own removed post; opens an APPEAL item; a second is 409; a live post is 409", async () => {
      const p = await makePerson(h);
      const mine = (
        await answers(p, { kind: "TEXT", body: "mine" }).expect(201)
      ).body.answer.id;
      const body = (id: string) => ({
        targetType: "ANSWER",
        targetId: id,
        note: "It was a joke",
      });
      const ap = (who: Person | null, b: object) => {
        const r = h.http().post("/api/v1/appeals").send(b);
        return who ? r.set("Authorization", who.auth) : r;
      };
      await ap(null, body(mine)).expect(401);
      expect((await ap(p, body(mine)).expect(409)).body.error.code).toBe(
        "CONFLICT",
      );
      await h.prisma.answer.update({
        where: { id: mine },
        data: { status: "REMOVED" },
      });
      await ap(await makePerson(h), body(mine)).expect(404);
      await ap(p, { ...body(mine), note: " " }).expect(422);
      const ok = await ap(p, body(mine)).expect(201);
      expect(ok.body.status).toBe("OPEN");
      const row = await h.prisma.appeal.findUniqueOrThrow({
        where: { id: ok.body.id },
      });
      expect(row.userId).toBe(p.id);
      expect(
        (
          await h.prisma.moderationItem.findUniqueOrThrow({
            where: { id: row.itemId as string },
          })
        ).queue,
      ).toBe("APPEAL");
      expect((await ap(p, body(mine)).expect(409)).body.error.code).toBe(
        "CONFLICT",
      );
    });

    it("support: guest or signed in, payment must be yours, 422 on empty, rate limited by config", async () => {
      const g = guestAuth();
      const r = await h
        .http()
        .post("/api/v1/support/messages")
        .set(g)
        .send({ topic: "OTHER", message: "Hello team", contactEmail: "a@b.co" })
        .expect(201);
      const row = await h.prisma.supportMessage.findUniqueOrThrow({
        where: { id: r.body.id },
      });
      expect(row).toMatchObject({
        userId: null,
        guestId: g["X-Guest-Id"],
        topic: "OTHER",
        message: "Hello team",
      });
      const p = await makePerson(h);
      const s = await h
        .http()
        .post("/api/v1/support/messages")
        .set("Authorization", p.auth)
        .send({ topic: "ACCOUNT", message: "Help" })
        .expect(201);
      expect(
        (
          await h.prisma.supportMessage.findUniqueOrThrow({
            where: { id: s.body.id },
          })
        ).userId,
      ).toBe(p.id);
      await h
        .http()
        .post("/api/v1/support/messages")
        .set("Authorization", p.auth)
        .send({
          topic: "PAYMENT",
          message: "Where is it",
          paymentId: randomUUID(),
        })
        .expect(422);
      await h
        .http()
        .post("/api/v1/support/messages")
        .send({ topic: "PAYMENT", message: "x", paymentId: randomUUID() })
        .expect(422);
      await h
        .http()
        .post("/api/v1/support/messages")
        .set(g)
        .send({ topic: "OTHER", message: "  " })
        .expect(422);
      await h
        .http()
        .post("/api/v1/support/messages")
        .set(g)
        .send({ topic: "NOPE", message: "x" })
        .expect(422);
      await h
        .http()
        .post("/api/v1/support/messages")
        .set(g)
        .send({ topic: "OTHER", message: "x", contactEmail: "bad" })
        .expect(422);
      await h.prisma.configEntry.upsert({
        where: { key: "ratelimit.support_per_min" },
        create: { key: "ratelimit.support_per_min", valueJson: 1 },
        update: { valueJson: 1 },
      });
      h.app
        .get(
          (await import("../../src/talk/shared/config-reader.js")).ConfigReader,
        )
        .invalidate();
      try {
        const g2 = guestAuth();
        await h
          .http()
          .post("/api/v1/support/messages")
          .set(g2)
          .send({ topic: "OTHER", message: "one" })
          .expect(201);
        await h
          .http()
          .post("/api/v1/support/messages")
          .set(g2)
          .send({ topic: "OTHER", message: "two" })
          .expect(429);
      } finally {
        await h.prisma.configEntry.delete({
          where: { key: "ratelimit.support_per_min" },
        });
        h.app
          .get(
            (await import("../../src/talk/shared/config-reader.js"))
              .ConfigReader,
          )
          .invalidate();
      }
    });
  });
});
