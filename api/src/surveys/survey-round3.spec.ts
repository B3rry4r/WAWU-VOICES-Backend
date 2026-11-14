import { buildReport, suppressSmall, type ReportInput } from "./survey-report";
import {
  SCRUB_MAX,
  readReviewCursor,
  reviewCursor,
  reviewHandle,
  scrubText,
} from "./survey-rules";

/** V-SURVEYS round 3: what a reader can work out from the released report, and the wider scrub. */

const choiceQ = {
  id: "c",
  position: 1,
  kind: "SINGLE_CHOICE" as const,
  prompt: "Which?",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
};
const textQ = {
  id: "t",
  position: 2,
  kind: "TEXT" as const,
  prompt: "Why?",
  options: [],
};
const voiceQ = {
  id: "v",
  position: 3,
  kind: "VOICE" as const,
  prompt: "Say",
  options: [],
};

/** `n` responses; the first `choice` answer the choice question, the first `text` write, `hidden` of those are hidden by staff. */
function build(
  n: number,
  o: { choice?: number; text?: number; hidden?: number; voice?: number },
  min = 20,
  free = true,
) {
  const responses = Array.from({ length: n }, (_, i) => {
    const answers = [] as ReportInput["responses"][number]["answers"];
    if (i < (o.choice ?? 0))
      answers.push({
        questionId: "c",
        optionId: i % 2 ? "a" : "b",
        text: null,
        voiceText: null,
        voiceMs: null,
      });
    if (i < (o.text ?? 0))
      answers.push({
        questionId: "t",
        optionId: null,
        text: `reason ${i}`,
        hidden: i < (o.hidden ?? 0),
        voiceText: null,
        voiceMs: null,
      });
    if (i < (o.voice ?? 0))
      answers.push({
        questionId: "v",
        optionId: null,
        text: null,
        voiceText: `spoken ${i}`,
        voiceMs: 3000,
      });
    return { shareDemo: false, state: null, ageBand: null, answers };
  });
  return buildReport(
    {
      questions: [choiceQ, textQ, voiceQ],
      responses,
      events: { views: 0, starts: 0, skips: 0 },
      minGroup: min,
    },
    { free },
  );
}

describe("M-A: answered for a written or voice question is the number of items in the list", () => {
  it("is the list length: hidden answers are in neither", () => {
    // 60 responses, 50 wrote, 25 of those hidden: the list holds 25, the 35 others are not a small group
    const q = build(60, { text: 50, hidden: 25 }).questions[1];
    expect(q.texts).toHaveLength(25);
    expect(q.answered).toBe(25);
  });
  it("an empty answer is in neither the list nor the count", () => {
    const rep = buildReport({
      questions: [textQ],
      responses: Array.from({ length: 70 }, (_, i) => ({
        shareDemo: false,
        state: null,
        ageBand: null,
        answers:
          i < 50
            ? [
                {
                  questionId: "t",
                  optionId: null,
                  text: i < 30 ? `fine ${i}` : i < 40 ? "   " : "ok ok ok",
                  voiceText: null,
                  voiceMs: null,
                },
              ]
            : [],
      })),
      events: { views: 0, starts: 0, skips: 0 },
      minGroup: 20,
    });
    // 40 listed (the 10 blank ones are in neither), 30 responses without an item: not a small gap
    expect(rep.questions[0].texts).toHaveLength(40);
    expect(rep.questions[0].answered).toBe(40);
  });
  it("30 answered, 29 listed (1 hidden): the list is not shown, so the 1 cannot be counted", () => {
    const q = build(30, { text: 30, hidden: 1 }).questions[1];
    expect(q.texts).toEqual([]);
    expect(q.answered).toBeNull();
  });
  it("a voice list follows the same rule", () => {
    const ok = build(30, { voice: 30 }).questions[2];
    expect(ok.voices).toHaveLength(30);
    expect(ok.answered).toBe(30);
    const small = build(30, { voice: 25 }).questions[2];
    expect(small.voices).toEqual([]);
    expect(small.answered).toBeNull();
  });
  it("a list under the floor is not shown, and before release (no free lists) answered is null", () => {
    expect(build(60, { text: 10 }).questions[1].texts).toEqual([]);
    const snap = build(30, { text: 30 }, 20, false).questions[1];
    expect(snap.answered).toBeNull();
    expect(snap.texts).toEqual([]);
  });
});

describe("M-B: answered for a question is shown only when it cannot give a small difference", () => {
  it("30 responses, 29 answered the choice: answered is null and no count shows", () => {
    const q = build(30, { choice: 29 }).questions[0];
    expect(q.answered).toBeNull();
    expect(q.options.every((o) => o.count === null && o.share === null)).toBe(
      true,
    );
    expect(q.other).toBeNull();
  });
  it("30 of 30 and 30 of 60 are shown; 41 of 60 is shown (gap 19 is under 20, so not)", () => {
    expect(build(30, { choice: 30 }).questions[0].answered).toBe(30);
    expect(build(60, { choice: 30 }).questions[0].answered).toBe(30);
    expect(build(60, { choice: 41 }).questions[0].answered).toBeNull();
    expect(build(60, { choice: 40 }).questions[0].answered).toBe(40);
  });
});

