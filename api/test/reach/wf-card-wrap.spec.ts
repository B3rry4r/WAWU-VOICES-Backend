import { fitHeadline, wrapText } from "../../src/reach/card-renderer";

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
