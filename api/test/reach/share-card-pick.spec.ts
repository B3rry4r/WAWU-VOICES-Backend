/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { createHash } from "node:crypto";
import {
  ResvgCardRenderer,
  textWidth,
  type CardSpec,
} from "../../src/reach/card-renderer";
import { cardSpecFor } from "../../src/reach/share.service";
import { ConfigReader } from "../../src/talk/shared/config-reader";
import type { Subject } from "../../src/reach/share-subject";
import { Harness, mkTopic, resetDb, startHarness } from "./helpers";

const sha = (b: Buffer | string) => createHash("sha1").update(b).digest("hex");
const base: CardSpec = {
  kind: "question",
  label: "Nigeria · Today’s question",
  headline: "How do you feel about Nigeria today?",
  args: [],
  rows: [],
  pollOpen: false,
  quote: null,
  summary: null,
  basedOnVoices: null,
  updated: "14 Nov 2026",
  newsTag: null,
  fallback: false,
  url: "usevoices.com",
};
const pickSpec = (
  headline: string,
  hint: string | null,
  words: string[],
  seconds = 60,
): CardSpec => ({ ...base, headline, pick: { hint, words, seconds } });
const FOUR = ["ANGRY", "TIRED", "PROUD", "HOPEFUL"];

/** The words of every <text> in the drawing. */
const texts = (svg: string) =>
  [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
/** The headline lines: Bagel Fat One text, with their size. */
const headline = (svg: string) =>
  [
    ...svg.matchAll(
      /<text [^>]*font-family="Bagel Fat One"[^>]*font-size="(\d+)"[^>]*>([^<]*)<\/text>/g,
    ),
  ].map((m) => ({ px: Number(m[1]), line: m[2] }));

describe("V-SHARE-CARD: the question card is the pick-one-word screen", () => {
  const r = new ResvgCardRenderer();

  it("four words: the question, small line, label, each word, the green line and the button with the configured seconds", () => {
    const svg = r.pickSvg(
      pickSpec(
        "How do you feel about Nigeria today?",
        "One word is enough.",
        FOUR,
        45,
      ),
    );
    const t = texts(svg);
    expect(t).toEqual(
      expect.arrayContaining([
        "NIGERIA'S NATIONAL CONVERSATION",
        "How do you feel about Nigeria today?",
        "One word is enough.",
        "Pick one word",
        ...FOUR,
        "Say it in 45 seconds",
      ]),
    );
    expect(svg).toContain('width="1200" height="630"');
    // two rows of two: two distinct tile rows
    const ys = new Set(
      [...svg.matchAll(/<rect x="\d+" y="(\d+)" width="530"/g)].map(
        (m) => m[1],
      ),
    );
    expect(ys.size).toBe(2);
    // each word on its own colour, in the word's light tint
    expect(svg).toContain('fill="#ff9b92"');
    expect(svg).toContain('fill="#9cc8ff"');
    // nothing about a number of voices or a date
    expect(t.join(" ")).not.toMatch(/voices|\d{4}|Nov/i);
    expect(svg).toContain("<image"); // the VOICES mark
  });

  it("the button reads the seconds it is given (one second is singular)", () => {
    expect(texts(r.pickSvg(pickSpec("Q?", null, FOUR, 90)))).toContain(
      "Say it in 90 seconds",
    );
    expect(texts(r.pickSvg(pickSpec("Q?", null, FOUR, 1)))).toContain(
      "Say it in 1 second",
    );
  });

  it("no words: no label and no tiles, the same card otherwise", () => {
    const svg = r.pickSvg(pickSpec("What would you fix?", "Say it.", []));
    const t = texts(svg);
    expect(t).not.toContain("Pick one word");
    expect(svg).not.toContain('width="530"');
    expect(t).toEqual(
      expect.arrayContaining([
        "What would you fix?",
        "Say it.",
        "Say it in 60 seconds",
      ]),
    );
  });

  it("two words: one row of two tiles", () => {
    const svg = r.pickSvg(pickSpec("Q?", null, ["TIRED", "HOPEFUL"]));
    expect(texts(svg)).toEqual(expect.arrayContaining(["TIRED", "HOPEFUL"]));
    expect(
      new Set(
        [...svg.matchAll(/<rect x="\d+" y="(\d+)" width="530"/g)].map(
          (m) => m[1],
        ),
      ).size,
    ).toBe(1);
  });

  it("a very long question stays inside the frame: at most three lines, shrunk, no word cut, nothing past the tiles", () => {
    const long =
      "When the lights go out for the third night this week in your street, your market and your office, who do you really think should answer for it, and what would you say to them?";
    expect(long.length).toBeGreaterThan(170);
    const svg = r.pickSvg(pickSpec(long, "Think about the last week.", FOUR));
    const lines = headline(svg);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0].px).toBeLessThan(64);
    expect(lines.map((l) => l.line).join(" ")).toBe(long);
    for (const l of lines)
      expect(
        textWidth(l.line, "bagel", l.px, -0.01 * l.px),
      ).toBeLessThanOrEqual(1072);
    // the last headline line ends above the label of the tiles
    const label = svg.match(/y="([\d.]+)"[^>]*>Pick one word</);
    const lastY = Math.max(
      ...[...svg.matchAll(/<text [^>]*y="([\d.]+)"[^>]*Bagel Fat One/g)].map(
        (m) => Number(m[1]),
      ),
    );
    expect(lastY).toBeLessThan(Number(label?.[1]));
  });

  it("renders a real 1200 x 630 picture", async () => {
    const png = await r.render(pickSpec("Q?", "Small.", FOUR));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  it("other cards are drawn exactly as on main (same drawing and same bytes for a voice and a poll card)", async () => {
    const voice: CardSpec = {
      ...base,
      kind: "voice",
      label: "Nigeria · A voice",
      quote: "I wake up tired but I still go out and try again.",
      summary: "A voice from Lagos",
    };
    const poll: CardSpec = {
      ...base,
      kind: "poll",
      label: "Nigeria · A voice",
      rows: [
        { label: "Yes", pct: 60 },
        { label: "No", pct: 40 },
      ],
      pollOpen: true,
      votes: 10,
      basedOnVoices: 10,
    };
    // hashes taken from origin/main's renderer for these same inputs
    expect(sha(r.svg(voice))).toBe("c6fa49eb3686a79f3ae5de1c021e0714745d3bd0");
    expect(sha(await r.render(voice))).toBe(
      "1cdaee6dff08794a78c01514872dbafa4b62bb13",
    );
    expect(sha(r.svg(poll))).toBe("f812e4d046c6864d27dbd59b123ef2acf2f76b49");
    expect(sha(await r.render(poll))).toBe(
      "ca14b6ade4f6aa7d2c9a1044c6417636311ec338",
    );
  });
});

describe("V-SHARE-CARD: what the spec takes from the question", () => {
  const subject = (over: Partial<Subject> = {}): Subject =>
    ({
      topicLine: "How do you feel?",
      countryAndTheme: "Nigeria",
      arguments: [],
      leanLine: null,
      cardLabel: "Today’s question",
      cardHeadline: null,
      cardRows: [],
      cardSummary: null,
      pollOpen: false,
      cardVoices: 3,
      newsTagKey: null,
      fallback: false,
      summaryUpdatedAt: new Date("2026-11-14T00:00:00Z"),
      poll: null,
      question: {
        hint: "A small line",
        moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
      },
      ...over,
    }) as unknown as Subject;

  it("words, order, small line and seconds come from the question and the setting", () => {
    const s = cardSpecFor("QUESTION", subject(), 60);
    expect(s.pick).toEqual({ hint: "A small line", words: FOUR, seconds: 60 });
  });
  it("a question that has not opened keeps the coming-up card", () => {
    const s = cardSpecFor(
      "QUESTION",
      subject({ comingUp: "Opens Sunday 15 November" }),
      60,
    );
    expect(s.pick).toBeUndefined();
  });
  it("an answer, a poll and a report get no pick layout", () => {
    expect(cardSpecFor("ANSWER", subject(), 60).pick).toBeUndefined();
    expect(cardSpecFor("POLL_RESULT", subject(), 60).pick).toBeUndefined();
  });
});

describe("V-SHARE-CARD: page text and links made before this change", () => {
  let h: Harness;
  let qid: string;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.cards.idle();
    await resetDb();
    h.store.objects.clear();
    h.renders.count = 0;
    const topic = await mkTopic(h, 1);
    const q = await h.prisma.question.create({
      data: {
        topicId: topic.id,
        kind: "DAILY",
        status: "LIVE",
        isSpare: false,
        text: "How do you feel about Nigeria today?",
        hint: "One word is enough.",
        moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
        scheduledFor: new Date(),
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 3600_000 * 20),
      },
    });
    qid = q.id;
  });

  const make = async () => {
    const res = await h
      .http()
      .post("/api/v1/share/links")
      .send({ objectType: "QUESTION", objectId: qid })
      .expect(201);
    await h.cards.idle();
    return res.body.code as string;
  };
  const card = (code: string) => h.http().get(`/api/v1/share/${code}/card`);

  it("the page title is the question and the description is built from its words", async () => {
    const code = await make();
    const p = (await h.http().get(`/api/v1/share/${code}`).expect(200)).body;
    expect(p.openGraph.title).toBe("How do you feel about Nigeria today?");
    expect(p.openGraph.description).toBe(
      "Pick one word: Angry, Tired, Proud, Hopeful. Say it in your voice.",
    );
    expect(p.openGraph.description).not.toMatch(/[—–]/);
    await h.prisma.question.update({
      where: { id: qid },
      data: { moodOptions: [] },
    });
    const q = (await h.http().get(`/api/v1/share/${code}`).expect(200)).body;
    expect(q.openGraph.description).toBe("Say it in your voice.");
  });

  it("the card is drawn with the seconds the app reads (voice.free_seconds)", async () => {
    await h.prisma.configEntry.upsert({
      where: { key: "voice.free_seconds" },
      update: { valueJson: 45 },
      create: { key: "voice.free_seconds", valueJson: 45 },
    });
    h.app.get(ConfigReader).invalidate();
    const seen: CardSpec[] = [];
    const renderer = (
      h.cards as unknown as {
        renderer: { render: (s: CardSpec, z?: string) => Promise<Buffer> };
      }
    ).renderer;
    const orig = renderer.render;
    renderer.render = (s: CardSpec, size?: string) => {
      seen.push(s);
      return orig(s, size);
    };
    try {
      await make();
    } finally {
      renderer.render = orig;
      await h.prisma.configEntry.deleteMany({
        where: { key: "voice.free_seconds" },
      });
      h.app.get(ConfigReader).invalidate();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].pick).toEqual({
      hint: "One word is enough.",
      words: FOUR,
      seconds: 45,
    });
  });

  it("a link made before this change gets the new layout on its next request, drawn once for many at the same time", async () => {
    const code = await make();
    // Make it an old link: the stored picture is the old layout, under a key with no pick mark.
    const link = await h.prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    const file = await h.prisma.storedFile.findFirstOrThrow({
      where: { id: link.storyFileId as string },
    });
    const oldPng = await new ResvgCardRenderer().render({
      ...base,
      kind: "question",
      headline: "old",
    });
    const oldKey = `share/${code}/card-000000000000.png`;
    h.store.objects.delete(file.key);
    h.store.objects.set(oldKey, oldPng);
    await h.prisma.storedFile.update({
      where: { id: file.id },
      data: { key: oldKey },
    });
    h.renders.count = 0;

    const rs = await Promise.all(Array.from({ length: 30 }, () => card(code)));
    expect(rs.every((x) => x.status === 200)).toBe(true);
    expect(h.renders.count).toBe(1);
    const fresh = await card(code).expect(200);
    expect(sha(fresh.body as Buffer)).not.toBe(sha(oldPng));
    for (const x of rs)
      expect([sha(oldPng), sha(fresh.body as Buffer)]).toContain(
        sha(x.body as Buffer),
      );
    // and again: the stored one, no more draws
    for (let i = 0; i < 5; i++) await card(code).expect(200);
    expect(h.renders.count).toBe(1);
    const now = await h.prisma.storedFile.findFirstOrThrow({
      where: {
        key: { startsWith: `share/${code}/card-q2` },
        purgedAt: null,
        purgeRequestedAt: null,
      },
    });
    expect(now.key).toMatch(/card-q2[0-9a-f]{10}\.png$/);
    expect(fresh.headers["cache-control"]).toBe("public, max-age=3600");
  }, 60_000);
});
