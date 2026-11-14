import { MAX_SCRUB_CHARS, REMOVED_MARK, scrub } from "../reach/scrub";
import { pct } from "./survey-rules";

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
    /** Each count about people is null while it is under the floor ("not enough yet"). */
    views: number | null;
    starts: number | null;
    skips: number | null;
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
 * THE rule for hiding small groups, written once (options of a question, states, age bands all use it).
 *
 * Every group under TWICE the floor is folded into "Other" (the fold depends on nothing but the count, so what the
 * reader can work out is exactly: each folded group is somewhere from 0 up to 2 x floor - 1, and together they sum to
 * the shown "Other"). The fold is shown only when no folded group can be pinned down:
 *   - nothing folded, or everything folded is 0 (nobody is in those groups): shown as they are.
 *     Owner ruling, 14 Nov 2026: a choice nobody picked is shown as 0 (for example 60, 40, 0);
 *   - otherwise the possible range of each folded group, from the hidden total h and the number folded k, is
 *     [max(0, h - (k-1) x (2 x floor - 1)), min(h, 2 x floor - 1)]. It is accepted when that range is at least as wide
 *     as the floor (high minus low >= floor) or when its low end is already at the floor (no folded group is small).
 *   - when that is not true, `ok` is false: no breakdown at all (the question shows "Not enough answers yet").
 * `other` is the hidden total, given whenever something is hidden (so a hidden total can never be had by subtracting
 * the shown groups from the answered total: it is shown, and it is at least the floor).
 */
export function suppressSmall(
  counts: number[],
  min: number,
): { shown: boolean[]; other: number | null; ok: boolean } {
  const fold = 2 * min;
  const pooled = counts.map((c) => c < fold);
  const k = pooled.filter(Boolean).length;
  const h = counts.reduce((a, c, i) => a + (pooled[i] ? c : 0), 0);
  if (k === 0 || h === 0)
    return { shown: counts.map(() => true), other: null, ok: true };
  const high = Math.min(h, fold - 1);
  const low = Math.max(0, h - (k - 1) * (fold - 1));
  if (low >= min || high - low >= min)
    return { shown: pooled.map((p) => !p), other: h, ok: true };
  return { shown: counts.map(() => false), other: null, ok: false };
}

/**
 * A count about people that is under the floor is not shown (null). People who started and people who finished are
 * both counted once each, so if they differ by a number from 1 to the floor less one, that small number of people
 * who did not finish would follow: starts (and so the completion rate) is then not shown. Views are events, not people.
 */
