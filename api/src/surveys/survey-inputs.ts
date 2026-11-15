import type { Prisma } from "../generated/prisma/client";

type Db = Prisma.TransactionClient;

export const surveyFull = {
  questions: {
    orderBy: { position: "asc" },
    include: { options: { orderBy: { position: "asc" } } },
  },
} satisfies Prisma.SponsoredSurveyInclude;

export type FullSurvey = Prisma.SponsoredSurveyGetPayload<{
  include: typeof surveyFull;
}>;

export async function minGroup(db: Pick<Db, "configEntry">): Promise<number> {
  const row = await db.configEntry.findUnique({
    where: { key: "weekly.min_group_size" },
  });
  return typeof row?.valueJson === "number" ? row.valueJson : 20;
}

/** The stored answers of a survey as the report builder wants them: no person on them. */
export async function loadReportInputs(db: Db, s: FullSurvey) {
  const [responses, evs] = await Promise.all([
    db.surveyResponse.findMany({
      where: { surveyId: s.id },
      select: {
        shareDemo: true,
        state: true,
        ageBand: true,
        answers: {
          select: {
            id: true,
            hidden: true,
            questionId: true,
            optionId: true,
            text: true,
            clipId: true,
          },
        },
      },
    }),
    db.surveyEvent.groupBy({
      by: ["kind"],
      where: { surveyId: s.id },
      _count: { _all: true },
    }),
  ]);
  const clipIds = responses.flatMap((r) =>
    r.answers.flatMap((a) => (a.clipId ? [a.clipId] : [])),
  );
  const clips = clipIds.length
    ? await db.voiceClip.findMany({
        where: { id: { in: clipIds }, status: "READY" },
        select: {
          id: true,
          durationMs: true,
          transcript: { select: { text: true } },
        },
      })
    : [];
  const clip = new Map(clips.map((c) => [c.id, c]));
  const n = (k: string) =>
    evs.find((e) => (e.kind as string) === k)?._count._all ?? 0;
  return {
    minGroup: await minGroup(db),
    questions: s.questions.map((q) => ({
      id: q.id,
      position: q.position,
      kind: q.kind,
      prompt: q.prompt,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    })),
    responses: responses.map((r) => ({
      shareDemo: r.shareDemo,
      state: r.state,
      ageBand: r.ageBand,
      answers: r.answers.map((a) => ({
        id: a.id,
        hidden: a.hidden,
        questionId: a.questionId,
        optionId: a.optionId,
        text: a.text,
        voiceText: a.clipId
          ? (clip.get(a.clipId)?.transcript?.text ?? null)
          : null,
        voiceMs: a.clipId ? (clip.get(a.clipId)?.durationMs ?? null) : null,
      })),
    })),
    events: { views: n("VIEW"), starts: n("START"), skips: n("SKIP") },
  };
}
