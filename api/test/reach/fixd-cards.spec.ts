/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  Harness,
  mkTopic,
  mkUser,
  pngSize,
  resetDb,
  startHarness,
} from "./helpers";
import { ResvgCardRenderer } from "../../src/reach/card-renderer";
import { loadSubject } from "../../src/reach/share-subject";
import { cardSpecFor } from "../../src/reach/share.service";
import { ensureInviteCode } from "../../src/me/invite-code";
import { MoodStatsService } from "../../src/mood/mood-stats.service";
import {
  DRAW_QUEUE_MAX,
  DRAW_SLOTS,
  DrawGate,
} from "../../src/reach/share.service";
import {
  DRAW_PER_ADDRESS,
  DrawCounter,
  ShareController,
} from "../../src/reach/share.controller";
import { xmlSafe } from "../../src/reach/card-renderer";

const OUT = process.env.CARD_OUT;

/** V-FIX-D (brief 6.8): the story (1080 x 1920) and the square (1080 x 1080) for every kind of share, and no name or invite code on an anonymous voice in any size. */
describe("share cards in both sizes for every kind", () => {
  let h: Harness;
  let stats: MoodStatsService;
  const real = new ResvgCardRenderer();
  beforeAll(async () => {
    h = await startHarness();
    stats = h.app.get(MoodStatsService);
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    h.app.get(ShareController).draws.clear();
    await h.cards.idle();
    await resetDb();
    h.store.objects.clear();
  });

  async function world(over: { anonymous?: boolean; showName?: boolean } = {}) {
    const topic = await mkTopic(h, 1);
    const q = await h.prisma.question.create({
      data: {
        topicId: topic.id,
        status: "LIVE",
        text: "When salary arrives, how many hours pass before it disappears?",
      },
    });
    const author = await mkUser(h, { handle: "tunde.adeyemi", state: "Lagos" });
    await h.prisma.user.update({
      where: { id: author.id },
      data: { displayName: "Tunde Adeyemi" },
    });
    const a = await h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: author.id,
        kind: "TEXT",
        body: "By the third day I have paid rent and sent money home, and the rest is gone before the month turns.",
        anonymous: !!over.anonymous,
        showNameOnCard: !!over.showName,
      },
    });
    const code = await ensureInviteCode(h.prisma, author.id);
    return { topic, q, author, a, code };
  }
  const link = (objectType: string, objectId: string) =>
    h.http().post("/api/v1/share/links").send({ objectType, objectId });
  const get = (path: string) => h.http().get(`/api/v1${path}`);

  it("every object type that has a card offers the story and the square, and both draw at their size", async () => {
    const w = await world();
    const poll = await h.prisma.poll.create({
      data: {
        topicId: w.topic.id,
        title: "Do you save before you spend?",
        kind: "WEEKLY",
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        status: "OPEN",
        options: {
          create: [
            { label: "Yes", sortOrder: 0 },
            { label: "No", sortOrder: 1 },
            { label: "Sometimes", sortOrder: 2 },
          ],
        },
      },
    });
    const kinds: [string, string][] = [
      ["ANSWER", w.a.id],
      ["QUESTION", w.q.id],
      ["POLL_RESULT", poll.id],
      ["PROFILE", w.author.id],
    ];
    for (const [type, id] of kinds) {
      const l = (await link(type, id).expect(201)).body;
      expect(l.storyImageUrl).toContain(`/share/${l.code}/story`);
      expect(l.squareImageUrl).toContain(`/share/${l.code}/square`);
      const story = await get(`/share/${l.code}/story`).expect(200);
      const square = await get(`/share/${l.code}/square`).expect(200);
      expect(pngSize(story.body)).toEqual({ w: 1080, h: 1920 });
      expect(pngSize(square.body)).toEqual({ w: 1080, h: 1080 });
      if (OUT) {
        writeFileSync(`${OUT}/${type}-story.png`, story.body);
        writeFileSync(`${OUT}/${type}-square.png`, square.body);
      }
    }
  });

  it("the square draws for every card shape, long text included", async () => {
    const base = {
      kind: "plain" as const,
      label: "Nigeria · Money",
      headline:
        "A headline that is long enough to need three lines on a square card, with words to spare",
      args: [] as { text: string; voices: number }[],
      rows: [] as { label: string; pct: number }[],
      pollOpen: false,
      quote: null as string | null,
      summary: "People are split so far." as string | null,
      basedOnVoices: 120 as number | null,
      votes: 120,
      updated: "1h ago",
      newsTag: "unverified" as "unverified" | null,
      fallback: false,
      url: "usevoices.com",
    };
    const long = "word ".repeat(57).slice(0, 279) + ".";
    const specs = {
      question: {
        ...base,
        kind: "question" as const,
        args: [
          {
            text: "Pay on the last working day, and say so in the offer letter",
            voices: 2400,
          },
          { text: "Let staff take part of it every week", voices: 1800 },
          { text: "A third argument that the square leaves out", voices: 90 },
        ],
      },
      poll: {
        ...base,
        kind: "poll" as const,
        rows: [
          { label: "Yes", pct: 52 },
          { label: "No", pct: 30 },
          { label: "Sometimes", pct: 12 },
          { label: "A fourth that the square leaves out", pct: 6 },
        ],
      },
      voice: {
        ...base,
        kind: "voice" as const,
        quote: long,
        summary: "An anonymous voice",
      },
      voiceShort: {
        ...base,
        kind: "voice" as const,
        quote: "Short.",
        summary: "An anonymous voice",
      },
      weekly: {
        ...base,
        kind: "weekly" as const,
        rows: [
          { label: "Lagos", pct: 40 },
          { label: "Abuja", pct: 35 },
        ],
      },
      plain: base,
      fallback: { ...base, fallback: true },
    };
    for (const [name, spec] of Object.entries(specs)) {
      const png = await real.render(spec, "square");
      expect({ name, ...pngSize(png) }).toEqual({ name, w: 1080, h: 1080 });
      if (OUT) writeFileSync(`${OUT}/spec-${name}-square.png`, png);
    }
  });

  it("an anonymous voice carries no name, handle, place or invite code on the 1200x630 card, the story or the square", async () => {
    for (const showName of [false, true]) {
      await resetDb();
      const w = await world({ anonymous: true, showName });
      const s = await loadSubject(h.prisma, "ANSWER", w.a.id, stats);
      const spec = cardSpecFor("ANSWER", s!);
      expect(spec.summary).toBe("An anonymous voice");
      const svgs = [
        real.svg(spec),
        real.storySvg(spec, "story"),
        real.storySvg(spec, "square"),
      ];
      for (const svg of [JSON.stringify(spec), ...svgs]) {
        expect(svg).not.toMatch(/tunde|Tunde|Adeyemi|Lagos/);
        expect(svg).not.toContain(w.code);
      }
      // and over the wire, for all three routes
      const l = (await link("ANSWER", w.a.id).expect(201)).body;
      expect(JSON.stringify(l)).not.toContain(w.code);
      await h.cards.idle();
      for (const kind of ["card", "story", "square"])
        await get(`/share/${l.code}/${kind}`).expect(200);
    }
  });

  it("a named voice still says whose it is, so the anonymous test above is not passing by an empty card", async () => {
    const w = await world();
    const s = await loadSubject(h.prisma, "ANSWER", w.a.id, stats);
    const spec = cardSpecFor("ANSWER", s!);
    expect(spec.summary).toBe("A voice from @tunde.adeyemi");
    expect(real.storySvg(spec, "square")).toBeTruthy();
  });

  describe("one rule for all three sizes", () => {
    const sizes = ["card", "story", "square"] as const;
    const status = async (code: string) => {
      const out: Record<string, number> = {};
      for (const k of sizes) out[k] = (await get(`/share/${code}/${k}`)).status;
      return out;
    };
    async function healthy() {
      const w = await world();
      const l = (await link("ANSWER", w.a.id).expect(201)).body;
      await h.cards.idle();
      expect(await status(l.code)).toEqual({
        card: 200,
        story: 200,
        square: 200,
      });
      return { w, code: l.code as string };
    }
    const cases: [
      string,
      (w: Awaited<ReturnType<typeof world>>) => Promise<unknown>,
    ][] = [
      [
        "removed",
        (w) =>
          h.prisma.answer.update({
            where: { id: w.a.id },
            data: { status: "REMOVED" },
          }),
      ],
      [
        "deleted by the author",
        (w) =>
          h.prisma.answer.update({
            where: { id: w.a.id },
            data: { status: "DELETED_BY_AUTHOR", deletedAt: new Date() },
          }),
      ],
      [
        "held",
        (w) =>
          h.prisma.answer.update({
            where: { id: w.a.id },
            data: { status: "HELD" },
          }),
      ],
      [
        "author banned",
        (w) =>
          h.prisma.user.update({
            where: { id: w.author.id },
            data: { status: "BANNED" },
          }),
      ],
      [
        "author suspended",
        (w) =>
          h.prisma.user.update({
            where: { id: w.author.id },
            data: { status: "SUSPENDED" },
          }),
      ],
      [
        "author waiting for deletion",
        (w) =>
          h.prisma.user.update({
            where: { id: w.author.id },
            data: {
              status: "DELETION_PENDING",
              deletionRequestedAt: new Date(),
            },
          }),
      ],
      [
        "author deleted",
        (w) =>
          h.prisma.user.update({
            where: { id: w.author.id },
            data: { status: "DELETED" },
          }),
      ],
      [
        "question not opened yet (scheduled in the future)",
        (w) =>
          h.prisma.question.update({
            where: { id: w.q.id },
            data: {
              status: "SCHEDULED",
              startsAt: new Date(Date.now() + 86_400_000),
            },
          }),
      ],
      [
        "question is a draft",
        (w) =>
          h.prisma.question.update({
            where: { id: w.q.id },
            data: { status: "DRAFT" },
          }),
      ],
    ];
    for (const [name, change] of cases)
      it(`${name}: no card in any size`, async () => {
        const { w, code } = await healthy();
        await change(w);
        expect(await status(code)).toEqual({
          card: 404,
          story: 404,
          square: 404,
        });
      });

    it("a question that has closed keeps its cards (shares stay open after the window)", async () => {
      const { w, code } = await healthy();
      await h.prisma.question.update({
        where: { id: w.q.id },
        data: { status: "CLOSED" },
      });
      expect(await status(code)).toEqual({
        card: 200,
        story: 200,
        square: 200,
      });
    });

    it("a question that has not opened gets no link and no card at all (its own card and an answer's follow the same window)", async () => {
      const w = await world();
      await h.prisma.question.update({
        where: { id: w.q.id },
        data: {
          status: "SCHEDULED",
          startsAt: new Date(Date.now() + 86_400_000),
        },
      });
      await link("QUESTION", w.q.id).expect(404);
    });
  });

  describe("a burst cannot make the server draw without limit", () => {
    it(`at most ${DRAW_SLOTS} draw at once and ${DRAW_QUEUE_MAX} wait; the next is refused with 503`, async () => {
      const gate = new DrawGate();
      let active = 0;
      let peak = 0;
      const release: (() => void)[] = [];
      const job = () =>
        gate.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise<void>((ok) => release.push(ok));
          active--;
        });
      const all = Array.from({ length: DRAW_SLOTS + DRAW_QUEUE_MAX }, job);
      await new Promise((r) => setImmediate(r));
      expect(active).toBe(DRAW_SLOTS);
      await expect(job()).rejects.toMatchObject({ status: 503 });
      while (release.length || active) {
        release.shift()?.();
        await new Promise((r) => setImmediate(r));
      }
      await Promise.all(all);
      expect(peak).toBe(DRAW_SLOTS);
    });

    it(`one address gets ${DRAW_PER_ADDRESS} story and square requests a minute together, counted before any draw`, () => {
      const t = 1_000_000;
      const c = new DrawCounter();
      for (let i = 0; i < DRAW_PER_ADDRESS; i++) c.count("10.0.0.9", t);
      expect(() => c.count("10.0.0.9", t + 1)).toThrow();
      expect(() => c.count("10.0.0.10", t + 1)).not.toThrow();
      expect(() => c.count("10.0.0.9", t + 61_000)).not.toThrow();
    });

    it("over the wire the story and the square share the one count", async () => {
      const w = await world();
      const l = (await link("ANSWER", w.a.id).expect(201)).body;
      let refused = 0;
      for (let i = 0; i < DRAW_PER_ADDRESS + 6; i++) {
        const r = await get(`/share/${l.code}/${i % 2 ? "story" : "square"}`);
        if (r.status === 429) refused++;
      }
      expect(refused).toBeGreaterThanOrEqual(1);
    });
  });

  describe("a control character in a post", () => {
    it("is dropped before drawing: the card is made in every size, and a FAILED card is drawn again", async () => {
      expect(xmlSafe("a\u0007b\u001bc\u0000d\ufffee")).toBe("abcde");
      expect(xmlSafe("Ada \u{1F600} \n\t ok")).toBe("Ada \u{1F600} \n\t ok");
      const w = await world();
      await h.prisma.answer.update({
        where: { id: w.a.id },
        data: { body: "Salary\u0007 day\u001b is short." },
      });
      const l = (await link("ANSWER", w.a.id).expect(201)).body;
      await h.cards.idle();
      for (const k of ["card", "story", "square"])
        await get(`/share/${l.code}/${k}`).expect(200);
      // a card that failed earlier (before the fix) is drawn again when the link is made again
      await h.prisma.shareCard.updateMany({
        where: { link: { code: l.code } },
        data: { status: "FAILED", failureReason: "a non-XML character" },
      });
      await get(`/share/${l.code}/card`).expect(404);
      await link("ANSWER", w.a.id).expect(201);
      await h.cards.idle();
      await get(`/share/${l.code}/card`).expect(200);
    });
  });
});
