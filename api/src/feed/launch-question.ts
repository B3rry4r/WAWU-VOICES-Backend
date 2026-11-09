import type { PrismaClient } from "../generated/prisma/client";
import { MOODS } from "../mood/mood";
import { dateOnly, lagosDayStart } from "./lagos";

/** V-31 and V-38 (a): the launch question, on Sunday 15 November 2026. */
export const LAUNCH_QUESTION = {
  seedKey: "launch-mood-1",
  day: "2026-11-15",
  text: "How do you feel about Nigeria right now?",
  hint: "With everything going on, say it in your voice. 10 seconds.",
} as const;

export interface LaunchSeedResult {
  created: boolean;
  /** The question that held the day and now sits in the week's held bank (spare), or null when the day was empty. */
  heldQuestionId: string | null;
}

/**
 * Puts the launch question on its day, idempotently. The question the day held is not deleted and not shifted: it moves
 * to the week's spare bank (isSpare, no slot, no date), the same state an admin "override the day" leaves it in, so an
 * editor can schedule it again from the calendar. The other days of the week stay where they are. Needs the question
 * bank to be seeded first (npm run seed:questions), because the launch question joins that day's week.
 */
export async function seedLaunchQuestion(
  db: PrismaClient,
): Promise<LaunchSeedResult> {
  const have = await db.question.findUnique({
    where: { seedKey: LAUNCH_QUESTION.seedKey },
    select: { id: true },
  });
  if (have) return { created: false, heldQuestionId: null };

  const day = dateOnly(LAUNCH_QUESTION.day);
  return db.$transaction(async (tx) => {
    const topic = await tx.topic.findFirst({
      where: { startsOn: { lte: day }, endsOn: { gte: day } },
    });
    if (!topic)
      throw new Error(
        `no week covers ${LAUNCH_QUESTION.day}: run seed:questions first`,
      );
    const held = await tx.question.findFirst({
      where: {
        kind: "DAILY",
        isSpare: false,
        scheduledFor: day,
        status: { in: ["DRAFT", "SCHEDULED", "LIVE"] },
      },
      orderBy: [{ pinned: "desc" }, { slotIndex: "asc" }],
    });
    if (held)
      await tx.question.update({
        where: { id: held.id },
        data: {
          isSpare: true,
          slotIndex: null,
          scheduledFor: null,
          startsAt: null,
          endsAt: null,
          pinned: false,
          status: held.status === "LIVE" ? "SCHEDULED" : held.status,
        },
      });
    const lastSlot = await tx.question.findFirst({
      where: { topicId: topic.id, isSpare: false, slotIndex: { not: null } },
      orderBy: { slotIndex: "desc" },
      select: { endsAt: true },
    });
    await tx.question.create({
      data: {
        seedKey: LAUNCH_QUESTION.seedKey,
        topicId: topic.id,
        categoryId: held?.categoryId ?? null,
        kind: "DAILY",
        status: "SCHEDULED",
        text: LAUNCH_QUESTION.text,
        hint: LAUNCH_QUESTION.hint,
        scheduledFor: day,
        slotIndex: held?.slotIndex ?? null,
        isSpare: false,
        startsAt: lagosDayStart(LAUNCH_QUESTION.day),
        // answerable from its day to the end of its week, like every seeded daily question
        endsAt: held?.endsAt ?? lastSlot?.endsAt ?? null,
        sensitive: false,
        moodOptions: [...MOODS],
      },
    });
    return { created: true, heldQuestionId: held?.id ?? null };
  });
}
