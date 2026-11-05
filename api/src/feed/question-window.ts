import type { Prisma } from "../generated/prisma/client";

/**
 * V-27: a question is OPEN when startsAt <= now < endsAt (the end of its window) and its stored status is not
 * CLOSED (or DRAFT). The stored SCHEDULED or LIVE value never decides it on its own: the seed stores every daily
 * question as SCHEDULED and nothing flips it. An override sets LIVE itself, with no start date: it is open until endsAt.
 * Feed, talk, vote and reach all ask this one helper.
 */
export interface QuestionWindow {
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

export function isQuestionOpen(q: QuestionWindow, now: Date): boolean {
  if (q.status !== "SCHEDULED" && q.status !== "LIVE") return false;
  if (q.startsAt ? now < q.startsAt : q.status !== "LIVE") return false;
  if (q.endsAt && now >= q.endsAt) return false;
  return true;
}

/** Past its window (or stored CLOSED): answers and replies are refused with QUESTION_CLOSED. */
export function isQuestionOver(q: QuestionWindow, now: Date): boolean {
  if (q.status === "CLOSED") return true;
  return (
    (q.status === "SCHEDULED" || q.status === "LIVE") &&
    !!q.endsAt &&
    now >= q.endsAt
  );
}

/** The same rule as a Prisma filter. */
export const questionOpenWhere = (now: Date): Prisma.QuestionWhereInput => ({
  status: { in: ["SCHEDULED", "LIVE"] },
  AND: [
    {
      OR: [{ startsAt: { lte: now } }, { startsAt: null, status: "LIVE" }],
    },
    { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
  ],
});
