import type { Prisma } from "../generated/prisma/client";
import { isQuestionOpen, isQuestionOver } from "./question-window";
import { lagosDay, lagosDayEnd, toDay } from "./lagos";

/** A poll is open by its dates (no job flips the stored status). */
export const pollOpenWhere = (now: Date) => ({
  status: { in: ["SCHEDULED", "OPEN"] as ("SCHEDULED" | "OPEN")[] },
  startsAt: { lte: now },
  endsAt: { gt: now },
});

export const questionInclude = (now: Date) =>
  ({
    category: true,
    topic: { select: { title: true, weekNumber: true } },
    overrideQuestion: true,
    _count: { select: { proposals: true } },
    polls: { where: pollOpenWhere(now), select: { id: true }, take: 1 },
    answers: {
      where: { status: "PUBLISHED" as const, anonymous: false },
      orderBy: { createdAt: "desc" as const },
      take: 3,
      select: {
        author: { select: { id: true, handle: true, avatarFileId: true } },
      },
    },
  }) satisfies Prisma.QuestionInclude;
export type QuestionRow = Prisma.QuestionGetPayload<{
  include: ReturnType<typeof questionInclude>;
}>;

export const answerInclude = {
  author: true,
  question: { select: { text: true, category: { select: { name: true } } } },
  clip: { include: { transcript: true } },
} satisfies Prisma.AnswerInclude;
export type AnswerRow = Prisma.AnswerGetPayload<{
  include: typeof answerInclude;
}>;

/** The public URL of a stored file, or null when there is no CDN base to build one from. */
export function fileUrl(key: string | null | undefined): string | null {
  const base = process.env.SPACES_CDN_BASE;
  return key && base ? `${base.replace(/\/$/, "")}/${key}` : null;
}

export interface Viewer {
  userId: string | null;
  guestId: string | null;
  blocked: Set<string>;
}

type Stored = "DRAFT" | "SCHEDULED" | "LIVE" | "CLOSED" | "IN_REVIEW";

/** A scheduled or live row is judged by its dates, so no job has to flip statuses at midnight. */
export function effectiveStatus<S extends Stored>(
  stored: S,
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date,
): Stored {
  if (stored !== "SCHEDULED" && stored !== "LIVE") return stored;
  const w = { status: stored, startsAt, endsAt };
  if (isQuestionOpen(w, now)) return "LIVE";
  return isQuestionOver(w, now) ? "CLOSED" : "SCHEDULED";
}

export function presentCategory(
  c: { id: string; slug: string; name: string; blurb: string | null },
  voicesThisWeek: number,
  questionCount: number,
) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    blurb: c.blurb,
    voicesThisWeek,
    questionCount,
  };
}

export function presentQuestion(
  q: QuestionRow,
  o: {
    now: Date;
    saved: Set<string>;
    catStats: Map<string, { voices: number; questions: number }>;
  },
) {
  const today = lagosDay(o.now);
  const isToday = q.scheduledFor ? toDay(q.scheduledFor) === today : false;
  const status = effectiveStatus(q.status, q.startsAt, q.endsAt, o.now);
  // the daily question shows the clock to the end of the Lagos day; it stays open for the rest of its week
  const endsAt =
    isToday && q.endsAt
      ? new Date(Math.min(q.endsAt.getTime(), lagosDayEnd(today).getTime()))
      : q.endsAt;
  const ov = q.overrideQuestion;
  const stat = q.category ? o.catStats.get(q.category.id) : undefined;
  return {
    iSaved: o.saved.has(q.id),
    recentVoices: q.answers.map((a) => ({
      id: a.author.id,
      handle: a.author.handle,
      avatarUrl: null,
    })),
    id: q.id,
    kind: q.kind,
    status,
    text: q.text,
    hint: q.hint,
    category: q.category
      ? presentCategory(q.category, stat?.voices ?? 0, stat?.questions ?? 0)
      : null,
    topicId: q.topicId,
    topicTitle: q.topic?.title ?? null,
    weekNumber: q.topic?.weekNumber ?? null,
    scheduledFor: toDay(q.scheduledFor),
    startsAt: q.startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    pinned: q.pinned,
    sensitive: q.sensitive,
    voiceCount: q.voiceCount,
    answerCount: q.answerCount,
    hasOpenPoll: q.polls.length > 0,
    proposalCount: q._count.proposals,
    override: ov
      ? {
          contentKind: ov.contentKind,
          body: ov.body,
          audioUrl: null,
          imageUrl: null,
          linkUrl: ov.linkUrl,
          endsAt: ov.endsAt.toISOString(),
        }
      : null,
  };
}

