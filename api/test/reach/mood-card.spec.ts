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

  it("G7: name on, the link line reads usevoices.com/go/<code>; name off or anonymous, usevoices.com/go with no code; all three sizes", async () => {
    const w = await world();
    const sizes = ["card", "square", "story"] as const;
    // name off (the default): no code, because the code leads to the person's handle
    const off = await spec(w.a.id);
    expect(off?.mood?.inviteCode).toBeNull();
    for (const size of sizes) {
      const svg = moodCardSvg(off!, size, "", "");
      expect(svg).toContain("usevoices.com/go<");
      expect(svg).not.toContain("/go/");
    }
    await h.prisma.answer.update({
      where: { id: w.a.id },
      data: { showNameOnCard: true },
    });
    const on = await spec(w.a.id);
    const code = (
      await h.prisma.invite.findUniqueOrThrow({
        where: { userId: w.author.id },
      })
    ).code;
    expect(on?.mood?.inviteCode).toBe(code);
    for (const size of sizes)
      expect(moodCardSvg(on!, size, "", "")).toContain(
        `usevoices.com/go/${code}`,
      );
    await h.prisma.answer.update({
      where: { id: w.a.id },
      data: { anonymous: true },
    });
    const anon = await spec(w.a.id);
    expect(anon?.mood?.inviteCode).toBeNull();
    for (const size of sizes)
      expect(moodCardSvg(anon!, size, "", "")).not.toContain("/go/");
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
      `https://usevoices.com/api/v1/share/${l.code}/square`,
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

  it("turning the name off drops the stored card at once, with no new share link (LCH-03)", async () => {
    const w = await world({ name: true, others: 3 });
    const l = (await link(w.a.id).expect(201)).body;
    await h.cards.idle();
    const named = await get(`/share/${l.code}/card`).expect(200);
    expect(named.headers["cache-control"]).toBe("no-cache");
    const storedKey = [...h.store.objects.keys()].find((k) =>
      k.startsWith(`share/${l.code}/`),
    );
    expect(storedKey).toBeTruthy();
    const namedBytes = Buffer.from(named.body);

    await h
      .http()
      .patch(`/api/v1/answers/${w.a.id}/card`)
      .set("Authorization", `Bearer ${h.tokenFor(w.author.wawuId)}`)
      .send({ showName: false })
      .expect(200);
    // no POST /share/links here: the next ask for the card must be the unnamed one
    const first = await get(`/share/${l.code}/card`);
    expect([200, 202]).toContain(first.status);
    await h.cards.idle();
    const plain = await get(`/share/${l.code}/card`).expect(200);
    expect(Buffer.from(plain.body).equals(namedBytes)).toBe(false);
    const row = await h.prisma.storedFile.findFirstOrThrow({
      where: { key: storedKey! },
    });
    expect(row.purgeRequestedAt).not.toBeNull(); // the named picture is marked for deletion
    // the drawn bytes are the unnamed card: the same spec drawn with no name
    const unnamed = await spec(w.a.id);
    expect(unnamed?.mood?.name).toBeNull();
    const again = await get(`/share/${l.code}/story`).expect(200);
    expect(again.body.length).toBeGreaterThan(1000);
  });

  it("a draw already running when the name is turned off is not stored: the stored and served card are unnamed (LCH-03)", async () => {
    const w = await world({ name: true, others: 3 });
    // hold the draw inside the renderer, after it read the answer with the name on
    const r = (
      h.cards as unknown as {
        renderer: { render: (...a: unknown[]) => Promise<Buffer> };
      }
    ).renderer;
    const real = r.render.bind(r);
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    let entered!: () => void;
    const inside = new Promise<void>((ok) => (entered = ok));
    let held = 0;
    r.render = async (...a: unknown[]) => {
      const png = await real(...a);
      if (held++ === 0) {
        entered();
        await gate;
      }
      return png;
    };
    try {
      const l = (await link(w.a.id).expect(201)).body;
      await inside; // the first draw holds a NAMED card
      await h
        .http()
        .patch(`/api/v1/answers/${w.a.id}/card`)
        .set("Authorization", `Bearer ${h.tokenFor(w.author.wawuId)}`)
        .send({ showName: false })
        .expect(200);
      release();
      await h.cards.idle();
      const served = await get(`/share/${l.code}/card`).expect(200);
      const unnamedSpec = await spec(w.a.id);
      expect(unnamedSpec?.mood?.name).toBeNull();
      const unnamed = await real(unnamedSpec);
      expect(Buffer.from(served.body).equals(unnamed)).toBe(true);
      // every picture still stored under this link, other than the unnamed one, is marked for deletion
      const files = await h.prisma.storedFile.findMany({
        where: { key: { startsWith: `share/${l.code}/` } },
      });
      const live = files.filter((f) => !f.purgeRequestedAt);
      expect(live).toHaveLength(1);
      expect(
        Buffer.from(h.store.objects.get(live[0].key)!).equals(unnamed),
      ).toBe(true);
    } finally {
      r.render = real;
      release();
    }
  });

  it("serves the square for a plain answer too (V-FIX-D: every kind, brief 6.8)", async () => {
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
    expect(l.squareImageUrl).toBe(
      `https://usevoices.com/api/v1/share/${l.code}/square`,
    );
    const sq = await get(`/share/${l.code}/square`).expect(200);
    expect(pngSize(sq.body)).toEqual({ w: 1080, h: 1080 });
    // an unknown link is still a 404
    await get(`/share/zzzzzzz/square`).expect(404);
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
