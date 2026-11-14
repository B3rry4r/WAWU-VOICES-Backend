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
    expect(q1.options.find((o) => o.id === "o1")).toMatchObject({
      count: 32,
      hidden: false,
    });
    // 8 chose "No": a group under 20, so it is not shown, not even as a count
    expect(q1.options.find((o) => o.id === "o2")).toMatchObject({
      count: null,
      share: null,
      hidden: true,
    });
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
    expect(r.byState).toEqual([{ state: "Lagos", responses: 25, share: 42 }]);
    expect(r.byAgeBand.map((g) => g.ageBand)).toEqual(["25-34"]);
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
    const { note: _note, ...rest } = buildReport(base(25));
    expect(JSON.stringify(rest)).not.toMatch(
      /userId|handle|displayName|respondentKey|clipId/i,
    );
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
  it("scrubText leaves plain words alone", () => {
    expect(scrubText("Prices are too high in Lagos, 2 times last year")).toBe(
      "Prices are too high in Lagos, 2 times last year",
    );
  });
});
