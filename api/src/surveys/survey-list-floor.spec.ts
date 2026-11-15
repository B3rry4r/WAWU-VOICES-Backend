import { dropFree } from "./survey-erase";
import { servedReport, type SurveyReport } from "./survey-report";

/** V-SURVEY-LIST-FLOOR (owner, 15 Nov 2026: "Hide a list under 5"). Pure: no database. */

type Mine = Parameters<typeof dropFree>[1][number];

function report(
  floor: number,
  nText: number,
  nVoice: number,
  extra = false,
): SurveyReport {
  const q = (
    id: string,
    kind: "TEXT" | "VOICE",
    n: number,
    tag: string,
  ): SurveyReport["questions"][number] => ({
    id,
    position: 1,
    kind,
    prompt: id,
    answered: 45,
    options: [],
    other: null,
    texts:
      kind === "TEXT" ? Array.from({ length: n }, (_, i) => `t${tag}${i}`) : [],
    voices:
      kind === "VOICE"
        ? Array.from({ length: n }, (_, i) => ({
            transcript: `v${tag}${i}`,
            seconds: 5,
          }))
        : [],
    textIds:
      kind === "TEXT" ? Array.from({ length: n }, (_, i) => `${tag}T${i}`) : [],
    voiceIds:
      kind === "VOICE"
        ? Array.from({ length: n }, (_, i) => `${tag}V${i}`)
        : [],
  });
  const questions: SurveyReport["questions"] = [
    {
      id: "c",
      position: 0,
      kind: "SINGLE_CHOICE",
      prompt: "c",
      answered: 45,
      options: [
        { id: "o1", label: "A", count: 30, share: 67, hidden: false },
        { id: "o2", label: "B", count: 15, share: 33, hidden: false },
      ],
      other: null,
      texts: [],
      voices: [],
      textIds: [],
      voiceIds: [],
    },
    q("t", "TEXT", nText, "a"),
    q("v", "VOICE", nVoice, "b"),
  ];
  if (extra) questions.push(q("t2", "TEXT", 7, "c"));
  return {
    minGroupSize: floor,
    belowMinimum: false,
    totals: {
      views: 50,
      starts: 48,
      skips: 2,
      responses: 45,
      completionRate: 90,
    },
    questions,
    byState: [],
    byStateOther: null,
    byAgeBand: [],
    byAgeBandOther: null,
    note: "n",
  };
}

const mine = (...ids: string[]): Mine[] =>
  ids.map((answerId) => ({
    answerId,
    questionId: answerId.includes("T")
      ? answerId.startsWith("c")
        ? "t2"
        : "t"
      : "v",
    kind: answerId.includes("T") ? "TEXT" : "VOICE",
    text: "",
    seconds: 0,
    beforeRelease: true,
  }));

const numbers = (r: SurveyReport) =>
  JSON.stringify({
    ...r,
    questions: r.questions.map((q) => ({
      ...q,
      texts: [],
      voices: [],
      textIds: [],
      voiceIds: [],
    })),
  });

