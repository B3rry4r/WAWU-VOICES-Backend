import { ConflictException } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import type { PrismaService } from "../common/prisma/prisma.service";
import { todayQuestionId } from "./today-question";

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
 * V-PRELAUNCH: "shown as coming up". True for the one question the API itself shows before it opens: the question Home and
 * /questions/today return (today-question.ts: a live override, else today's daily question, else, with none today, the NEXT
 * daily question to come, so the launch question until it opens). The caller has already found the question unreadable
 * (not open, not over). It is that question for as long as nothing is dated today and no live override is set; it stops
 * being one the moment it opens. Three things use it, and nothing else: the read of the question by id before it opens
 * (feed.service.ts question()), the 409 on writes (notOpenYet), and whether a share link may be made (reach/share-subject.ts).
 * Every other unopened question stays 404 for reads and writes alike (V-27).
 */
export async function isShownComingUp(
  db: PrismaService,
  questionId: string,
  now: Date,
): Promise<boolean> {
  return (await todayQuestionId(db, now)) === questionId;
}

/**
 * A write (post, reply, react, like, save, vote on the explanation, proposal) on a question that is shown as coming up:
 * a plain 409 that says when. null for any other question (a draft, an unknown one, a hidden bank question), so the
 * caller keeps its V-27 answer, 404.
 */
export async function notOpenYet(
  db: PrismaService,
  q: QuestionWindow & { id: string },
  now: Date,
): Promise<ConflictException | null> {
  if (q.status !== "SCHEDULED" || !q.startsAt || now >= q.startsAt) return null;
  if (!(await isShownComingUp(db, q.id, now))) return null;
  return new ConflictException({
    code: "QUESTION_NOT_OPEN",
    message: `This question opens on ${lagosDateWords(q.startsAt)}.`,
  });
}

/**
 * C2.1-COST: the questions that are NOT readable now and hold at least one answer, reply or proposal, kept in memory
 * for at most 15 seconds. The hot signed-in routes (/me, /people/{id}, /me/answers, people search, the notification
 * list and unread count) ask this ONE list instead of joining Question in every query: an answer is readable exactly
 * when its question is not in the list (an answer is a post, so its question holds a post). With nothing in the list
 * (the normal state) they run no window join at all. The list is computed with the one rule above
 * (questionReadableWhere), never with a second copy of it.
 *
 * Why a stale list can only hide, never show early: time moves a question one way, not open -> open -> over, so a
 * question that was readable when the list was made stays readable, and a question that was not readable may have
 * opened since (the stale list then hides it for up to 15 seconds longer). Dates and status change another way only
 * through the writes that call invalidateUnreadableQuestions() (listed in docs/lead/reports/C21-cost.md), which drops the
 * list at once, after the write has committed. A question with no post cannot be in the list and cannot get one before
 * it opens (every write on it is refused), so it never needs to be.
 */
export const UNREADABLE_LIST_TTL_MS = 15_000;
let unreadableTtlMs: number | null = null;
let unreadableGen = 0;
let unreadableCache: { at: number; ids: readonly string[] } | null = null;
let unreadableLoading: { gen: number; p: Promise<readonly string[]> } | null =
  null;

/** The cache life in ms: set by setUnreadableListTtl, else QUESTION_WINDOW_LIST_TTL_MS, else 15 seconds. */
function unreadableTtl(): number {
  if (unreadableTtlMs !== null) return unreadableTtlMs;
  const e = process.env.QUESTION_WINDOW_LIST_TTL_MS;
  const n = e === undefined || e === "" ? NaN : Number(e);
  return Number.isFinite(n) && n >= 0
    ? Math.min(n, UNREADABLE_LIST_TTL_MS)
    : UNREADABLE_LIST_TTL_MS;
}

/** For specs: the life of the list (never above 15 seconds), or null for the default. */
export function setUnreadableListTtl(ms: number | null): void {
  unreadableTtlMs = ms === null ? null : Math.min(ms, UNREADABLE_LIST_TTL_MS);
  invalidateUnreadableQuestions();
}

/** Drops the list at once. Call it AFTER any write that changes a question's dates or status has committed. */
export function invalidateUnreadableQuestions(): void {
  unreadableGen++;
  unreadableCache = null;
  unreadableLoading = null;
}

/** The list, straight from the database with the existing rule (no cache). */
export async function loadUnreadableQuestionIds(
  db: PrismaService,
  now: Date,
): Promise<string[]> {
  // The rule is applied in code (isQuestionReadable), not as NOT(questionReadableWhere): in SQL a question with no start or
  // end date makes the readable test NULL, and NOT NULL is NULL, so such a question would drop out of the list.
  const rows = await db.question.findMany({
    where: { OR: [{ answers: { some: {} } }, { proposals: { some: {} } }] },
    select: { id: true, status: true, startsAt: true, endsAt: true },
  });
  return rows.filter((q) => !isQuestionReadable(q, now)).map((q) => q.id);
}

let directRuleOnly = false;

/** For specs: true makes unreadableQuestionIds answer null, so every route that uses it runs the direct rule instead. */
export function setDirectRuleOnly(on: boolean): void {
  directRuleOnly = on;
}

/**
 * Ids of questions that are not readable now and hold at least one answer, reply or proposal (see above). null only
 * while a spec has called setDirectRuleOnly(true): the caller then runs the direct rule.
 */
export async function unreadableQuestionIds(
  db: PrismaService,
  now: Date = new Date(),
): Promise<readonly string[] | null> {
  if (directRuleOnly) return null;
  const ttl = unreadableTtl();
  const t = now.getTime();
  const c = unreadableCache;
  if (c && ttl > 0 && t >= c.at && t - c.at < ttl) return c.ids;
  if (ttl > 0 && unreadableLoading && unreadableLoading.gen === unreadableGen)
    return unreadableLoading.p;
  const gen = unreadableGen;
  const p: Promise<readonly string[]> = loadUnreadableQuestionIds(db, now)
    .then((ids) => {
      // a write that invalidated the list while this ran leaves the answer to this caller only
      if (gen === unreadableGen && ttl > 0) unreadableCache = { at: t, ids };
      return ids;
    })
    .finally(() => {
      if (unreadableLoading?.p === p) unreadableLoading = null;
    });
  if (ttl > 0) unreadableLoading = { gen, p };
  return p;
}

/**
 * The same readable rule for an answer, through the list (unreadableQuestionIds): nothing to add when the list is empty,
 * else `questionId NOT IN (list)`. Equal to answerReadableWhere because an answer is itself a post, so its question is in
 * the list exactly when it is not readable.
 */
export const answerReadableByList = (
  unreadable: readonly string[] | null,
  now: Date = new Date(),
): Prisma.AnswerWhereInput =>
  unreadable === null
    ? answerReadableWhere(now)
    : unreadable.length
      ? { questionId: { notIn: [...unreadable] } }
      : {};
