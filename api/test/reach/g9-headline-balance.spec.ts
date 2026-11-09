import { balancedWidth, wrapText } from "../../src/reach/card-renderer";

describe("G9: a headline never leaves one word alone on its last line", () => {
  const text =
    "Power cuts and rent are making people angry again this week, and everyone wants it fixed";
  const px = 88;
  const sp = -0.01 * px;
  it("the greedy wrap does leave an orphan here", () => {
    const g = wrapText(text, "bagel", px, 912, 99, sp);
    expect(g[g.length - 1]).toBe("fixed");
  });
  it("the balanced width keeps the line count and puts two or more words on the last line", () => {
    const g = wrapText(text, "bagel", px, 912, 99, sp);
    const w = balancedWidth(text, "bagel", px, 912, sp);
    expect(w).toBeLessThan(912);
    const b = wrapText(text, "bagel", px, w, 99, sp);
    expect(b).toHaveLength(g.length);
    expect(b[b.length - 1].split(" ").length).toBeGreaterThan(1);
  });
  it("a headline that already ends well, or fits one line, keeps its full width", () => {
    expect(balancedWidth("Prices keep going up", "bagel", 96, 912, -0.96)).toBe(
      912,
    );
    expect(
      balancedWidth(
        "Hopeful, but tired of waiting up",
        "bagel",
        96,
        912,
        -0.96,
      ),
    ).toBe(912);
  });
});
