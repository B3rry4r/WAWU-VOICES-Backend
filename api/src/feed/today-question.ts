import type { Prisma } from "../generated/prisma/client";
import type { PrismaService } from "../common/prisma/prisma.service";
import { dateOnly, lagosDay } from "./lagos";

/**
 * The question Home and /questions/today show: the live override if there is one, else today's daily question; before
 * launch, the next one to come. V-26: whatever this returns is readable by id even before it opens (as "coming up").
 * Share links (reach/share-subject.ts) ask this same function, so "shown as coming up" is decided here and only here.
 */
export async function todayQuestionId(
  db: PrismaService,
  now: Date,
): Promise<string | null> {
  const ov = await db.override.findFirst({
    where: {
      status: { in: ["SCHEDULED", "LIVE"] },
      startsAt: { lte: now },
      endsAt: { gt: now },
      cancelledAt: null,
    },
    orderBy: { startsAt: "desc" },
    select: { questionId: true },
  });
  if (ov) {
    const q = await db.question.findUnique({
      where: { id: ov.questionId },
      select: { id: true },
    });
    if (q) return q.id;
  }
  const today = dateOnly(lagosDay(now));
  const dailyOk: Prisma.QuestionWhereInput = {
    kind: "DAILY",
    status: { in: ["SCHEDULED", "LIVE"] },
    isSpare: false,
  };
  const row =
    (await db.question.findFirst({
      where: { ...dailyOk, scheduledFor: today },
      orderBy: { pinned: "desc" },
      select: { id: true },
    })) ??
    (await db.question.findFirst({
      where: { ...dailyOk, scheduledFor: { gt: today } },
      orderBy: { scheduledFor: "asc" },
      select: { id: true },
    }));
  return row?.id ?? null;
}
