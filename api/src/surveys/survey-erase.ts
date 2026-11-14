import type { Prisma } from "../generated/prisma/client";
import { lockRow } from "../admin/trust/common";
import { loadReportInputs } from "./survey-inputs";
import { buildReport, type SurveyReport } from "./survey-report";
import { MAX_SCRUB_CHARS, REMOVED_MARK, scrub } from "../reach/scrub";
import { respondentKey } from "./survey-rules";

type Db = Prisma.TransactionClient;

const FULL = {
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.SponsoredSurveyInclude;

interface Mine {
  /** The answer row's id: the only thing a stored report with ids is matched by. */
  answerId: string;
  questionId: string;
  kind: "TEXT" | "VOICE";
  text: string;
  seconds: number;
  /** For a stored report without ids: the answer and its transcript both existed before the release. */
  beforeRelease: boolean;
}

/**
 * The person's own written and voice answers (hidden or not): their ids, and their text as the report scrubs it, so a
 * stored report from before answer ids were kept can still be matched, and only when it is safe to.
 */
async function freeAnswersOf(
  tx: Db,
  surveyId: string,
  key: string,
  releasedAt: Date,
): Promise<Mine[]> {
  const rows = await tx.surveyAnswer.findMany({
    where: {
      response: { surveyId, respondentKey: key },
      question: { kind: { in: ["TEXT", "VOICE"] } },
    },
    select: {
      id: true,
      questionId: true,
      text: true,
      clipId: true,
      createdAt: true,
      question: { select: { kind: true } },
    },
  });
  const out: Mine[] = [];
  for (const r of rows) {
    const before = r.createdAt.getTime() < releasedAt.getTime();
    if (r.question.kind === "TEXT") {
      out.push({
        answerId: r.id,
        questionId: r.questionId,
        kind: "TEXT",
        text: scrub(r.text ?? "", MAX_SCRUB_CHARS, REMOVED_MARK),
        seconds: 0,
        beforeRelease: before,
      });
    } else if (r.clipId) {
      const c = await tx.voiceClip.findFirst({
        where: { id: r.clipId, status: "READY" },
        select: {
          durationMs: true,
          transcript: {
            select: { text: true, createdAt: true, readyAt: true },
          },
        },
      });
      const tr = c?.transcript;
      const raw = tr?.text;
      const seen = tr ? (tr.readyAt ?? tr.createdAt) : null;
      out.push({
        answerId: r.id,
        questionId: r.questionId,
        kind: "VOICE",
        text: raw && raw.trim() ? scrub(raw, MAX_SCRUB_CHARS, REMOVED_MARK) : "",
        seconds: Math.round((c?.durationMs ?? 0) / 1000),
        beforeRelease:
          before && !!seen && seen.getTime() < releasedAt.getTime(),
      });
    }
  }
  return out;
}

/**
 * The released report without the purged person's own listed items, and nothing else changed (owner: "Numbers stay"):
 * every number, including each question's `answered`, is as released.
 *
 * A stored report with answer ids (every report released from round 7 on): exactly the items whose answer id is one of
 * the person's answer ids go. A person with no item in the list loses nothing, whatever another person's text says.
 * A stored report without ids (none is expected): an item goes only on an exact text match AND when the person's answer
 * and its transcript existed before the release.
 */
export function dropFree(report: SurveyReport, mine: Mine[]): SurveyReport {
  const ids = new Set(mine.map((m) => m.answerId));
  const questions = report.questions.map((q) => {
    const keepT: boolean[] = q.texts.map(() => true);
    const keepV: boolean[] = q.voices.map(() => true);
    if (q.textIds && q.voiceIds) {
      q.textIds.forEach((id, i) => {
        if (ids.has(id)) keepT[i] = false;
      });
      q.voiceIds.forEach((id, i) => {
        if (ids.has(id)) keepV[i] = false;
      });
    } else {
      for (const m of mine) {
        if (m.questionId !== q.id || !m.beforeRelease || !m.text) continue;
        if (m.kind === "TEXT") {
          const i = q.texts.findIndex((t, k) => keepT[k] && t === m.text);
          if (i >= 0) keepT[i] = false;
        } else {
          const i = q.voices.findIndex(
            (v, k) =>
              keepV[k] && v.transcript === m.text && v.seconds === m.seconds,
          );
          if (i >= 0) keepV[i] = false;
        }
      }
    }
    const f = <T>(a: T[], k: boolean[]) => a.filter((_, i) => k[i]);
    return {
      ...q,
      texts: f(q.texts, keepT),
      voices: f(q.voices, keepV),
      ...(q.textIds && q.voiceIds
        ? { textIds: f(q.textIds, keepT), voiceIds: f(q.voiceIds, keepV) }
        : {}),
    };
  });
  return { ...report, questions };
}

/**
 * Account deletion (V-SURVEYS round 5, M1). The answer tables hold no person, only respondentKey = HMAC(survey, person).
 * The server can recompute that key, so on purge it does: for every survey that has any answer, the person's response
 * row goes, and with it (cascade) every choice, text and voice answer they gave, all together, so no part is left to
 * stand out. Their voice clips are removed by the purge itself.
 *
 * A survey whose results are fixed but not released (in review) is rebuilt from the answers that remain, with the same
 * hiding rule as any report. A RELEASED survey keeps every number it was released with (owner, 14 Nov 2026: "Numbers
 * stay"): its released report and snapshot are not rebuilt; only the person's own written and voice answers are taken
 * out of the released report's lists (by their answer ids; `answered` stays as released). Staff totals of a released survey are the stored
 * `releasedTotals`.
 *
 * The person's own VIEW, START and SKIP rows for each survey they answered are deleted too (with their id), in the same
 * transaction, so `starts` falls with `responses`. `completes` is served from the response count, never from the COMPLETE
 * rows (which carry no person), so it falls with `responses` and cannot drift. Call this BEFORE any step that clears the
 * user id on survey events, or those rows can no longer be found.
 *
 * Returns how many answer sets were removed.
 */
export async function eraseSurveyAnswers(
  tx: Db,
  userId: string,
): Promise<number> {
  const surveys = await tx.sponsoredSurvey.findMany({
    where: { responses: { some: {} } },
    select: { id: true },
  });
  let removed = 0;
  for (const { id } of surveys) {
    const hit = await tx.surveyResponse.findFirst({
      where: { surveyId: id, respondentKey: respondentKey(id, userId) },
      select: { id: true },
    });
    if (!hit) continue;
    await lockRow(tx, "SponsoredSurvey", "id", id);
    const before = await tx.sponsoredSurvey.findUnique({
      where: { id },
      include: FULL,
    });
    // A released survey: its numbers stay exactly as released. Only the person's own written and voice answers are taken
    // out of the stored report, found by their answer rows now, before those rows are deleted.
    const mine = before?.releasedAt
      ? await freeAnswersOf(
          tx,
          id,
          respondentKey(id, userId),
          before.releasedAt,
        )
      : [];
    const gone = await tx.surveyResponse.deleteMany({
      where: { surveyId: id, respondentKey: respondentKey(id, userId) },
    });
    removed += gone.count;
    await tx.surveyEvent.deleteMany({
      where: { surveyId: id, userId, kind: { in: ["VIEW", "START", "SKIP"] } },
    });
    if (!before?.snapshotAt) continue;
    if (before.releasedAt) {
      if (before.releasedReport && mine.length)
        await tx.sponsoredSurvey.update({
          where: { id },
          data: {
            releasedReport: dropFree(
              before.releasedReport as unknown as SurveyReport,
              mine,
            ) as unknown as Prisma.InputJsonValue,
          },
        });
      continue;
    }
    // Not released yet (in review): the fixed results are rebuilt from the answers that remain.
    const inputs = await loadReportInputs(tx, before);
    const snap = buildReport(inputs, { free: false });
    await tx.sponsoredSurvey.update({
      where: { id },
      data: { reportSnapshot: snap as unknown as Prisma.InputJsonValue },
    });
  }
  return removed;
}
