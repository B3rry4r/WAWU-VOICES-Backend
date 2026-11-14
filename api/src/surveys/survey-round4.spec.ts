import {
  buildReport,
  floorTotals,
  suppressSmall,
  type ReportInput,
} from "./survey-report";

/** A report for one choice question with the given option counts (everybody answers it). */
function poll(
  split: number[],
  minGroup = 20,
  events = { views: 0, starts: 0, skips: 0 },
): ReportInput {
  const responses = split.flatMap((c, k) =>
    Array.from({ length: c }, () => ({
      shareDemo: false,
      state: null,
      ageBand: null,
      answers: [
        {
          questionId: "q",
          optionId: `o${k}`,
          text: null,
          voiceText: null,
          voiceMs: null,
        },
      ],
    })),
  );
  return {
    questions: [
      {
        id: "q",
        position: 1,
        kind: "SINGLE_CHOICE",
        prompt: "Which?",
        options: split.map((_, k) => ({ id: `o${k}`, label: `Option ${k}` })),
      },
    ],
    responses,
    events,
    minGroup,
  };
}

const show = (split: number[], min = 20) => {
  const q = buildReport(poll(split, min)).questions[0];
  return {
    counts: q.options.map((o) => o.count),
    other: q.other?.count ?? null,
    answered: q.answered,
  };
};

describe("round 4, ruling 1 (L-A): a hidden small group can never be worked out", () => {
  it("the report's own cases: 20/19/19/19, 21/21/19, 18/22/22, 15/19/19/19 and 19/19/19/19 show no exact hidden number", () => {
    // everything is under twice the floor (40): one Other line holds them, and each could be anything from 0 to 39
    expect(show([20, 19, 19, 19])).toEqual({
      counts: [null, null, null, null],
      other: 77,
      answered: 77,
    });
    expect(show([21, 21, 19])).toEqual({
      counts: [null, null, null],
      other: 61,
      answered: 61,
    });
    expect(show([18, 22, 22]).counts).toEqual([null, null, null]);
    expect(show([15, 19, 19, 19]).other).toBe(72);
    expect(show([19, 19, 19, 19]).other).toBe(76);
  });

  it("all options under the floor: one Other line with the total, nothing else", () => {
    expect(show([10, 6, 4])).toEqual({
      counts: [null, null, null],
      other: 20,
      answered: 20,
    });
    expect(show([10, 6, 5])).toEqual({
      counts: [null, null, null],
      other: 21,
      answered: 21,
    });
  });

  it("one option under the floor beside a big one: no breakdown at all (the small one would be exact), never 'Other = that one'", () => {
    const r = show([200, 5]);
    expect(r).toEqual({ counts: [null, null], other: null, answered: null });
    // beside two big ones the same
    expect(show([200, 150, 5])).toEqual({
      counts: [null, null, null],
      other: null,
      answered: null,
    });
  });

  it("one option under the floor beside one just over: both fold, so neither is exact", () => {
    // 5 and 30 are both under 40 and fold into Other 35 (each between 0 and 35 as far as the reader can tell)
    expect(show([100, 30, 5])).toEqual({
      counts: [100, null, null],
      other: 35,
      answered: 135,
    });
  });

  it("ties fold together or stay together: the fold is by the count, never by position", () => {
    // the small ones are 5 and 5: they would only be known as "0 to 10", so the breakdown is not shown at all
    expect(show([41, 41, 5, 5])).toEqual({
      counts: [null, null, null, null],
      other: null,
      answered: null,
    });
    const a = suppressSmall([41, 41, 5, 5], 20);
    expect(a.ok).toBe(false);
    expect(a.shown).toEqual([false, false, false, false]);
    // and the position of the small ones changes nothing
    expect(suppressSmall([5, 41, 5, 41], 20)).toEqual(a);
    // equal middle groups: 30, 30, 30 beside a big one fold together (Other 90)
    expect(show([100, 30, 30, 30])).toEqual({
      counts: [100, null, null, null],
      other: 90,
      answered: 190,
    });
  });

  it("two options exactly at the floor are still folded (under twice the floor) into one Other", () => {
    expect(show([20, 20])).toEqual({
      counts: [null, null],
      other: 40,
      answered: 40,
    });
    // at twice the floor a group is shown on its own
    expect(show([40, 20, 20]).counts).toEqual([40, null, null]);
    expect(show([40, 40]).counts).toEqual([40, 40]);
  });

  it("round 5 (L1): zero is not told from small: an option nobody chose is hidden like one a few chose, never shown as 0", () => {
    // [60, 40, 0] and [60, 40, 3] must look the same: no breakdown (the hidden total, 0 or 3, is under the floor)
    const none = { counts: [null, null, null], other: null, answered: null };
    expect(show([60, 40, 0])).toEqual(none);
    expect(show([60, 40, 3])).toEqual(none);
    expect(suppressSmall([60, 40, 0], 20)).toEqual(
      suppressSmall([60, 40, 3], 20),
    );
    // and nothing is ever shown at a count under the floor, 0 included
    for (const c of [
      [100, 0],
      [100, 0, 0],
      [0, 50, 50, 0],
      [200, 0, 21],
    ]) {
      const r = suppressSmall(c, 20);
      c.forEach((v, i) => {
        if (v < 20) expect(r.shown[i]).toBe(false);
      });
    }
    expect(show([60, 25, 0]).counts).toEqual([60, null, null]);
  });

  it("a total never reveals the remainder by subtraction: whenever something is hidden, its total is shown (or nothing is)", () => {
    for (const split of [
      [60, 30, 5],
      [100, 22, 21],
      [45, 45, 10],
      [200, 60, 25, 3],
    ]) {
      const q = buildReport(poll(split)).questions[0];
      const shownSum = q.options.reduce((a, o) => a + (o.count ?? 0), 0);
      const hiddenSome = q.options.some((o) => o.hidden);
      if (q.answered != null && hiddenSome) {
        // answered minus the shown sum is the Other line itself, which is at least the floor
        expect(q.other?.count).toBe(q.answered - shownSum);
        expect(q.other?.count).toBeGreaterThanOrEqual(20);
      }
    }
  });

  /**
   * The check itself. For every count vector of a few sizes, run the rule; collect for every display (which groups are
   * hidden, the shown counts, the hidden total, or "no breakdown") the lowest and highest count each hidden group can
   * have across all vectors that give that display. Each hidden group must either be possibly any of at least `floor`
   * apart (high minus low >= floor) or have a low end that is already at the floor.
   */
  function worstRange(n: number, min: number, top: number): number {
    const seen = new Map<
      string,
      { lo: number[]; hi: number[]; hid: boolean[] }
    >();
    const v: number[] = [];
    const visit = (): void => {
      const r = suppressSmall(v, min);
      const key = r.ok
        ? v.map((c, i) => (r.shown[i] ? c : "x")).join(",") + "|" + r.other
        : "none";
      let e = seen.get(key);
      if (!e) {
        e = {
          lo: v.map(() => Infinity),
          hi: v.map(() => -1),
          hid: r.ok ? r.shown.map((s) => !s) : v.map(() => true),
        };
        seen.set(key, e);
      }
      v.forEach((c, i) => {
        if (c < e.lo[i]) e.lo[i] = c;
        if (c > e.hi[i]) e.hi[i] = c;
      });
    };
    const walk = (i: number, left: number): void => {
      if (i === n - 1) {
        v[i] = left;
        visit();
        return;
      }
      for (let c = 0; c <= left; c++) {
        v[i] = c;
        walk(i + 1, left - c);
      }
    };
    for (let total = min; total <= top; total++) walk(0, total);
    let worst = Infinity;
    for (const e of seen.values())
      e.hid.forEach((h, i) => {
        if (h && e.lo[i] < min) worst = Math.min(worst, e.hi[i] - e.lo[i]);
      });
    return worst;
  }

  it("exhaustive: no hidden group's possible range is narrower than the floor (floor 5: 2 to 5 options)", () => {
    for (const [n, top] of [
      [2, 40],
      [3, 40],
      [4, 36],
      [5, 28],
    ] as const)
      expect(worstRange(n, 5, top)).toBeGreaterThanOrEqual(5);
  });

  it("exhaustive: the same with the shipped floor of 20 (2 to 4 options, up to 85 answers)", () => {
    for (const [n, top] of [
      [2, 100],
      [3, 85],
      [4, 70],
    ] as const)
      expect(worstRange(n, 20, top)).toBeGreaterThanOrEqual(20);
  });

  it("states and age bands use the same rule: one small state beside a big one gives no breakdown", () => {
    const r = poll([60]);
    r.responses.forEach((x, i) =>
      Object.assign(x, { shareDemo: true, state: i < 59 ? "Lagos" : "Kano" }),
    );
    const out = buildReport(r);
    expect(out.byState).toEqual([]);
    expect(out.byStateOther).toBeNull();
  });
});