describe("L-A and the exhaustive check of suppressSmall", () => {
  const MIN = 3;
  it("every count vector: what is hidden is never one group, and never a sum under twice the floor unless all are hidden", () => {
    let checked = 0;
    for (let k = 2; k <= 4; k++) {
      const top = k === 2 ? 14 : k === 3 ? 11 : 8;
      const v = Array(k).fill(0) as number[];
      const walk = (d: number): void => {
        if (d === k) {
          const total = v.reduce((a, b) => a + b, 0);
          if (total < MIN) return;
          const { shown, other } = suppressSmall(v, MIN);
          const hidden = v
            .map((c, i) => (shown[i] ? -1 : c))
            .filter((c) => c >= 0);
          const h = hidden.reduce((a, b) => a + b, 0);
          for (let i = 0; i < k; i++)
            if (shown[i]) expect(v[i]).toBeGreaterThanOrEqual(MIN);
          if (h > 0) {
            expect(hidden.length).toBeGreaterThanOrEqual(2);
            expect(h >= 2 * MIN || hidden.length === k).toBe(true);
            expect(other).toBe(h >= MIN ? h : null);
          } else expect(other).toBeNull(); // only empty groups are hidden
          checked++;
          return;
        }
        for (let c = 0; c <= top; c++) {
          v[d] = c;
          walk(d + 1);
        }
      };
      walk(0);
    }
    expect(checked).toBeGreaterThan(5000);
  });
  it("50, 20 and 1 with a floor of 20 hides the 20 and the 1 and one more, never 'one of them is 1 or 0'", () => {
    const r = suppressSmall([50, 20, 1], 20);
    expect(r.shown).toEqual([false, false, false]);
    expect(r.other).toBe(71);
  });
});

describe("L-B: two breakdowns against each other and the total, exhaustively", () => {
  const MIN = 3;
  it("a breakdown's shared total equals the other's and the total, or differs from each by at least the floor", () => {
    let checked = 0;
    for (let both = 0; both <= 7; both++)
      for (let stOnly = 0; stOnly <= 7; stOnly++)
        for (let ageOnly = 0; ageOnly <= 7; ageOnly++)
          for (let none = 0; none <= 7; none++) {
            const n = both + stOnly + ageOnly + none;
            if (n < MIN) continue;
            const mk = (
              state: string | null,
              age: string | null,
              i: number,
            ) => ({
              shareDemo: !!(state || age),
              state,
              ageBand: age,
              answers: [] as ReportInput["responses"][number]["answers"],
              i,
            });
            const responses = [
              ...Array.from({ length: both }, (_, i) =>
                mk(i % 2 ? "Lagos" : "Kano", i % 2 ? "25-34" : "35-44", i),
              ),
              ...Array.from({ length: stOnly }, (_, i) => mk("Lagos", null, i)),
              ...Array.from({ length: ageOnly }, (_, i) =>
                mk(null, "25-34", i),
              ),
              ...Array.from({ length: none }, (_, i) => mk(null, null, i)),
            ];
            const r = buildReport({
              questions: [],
              responses,
              events: { views: 0, starts: 0, skips: 0 },
              minGroup: MIN,
            });
            const sum = (
              rows: { responses: number }[],
              other: { responses: number } | null,
            ) =>
              rows.reduce((a, g) => a + g.responses, 0) +
              (other?.responses ?? 0);
            const sShown = r.byState.length > 0 || r.byStateOther != null;
            const aShown = r.byAgeBand.length > 0 || r.byAgeBandOther != null;
            const S = sum(r.byState, r.byStateOther);
            const A = sum(r.byAgeBand, r.byAgeBandOther);
            const ok = (d: number) => d === 0 || d >= MIN;
            if (sShown) {
              expect(S).toBe(both + stOnly);
              expect(ok(n - S)).toBe(true);
            }
            if (aShown) {
              expect(A).toBe(both + ageOnly);
              expect(ok(n - A)).toBe(true);
            }
            if (sShown && aShown) expect(ok(Math.abs(S - A))).toBe(true);
            checked++;
          }
    expect(checked).toBeGreaterThan(4000);
  });
  it("60 people: 20 share nothing, 39 share state and age band, 1 shares state only: age band is left out", () => {
    const mk = (state: string | null, age: string | null) => ({
      shareDemo: !!(state || age),
      state,
      ageBand: age,
      answers: [] as ReportInput["responses"][number]["answers"],
    });
    const responses = [
      ...Array.from({ length: 20 }, () => mk(null, null)),
      ...Array.from({ length: 19 }, () => mk("Lagos", "25-34")),
      ...Array.from({ length: 20 }, () => mk("Lagos", "35-44")),
      mk("Lagos", null),
    ];
    const r = buildReport({
      questions: [],
      responses,
      events: { views: 0, starts: 0, skips: 0 },
      minGroup: 20,
    });
    expect(r.byAgeBand).toEqual([]);
    expect(r.byAgeBandOther).toBeNull();
  });
});

