import type { Prisma } from "../generated/prisma/client";
import { lockRow } from "../admin/trust/common";
import { loadReportInputs } from "./survey-inputs";
import { buildReport, mergeFree } from "./survey-report";
import { respondentKey } from "./survey-rules";

type Db = Prisma.TransactionClient;

const FULL = {
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.SponsoredSurveyInclude;

/**
 * Account deletion (V-SURVEYS round 5, M1). The answer tables hold no person, only respondentKey = HMAC(survey, person).
 * The server can recompute that key, so on purge it does: for every survey that has any answer, the person's response
 * row goes, and with it (cascade) every choice, text and voice answer they gave, all together, so no part is left to
 * stand out. Their voice clips are removed by the purge itself.
 *
 * A survey whose results are already fixed (snapshot) or released to the brand is then rebuilt from the answers that
 * remain, with the same hiding rule as any report (`buildReport`: a group under the floor folds, a count that would
 * differ from the whole by a small number is not shown). The released report is replaced, not patched.
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
    const gone = await tx.surveyResponse.deleteMany({
      where: { surveyId: id, respondentKey: respondentKey(id, userId) },
    });
    removed += gone.count;
    await tx.surveyEvent.deleteMany({
      where: { surveyId: id, userId, kind: { in: ["VIEW", "START", "SKIP"] } },
    });
    const s = await tx.sponsoredSurvey.findUnique({
      where: { id },
      include: FULL,
    });
    if (!s?.snapshotAt) continue;
    const inputs = await loadReportInputs(tx, s);
    const snap = buildReport(inputs, { free: false });
    const data: Prisma.SponsoredSurveyUpdateInput = {
      reportSnapshot: snap as unknown as Prisma.InputJsonValue,
    };
    if (s.releasedAt) {
      const withFree = buildReport(inputs, { free: true });
      data.releasedReport = mergeFree(
        snap,
        withFree,
      ) as unknown as Prisma.InputJsonValue;
      data.releasedHiddenCount = await tx.surveyAnswer.count({
        where: { response: { surveyId: id }, hidden: true },
      });
    }
    await tx.sponsoredSurvey.update({ where: { id }, data });
  }
  return removed;
}
