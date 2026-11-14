/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  Harness,
  idem,
  makePerson,
  Person,
  startHarness,
} from "../talk/harness";
import { MoodStatsService } from "../../src/mood/mood-stats.service";
import type { Mood } from "../../src/generated/prisma/client";

/** LCH-02 and LCH-04: a mood question, its words, and where a person sits (49 against 50, one per person). */
describe("mood question and where you sit", () => {
  let h: Harness;
  let stats: MoodStatsService;
  beforeAll(async () => {
    h = await startHarness();
    stats = h.app.get(MoodStatsService);
  });
  afterAll(async () => {
    await h.close();
  });

  const api = (path: string, p?: Person) => {
    const r = h.http().get(`/api/v1${path}`);
    return p ? r.set("Authorization", p.auth) : r;
  };

  async function moodQuestion() {
    return h.prisma.question.create({
      data: {
        text: "How do you feel about Nigeria right now?",
        hint: "With everything going on, say it in your voice. Up to 1 minute.",
        status: "LIVE",
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
      },
    });
  }
  const post = (p: Person, qid: string, body: object) =>
    h
      .http()
      .post(`/api/v1/questions/${qid}/answers`)
      .set("Authorization", p.auth)
      .set(idem())
      .send(body);

  /** `n` people, each with one valid answer carrying `mood`, in the given country. */
  async function crowd(
    qid: string,
    n: number,
    mood: Mood,
    countryCode = "NG",
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      ids.push(id);
      await h.prisma.user.create({
        data: {
          id,
          wawuId: `crowd-${id}`,
          handle: `c${id.replace(/-/g, "").slice(0, 18)}`,
          referralCode: id.slice(0, 12),
          countryCode,
        },
      });
    }
    await h.prisma.answer.createMany({
      data: ids.map((authorId) => ({
        questionId: qid,
        authorId,
        kind: "TEXT" as const,
        body: "x",
        mood,
      })),
    });
    return ids;
  }

  describe("posting", () => {
    it("refuses an answer without a word on a mood question, in plain words, text and voice", async () => {
      const q = await moodQuestion();
      const p = await makePerson(h);
      const t = await post(p, q.id, { kind: "TEXT", body: "Tired." }).expect(
        422,
      );
      expect(t.body.error.details.fields[0]).toEqual({
        path: "mood",
        message: "Pick one word before you post.",
      });
      const v = await post(p, q.id, { kind: "VOICE" }).expect(422);
      expect(v.body.error.details.fields[0].path).toBe("mood");
      expect(await h.prisma.answer.count({ where: { questionId: q.id } })).toBe(
        0,
      );
    });

    it("refuses a word the question does not offer, and a word on an ordinary question", async () => {
      const q = await moodQuestion();
      await h.prisma.question.update({
        where: { id: q.id },
        data: { moodOptions: ["ANGRY", "TIRED"] },
      });
      const p = await makePerson(h);
      await post(p, q.id, {
        kind: "TEXT",
        body: "Proud.",
        mood: "PROUD",
      }).expect(422);
      await post(p, q.id, { kind: "TEXT", body: "x", mood: "SAD" }).expect(422);
      const plain = await h.prisma.question.create({
        data: { text: "An ordinary question?", status: "LIVE" },
      });
      const r = await post(p, plain.id, {
        kind: "TEXT",
        body: "Hello.",
        mood: "PROUD",
      }).expect(422);
      expect(r.body.error.details.fields[0].message).toBe(
        "This question has no words to pick from.",
      );
      // an ordinary question still takes an ordinary answer, with no word
      const ok = await post(p, plain.id, {
        kind: "TEXT",
        body: "Hello.",
      }).expect(201);
      expect(ok.body.answer.mood).toBeNull();
    });

    it("stores the word and serves it on the answer, the thread, the question list, the profile and the share page", async () => {
      const q = await moodQuestion();
      const p = await makePerson(h);
      const res = await post(p, q.id, {
        kind: "TEXT",
        body: "Hopeful, because the young ones build.",
        mood: "HOPEFUL",
      }).expect(201);
      expect(res.body.answer.mood).toBe("HOPEFUL");
      const id = res.body.answer.id;
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id } })).mood,
      ).toBe("HOPEFUL");
      expect((await api(`/answers/${id}`).expect(200)).body.mood).toBe(
        "HOPEFUL",
      );
      const list = await api(`/questions/${q.id}/answers`).expect(200);
      expect(list.body.items[0].answer.mood).toBe("HOPEFUL");
      const mine = await api("/me/answers", p).expect(200);
      expect(mine.body.items[0].answer.mood).toBe("HOPEFUL");
      const qv = await api(`/questions/${q.id}`).expect(200);
      expect(qv.body.moodOptions).toEqual([
        "ANGRY",
        "TIRED",
        "PROUD",
        "HOPEFUL",
      ]);
      const sh = await h
        .http()
        .post("/api/v1/share/links")
        .send({ objectType: "ANSWER", objectId: id })
        .expect(201);
      const page = await api(`/share/${sh.body.code}`).expect(200);
      expect(page.body.featuredVoice.mood).toBe("HOPEFUL");
      expect(page.body.question.moodOptions).toContain("HOPEFUL");
    });

    it("filters the answers of a question by word, and refuses a word that is not one", async () => {
      const q = await moodQuestion();
      await crowd(q.id, 3, "ANGRY");
      await crowd(q.id, 2, "TIRED");
      const angry = await api(`/questions/${q.id}/answers?mood=ANGRY`).expect(
        200,
      );
      expect(angry.body.items).toHaveLength(3);
      expect(
        angry.body.items.every((i: any) => i.answer.mood === "ANGRY"),
      ).toBe(true);
      expect(
        (await api(`/questions/${q.id}/answers?mood=PROUD`).expect(200)).body
          .items,
      ).toHaveLength(0);
      expect(
        (await api(`/questions/${q.id}/answers`).expect(200)).body.items,
      ).toHaveLength(5);
      await api(`/questions/${q.id}/answers?mood=SAD`).expect(422);
    });

    it("counts per word; a removed answer leaves the count", async () => {
      const q = await moodQuestion();
      await crowd(q.id, 3, "ANGRY");
      await crowd(q.id, 1, "HOPEFUL");
      await stats.refresh(q.id);
      const a = (await api(`/questions/${q.id}/moods`).expect(200)).body;
      expect(a.total).toBe(4);
      expect(a.items.find((i: any) => i.mood === "ANGRY")).toMatchObject({
        count: 3,
        percent: 75,
      });
      const one = await h.prisma.answer.findFirstOrThrow({
        where: { questionId: q.id, mood: "ANGRY" },
      });
      await h.prisma.answer.update({
        where: { id: one.id },
        data: { status: "REMOVED" },
      });
      await stats.refresh(q.id);
      const b = (await api(`/questions/${q.id}/moods`).expect(200)).body;
      expect(b.total).toBe(3);
      expect(b.items.find((i: any) => i.mood === "ANGRY").count).toBe(2);
      // a question with no words has no counts
      const plain = await h.prisma.question.create({
        data: { text: "Plain?", status: "LIVE" },
      });
      await api(`/questions/${plain.id}/moods`).expect(404);
    });
  });

  describe("where you sit", () => {
    async function me(qid: string, mood: Mood = "HOPEFUL", country = "NG") {
      const p = await makePerson(h);
      await h.prisma.user.update({
        where: { id: p.id },
        data: { countryCode: country },
      });
      const a = await h.prisma.answer.create({
        data: {
          questionId: qid,
          authorId: p.id,
          kind: "TEXT",
          body: "mine",
          mood,
          createdAt: new Date(Date.now() - 120_000),
        },
      });
      return { p, a };
    }
    const sit = async (qid: string, p: Person, answerId: string) => {
      await stats.refresh(qid);
      return (await api(`/answers/${answerId}/where-you-sit`, p).expect(200))
        .body;
    };

    it("shows no percentage at 49 valid answers and one at 50", async () => {
      const q = await moodQuestion();
      const { p, a } = await me(q.id);
      await crowd(q.id, 47, "HOPEFUL"); // 48 with mine
      await crowd(q.id, 0, "ANGRY");
      let s = await sit(q.id, p, a.id);
      expect(s.nigeria.percent).toBeNull();
      expect(s.world.percent).toBeNull();
      expect(s.showSwitch).toBe(false);
      expect(s.line).toBe("You’re one of the first.");
      await crowd(q.id, 1, "ANGRY"); // 49 in all
      s = await sit(q.id, p, a.id);
      expect(s.world.percent).toBeNull();
      expect(s.line).toBe("You’re one of the first.");
      await crowd(q.id, 1, "ANGRY"); // 50 in all: 48 hopeful, 2 angry
      s = await sit(q.id, p, a.id);
      expect(s.nigeria.percent).toBe(96);
      expect(s.world.percent).toBe(96);
      expect(s.nigeria.voices).toBe(50);
      expect(s.showSwitch).toBe(true);
      expect(s.defaultScope).toBe("NIGERIA");
      expect(s.line).toBe("You’re with the 96% who feel HOPEFUL.");
    });

    it("counts Nigeria and the World apart", async () => {
      const q = await moodQuestion();
      const { p, a } = await me(q.id, "TIRED");
      await crowd(q.id, 20, "TIRED"); // Nigeria: 21 tired
      await crowd(q.id, 20, "ANGRY"); // Nigeria: 20 angry, 41 in all
      await crowd(q.id, 9, "PROUD"); // Nigeria: 50 in all
      await crowd(q.id, 30, "HOPEFUL", "GH"); // World: 80 in all
      const s = await sit(q.id, p, a.id);
      expect(s.nigeria.voices).toBe(50);
      expect(s.nigeria.percent).toBe(42); // 21 of 50
      expect(s.world.voices).toBe(80);
      expect(s.world.percent).toBe(26); // 21 of 80
      // a group under 50 shows no percentage even when the other has one
      const q2 = await moodQuestion();
      const m2 = await me(q2.id, "TIRED", "GH");
      await crowd(q2.id, 10, "TIRED"); // Nigeria 10
      await crowd(q2.id, 45, "HOPEFUL", "GH"); // World 56
      const s2 = await sit(q2.id, m2.p, m2.a.id);
      expect(s2.nigeria.percent).toBeNull();
      expect(s2.world.percent).toBe(20); // 11 of 56
      expect(s2.defaultScope).toBe("WORLD");
      expect(s2.line).toBe("You’re with the 20% who feel TIRED.");
    });

    it("counts one person once, with their latest valid answer", async () => {
      const q = await moodQuestion();
      const { p, a } = await me(q.id, "HOPEFUL");
      // the same person answers again with another word: only the newest counts
      await h.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: p.id,
          kind: "TEXT",
          body: "changed my mind",
          mood: "ANGRY",
        },
      });
      await crowd(q.id, 48, "HOPEFUL");
      await stats.refresh(q.id);
      const counts = (await api(`/questions/${q.id}/moods`).expect(200)).body;
      expect(counts.total).toBe(49);
      expect(counts.items.find((i: any) => i.mood === "ANGRY").count).toBe(1);
      expect(counts.items.find((i: any) => i.mood === "HOPEFUL").count).toBe(
        48,
      );
      await crowd(q.id, 1, "PROUD"); // 50 people, not 51
      const s = await sit(q.id, p, a.id);
      expect(s.world.voices).toBe(50);
    });

    it("leaves out removed, deleted, held and suspended people's answers", async () => {
      const q = await moodQuestion();
      const { p, a } = await me(q.id, "PROUD");
      const ids = await crowd(q.id, 49, "PROUD");
      let s = await sit(q.id, p, a.id);
      expect(s.world.voices).toBe(50);
      await h.prisma.answer.updateMany({
        where: { authorId: ids[0] },
        data: { status: "REMOVED" },
      });
      await h.prisma.answer.updateMany({
        where: { authorId: ids[1] },
        data: { status: "DELETED_BY_AUTHOR", deletedAt: new Date() },
      });
      await h.prisma.user.update({
        where: { id: ids[2] },
        data: {
          status: "SUSPENDED",
          suspendedUntil: new Date(Date.now() + 1e8),
        },
      });
      s = await sit(q.id, p, a.id);
      expect(s.world.voices).toBeNull(); // 47 left: back under 50
      expect(s.line).toBe("You’re one of the first.");
      // a lapsed suspension counts again
      await h.prisma.user.update({
        where: { id: ids[2] },
        data: { suspendedUntil: new Date(Date.now() - 1000) },
      });
      await stats.refresh(q.id);
      expect(
        (await api(`/questions/${q.id}/moods`).expect(200)).body.total,
      ).toBe(48);
    });

    it("reads the stored counts, not the database, and adds a brand new own answer", async () => {
      const q = await moodQuestion();
      await crowd(q.id, 59, "HOPEFUL");
      await stats.refresh(q.id);
      const before = await stats.get(q.id);
      // a person posts after the counts were stored: not in them yet, but in their own percentage
      const p = await makePerson(h);
      const r = await post(p, q.id, {
        kind: "TEXT",
        body: "Angry.",
        mood: "ANGRY",
      }).expect(201);
      const same = await stats.get(q.id);
      expect(same.at).toBe(before.at); // no recount on read
      const s = (
        await api(`/answers/${r.body.answer.id}/where-you-sit`, p).expect(200)
      ).body;
      expect(s.world.voices).toBe(60);
      expect(s.world.percent).toBe(2); // 1 of 60
      expect((await stats.get(q.id)).at).toBe(before.at);
    });

    it("answers only the author, about their own published mood answer", async () => {
      const q = await moodQuestion();
      const { a } = await me(q.id);
      const other = await makePerson(h);
      await api(`/answers/${a.id}/where-you-sit`, other).expect(404);
      await api(`/answers/${a.id}/where-you-sit`).expect(401);
    });
  });

  describe("show my name on the card", () => {
    it("is off by default, changes only by its author, and survives on the answer", async () => {
      const q = await moodQuestion();
      const p = await makePerson(h);
      const r = await post(p, q.id, {
        kind: "TEXT",
        body: "Proud.",
        mood: "PROUD",
      }).expect(201);
      const id = r.body.answer.id;
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id } }))
          .showNameOnCard,
      ).toBe(false);
      const other = await makePerson(h);
      await h
        .http()
        .patch(`/api/v1/answers/${id}/card`)
        .set("Authorization", other.auth)
        .send({ showName: true })
        .expect(404);
      await h
        .http()
        .patch(`/api/v1/answers/${id}/card`)
        .set("Authorization", p.auth)
        .send({ showName: true })
        .expect(200);
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id } }))
          .showNameOnCard,
      ).toBe(true);
      await h
        .http()
        .patch(`/api/v1/answers/${id}/card`)
        .set("Authorization", p.auth)
        .send({ showName: "yes" })
        .expect(422);
    });
  });
});
