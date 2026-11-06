import {
  ResvgCardRenderer,
  type CardSpec,
} from "../../src/reach/card-renderer";

/** WF-7a: a poll card says "Based on N votes" (RX5, as the /s page does); a question card keeps "voices". */
describe("the card footer counts what the card is about", () => {
  const spec = (over: Partial<CardSpec>): CardSpec => ({
    kind: "poll",
    label: "Week 1 poll",
    headline: "What would make you feel truly fine again?",
    args: [],
    rows: [
      { label: "Stable power", pct: 46 },
      { label: "A proper job", pct: 54 },
    ],
    pollOpen: true,
    quote: null,
    summary: null,
    basedOnVoices: 89,
    votes: 89,
    updated: "6 Nov",
    newsTag: null,
    fallback: false,
    url: "voices.wawuafrica.com",
    ...over,
  });
  const r = new ResvgCardRenderer();

  it("a poll card reads votes on the card and the story", () => {
    for (const svg of [r.svg(spec({})), r.storySvg(spec({}))]) {
      expect(svg).toContain("Based on 89 votes");
      expect(svg).not.toContain("Based on 89 voices");
    }
  });
  it("one vote is singular", () => {
    expect(r.svg(spec({ basedOnVoices: 1, votes: 1 }))).toContain(
      "Based on 1 vote ",
    );
  });
  it("a question card still reads voices", () => {
    const q = spec({ kind: "question", rows: [], basedOnVoices: 12 });
    expect(r.svg(q)).toContain("Based on 12 voices");
    expect(r.storySvg(q)).toContain("Based on 12 voices");
    expect(r.svg({ ...q, basedOnVoices: 1 })).toContain("Based on 1 voice ");
  });
});
