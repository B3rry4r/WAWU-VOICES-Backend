/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  Harness,
  idem,
  makePerson,
  Person,
  startHarness,
} from "../talk/harness";
import { importQuestions } from "../../src/feed/seed";
import type { SeedFile, WeekCategory } from "../../src/feed/seed";
import { dateOnly, lagosDay } from "../../src/feed/lagos";
import { loadSubject } from "../../src/reach/share-subject";
import { cardSpecFor } from "../../src/reach/share.service";
import { MoodStatsService } from "../../src/mood/mood-stats.service";

const WORDS = ["ANGRY", "TIRED", "PROUD", "HOPEFUL"];

/** Rule W: a daily question carries the four words, and everything that follows from that, through the real routes. */
describe("daily questions carry the four words", () => {
  let h: Harness;
  let stats: MoodStatsService;
  let editor: Person;
  const made: string[] = [];
  let topicIds: string[] = [];

  beforeAll(async () => {
    h = await startHarness();
    stats = h.app.get(MoodStatsService);
    editor = await makePerson(h, { roles: ["EDITOR"] });
  });
  afterAll(async () => {
    // leave nothing readable: every question this file made is a draft, every answer under it removed
    await h.prisma.answer.updateMany({
      where: { questionId: { in: made } },
      data: { status: "REMOVED" },
    });
    await h.prisma.question.updateMany({
      where: { id: { in: made } },
      data: { status: "DRAFT", pinned: false },
    });
    await h.prisma.question.updateMany({
      where: { seedKey: { startsWith: "q9000" } },
      data: { status: "DRAFT" },
    });
    await h.prisma.topic.updateMany({
      where: { id: { in: topicIds } },
      data: { status: "DRAFT" },
    });
    await h.close();
  });

  const get = (path: string, p?: Person) => {
    const r = h.http().get(`/api/v1${path}`);
    return p ? r.set("Authorization", p.auth) : r;
  };
  const post = (p: Person, qid: string, body: object) =>
    h
      .http()
      .post(`/api/v1/questions/${qid}/answers`)
      .set("Authorization", p.auth)
      .set(idem())
      .send(body);

  /** A daily question made through the admin route, then opened for answers. */
  async function dailyViaAdmin(over: { today?: boolean } = {}) {
    const r = await h
      .http()
      .post("/api/v1/admin/questions")
      .set("Authorization", editor.auth)
      .send({
        kind: "DAILY",
        status: "DRAFT",
        text: `Daily words ${randomUUID()}?`,
      });
    expect(r.status).toBe(201);
    const id: string = r.body.question?.id ?? r.body.id;
    made.push(id);
    await h.prisma.question.update({
      where: { id },
      data: {
        status: "LIVE",
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        ...(over.today
          ? {
              scheduledFor: dateOnly(lagosDay(new Date())),
              isSpare: false,
              pinned: true,
            }
          : {}),
      },
    });
    return id;
  }

  describe("where a daily question is made", () => {
    it("the admin route gives a DAILY question the four words and leaves a FLASH question without", async () => {
      const id = await dailyViaAdmin();
      expect(
        (await h.prisma.question.findUniqueOrThrow({ where: { id } }))
          .moodOptions,
      ).toEqual(WORDS);
      const f = await h
        .http()
        .post("/api/v1/admin/questions")
        .set("Authorization", editor.auth)
        .send({ kind: "FLASH", status: "DRAFT", text: "A flash question?" });
      expect(f.status).toBe(201);
      const fid: string = f.body.question?.id ?? f.body.id;
      made.push(fid);
      expect(
        (await h.prisma.question.findUniqueOrThrow({ where: { id: fid } }))
          .moodOptions,
      ).toEqual([]);
    });

    it("the calendar seed gives every daily question the four words", async () => {
      const file: SeedFile = {
        questions: Array.from({ length: 10 }, (_, i) => ({
          n: 900001 + i,
          week: 9000,
          category: "money",
          theme: "x",
          qInWeek: i + 1,
          text: `Seeded daily words ${i + 1}?`,
          speakPrompt: null,
        })),
        weeks: [
          {
            week: 9000,
            topic: "Daily words week",
            category: "money",
            poll: { question: "Which?", options: [{ key: "a", text: "A" }] },
            whatNext: { question: "What next?" },
          },
        ],
      };
      const cats: WeekCategory[] = [
        { week: 9000, season: "x", theme: "x", category: "money" },
      ];
      await importQuestions(h.prisma, file, cats);
      const rows = await h.prisma.question.findMany({
        where: { seedKey: { startsWith: "q9000" } },
      });
      topicIds = [...new Set(rows.map((r) => r.topicId!).filter(Boolean))];
      expect(rows).toHaveLength(10);
      for (const r of rows) {
        expect(r.kind).toBe("DAILY");
        expect(r.moodOptions).toEqual(WORDS);
      }
    });
  });

  describe("posting", () => {
    it("a voice answer and a written answer both need one of the four words, and store it", async () => {
      const id = await dailyViaAdmin();
      const p = await makePerson(h);
      const t = await post(p, id, { kind: "TEXT", body: "Tired." }).expect(422);
      expect(t.body.error.details.fields[0]).toEqual({
        path: "mood",
        message: "Pick one word before you post.",
      });
      await post(p, id, { kind: "VOICE" }).expect(422);
      await post(p, id, { kind: "TEXT", body: "x", mood: "SAD" }).expect(422);
      expect(await h.prisma.answer.count({ where: { questionId: id } })).toBe(
        0,
      );
      const ok = await post(p, id, {
        kind: "TEXT",
        body: "Proud of the young ones.",
        mood: "PROUD",
      }).expect(201);
      expect(ok.body.answer.mood).toBe("PROUD");
      const p2 = await makePerson(h);
      const clip2 = await h.prisma.voiceClip.create({
        data: {
          ownerId: p2.id,
          purpose: "ANSWER",
          status: "READY",
          rawKey: "raw/dw2",
          rawMime: "audio/webm",
          playKey: "voice/dw2.m4a",
          playMime: "audio/mp4",
          maxDurationMs: 10000,
          durationMs: 3000,
        },
      });
      const v = await post(p2, id, {
        kind: "VOICE",
        clipId: clip2.id,
        mood: "HOPEFUL",
      }).expect(201);
      expect(v.body.answer.mood).toBe("HOPEFUL");
      const rows = await h.prisma.answer.findMany({
        where: { questionId: id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((r) => [r.kind, r.mood])).toEqual([
        ["TEXT", "PROUD"],
        ["VOICE", "HOPEFUL"],
      ]);
    });

    it("an older client that sends no word gets 422 and 'Pick one word before you post.'", async () => {
      const id = await dailyViaAdmin();
      const p = await makePerson(h);
      const r = await post(p, id, { kind: "TEXT", body: "No word." }).expect(
        422,
      );
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
      expect(r.body.error.details.fields[0].message).toBe(
        "Pick one word before you post.",
      );
    });
  });

  describe("explain my vote", () => {
    it("needs one of the four words under a daily question, and stores it", async () => {
      const id = await dailyViaAdmin();
      const topic = await h.prisma.topic.create({
        data: {
          weekNumber: 9100 + Math.floor(Math.random() * 800),
          title: "Daily words poll week",
          startsOn: new Date("2026-11-16"),
          endsOn: new Date("2026-11-22"),
          status: "DRAFT",
          whatNextPrompt: "What next?",
        },
      });
      topicIds.push(topic.id);
      const poll = await h.prisma.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: "Which is it?",
          status: "OPEN",
          questionId: id,
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 3_600_000),
          options: {
            create: [
              { label: "One", sortOrder: 0 },
              { label: "Two", sortOrder: 1 },
            ],
          },
        } as never,
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });
      const u = await makePerson(h);
      await h
        .http()
        .post(`/api/v1/polls/${poll.id}/votes`)
        .set("Authorization", u.auth)
        .set(idem())
        .send({ optionIds: [poll.options[0].id] })
        .expect(201);
      const explain = (body: object) =>
        h
          .http()
          .post(`/api/v1/polls/${poll.id}/explanation`)
          .set("Authorization", u.auth)
          .set(idem())
          .send(body);
      const none = await explain({
        kind: "TEXT",
        body: "Because rent.",
      }).expect(422);
      expect(none.body.error.details.fields[0]).toEqual({
        path: "mood",
        message: "Pick one word before you post.",
      });
      const ok = await explain({
        kind: "TEXT",
        body: "Because rent.",
        mood: "TIRED",
      }).expect(201);
      expect(ok.body.answer.mood).toBe("TIRED");
    });
  });

  describe("what a daily question with words serves", () => {
    it("the word counts route answers for it", async () => {
      const id = await dailyViaAdmin();
      const a = await makePerson(h);
      const b = await makePerson(h);
      await post(a, id, { kind: "TEXT", body: "a", mood: "ANGRY" }).expect(201);
      await post(b, id, { kind: "TEXT", body: "b", mood: "ANGRY" }).expect(201);
      await stats.refresh(id);
      const r = (await get(`/questions/${id}/moods`).expect(200)).body as {
        total: number;
        items: { mood: string; count: number }[];
      };
      expect(r.total).toBe(2);
      expect(r.items.map((i) => i.mood)).toEqual(WORDS);
      expect(r.items.find((i) => i.mood === "ANGRY")?.count).toBe(2);
    });

    it("the share card carries the person's word", async () => {
      const id = await dailyViaAdmin();
      const p = await makePerson(h);
      const res = await post(p, id, {
        kind: "TEXT",
        body: "Hopeful.",
        mood: "HOPEFUL",
      }).expect(201);
      const s = await loadSubject(
        h.prisma,
        "ANSWER",
        res.body.answer.id,
        stats,
      );
      expect(s).not.toBeNull();
      const spec = cardSpecFor("ANSWER", s!);
      expect(spec.kind).toBe("mood");
      expect(spec.mood?.word).toBe("HOPEFUL");
      const link = await h
        .http()
        .post("/api/v1/share/links")
        .send({ objectType: "ANSWER", objectId: res.body.answer.id })
        .expect(201);
      const page = await get(`/share/${link.body.code}`).expect(200);
      expect(page.body.featuredVoice.mood).toBe("HOPEFUL");
      expect(page.body.question.moodOptions).toEqual(WORDS);
    });

    it("the question, Home and today all carry the four words", async () => {
      const id = await dailyViaAdmin({ today: true });
      expect(
        (await get(`/questions/${id}`).expect(200)).body.moodOptions,
      ).toEqual(WORDS);
      const today = (await get("/questions/today").expect(200)).body;
      expect(today.id).toBe(id);
      expect(today.moodOptions).toEqual(WORDS);
      // Home needs a topic for the week; this one is a draft again when the file ends
      const day = (n: number) =>
        dateOnly(lagosDay(new Date(Date.now() + n * 86_400_000)));
      const week = await h.prisma.topic.create({
        data: {
          weekNumber: 9900 + Math.floor(Math.random() * 90),
          title: "Daily words Home week",
          startsOn: day(-1),
          endsOn: day(5),
          status: "LIVE",
          whatNextPrompt: "What next?",
        },
      });
      topicIds.push(week.id);
      const home = (await get("/home").expect(200)).body;
      expect(JSON.stringify(home)).toContain(id);
      type Node = { id?: string; moodOptions?: string[] };
      const find = (n: unknown): Node | undefined => {
        if (!n || typeof n !== "object") return undefined;
        const o = n as Node;
        if (o.id === id && o.moodOptions) return o;
        return Object.values(n).map(find).find(Boolean);
      };
      expect(find(home)?.moodOptions).toEqual(WORDS);
    });
  });
});
