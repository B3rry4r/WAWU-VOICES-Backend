import { cardSpecFor } from "../../src/reach/share.service";
import type { Subject } from "../../src/reach/share-subject";
import {
  ResvgCardRenderer,
  fitHeadline,
  wrapText,
  type CardSpec,
} from "../../src/reach/card-renderer";

describe("B-M2: the question card never cuts a word", () => {
  const q =
    "Or are you just going to wait for somebody else to fix it for the whole street?";
  it("an ellipsis comes after a whole word, never inside one", () => {
    for (let width = 300; width <= 900; width += 7) {
      for (const lines of [1, 2, 3]) {
        const out = wrapText(q, "bagel", 60, width, lines, -0.6);
        const last = out[out.length - 1];
        if (!last.endsWith("...")) continue;
        const kept = last.slice(0, -3);
        const words = new Set(q.split(" "));
        const lastWord = kept.split(" ").pop() as string;
        expect(words.has(lastWord.replace(/[.,;:!?]+$/, ""))).toBe(true);
      }
    }
  });
  it("nothing is cut when it fits, and a single huge word is still split to fit", () => {
    expect(wrapText("Short one", "bagel", 60, 900, 3)).toEqual(["Short one"]);
    const out = wrapText("W".repeat(80), "bagel", 60, 400, 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });
});

describe("B-M2: fitHeadline shrinks before it cuts", () => {
  const long =
    "Or are you just going to wait for somebody else to fix the road for the whole street?";
  it("fits a long question whole by shrinking, with no ellipsis", () => {
    const f = fitHeadline(long, "bagel", {
      px: 60,
      lh: 64,
      width: 17 * 36,
      room: 3 * 64,
      maxLines: 3,
      minPx: 34,
    });
    expect(f.lines.join(" ")).toBe(long);
    expect(f.px).toBeLessThan(60);
    expect(f.lines.length).toBeLessThanOrEqual(3);
  });
  it("a short question keeps the full size", () => {
    const f = fitHeadline("Is it safe?", "bagel", {
      px: 60,
      lh: 64,
      width: 17 * 36,
      room: 3 * 64,
      maxLines: 3,
      minPx: 34,
    });
    expect(f.px).toBe(60);
  });
  it("only when nothing fits at the smallest size does an ellipsis come, and then after a whole word", () => {
    const huge = long.repeat(6);
    const f = fitHeadline(huge, "bagel", {
      px: 60,
      lh: 64,
      width: 17 * 36,
      room: 3 * 64,
      maxLines: 3,
      minPx: 34,
    });
    const last = f.lines[f.lines.length - 1];
    expect(last.endsWith("...")).toBe(true);
    const lastWord = last.slice(0, -3).split(" ").pop() as string;
    expect(huge.split(" ")).toContain(lastWord);
  });
});

describe("a profile card has no split line", () => {
  const spec = (over: Partial<CardSpec>): CardSpec => ({
    kind: "plain",
    label: "Nigeria · A voice",
    headline: "@ada.o on VOICES",
    args: [],
    rows: [],
    pollOpen: false,
    quote: null,
    summary: null,
    basedOnVoices: 2,
    updated: "6 Nov",
    newsTag: null,
    fallback: false,
    url: "usevoices.com",
    ...over,
  });
  it("plain cards never say 'People are split so far.'; a poll card with no summary still does", () => {
    const r = new ResvgCardRenderer();
    for (const svg of [r.svg(spec({})), r.storySvg(spec({}))])
      expect(svg).not.toContain("split so far");
    expect(r.svg(spec({ kind: "poll" }))).toContain("People are split so far.");
    expect(r.storySvg(spec({ kind: "poll" }))).toContain(
      "People are split so far.",
    );
  });
});

describe("WF-5: no votes, no split line and no leader, on any card", () => {
  const spec = (over: Partial<CardSpec>): CardSpec => ({
    kind: "question",
    label: "Nigeria · Today’s question",
    headline: "Should fuel cost less?",
    args: [],
    rows: [],
    pollOpen: false,
    quote: null,
    summary: null,
    basedOnVoices: 0,
    updated: "6 Nov",
    newsTag: null,
    fallback: false,
    url: "usevoices.com",
    ...over,
  });
  const r = new ResvgCardRenderer();
  it("a question card with 0 votes has no split line; with votes it has one", () => {
    for (const draw of [
      (s: CardSpec) => r.svg(s),
      (s: CardSpec) => r.storySvg(s),
    ]) {
      expect(draw(spec({ votes: 0 }))).not.toContain("split so far");
      expect(draw(spec({ votes: 7 }))).toContain("People are split so far.");
      // an editor's summary is still shown
      expect(draw(spec({ votes: 0, summary: "Prices hurt." }))).toContain(
        "Prices hurt.",
      );
    }
  });
  it("an open poll with 0 votes names no leader", () => {
    const rows = [
      { label: "Yes", pct: 0 },
      { label: "No", pct: 0 },
    ];
    for (const draw of [
      (s: CardSpec) => r.svg(s),
      (s: CardSpec) => r.storySvg(s),
    ]) {
      const none = draw(spec({ kind: "poll", pollOpen: true, rows, votes: 0 }));
      expect(none).not.toContain("so far");
      const some = draw(
        spec({
          kind: "poll",
          pollOpen: true,
          votes: 4,
          rows: [
            { label: "Yes", pct: 75 },
            { label: "No", pct: 25 },
          ],
        }),
      );
      expect(some).toContain("75% so far");
    }
  });
});

describe("WF-5: the card spec carries the vote count the split line depends on", () => {
  const subject = (poll: unknown): Subject =>
    ({
      topicLine: "Should fuel cost less?",
      cardLabel: "Today’s question",
      cardHeadline: null,
      arguments: [],
      cardRows: [],
      cardSummary: null,
      cardVoices: 2,
      pollOpen: false,
      quote: null,
      summaryUpdatedAt: new Date("2026-11-06T10:00:00Z"),
      newsTagKey: null,
      fallback: false,
      poll,
    }) as unknown as Subject;
  it("a question whose poll has no votes: votes 0, so no split line is drawn", () => {
    const spec = cardSpecFor("QUESTION", subject({ totalVotes: 0 }));
    expect(spec.votes).toBe(0);
    expect(new ResvgCardRenderer().svg(spec)).not.toContain("split so far");
    expect(cardSpecFor("QUESTION", subject({ totalVotes: 5 })).votes).toBe(5);
    expect(cardSpecFor("QUESTION", subject(null)).votes).toBe(0);
  });
});
