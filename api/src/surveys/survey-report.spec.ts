import {
  buildReport,
  type ReportInput,
  type ReportResponse,
} from "./survey-report";
import { respondentKey, scrubText } from "./survey-rules";

const Q = [
  {
    id: "q1",
    position: 1,
    kind: "SINGLE_CHOICE" as const,
    prompt: "Which?",
    options: [
      { id: "o1", label: "Yes" },
      { id: "o2", label: "No" },
    ],
  },
  {
    id: "q2",
    position: 2,
    kind: "TEXT" as const,
    prompt: "Why?",
    options: [],
  },
  {
    id: "q3",
    position: 3,
    kind: "VOICE" as const,
    prompt: "Say it",
    options: [],
  },
];

function resp(i: number, over: Partial<ReportResponse> = {}): ReportResponse {
  return {
    shareDemo: false,
    state: null,
    ageBand: null,
    answers: [
      {
        questionId: "q1",
        optionId: i % 5 === 0 ? "o2" : "o1",
        text: null,
        voiceText: null,
        voiceMs: null,
      },
      {
        questionId: "q2",
        optionId: null,
        text: `reason ${i}`,
        voiceText: null,
        voiceMs: null,
      },
      {
        questionId: "q3",
        optionId: null,
        text: null,
        voiceText: `spoken ${i}`,
        voiceMs: 4000,
      },
    ],
    ...over,
  };
}

const base = (
  n: number,
  over: (i: number) => Partial<ReportResponse> = () => ({}),
): ReportInput => ({
  questions: Q,
  responses: Array.from({ length: n }, (_, i) => resp(i, over(i))),
  events: { views: 100, starts: 50, skips: 5 },
  minGroup: 20,
});

describe("survey report: the minimum group size", () => {
  it("shows no group of people, no answer and no count of answers while fewer people answered than the minimum", () => {
    const r = buildReport(base(19));
    expect(r.belowMinimum).toBe(true);
    expect(r.totals.responses).toBeNull();
    expect(r.questions).toEqual([]);
    expect(r.byState).toEqual([]);
    expect(JSON.stringify(r)).not.toContain("reason 1");
  });

  it("at the minimum it shows totals, option counts at or over the minimum, and free answers", () => {
    const r = buildReport(base(40));
    expect(r.belowMinimum).toBe(false);
    expect(r.totals.responses).toBe(40);
    const q1 = r.questions[0];
    // Round 2 (no hidden group by subtraction): 8 chose "No", a group under 20, so it is hidden, and with it the next
    // smallest group, because 8 hidden alone would follow from 40 minus 32. Both go into one "Other" line of 40.
    expect(q1.options.find((o) => o.id === "o1")).toMatchObject({
      count: null,
      hidden: true,
    });
    expect(q1.options.find((o) => o.id === "o2")).toMatchObject({
      count: null,
      share: null,
      hidden: true,
    });
    expect(q1.other).toEqual({ label: "Other", count: 40, share: 100 });
    expect(r.questions[1].texts).toHaveLength(40);
    expect(r.questions[2].voices).toHaveLength(40);
  });

  it("a state or age band group under the minimum is never listed; people who did not consent are never counted in one", () => {
    const r = buildReport(
      base(
        60,
        (i) =>
          i < 25
            ? { shareDemo: true, state: "Lagos", ageBand: "25-34" }
            : i < 40
              ? { shareDemo: true, state: "Kano", ageBand: "18-24" } // 15 people: under 20
              : { shareDemo: false, state: "Oyo", ageBand: "55+" }, // did not consent: stored values must not count
      ),
    );
    // Round 2: Kano (15) is under 20, and alone it would follow from 40 minus Lagos, so Lagos is hidden too and the two
    // go into one "Other" line (40 people who shared; shares are of the people who shared).
    expect(r.byState).toEqual([]);
    expect(r.byStateOther).toEqual({ responses: 40, share: 100 });
    expect(r.byAgeBand).toEqual([]);
    expect(r.byAgeBandOther).toEqual({ responses: 40, share: 100 });
    expect(JSON.stringify(r)).not.toMatch(/Kano|Oyo|18-24|55\+/);
  });

  it("a poll with a question answered by fewer than the minimum hides that question's free answers", () => {
    const input = base(30);
    // only 5 people answered the text question
    input.responses.forEach((x, i) => {
      if (i >= 5) x.answers = x.answers.filter((a) => a.questionId !== "q2");
    });
    const r = buildReport(input);
    expect(r.questions[1].answered).toBeNull();
    expect(r.questions[1].texts).toEqual([]);
  });

  it("scrubs emails, phone numbers, handles and links from free answers and transcripts", () => {
    const input = base(25);
    input.responses[0].answers[1].text =
      "Call me on 0803 123 4567 or mail ada@example.com, I am @ada.okafor see https://x.test/a";
    input.responses[1].answers[2].voiceText = "my number is +234 803 123 4567";
    const out = JSON.stringify(buildReport(input));
    expect(out).not.toMatch(/0803|ada@example|@ada|https:\/\/x\.test|803 123/);
    expect(out).toContain("[removed]");
  });

  it("the report carries no id of a person: its keys are fixed and an answer has only text", () => {
    const rest: Record<string, unknown> = { ...buildReport(base(25)) };
    delete rest.note;
    expect(JSON.stringify(rest)).not.toMatch(
      /userId|handle|displayName|respondentKey|clipId/i,
    );
  });
});

