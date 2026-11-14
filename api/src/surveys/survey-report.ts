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
  /** The stored answer's own id (it names no person). Only the staff review uses it. */
  id?: string;
  /** Staff hid this free answer or transcript: it is left out of the free lists. */
  hidden?: boolean;
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
    /** The hidden choices together, only when their sum is at least the minimum group size. */
    other: { label: string; count: number; share: number } | null;
    texts: string[];
    voices: { transcript: string; seconds: number }[];
  }[];
  byState: { state: string; responses: number; share: number }[];
  byStateOther: { responses: number; share: number } | null;
  byAgeBand: { ageBand: string; responses: number; share: number }[];
  byAgeBandOther: { responses: number; share: number } | null;
  note: string;
}

/**
 * Hides every group under the floor, then keeps hiding the next smallest shown group while the hidden total is above
 * zero but under the floor, so no hidden group can be worked out from the totals. `other` is the hidden total, given
 * only when it is at least the floor.
 */
export function suppressSmall(
  counts: number[],
  min: number,
): { shown: boolean[]; other: number | null } {
  const shown = counts.map((c) => c >= min);
  const hiddenTotal = () =>
    counts.reduce((a, c, i) => a + (shown[i] ? 0 : c), 0);
  for (;;) {
    const h = hiddenTotal();
    if (h === 0 || h >= min) break;
    let at = -1;
    counts.forEach((c, i) => {
      if (shown[i] && (at === -1 || c < counts[at])) at = i;
    });
    if (at === -1) break;
    shown[at] = false;
  }
  const h = hiddenTotal();
  return { shown, other: h >= min ? h : null };
}

const NOTE =
  "Results are combined and anonymous. No names, handles, photos or ids are ever shown. Any group smaller than the minimum group size is left out.";

/**
 * Turns stored answers into the brand's report. Pure: no database, no person. The floor (the weekly report's minimum
 * group size) applies to every group shown: the whole set of answers, each option, each list of free answers, each
 * state and each age band. A group under the floor is never shown, not even as a count, and no hidden group can be
 * worked out by subtraction (see suppressSmall).
 */
export function buildReport(
  i: ReportInput,
  opts: { free?: boolean } = {},
): SurveyReport {
  const free = opts.free !== false;
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
      byStateOther: null,
      byAgeBand: [],
      byAgeBandOther: null,
      note: NOTE,
    };
  }
  const questions = i.questions.map((q) => {
    const rows = i.responses.flatMap((r) =>
      r.answers.filter((a) => a.questionId === q.id),
    );
    const answered = rows.length;
    const enough = answered >= min;
    const counts = q.options.map(
      (o) => rows.filter((a) => a.optionId === o.id).length,
    );
    const sup = enough
      ? suppressSmall(counts, min)
      : { shown: counts.map(() => false), other: null };
    const options = q.options.map((o, k) => {
      const hidden = !sup.shown[k];
      return {
        id: o.id,
        label: o.label,
        count: hidden ? null : counts[k],
        share: hidden ? null : pct(counts[k], answered),
        hidden,
      };
    });
    const texts =
      free && q.kind === "TEXT" && enough
        ? rows
            .filter((a) => !a.hidden)
            .map((a) => scrubText(a.text ?? ""))
            .filter((t) => t.length > 0)
            .sort((a, b) => a.localeCompare(b))
        : [];
    const voices =
      free && q.kind === "VOICE" && enough
        ? rows
            .filter(
              (a) => !a.hidden && a.voiceText && a.voiceText.trim().length > 0,
            )
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
      other:
        q.kind === "SINGLE_CHOICE" && sup.other != null
          ? {
              label: "Other",
              count: sup.other,
              share: pct(sup.other, answered),
            }
          : null,
      texts,
      voices,
    };
  });
  // A breakdown only from people who agreed to share. Its shares are of the people who shared, so the people who did
  // not share cannot be worked out; if that group is itself small and not empty, the breakdown is not shown at all.
  const group = (pick: (r: ReportResponse) => string | null) => {
    const shared = i.responses.filter((r) => r.shareDemo && pick(r));
    const by = new Map<string, number>();
    for (const r of shared)
      by.set(pick(r) as string, (by.get(pick(r) as string) ?? 0) + 1);
    const keys = [...by.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const notShared = n - shared.length;
    if (notShared > 0 && notShared < min) return { rows: [], other: null };
    const sup = suppressSmall(
      keys.map(([, c]) => c),
      min,
    );
    return {
      rows: keys
        .filter((_, k) => sup.shown[k])
        .map(([k, c]) => ({
          key: k,
          responses: c,
          share: pct(c, shared.length),
        })),
      other:
        sup.other != null
          ? { responses: sup.other, share: pct(sup.other, shared.length) }
          : null,
    };
  };
  const states = group((r) => r.state);
  const ages = group((r) => r.ageBand);
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
    byState: states.rows.map((g) => ({
      state: g.key,
      responses: g.responses,
      share: g.share,
    })),
    byStateOther: states.other,
    byAgeBand: ages.rows.map((g) => ({
      ageBand: g.key,
      responses: g.responses,
      share: g.share,
    })),
    byAgeBandOther: ages.other,
    note: NOTE,
  };
}
