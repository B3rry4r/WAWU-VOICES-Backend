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
  questionId: string;
  kind: "TEXT" | "VOICE";
  text: string;
  seconds: number;
}

/** The person's shown (not hidden) written and voice answers, scrubbed exactly as the report scrubs them. */
async function freeAnswersOf(
  tx: Db,
  surveyId: string,
  key: string,
): Promise<Mine[]> {
  const rows = await tx.surveyAnswer.findMany({
    where: {
      hidden: false,
      response: { surveyId, respondentKey: key },
      question: { kind: { in: ["TEXT", "VOICE"] } },
    },
    select: {
      questionId: true,
      text: true,
      clipId: true,
      question: { select: { kind: true } },
    },
  });
  const out: Mine[] = [];
  for (const r of rows) {
    if (r.question.kind === "TEXT") {
      const t = scrub(r.text ?? "", MAX_SCRUB_CHARS, REMOVED_MARK);
      if (t)
        out.push({
          questionId: r.questionId,
          kind: "TEXT",
          text: t,
          seconds: 0,
        });
    } else if (r.clipId) {
      const c = await tx.voiceClip.findFirst({
        where: { id: r.clipId, status: "READY" },
        select: { durationMs: true, transcript: { select: { text: true } } },
      });
      const raw = c?.transcript?.text;
      if (raw && raw.trim()) {
        const t = scrub(raw, MAX_SCRUB_CHARS, REMOVED_MARK);
        if (t)
          out.push({
            questionId: r.questionId,
            kind: "VOICE",
            text: t,
            seconds: Math.round((c?.durationMs ?? 0) / 1000),
          });
      }
    }
  }
  return out;
}

/**
 * The released report without the person's written and voice answers, and nothing else changed: one equal item is taken
 * out of the list of its question (which one of two equal items does not matter, they read the same) and that question's
 * `answered`, which counts the items in the list, falls by one. Counts, "Other", states, age bands and totals are not touched.
 */
export function dropFree(report: SurveyReport, mine: Mine[]): SurveyReport {
  const questions = report.questions.map((q) => ({
    ...q,
    texts: [...q.texts],
    voices: [...q.voices],
  }));
  for (const m of mine) {
    const q = questions.find((x) => x.id === m.questionId);
    if (!q) continue;
    const i =
      m.kind === "TEXT"
        ? q.texts.indexOf(m.text)
        : q.voices.findIndex(
            (v) => v.transcript === m.text && v.seconds === m.seconds,
          );
    if (i < 0) continue;
    if (m.kind === "TEXT") q.texts.splice(i, 1);
    else q.voices.splice(i, 1);
    if (typeof q.answered === "number") q.answered -= 1;
  }
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
 * out of the released report's lists (and the lists' `answered`). Staff totals of a released survey are the stored
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
      ? await freeAnswersOf(tx, id, respondentKey(id, userId))
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