/** n people answer one poll question: `split` is how many chose each option (in order). */
function poll(split: number[]): ReportInput {
  const q = {
    id: "q1",
    position: 1,
    kind: "SINGLE_CHOICE" as const,
    prompt: "Which?",
    options: split.map((_, k) => ({ id: `o${k}`, label: `Option ${k}` })),
  };
  const responses: ReportResponse[] = [];
  split.forEach((c, k) =>
    Array.from({ length: c }).forEach(() =>
      responses.push({
        shareDemo: false,
        state: null,
        ageBand: null,
        answers: [
          {
            questionId: "q1",
            optionId: `o${k}`,
            text: null,
            voiceText: null,
            voiceMs: null,
          },
        ],
      }),
    ),
  );
  return {
    questions: [q],
    responses,
    events: { views: 0, starts: 0, skips: 0 },
    minGroup: 20,
  };
}

describe("survey report: no hidden group can be worked out by subtraction", () => {
  it("19 answers: nothing about people; 20 with one choice: shown; 21 as 20 and 1: both hidden into one Other of 21", () => {
    expect(buildReport(poll([19])).belowMinimum).toBe(true);
    const at20 = buildReport(poll([20, 0])).questions[0];
    // round 4 (L-A): a group under twice the floor is folded into Other (here one line of 20)
    expect(at20.options[0]).toMatchObject({ count: null, hidden: true });
    expect(at20.other).toEqual({ label: "Other", count: 20, share: 100 });
    const at21 = buildReport(poll([20, 1])).questions[0];
    expect(at21.options.every((o) => o.hidden && o.count === null)).toBe(true);
    expect(at21.other).toEqual({ label: "Other", count: 21, share: 100 });
    // the one hidden choice cannot be had as answered (21) minus a shown count: nothing is shown
    expect(JSON.stringify(at21)).not.toMatch(/"count":20[,}]/);
  });

  it("20 and 1 with 20 + 1: no shown count and no share lets the 1 follow", () => {
    const q = buildReport(poll([25, 1])).questions[0];
    expect(q.options.map((o) => o.count)).toEqual([null, null]);
    expect(q.other?.count).toBe(26);
  });

  it("three choices with two small: the two small and the next smallest are hidden together", () => {
    // 30, 5, 4: hidden 9 is under 20, so 30 goes too
    const q = buildReport(poll([30, 5, 4])).questions[0];
    expect(q.options.map((o) => o.hidden)).toEqual([true, true, true]);
    expect(q.other).toEqual({ label: "Other", count: 39, share: 100 });
    // 40, 30, 5, 4: everything under twice the floor (40) is folded: 30, 5 and 4 make Other 39, and 40 stays shown
    const q2 = buildReport(poll([40, 30, 5, 4])).questions[0];
    // round 4 (L-A): was [null x4] and Other 79 (round 3); the fold is now by the count alone
    expect(q2.options.map((o) => o.count)).toEqual([40, null, null, null]);
    expect(q2.other).toEqual({ label: "Other", count: 39, share: 49 });
  });

  it("two small groups that together reach the floor stay hidden under one Other line", () => {
    const q = buildReport(poll([50, 12, 10])).questions[0];
    // round 4 (L-A): was [null x3] and Other 72 (round 3); 12 and 10 are folded, the 50 stays shown
    expect(q.options.map((o) => o.count)).toEqual([50, null, null]);
    expect(q.other).toEqual({ label: "Other", count: 22, share: 31 });
  });

  it("a state breakdown follows the same rule, and a small group of people who did not share cannot be worked out", () => {
    const withStates = (lagos: number, kano: number, none: number) => {
      const r = poll([lagos + kano + none]);
      r.responses.forEach((x, i) => {
        if (i < lagos) Object.assign(x, { shareDemo: true, state: "Lagos" });
        else if (i < lagos + kano)
          Object.assign(x, { shareDemo: true, state: "Kano" });
      });
      return buildReport(r);
    };
    const a = withStates(20, 1, 0);
    expect(a.byState).toEqual([]);
    expect(a.byStateOther).toEqual({ responses: 21, share: 100 });
    const b = withStates(40, 0, 0);
    expect(b.byState).toEqual([{ state: "Lagos", responses: 40, share: 100 }]);
    expect(b.byStateOther).toBeNull();
    const b2 = withStates(40, 1, 0);
    expect(b2.byState).toEqual([]);
    // round 4 (L-A): was Other 41 (round 3). One small state beside a big one would be known exactly, so no breakdown
    expect(b2.byStateOther).toBeNull();
    // 40 shared in Lagos, 3 did not share: 3 would follow from 43 minus 40, so the breakdown is not shown
    const c = withStates(40, 0, 3);
    expect(c.byState).toEqual([]);
    expect(c.byStateOther).toBeNull();
  });
});

