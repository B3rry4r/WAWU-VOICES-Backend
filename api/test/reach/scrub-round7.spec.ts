import { scrub } from "../../src/reach/scrub";

/** V-SURVEYS round 7 (M2): the sentence-end rule, plain 10 digit numbers, and the speed of the slow shape. */
describe("scrub round 7", () => {
  it("the twelve shapes the round 6 check found kept are removed again (alone, or ending the text)", () => {
    for (const t of [
      "Chidi.Me",
      "MyBrand.Me",
      "mybrand.Me",
      "Chidi.Shop",
      "chidi.Shop",
      "ChidiShop.Store",
      "Chidi.Link",
      "Chidi.Page",
      "Mybrand.To",
      "Mybrand.Africa",
      "MyBrand.Info",
      "find me on Chidi.Me",
    ])
      expect(scrub(t)).not.toMatch(/\./);
  });

  it("an address followed only by punctuation is removed", () => {
    expect(scrub("MyBrand.Info!")).toBe("!");
    expect(scrub("Reach me on MyBrand.Me.")).toBe("Reach me on .");
  });

  it("a contact cue within three words before it removes it, whatever follows", () => {
    expect(scrub("check Chidi.Me now")).toBe("check now");
    expect(scrub("follow me on Chidi.Me for more")).not.toMatch(/Chidi/);
    expect(scrub("dm Chidi.Shop today")).not.toMatch(/Chidi/);
    expect(scrub("my ig x Chidi.Link soon")).not.toMatch(/Chidi/);
  });

  it("a sentence that goes on after it, with no cue, is kept", () => {
    for (const t of [
      "Thanks.Us too.",
      "Wait.Me I am coming.",
      "Oga.Me I no go.",
      "It is hot.Co-workers sweat too.",
      "Take it.Link me when you reach.",
    ]) {
      expect(scrub(t)).toBe(t);
      expect(scrub(t, 5000, "[removed]")).toBe(t);
    }
  });

  it("a plain 10 digit number that starts with 0 is removed; an amount ending in five zeros stays", () => {
    for (const n of ["0241234567", "0803123456", "0123456789"])
      expect(scrub(`call ${n} now`)).toBe("call now");
    expect(scrub("1000000000")).toBe("1000000000");
    expect(scrub("the budget is 1000000000 naira")).toBe(
      "the budget is 1000000000 naira",
    );
    expect(scrub("call 1234567890 now")).toBe("call now");
  });

  it("200,000 characters of 1-: the median of 15 runs is under 25 ms", () => {
    const t = "1-".repeat(100_000);
    scrub(t);
    const xs: number[] = [];
    for (let i = 0; i < 15; i++) {
      const s = performance.now();
      scrub(t);
      xs.push(performance.now() - s);
    }
    xs.sort((a, b) => a - b);
    expect(xs[7]).toBeLessThan(25);
  });
});
