import { ConflictException } from "@nestjs/common";
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

/** The same "past its window" rule as a Prisma filter (stored CLOSED, or its window has ended). */
export const questionOverWhere = (now: Date): Prisma.QuestionWhereInput => ({
  OR: [
    { status: "CLOSED" },
    { status: { in: ["SCHEDULED", "LIVE"] }, endsAt: { lte: now } },
  ],
});

/**
 * V-PRELAUNCH: THE test for "may anyone read this question and what is under it": it has opened (inside its window) or
 * is over. Before its window, and for a draft, nothing under it is readable by anyone, its author included. Every read
 * of an answer or a reply asks this, through its question; nobody writes a second version of it.
 */
export function isQuestionReadable(q: QuestionWindow, now: Date): boolean {
  return isQuestionOpen(q, now) || isQuestionOver(q, now);
}

/** isQuestionReadable as a Prisma filter on a question. */
export const questionReadableWhere = (
  now: Date,
): Prisma.QuestionWhereInput => ({
  OR: [questionOpenWhere(now), questionOverWhere(now)],
});

/** isQuestionReadable as a Prisma filter on an answer, through its question. AND-ed in, so it is never overwritten. */
export const answerReadableWhere = (now: Date): Prisma.AnswerWhereInput => ({
  question: questionReadableWhere(now),
});

/** The same, for a reply (through its answer's question). */
export const replyReadableWhere = (now: Date): Prisma.ReplyWhereInput => ({
  answer: answerReadableWhere(now),
});

/** "Sunday 15 November", the Lagos calendar day of an instant. */
export function lagosDateWords(at: Date): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("weekday")} ${g("day")} ${g("month")}`;
}

/**
 * V-PRELAUNCH: someone posts, reacts, votes or saves on a question that is scheduled and has not opened yet. A plain
 * refusal that says when, not a bare "not found". null when this is not that case (a draft, an unknown question or one
 * with no start date), so the caller keeps its own answer.
 */
export function notOpenYet(
  q: QuestionWindow,
  now: Date,
): ConflictException | null {
  if (q.status !== "SCHEDULED" || !q.startsAt || now >= q.startsAt) return null;
  return new ConflictException({
    code: "QUESTION_NOT_OPEN",
    message: `This question opens on ${lagosDateWords(q.startsAt)}.`,
  });
}