describe("round 4, ruling 2 (N-2): a count about people under the floor is not shown", () => {
  it("views, starts and skips under the floor are null; at or over it they are shown as they are", () => {
    const t = floorTotals({ views: 40, starts: 26, skips: 3 }, 25, 20);
    expect(t.skips).toBeNull();
    expect(t.views).toBe(40);
    // 26 started and 25 finished: the 1 who did not would follow, so starts and the rate are not shown
    expect(t.starts).toBeNull();
    expect(t.completionRate).toBeNull();
    expect(t.responses).toBe(25);
    const u = floorTotals({ views: 90, starts: 60, skips: 20 }, 40, 20);
    expect(u).toEqual({
      views: 90,
      starts: 60,
      skips: 20,
      responses: 40,
      completionRate: 67,
    });
    const z = floorTotals({ views: 0, starts: 0, skips: 0 }, 20, 20);
    expect(z).toEqual({
      views: null,
      starts: null,
      skips: null,
      responses: 20,
      completionRate: null,
    });
  });

  it("starts and responses are never both shown when they differ by 1 to 19", () => {
    for (let starts = 0; starts <= 80; starts++)
      for (const responses of [20, 25, 30, 41, 60]) {
        const t = floorTotals({ views: 99, starts, skips: 5 }, responses, 20);
        if (t.starts != null && t.responses != null) {
          const d = Math.abs(t.starts - t.responses);
          expect(d === 0 || d >= 20).toBe(true);
        }
        // every shown count is at or over the floor
        for (const x of [t.views, t.starts, t.skips, t.responses])
          expect(x === null || x >= 20).toBe(true);
      }
  });

  it("in a report: the skips of 3 are not shown, even when the survey itself is large", () => {
    const rep = buildReport(
      poll([30, 30], 20, { views: 80, starts: 61, skips: 3 }),
    );
    expect(rep.totals.skips).toBeNull();
    expect(rep.totals.starts).toBeNull(); // 61 started, 60 answered: a gap of 1
    expect(rep.totals.completionRate).toBeNull();
    expect(rep.totals.views).toBe(80);
    expect(rep.totals.responses).toBe(60);
    const small = buildReport(
      poll([5], 20, { views: 10, starts: 6, skips: 1 }),
    );
    expect(small.belowMinimum).toBe(true);
    expect(small.totals).toEqual({
      views: null,
      starts: null,
      skips: null,
      responses: null,
      completionRate: null,
    });
  });
});
