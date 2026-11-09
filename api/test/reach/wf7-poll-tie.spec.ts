/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { mkdirSync, writeFileSync } from "node:fs";
import { Harness, mkTopic, pngSize, resetDb, startHarness } from "./helpers";
import { ResvgCardRenderer, tied } from "../../src/reach/card-renderer";

const OUT =
  process.env.CARD_OUT ??
  "/tmp/claude-0/-home-user/f6abda14-ea52-5aeb-b102-78d31cb7857d/scratchpad/voices-build/shots/wf-7a";

/** WF-7a: a poll that is tied names no leader ("Tied so far."); a poll with no votes has no split line. */
describe("poll share card on a tie and on no votes", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    mkdirSync(OUT, { recursive: true });
  });
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.cards.idle();
    await resetDb();
  });

  async function poll(counts: number[]) {
    const topic = await mkTopic(h, 1);
    const p = await h.prisma.poll.create({
      data: {
        topicId: topic.id,
        kind: "WEEKLY",
        title: "What would make you feel truly fine again?",
        status: "OPEN",
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        options: {
          create: counts.map((c, i) => ({
            label: ["Stable power", "A proper job", "Safety"][i],
            sortOrder: i,
            voteCount: c,
          })),
        },
      },
    });
    const { code } = (
      await h
        .http()
        .post("/api/v1/share/links")
        .send({ objectType: "POLL_RESULT", objectId: p.id })
        .expect(201)
    ).body;
    return code as string;
  }

  it("2-2: the page and the card say Tied so far, and no option is called ahead or leading", async () => {
    const code = await poll([2, 2]);
    const page = (await h.http().get(`/api/v1/share/${code}`).expect(200)).body;
    expect(page.leanLine).toBe("Tied so far.");
    expect(page.openGraph.description).toBe("Tied so far.");
    await h.cards.idle();
    const png = (await h.http().get(`/api/v1/share/${code}/card`).expect(200))
      .body;
    expect(pngSize(png)).toEqual({ w: 1200, h: 630 });
    writeFileSync(`${OUT}/poll-tied-2-2.png`, png);
    const sc = await h.prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    expect(sc.leanLine).toBe("Tied so far.");
  });

  it("0 votes: no split line, no leader", async () => {
    const code = await poll([0, 0]);
    const page = (await h.http().get(`/api/v1/share/${code}`).expect(200)).body;
    expect(page.leanLine).toBeNull();
    await h.cards.idle();
    const png = (await h.http().get(`/api/v1/share/${code}/card`).expect(200))
      .body;
    writeFileSync(`${OUT}/poll-0-votes.png`, png);
  });

  it("a clear lead still says who is ahead", async () => {
    const code = await poll([5, 1]);
    const page = (await h.http().get(`/api/v1/share/${code}`).expect(200)).body;
    expect(page.leanLine).toBe("So far, Stable power is ahead.");
  });

  it("the drawing: a tie has no 'so far' on a row and says Tied so far.; a lead keeps it", () => {
    const r = new ResvgCardRenderer();
    const base = {
      kind: "poll" as const,
      label: "Week 1 poll",
      headline: "Q?",
      args: [],
      pollOpen: true,
      quote: null,
      summary: null,
      basedOnVoices: 4,
      votes: 4,
      updated: "6 Nov",
      newsTag: null,
      fallback: false,
      url: "usevoices.com",
    };
    const tie = {
      ...base,
      rows: [
        { label: "A", pct: 50 },
        { label: "B", pct: 50 },
      ],
    };
    const lead = {
      ...base,
      rows: [
        { label: "A", pct: 75 },
        { label: "B", pct: 25 },
      ],
    };
    expect(tied(tie.rows)).toBe(true);
    expect(tied(lead.rows)).toBe(false);
    for (const svg of [r.svg(tie), r.storySvg(tie)]) {
      expect(svg).toContain("Tied so far.");
      expect(svg).not.toContain("50% so far");
      expect(svg).not.toContain("split so far");
    }
    expect(r.svg(lead)).toContain("75% so far");
    expect(
      r.svg({
        ...tie,
        rows: [
          { label: "A", pct: 0 },
          { label: "B", pct: 0 },
        ],
        votes: 0,
        basedOnVoices: 0,
      }),
    ).not.toContain("Tied");
  });
});