describe("M-C: review handles", () => {
  it("are deterministic, differ by survey and answer, are not the answer id and are not ordered by it", () => {
    const ids = Array.from(
      { length: 50 },
      (_, i) => `0192f0a0-0000-7000-8000-${String(i).padStart(12, "0")}`,
    );
    const hs = ids.map((id) => reviewHandle("s1", id));
    expect(hs).toEqual(ids.map((id) => reviewHandle("s1", id)));
    expect(new Set(hs).size).toBe(50);
    expect(hs.every((h) => /^[0-9a-f]{32}$/.test(h))).toBe(true);
    expect(reviewHandle("s2", ids[0])).not.toBe(hs[0]);
    expect(hs.some((h, i) => h === ids[i])).toBe(false);
    // time-ordered ids would sort the same as their handles; these do not
    expect([...hs].sort()).not.toEqual(hs);
  });
  it("a page link works only for its survey, its admin and its offset", () => {
    const c = reviewCursor("s1", "u1", 50);
    expect(readReviewCursor("s1", "u1", c)).toBe(50);
    expect(readReviewCursor("s2", "u1", c)).toBeNull();
    expect(readReviewCursor("s1", "u2", c)).toBeNull();
    expect(readReviewCursor("s1", "u1", c.replace(/^50/, "100"))).toBeNull();
    expect(readReviewCursor("s1", "u1", "junk")).toBeNull();
  });
});

describe("M-E: the wider scrub", () => {
  const gone: [string, RegExp][] = [
    ["email chidi(at)gmail(dot)com please", /chidi|gmail/],
    ["chidi @ gmail . com", /chidi|gmail/],
    ["write chidi at gmail.com", /chidi|gmail/],
    ["chidi at gmail dot com", /chidi|gmail/],
    ["kemi@gmail。com", /kemi|gmail/],
    ["ＡＢ＠gmail.com", /gmail/],
    ["see kemi.studio", /kemi/],
    ["kemi dot studio", /kemi/],
    ["chidi dot com", /chidi/],
    ["ftp://files.example/x", /ftp|example/],
    ["go to shop.example/path", /shop/],
    ["1.2.3.4", /1\.2\.3\.4/],
    ["08031234567", /0803/],
    ["0803 123 4567", /0803/],
    ["+234 (803) 123-4567", /803/],
    ["08O3I234567", /234567/],
    ["０８０３１２３４５６７８", /０８/],
    ["٠٨٠٣١٢٣٤٥٦٧٨", /٠٨/],
    ["zero eight oh three 1 2 3 4 5 six", /zero eight/],
    [
      "double five double five double five double five double five",
      /double five/,
    ],
    ["telegram: chidi_o", /chidi/],
    ["fb: chidi.okafor", /chidi/],
    ["tg @chidi", /chidi/],
    ["wa: chidi99", /chidi/],
    ["insta chidi99", /chidi/],
    ["snap me at kemi_ng", /kemi/],
    ["follow @chidi", /chidi/],
    ["linkedin: kemi-o", /kemi/],
  ];
  it.each(gone)("removes %s", (said, left) => {
    const out = scrubText(said);
    expect(out).not.toMatch(left);
    expect(out).toContain("[removed]");
  });
  it.each([
    "I went home.Then I slept",
    "the x factor",
    "handle with care",
    "snap out of it",
    "twitter is down",
    "I use facebook a lot",
    "I bought 5 apples. 3 pears, 2 plums.",
    "Call me Chidi Okafor from Surulere",
    "a.b.c",
    "one two three",
  ])("leaves %s as it is", (said) => {
    expect(scrubText(said)).toBe(said);
  });
  it("a name or a street address in plain words is left to the staff's read", () => {
    expect(scrubText("I am Adaeze Nwosu of 12 Allen Avenue Ikeja")).toBe(
      "I am Adaeze Nwosu of 12 Allen Avenue Ikeja",
    );
  });
  it("is linear: 200 000 characters of the worst shapes take under 50 ms each", () => {
    for (const unit of [
      "a",
      "1",
      "a.",
      "a@",
      "1 ",
      "one ",
      "a at ",
      "a dot ",
      "x ",
      "a.b/",
      "0 ",
    ]) {
      const big = unit.repeat(Math.ceil(200_000 / unit.length));
      const t = Date.now();
      scrubText(big);
      expect([unit, Date.now() - t < 50]).toEqual([unit, true]);
    }
    expect(SCRUB_MAX).toBeLessThanOrEqual(5000);
  });
});
