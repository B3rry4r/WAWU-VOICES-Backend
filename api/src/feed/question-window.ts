import type { Prisma } from "../generated/prisma/client";

/**
 * V-27: a question is OPEN when startsAt <= now < endsAt (the end of its window) and its stored status is not
 * CLOSED (or DRAFT). The stored SCHEDULED or LIVE value never decides it on its own: the seed stores every daily
 * question as SCHEDULED and nothing flips it. An override sets LIVE itself, with no start date: it is open until endsAt.
 * Feed, talk, vote and reach all ask this one helper. The same rule gives polls their status (vote/poll.service.ts).
 *
 * What the window means for each action (lead ruling, V-27 detail):
 * - BEFORE the window: nothing at all. The question and every route under it answer 404 to the public: answers, replies,
 *   proposals, proposal stances, explain-my-vote, saves, reactions, likes, helpful marks, shares.
 * - AFTER the window: NEW CONTRIBUTIONS are refused with 409 QUESTION_CLOSED: answers, replies, votes (POLL_CLOSED),
 *   explain-my-vote, proposals, and proposal stances (support, challenge, improve).
 * - AFTER the window, ENGAGEMENT stays open: reactions, likes, helpful marks, saves, shares and reports.
 * `isQuestionOpen` is "inside", `isQuestionOver` is "after"; neither is "before" (a draft is also neither).
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

/**
 * V-FIX-B round 2: a question people can read, which is open or over. One that has not opened yet, and a draft, is neither,
 * so nothing is announced from it and nothing under it is listed. The same rule as isQuestionOpen or isQuestionOver.
 */
export function isQuestionReadable(q: QuestionWindow, now: Date): boolean {
  return isQuestionOpen(q, now) || isQuestionOver(q, now);
}

/** The same rule as a Prisma filter. */
export const questionReadableWhere = (
  now: Date,
): Prisma.QuestionWhereInput => ({
  OR: [
    questionOpenWhere(now),
    { status: "CLOSED" },
    { status: { in: ["SCHEDULED", "LIVE"] }, endsAt: { lte: now } },
  ],
});
