import { pct, scrubText } from "./survey-rules";

export interface ReportQuestion {
  id: string;
  position: number;
  kind: "SINGLE_CHOICE" | "TEXT" | "VOICE";
  prompt: string;
  options: { id: string; label: string }[];
}

/** One stored answer, already stripped of any person: the report builder is never handed an id of a person. */
export interface ReportAnswer {
  questionId: string;
  optionId: string | null;
  text: string | null;
  voiceText: string | null;
  voiceMs: number | null;
}

export interface ReportResponse {
  shareDemo: boolean;
  state: string | null;
  ageBand: string | null;
  answers: ReportAnswer[];
}

export interface ReportInput {
  questions: ReportQuestion[];
  responses: ReportResponse[];
  events: { views: number; starts: number; skips: number };
  minGroup: number;
}

export interface SurveyReport {
  minGroupSize: number;
  /** True while fewer people answered than the minimum group size: nothing about the people is shown. */
  belowMinimum: boolean;
  totals: {
    views: number;
    starts: number;
    skips: number;
    responses: number | null;
    completionRate: number | null;
  };
  questions: {
    id: string;
    position: number;
    kind: ReportQuestion["kind"];
    prompt: string;
    answered: number | null;
    options: {
      id: string;
      label: string;
      count: number | null;
      share: number | null;
      hidden: boolean;
    }[];
    texts: string[];
    voices: { transcript: string; seconds: number }[];
  }[];
  byState: { state: string; responses: number; share: number }[];
  byAgeBand: { ageBand: string; responses: number; share: number }[];
  note: string;
}

const NOTE =
  "Results are combined and anonymous. No names, handles, photos or ids are ever shown. Any group smaller than the minimum group size is left out.";

/**
 * Turns stored answers into the brand's report. Pure: no database, no person. The floor (the weekly report's minimum
 * group size) applies to every group shown: the whole set of answers, each option, each list of free answers, each
 * state and each age band. A group under the floor is never shown, not even as a count.
 */
export function buildReport(i: ReportInput): SurveyReport {
  const min = Math.max(1, i.minGroup);
  const n = i.responses.length;
  const completionRate = i.events.starts > 0 ? pct(n, i.events.starts) : null;
  if (n < min) {
    return {
      minGroupSize: min,
      belowMinimum: true,
      totals: {
        views: i.events.views,
        starts: i.events.starts,
        skips: i.events.skips,
        responses: null,
        completionRate: null,
      },
      questions: [],
      byState: [],
      byAgeBand: [],
      note: NOTE,
    };
  }
  const questions = i.questions.map((q) => {
    const rows = i.responses.flatMap((r) =>
      r.answers.filter((a) => a.questionId === q.id),
    );
    const answered = rows.length;
    const enough = answered >= min;
    const options = q.options.map((o) => {
      const c = rows.filter((a) => a.optionId === o.id).length;
      const hidden = !enough || c < min;
      return {
        id: o.id,
        label: o.label,
        count: hidden ? null : c,
        share: hidden ? null : pct(c, answered),
        hidden,
      };
    });
    const texts =
      q.kind === "TEXT" && enough
        ? rows
            .map((a) => scrubText(a.text ?? ""))
            .filter((t) => t.length > 0)
            .sort((a, b) => a.localeCompare(b))
        : [];
    const voices =
      q.kind === "VOICE" && enough
        ? rows
            .filter((a) => a.voiceText && a.voiceText.trim().length > 0)
            .map((a) => ({
              transcript: scrubText(a.voiceText as string),
              seconds: Math.round((a.voiceMs ?? 0) / 1000),
            }))
            .sort((a, b) => a.transcript.localeCompare(b.transcript))
        : [];
    return {
      id: q.id,
      position: q.position,
      kind: q.kind,
      prompt: q.prompt,
      answered: enough ? answered : null,
      options: q.kind === "SINGLE_CHOICE" ? options : [],
      texts,
      voices,
    };
  });
  const group = (pick: (r: ReportResponse) => string | null) => {
    const shared = i.responses.filter((r) => r.shareDemo && pick(r));
    const by = new Map<string, number>();
    for (const r of shared)
      by.set(pick(r) as string, (by.get(pick(r) as string) ?? 0) + 1);
    return [...by.entries()]
      .filter(([, c]) => c >= min)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, c]) => ({ key: k, responses: c, share: pct(c, n) }));
  };
  return {
    minGroupSize: min,
    belowMinimum: false,
    totals: {
      views: i.events.views,
      starts: i.events.starts,
      skips: i.events.skips,
      responses: n,
      completionRate,
    },
    questions,
    byState: group((r) => r.state).map((g) => ({
      state: g.key,
      responses: g.responses,
      share: g.share,
    })),
    byAgeBand: group((r) => r.ageBand).map((g) => ({
      ageBand: g.key,
      responses: g.responses,
      share: g.share,
    })),
    note: NOTE,
  };
}
