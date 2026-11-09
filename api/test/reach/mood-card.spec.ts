/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  Harness,
  mkTopic,
  mkUser,
  pngSize,
  resetDb,
  startHarness,
} from "./helpers";
import { loadSubject } from "../../src/reach/share-subject";
import { cardSpecFor } from "../../src/reach/share.service";
import { moodCardSvg } from "../../src/reach/mood-card";
import { MoodStatsService } from "../../src/mood/mood-stats.service";
import type { Mood } from "../../src/generated/prisma/client";

const OUT = process.env.CARD_OUT;

/** LCH-03: the personal mood share card, in three sizes. */
describe("mood share card", () => {
  let h: Harness;
  let stats: MoodStatsService;
  beforeAll(async () => {
    h = await startHarness();
    stats = h.app.get(MoodStatsService);
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await h.cards.idle();
    await resetDb();
    h.store.objects.clear();
  });

  let week = 0;
  async function world(opts: { name?: boolean; others?: number } = {}) {
    const topic = await mkTopic(h, ++week);
    const q = await h.prisma.question.create({
      data: {
        topicId: topic.id,
        status: "LIVE",
        text: "How do you feel about Nigeria right now?",
        moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
      },
    });
    const author = await mkUser(h, {
      handle: `ada.okafor${week}`,
      state: "Lagos",
    });
    await h.prisma.user.update({
      where: { id: author.id },
      data: { displayName: "Ada Okafor" },
    });
    const a = await h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: author.id,
        kind: "TEXT",
        body: "Hopeful.",
        mood: "HOPEFUL",
        showNameOnCard: !!opts.name,
        createdAt: new Date(Date.now() - 120_000),
      },
    });
    await more(q.id, opts.others ?? 0, "HOPEFUL");
    return { q, author, a };
  }
  async function more(qid: string, n: number, mood: Mood) {
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      await h.prisma.user.create({
        data: {
          id,
          wawuId: `c-${id}`,
          handle: `c${id.replace(/-/g, "").slice(0, 18)}`,
          referralCode: id.slice(0, 12),
        },
      });
      await h.prisma.answer.create({
        data: { questionId: qid, authorId: id, kind: "TEXT", body: "x", mood },
      });
    }
    await stats.refresh(qid);
  }
  const spec = async (answerId: string) => {
    const s = await loadSubject(h.prisma, "ANSWER", answerId, stats);
    return s ? cardSpecFor("ANSWER", s) : null;
  };
  const link = (answerId: string) =>
    h
      .http()
      .post("/api/v1/share/links")
      .send({ objectType: "ANSWER", objectId: answerId });
  const get = (path: string) => h.http().get(`/api/v1${path}`);
  const save = (name: string, png: Buffer) =>
    OUT && writeFileSync(`${OUT}/${name}.png`, png);

  it("names nobody unless the person turned the name on", async () => {
    const w = await world();
    const off = await spec(w.a.id);
    expect(off?.kind).toBe("mood");
    expect(off?.mood?.name).toBeNull();
    expect(off?.mood?.place).toBeNull();
    expect(JSON.stringify(off)).not.toMatch(/Ada|ada\.okafor|Lagos/);
    const svgOff = moodCardSvg(off!, "square", "", "");
    expect(svgOff).not.toMatch(/Ada|Okafor/);

    await h.prisma.answer.update({
      where: { id: w.a.id },
      data: { showNameOnCard: true },
    });
    const on = await spec(w.a.id);
    expect(on?.mood?.name).toBe("Ada Okafor");
    expect(on?.mood?.place).toBe("Lagos");
    expect(moodCardSvg(on!, "square", "", "")).toContain("Ada Okafor · Lagos");

    // an anonymous answer never carries a name, whatever the switch says
    await h.prisma.answer.update({
      where: { id: w.a.id },
      data: { anonymous: true },
    });
    expect((await spec(w.a.id))?.mood?.name).toBeNull();
  });

  it("says one of the first at 49 answers and the percentage at 50", async () => {
    const w = await world({ others: 48 }); // 49 in all
    let s = await spec(w.a.id);
    expect(s?.mood?.line).toBe("You’re one of the first.");
    await more(w.q.id, 1, "ANGRY"); // 50 in all: 49 hopeful
    s = await spec(w.a.id);
    expect(s?.mood?.line).toBe("You’re with the 98% who feel hopeful.");
    expect(s?.mood?.word).toBe("HOPEFUL");
  });

  it("draws the card at 1200x630, the story at 1080x1920 and the square at 1080x1080, and caches them", async () => {
    const w = await world({ name: true, others: 49 });
    const l = (await link(w.a.id).expect(201)).body;
    expect(l.squareImageUrl).toBe(
      `https://voices.wawuafrica.com/api/v1/share/${l.code}/square`,
    );
    await h.cards.idle();
    const card = await get(`/share/${l.code}/card`).expect(200);
    expect(pngSize(card.body)).toEqual({ w: 1200, h: 630 });
    const story = await get(`/share/${l.code}/story`).expect(200);
    expect(pngSize(story.body)).toEqual({ w: 1080, h: 1920 });
    const square = await get(`/share/${l.code}/square`).expect(200);
    expect(pngSize(square.body)).toEqual({ w: 1080, h: 1080 });
    save("mood-card", card.body);
    save("mood-story", story.body);
    save("mood-square", square.body);
    // the second ask is cached: no new draw
    const before = h.renders.count;
    await get(`/share/${l.code}/card`).expect(200);
    expect(h.renders.count).toBe(before);
  });

  it("serves the square for a mood card only", async () => {
    const w = await world();
    const plain = await h.prisma.answer.create({
      data: {
        questionId: w.q.id,
        authorId: (await mkUser(h)).id,
        kind: "TEXT",
        body: "A plain one.",
      },
    });
    const pq = await h.prisma.question.create({
      data: { text: "Plain?", status: "LIVE" },
    });
    await h.prisma.answer.update({
      where: { id: plain.id },
      data: { questionId: pq.id },
    });
    const l = (await link(plain.id).expect(201)).body;
    expect(l.squareImageUrl).toBeNull();
    await get(`/share/${l.code}/square`).expect(404);
  });

  it("never serves a deleted account's card, in any size", async () => {
    const w = await world({ name: true, others: 3 });
    const l = (await link(w.a.id).expect(201)).body;
    await h.cards.idle();
    await get(`/share/${l.code}/card`).expect(200);
    await get(`/share/${l.code}/story`).expect(200);
    await get(`/share/${l.code}/square`).expect(200);
    await h.prisma.user.update({
      where: { id: w.author.id },
      data: { status: "DELETED" },
    });
    await get(`/share/${l.code}/card`).expect(404);
    await get(`/share/${l.code}/story`).expect(404);
    await get(`/share/${l.code}/square`).expect(404);
    await get(`/share/${l.code}`).expect(404);
    // a person who asked to be deleted is gone from cards at once too
    const w2 = await world({ others: 1 });
    const l2 = (await link(w2.a.id).expect(201)).body;
    await h.prisma.user.update({
      where: { id: w2.author.id },
      data: { status: "DELETION_PENDING", deletionRequestedAt: new Date() },
    });
    await get(`/share/${l2.code}/square`).expect(404);
  });
});