describe("a list under the floor is emptied at the purge", () => {
  it("7 listed, floor 5: one purge shows 6; two more leave 4 and the list is empty, numbers as released", () => {
    const r0 = report(5, 7, 7);
    const r1 = dropFree(r0, mine("aT0"));
    expect(r1.questions[1].texts).toHaveLength(6);
    const r2 = dropFree(r1, mine("aT1", "aT2"));
    expect(r2.questions[1].texts).toEqual([]);
    expect(r2.questions[1].textIds).toEqual([]);
    expect(r2.questions[1].answered).toBe(45);
    expect(numbers(r2)).toBe(numbers(r0));
    expect(r2.questions[2].voices).toHaveLength(7); // the voice list was not touched
  });
  it("a voice list does the same", () => {
    const r0 = report(5, 7, 7);
    const r2 = dropFree(dropFree(r0, mine("bV0")), mine("bV1", "bV2"));
    expect(r2.questions[2].voices).toEqual([]);
    expect(r2.questions[2].voiceIds).toEqual([]);
    expect(r2.questions[2].answered).toBe(45);
    expect(numbers(r2)).toBe(numbers(r0));
  });
  it("two lists in one survey: only the one under the floor is emptied", () => {
    const r0 = report(5, 5, 9);
    const r = dropFree(r0, mine("aT0", "bV0"));
    expect(r.questions[1].texts).toEqual([]);
    expect(r.questions[2].voices).toHaveLength(8);
    expect(r.questions[0]).toEqual(r0.questions[0]);
  });
  it("a person with a text AND a voice item loses both; each list is judged on its own", () => {
    const r0 = report(5, 5, 6);
    const r = dropFree(r0, mine("aT0", "bV0"));
    expect(r.questions[1].texts).toEqual([]); // 4 left
    expect(r.questions[2].voices).toHaveLength(5); // 5 left: exactly the floor stays
  });
  it("a person with no item changes nothing, even when a list is already short", () => {
    const r0 = report(5, 3, 7);
    const r = dropFree(r0, mine("zT9"));
    expect(r).toEqual(r0);
    expect(r.questions[1].texts).toHaveLength(3);
  });
  it("a purge that touches one list leaves another short list as it is", () => {
    const r0 = report(5, 3, 7);
    const r = dropFree(r0, mine("bV0"));
    expect(r.questions[1].texts).toHaveLength(3);
    expect(r.questions[2].voices).toHaveLength(6);
  });
  it("a list exactly at the floor stays", () => {
    const r = dropFree(report(5, 6, 6), mine("aT0"));
    expect(r.questions[1].texts).toHaveLength(5);
  });
  it.each([2, 3, 4, 5, 6])(
    "floor %i: at the floor stays, one under is emptied",
    (f) => {
      const keep = dropFree(report(f, f + 1, f + 1), mine("aT0", "bV0"));
      expect(keep.questions[1].texts).toHaveLength(f);
      expect(keep.questions[2].voices).toHaveLength(f);
      const gone = dropFree(report(f, f, f), mine("aT0", "bV0"));
      expect(gone.questions[1].texts).toEqual([]);
      expect(gone.questions[2].voices).toEqual([]);
      expect(gone.questions[1].answered).toBe(45);
    },
  );
  it("the floor used is the report's own, not today's setting", () => {
    const r = dropFree(report(2, 3, 3), mine("aT0")); // 2 left, floor 2: stays
    expect(r.questions[1].texts).toHaveLength(2);
  });
});

describe("a released report is served with short lists hidden (every role)", () => {
  it("a stored report with 3 items is served empty; ids never served; numbers as stored", () => {
    const stored = report(5, 3, 4);
    const out = servedReport(stored);
    expect(out.questions[1].texts).toEqual([]);
    expect(out.questions[2].voices).toEqual([]);
    expect(out.questions[1].answered).toBe(45);
    expect("textIds" in out.questions[1]).toBe(false);
    expect("voiceIds" in out.questions[2]).toBe(false);
    expect(numbers(out)).toBe(
      numbers({
        ...stored,
        questions: out.questions.map((q, i) => ({
          ...stored.questions[i],
          answered: q.answered,
        })),
      }),
    );
    expect(JSON.stringify(out)).not.toMatch(/"t[ab]\d|"v[ab]\d/);
  });
  it("a list at the floor is served whole; choice questions untouched; input not mutated", () => {
    const stored = report(5, 5, 9);
    const snap = JSON.stringify(stored);
    const out = servedReport(stored);
    expect(out.questions[1].texts).toHaveLength(5);
    expect(out.questions[2].voices).toHaveLength(9);
    expect(out.questions[0].options).toEqual(stored.questions[0].options);
    expect(JSON.stringify(stored)).toBe(snap);
  });
});
