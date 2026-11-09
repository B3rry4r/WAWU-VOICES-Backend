import { ResvgCardRenderer } from "../../src/reach/card-renderer";

/** Verifier fix: on a tie no bar takes the yellow leader colour; with a clear lead the first one does. */
describe("poll card bar colours", () => {
  const spec = (pcts: number[]) =>
    ({
      kind: "poll",
      label: "Weekly poll",
      headline: "What would make you feel truly fine again?",
      args: [],
      rows: pcts.map((pct, i) => ({ label: `Option ${i}`, pct })),
      pollOpen: true,
      quote: null,
      summary: null,
      basedOnVoices: null,
      votes: 4,
      updated: "now",
      newsTag: null,
      fallback: false,
      url: "usevoices.com/p/x",
    }) as never;
  const r = new ResvgCardRenderer() as unknown as {
    svg: (s: never) => string;
    storySvg: (s: never) => string;
  };
  const sun = (svg: string) => (svg.match(/#ffc845/gi) ?? []).length;

  it.each([["card"], ["story"]] as const)(
    "%s: a 2-2 tie has no leader colour on any bar, a clear lead has one",
    (size) => {
      const draw = (p: number[]) =>
        size === "card" ? r.svg(spec(p)) : r.storySvg(spec(p));
      expect(sun(draw([50, 50]))).toBe(sun(draw([0, 0])));
      expect(sun(draw([83, 17]))).toBe(sun(draw([50, 50])) + 1);
    },
  );
});