describe("survey respondent key", () => {
  it("is stable for one person and survey, different across surveys and people, and never the id itself", () => {
    const a = respondentKey("s1", "u1");
    expect(respondentKey("s1", "u1")).toBe(a);
    expect(respondentKey("s2", "u1")).not.toBe(a);
    expect(respondentKey("s1", "u2")).not.toBe(a);
    expect(a).not.toContain("u1");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it("scrubText removes bare domains, t.me and wa.me links, 'name at provider dot com', numbers in words and handles after insta, ig, twitter, x, tiktok and snap", () => {
    for (const [said, gone] of [
      ["email me chidi at gmail dot com", /chidi|gmail/],
      ["write chidi (at) gmail (dot) com", /chidi|gmail/],
      ["t.me/chidi_o", /chidi/],
      ["wa.me/2348031234567 please", /2348031234567/],
      ["see zobofresh.com/shop today", /zobofresh/],
      ["my insta is kemi_ng", /kemi_ng/],
      ["ig: kemi.ng", /kemi\.ng/],
      ["twitter kemi_ng", /kemi_ng/],
      ["tiktok handle kemi_ng", /kemi_ng/],
      ["snap me at kemi_ng", /kemi_ng/],
      ["x is chidi_o", /chidi_o/],
      [
        "number zero eight zero three one two three four five six",
        /eight|zero/,
      ],
      ["call 0803 123 4567 now", /0803/],
      ["plus 234 803 123 4567", /803/],
    ] as const) {
      const out = scrubText(said);
      expect([said, out]).toEqual([said, expect.not.stringMatching(gone)]);
      expect(out).toContain("[removed]");
    }
    // the words around a number are kept, with their space
    expect(scrubText("call 0803 123 4567 now")).toBe("call [removed] now");
  });
  it("scrubText leaves plain words alone", () => {
    expect(scrubText("Prices are too high in Lagos, 2 times last year")).toBe(
      "Prices are too high in Lagos, 2 times last year",
    );
  });
});