const LABEL_BY_REACTION: Record<string, string> = {
  RELATABLE: "MOST_RELATABLE",
  THOUGHT_PROVOKING: "MOST_THOUGHT_PROVOKING",
  SURPRISING: "MOST_SURPRISING",
  WELL_SAID: "MOST_SUPPORTED",
};

export function presentAnswer(
  a: AnswerRow,
  o: {
    viewer: Viewer;
    breakdown: Map<string, { kind: string; count: number }[]>;
    myReaction: Map<string, string>;
    liked: Set<string>;
    saved: Set<string>;
    trending?: boolean;
  },
) {
  const breakdown = (o.breakdown.get(a.id) ?? [])
    .slice()
    .sort((x, y) => y.count - x.count);
  const labels: string[] = [];
  if (o.trending) labels.push("TRENDING");
  const top = breakdown[0];
  if (top && LABEL_BY_REACTION[top.kind])
    labels.push(LABEL_BY_REACTION[top.kind]);
  if (
    a.debateScore > 0 &&
    a.agreeCount > 0 &&
    a.disagreeCount > 0 &&
    a.debateScore >= 1
  )
    labels.push("MOST_DEBATED");
  const clip = a.clip && a.clip.status !== "REMOVED" ? a.clip : null;
  return {
    categoryName: a.question.category?.name ?? null,
    id: a.id,
    questionId: a.questionId,
    author: a.anonymous
      ? null
      : {
          id: a.author.id,
          handle: a.author.handle,
          displayName: a.author.displayName,
          state: a.author.state,
          avatarUrl: null,
        },
    kind: a.kind,
    body: a.body,
    clip: clip
      ? {
          id: clip.id,
          status: clip.status,
          durationMs: clip.durationMs,
          maxDurationMs: clip.maxDurationMs,
          peaks: Array.isArray(clip.peaks) ? (clip.peaks as number[]) : null,
          transcript: clip.transcript
            ? {
                status: clip.transcript.status,
                language: clip.transcript.language,
                text: clip.transcript.text,
              }
            : null,
        }
      : null,
    createdAt: a.createdAt.toISOString(),
    editedAt: a.editedAt?.toISOString() ?? null,
    status: a.status,
    news:
      a.isNews && a.newsTag
        ? {
            tag: a.newsTag,
            sourceName: a.newsSourceName,
            sourceUrl: a.newsSourceUrl,
            chosenBy: a.newsTag === "VERIFIED_NEWS" ? "WAWU editors" : "author",
            chosenAt: a.createdAt.toISOString(),
          }
        : null,
    likeCount: a.likeCount,
    replyCount: a.replyCount,
    agreeCount: a.agreeCount,
    disagreeCount: a.disagreeCount,
    reactionCount: a.reactionCount,
    reactionBreakdown: breakdown,
    myReaction: o.myReaction.get(a.id) ?? null,
    iLiked: o.liked.has(a.id),
    iSaved: o.saved.has(a.id),
    isMine: o.viewer.userId === a.authorId,
    labels,
    questionText: a.question.text,
    explainsVote: a.explainsVoteId !== null,
  };
}

export function presentTopic(
  t: {
    id: string;
    weekNumber: number;
    title: string;
    blurb: string | null;
    countryCode: string;
    startsOn: Date;
    endsOn: Date;
    status: Stored;
    sensitive: boolean;
    questionCount: number;
    whatNextPrompt: string | null;
  },
  extra: {
    voiceCount: number;
    weeklyPollId: string | null;
    reportId: string | null;
  },
  now: Date,
) {
  const start = t.startsOn.toISOString().slice(0, 10);
  const end = t.endsOn.toISOString().slice(0, 10);
  const startAt = new Date(Date.parse(`${start}T00:00:00Z`) - 3_600_000);
  const endAt = lagosDayEnd(end);
  return {
    questionCount: t.questionCount,
    id: t.id,
    weekNumber: t.weekNumber,
    title: t.title,
    blurb: t.blurb,
    countryCode: t.countryCode,
    startsOn: start,
    endsOn: end,
    status: effectiveStatus(t.status, startAt, endAt, now),
    sensitive: t.sensitive,
    whatNextPrompt: t.whatNextPrompt,
    voiceCount: extra.voiceCount,
    weeklyPollId: extra.weeklyPollId,
    reportId: extra.reportId,
  };
}