export function floorTotals(
  raw: { views: number; starts: number; skips: number },
  responses: number | null,
  min: number,
): SurveyReport["totals"] {
  const f = (c: number) => (c >= min ? c : null);
  const views = f(raw.views);
  let starts = f(raw.starts);
  const skips = f(raw.skips);
  const r = responses != null && responses >= min ? responses : null;
  const gap = (a: number | null, b: number | null) =>
    a != null && b != null && Math.abs(a - b) > 0 && Math.abs(a - b) < min;
  if (gap(starts, r)) starts = null;
  // People who started are never shown while the people who answered are hidden.
  if (r == null) starts = null;
  return {
    views,
    starts,
    skips,
    responses: r,
    completionRate:
      starts != null && r != null && starts > 0 ? pct(r, starts) : null,
  };
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
  if (n < min) {
    return {
      minGroupSize: min,
      belowMinimum: true,
      totals: floorTotals(i.events, null, min),
      questions: [],
      byState: [],
      byStateOther: null,
      byAgeBand: [],
      byAgeBandOther: null,
      note: NOTE,
    };
  }
  /** A count that is the difference between all responses and this one must not be a small one. */
  const smallGap = (c: number) => n - c > 0 && n - c < min;
  const questions = i.questions.map((q) => {
    const rows = i.responses.flatMap((r) =>
      r.answers.filter((a) => a.questionId === q.id),
    );
    // A choice question: shown only when enough people answered and the number who skipped it is not a small one.
    // (If the skipped number were small, the counts shown would add up to `answered` and give it away.)
    const okChoice = rows.length >= min && !smallGap(rows.length);
    const counts = q.options.map(
      (o) => rows.filter((a) => a.optionId === o.id).length,
    );
    const sup = okChoice
      ? suppressSmall(counts, min)
      : { shown: counts.map(() => false), other: null, ok: false };
    const options = q.options.map((o, k) => {
      const hidden = !sup.shown[k];
      return {
        id: o.id,
        label: o.label,
        count: hidden ? null : counts[k],
        share: hidden ? null : pct(counts[k], rows.length),
        hidden,
      };
    });
    // A written or voice question: `answered` is the number of items in the list the brand gets (hidden, empty and
    // scrubbed-to-nothing answers are in neither). The list is shown only when it is not under the floor and the number
    // of responses without an item is not a small one.
    let texts: string[] = [];
    let voices: { transcript: string; seconds: number }[] = [];
    if (free && q.kind === "TEXT")
      texts = rows
        .filter((a) => !a.hidden)
        .map((a) => scrub(a.text ?? "", MAX_SCRUB_CHARS, REMOVED_MARK))
        .filter((t) => t.length > 0)
        .sort((a, b) => a.localeCompare(b));
    if (free && q.kind === "VOICE")
      voices = rows
        .filter(
          (a) => !a.hidden && a.voiceText && a.voiceText.trim().length > 0,
        )
        .map((a) => ({
          transcript: scrub(
            a.voiceText as string,
            MAX_SCRUB_CHARS,
            REMOVED_MARK,
          ),
          seconds: Math.round((a.voiceMs ?? 0) / 1000),
        }))
        .filter((v) => v.transcript.length > 0)
        .sort((a, b) => a.transcript.localeCompare(b.transcript));
    const listed = q.kind === "TEXT" ? texts.length : voices.length;
    const okFree = listed >= min && !smallGap(listed);
    if (!okFree) {
      texts = [];
      voices = [];
    }
    const isChoice = q.kind === "SINGLE_CHOICE";
    return {
      id: q.id,
      position: q.position,
      kind: q.kind,
      prompt: q.prompt,
      answered: isChoice
        ? okChoice && sup.ok
          ? rows.length
          : null
        : free && okFree
          ? listed
          : null,
      options: isChoice ? options : [],
      other:
        isChoice && sup.other != null
          ? {
              label: "Other",
              count: sup.other,
              share: pct(sup.other, rows.length),
            }
          : null,
      texts,
      voices,
    };
  });
  // A breakdown only from people who agreed to share. Its shares are of the people who shared, so the people who did
  // not share cannot be worked out; if that group is itself small and not empty, the breakdown is not shown at all.
  const group = (
    pick: (r: ReportResponse) => string | null,
  ): {
    rows: { key: string; responses: number; share: number }[];
    other: { responses: number; share: number } | null;
  } => {
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
    if (!sup.ok) return { rows: [], other: null };
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
  const stateShared = i.responses.filter((r) => r.shareDemo && r.state).length;
  const ageShared = i.responses.filter((r) => r.shareDemo && r.ageBand).length;
  const states = group((r) => r.state);
  // Two breakdowns whose shared totals differ by a small number would give that small group away (people who shared
  // one and not the other). The second is then left out whole.
  const statesShown = states.rows.length > 0 || states.other != null;
  const ages =
    statesShown &&
    ageShared !== stateShared &&
    Math.abs(ageShared - stateShared) < min
      ? { rows: [], other: null }
      : group((r) => r.ageBand);
  return {
    minGroupSize: min,
    belowMinimum: false,
    totals: floorTotals(i.events, n, min),
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

/**
 * The brand's released report: the frozen counts of `snap`, and for written and voice questions the free answers left in
 * (`withFree`, built with free answers on). For such a question `answered` is the number of items in the list the brand gets.
 */
export function mergeFree(
  snap: SurveyReport,
  withFree: SurveyReport,
): SurveyReport {
  const free = new Map(withFree.questions.map((q) => [q.id, q]));
  return {
    ...snap,
    questions: snap.questions.map((q) => ({
      ...q,
      answered:
        q.kind === "SINGLE_CHOICE"
          ? q.answered
          : (free.get(q.id)?.answered ?? null),
      texts: free.get(q.id)?.texts ?? [],
      voices: free.get(q.id)?.voices ?? [],
    })),
  };
}
