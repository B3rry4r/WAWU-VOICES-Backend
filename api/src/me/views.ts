import { Injectable, NotFoundException, PipeTransform } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { isVerifiedNow } from "../verify/verified";
import {
  ContentStatus,
  PollStatus,
  QuestionStatus,
} from "../generated/prisma/enums";
import { visibleUser } from "./blocks";
import {
  answerReadableByList,
  answerReadableWhere,
  questionReadableWhere,
  replyReadableWhere,
  unreadableQuestionIds,
} from "../feed/question-window";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id that is not a UUID cannot exist: 404 in the one error shape. */
export class UuidParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value))
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "We could not find that.",
      });
    return value.toLowerCase();
  }
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export interface ClipView {
  id: string;
  status: string;
  durationMs: number | null;
  maxDurationMs: number;
  peaks: number[] | null;
  transcript?: { status: string; language: string | null; text: string | null };
}

export interface ProfileView {
  id: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  voiceCard: ClipView | null;
  countryCode: string;
  state: string | null;
  city: string | null;
  languages: string[];
  joinedAt: string;
  voiceCount: number;
  /** lead ruling WF, 6 Nov (RW1): this person's published top-level answers, voice or text (anonymous ones only on their own page). */
  voicesCount: number;
  replyCount: number;
  reactionsReceived: number;
  /** V-46: an admin approved their ID and bill and their subscription is running. */
  verified: boolean;
}

export interface Viewer {
  userId?: string;
  guestId?: string;
}

type ClipRow = {
  id: string;
  status: string;
  durationMs: number | null;
  maxDurationMs: number;
  peaks: unknown;
  transcript: {
    status: string;
    language: string | null;
    text: string | null;
  } | null;
};

export function clipView(c: ClipRow | null | undefined): ClipView | null {
  if (!c) return null;
  return {
    id: c.id,
    status: c.status,
    durationMs: c.durationMs,
    maxDurationMs: c.maxDurationMs,
    peaks: Array.isArray(c.peaks) ? (c.peaks as number[]) : null,
    ...(c.transcript
      ? {
          transcript: {
            status: c.transcript.status,
            language: c.transcript.language,
            text: c.transcript.text,
          },
        }
      : {}),
  };
}

const CLIP_SELECT = {
  id: true,
  status: true,
  durationMs: true,
  maxDurationMs: true,
  peaks: true,
  transcript: { select: { status: true, language: true, text: true } },
} as const;

/**
 * V-PRELAUNCH: the stored profile counters (voiceCount, replyCount, reactionsReceived) include posts under a question that
 * has not opened. This is how many of each sit there, found as (all) minus (readable, the one rule in
 * feed/question-window.ts), so it is 0 for a person whose posts are all on open questions and their counters are unchanged.
 */
export async function hiddenCounters(
  prisma: PrismaService,
  ids: string[],
  now = new Date(),
  /** C2.1-COST: the list from unreadableQuestionIds; with it the counters come from the list and not from a join. */
  unreadable?: readonly string[] | null,
): Promise<Map<string, { voice: number; reply: number; reactions: number }>> {
  const out = new Map<
    string,
    { voice: number; reply: number; reactions: number }
  >();
  for (const id of ids) out.set(id, { voice: 0, reply: 0, reactions: 0 });
  if (ids.length === 0) return out;
  if (unreadable) {
    if (unreadable.length === 0) return out; // nothing unreadable holds a post: nothing is hidden
    const inList = { in: [...unreadable] };
    const vo = {
      authorId: { in: ids },
      status: ContentStatus.PUBLISHED,
      deletedAt: null,
      clipId: { not: null },
      anonymous: false,
      questionId: inList,
    };
    const [v, r, x] = await Promise.all([
      prisma.answer.groupBy({ by: ["authorId"], where: vo, _count: true }),
      prisma.reply.groupBy({
        by: ["authorId"],
        where: {
          authorId: { in: ids },
          status: ContentStatus.PUBLISHED,
          anonymous: false,
          answer: { questionId: inList },
        },
        _count: true,
      }),
      prisma.reaction.findMany({
        where: { answer: { authorId: { in: ids }, questionId: inList } },
        select: { answer: { select: { authorId: true } } },
      }),
    ]);
    for (const id of ids) {
      const h = out.get(id)!;
      h.voice = v.find((y) => y.authorId === id)?._count ?? 0;
      h.reply = r.find((y) => y.authorId === id)?._count ?? 0;
      h.reactions = x.filter((y) => y.answer.authorId === id).length;
    }
    return out;
  }
  const voice = {
    authorId: { in: ids },
    status: ContentStatus.PUBLISHED,
    deletedAt: null,
    clipId: { not: null },
    anonymous: false,
  };
  // The stored reply counter counts named replies only, so these do too.
  const reply = {
    authorId: { in: ids },
    status: ContentStatus.PUBLISHED,
    anonymous: false,
  };
  const reactionOn = { answer: { authorId: { in: ids } } };
  const readable = answerReadableWhere(now);
  const [vAll, vOk, rAll, rOk, xAll, xOk] = await Promise.all([
    prisma.answer.groupBy({ by: ["authorId"], where: voice, _count: true }),
    prisma.answer.groupBy({
      by: ["authorId"],
      where: { ...voice, ...readable },
      _count: true,
    }),
    prisma.reply.groupBy({ by: ["authorId"], where: reply, _count: true }),
    prisma.reply.groupBy({
      by: ["authorId"],
      where: { ...reply, ...replyReadableWhere(now) },
      _count: true,
    }),
    prisma.reaction.findMany({
      where: reactionOn,
      select: { answer: { select: { authorId: true } } },
    }),
    prisma.reaction.findMany({
      where: { answer: { authorId: { in: ids }, ...readable } },
      select: { answer: { select: { authorId: true } } },
    }),
  ]);
  const n = (rows: { authorId: string; _count: number }[], id: string) =>
    rows.find((r) => r.authorId === id)?._count ?? 0;
  const tally = (rows: { answer: { authorId: string } }[], id: string) =>
    rows.filter((r) => r.answer.authorId === id).length;
  for (const id of ids) {
    const h = out.get(id)!;
    h.voice = n(vAll, id) - n(vOk, id);
    h.reply = n(rAll, id) - n(rOk, id);
    h.reactions = tally(xAll, id) - tally(xOk, id);
  }
  return out;
}

/** Builds the contract's read shapes (Profile, Answer, Reply, Question) for the lists this module serves. */
@Injectable()
export class Views {
  constructor(private readonly prisma: PrismaService) {}

  avatarUrl(key: string | null | undefined): string | null {
    const base = process.env.SPACES_CDN_BASE;
    return key && base ? `${base.replace(/\/$/, "")}/${key}` : null;
  }

  /** Profiles for many people in a fixed number of queries. */
  async profiles(
    ids: string[],
    ownerId?: string,
    /** C2.1-COST: the hot routes (/me, /people/{id}) read the window through the cached list, not a join. */
    viaList = false,
  ): Promise<Map<string, ProfileView>> {
    const out = new Map<string, ProfileView>();
    if (ids.length === 0) return out;
    const unreadable = viaList
      ? await unreadableQuestionIds(this.prisma)
      : null;
    const readable = viaList
      ? answerReadableByList(unreadable ?? null)
      : answerReadableWhere(new Date());
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
    });
    const fileIds = users
      .map((u) => u.avatarFileId)
      .filter((x): x is string => !!x);
    const clipIds = users
      .map((u) => u.voiceCardClipId)
      .filter((x): x is string => !!x);
    const [files, clips] = await Promise.all([
      fileIds.length
        ? this.prisma.storedFile.findMany({ where: { id: { in: fileIds } } })
        : [],
      clipIds.length
        ? this.prisma.voiceClip.findMany({
            where: { id: { in: clipIds }, status: "READY" },
            select: CLIP_SELECT,
          })
        : [],
    ]);
    const [counted, ownAnon] = await Promise.all([
      this.prisma.answer.groupBy({
        by: ["authorId"],
        where: {
          authorId: { in: ids },
          status: ContentStatus.PUBLISHED,
          deletedAt: null,
          anonymous: false,
          ...readable,
        },
        _count: { _all: true },
      }),
      ownerId && ids.includes(ownerId)
        ? this.prisma.answer.count({
            where: {
              authorId: ownerId,
              status: ContentStatus.PUBLISHED,
              deletedAt: null,
              anonymous: true,
              ...readable,
            },
          })
        : 0,
    ]);
    const hidden = await hiddenCounters(
      this.prisma,
      ids,
      new Date(),
      unreadable,
    );
    const voicesOf = new Map(counted.map((c) => [c.authorId, c._count._all]));
    const fileKey = new Map(files.map((f) => [f.id, f.key]));
    const clipById = new Map(clips.map((c) => [c.id, c]));
    for (const u of users) {
      out.set(u.id, {
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        bio: u.bio,
        avatarUrl: this.avatarUrl(
          u.avatarFileId ? fileKey.get(u.avatarFileId) : null,
        ),
        voiceCard: clipView(
          u.voiceCardClipId ? clipById.get(u.voiceCardClipId) : null,
        ),
        countryCode: u.countryCode,
        state: u.state,
        city: u.city,
        languages: u.languages,
        joinedAt: u.createdAt.toISOString(),
        voiceCount: Math.max(0, u.voiceCount - hidden.get(u.id)!.voice),
        voicesCount:
          (voicesOf.get(u.id) ?? 0) + (u.id === ownerId ? ownAnon : 0),
        replyCount: Math.max(0, u.replyCount - hidden.get(u.id)!.reply),
        reactionsReceived: Math.max(
          0,
          u.reactionsReceived - hidden.get(u.id)!.reactions,
        ),
        verified: isVerifiedNow(u),
      });
    }
    return out;
  }

  private async authorRefs(ids: string[]) {
    // C2.1-COST: only the name fields are read here, so the counters behind them come from the cached list (equal result)
    const profiles = await this.profiles(ids, undefined, true);
    return (id: string) => {
      const p = profiles.get(id);
      return p
        ? {
            id: p.id,
            handle: p.handle,
            displayName: p.displayName,
            state: p.state,
            avatarUrl: p.avatarUrl,
            verified: p.verified,
          }
        : null;
    };
  }

  /** Answer rows (loaded with ANSWER_INCLUDE) as the contract's Answer, for this viewer. */
  async answers(
    rows: AnswerRow[],
    viewer: Viewer,
  ): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [authorOf, breakdown, mine, liked, saved, changes] =
      await Promise.all([
        this.authorRefs([...new Set(rows.map((r) => r.authorId))]),
        this.prisma.reaction.groupBy({
          by: ["answerId", "kind"],
          where: { answerId: { in: ids } },
          _count: { _all: true },
        }),
        viewer.userId
          ? this.prisma.reaction.findMany({
              where: { answerId: { in: ids }, userId: viewer.userId },
              select: { answerId: true, kind: true },
            })
          : [],
        viewer.userId || viewer.guestId
          ? this.prisma.like.findMany({
              where: {
                answerId: { in: ids },
                ...(viewer.userId
                  ? { userId: viewer.userId }
                  : { guestId: viewer.guestId }),
              },
              select: { answerId: true },
            })
          : [],
        viewer.userId
          ? this.prisma.save.findMany({
              where: { answerId: { in: ids }, userId: viewer.userId },
              select: { answerId: true },
            })
          : [],
        this.prisma.tagChange.findMany({
          where: { answerId: { in: ids } },
          orderBy: { createdAt: "desc" },
        }),
      ]);
    const bd = new Map<string, { kind: string; count: number }[]>();
    for (const b of breakdown)
      bd.set(b.answerId, [
        ...(bd.get(b.answerId) ?? []),
        { kind: b.kind, count: b._count._all },
      ]);
    const myReaction = new Map(mine.map((m) => [m.answerId, m.kind]));
    const likedSet = new Set(liked.map((l) => l.answerId));
    const savedSet = new Set(saved.map((s) => s.answerId));
    const lastChange = new Map<string, (typeof changes)[number]>();
    for (const c of changes)
      if (!lastChange.has(c.answerId)) lastChange.set(c.answerId, c);
    return rows.map((a) => {
      const change = lastChange.get(a.id);
      const isMine = viewer.userId === a.authorId;
      return {
        id: a.id,
        questionId: a.questionId,
        author: a.anonymous ? null : authorOf(a.authorId),
        kind: a.kind,
        body: a.body,
        clip: clipView(a.clip),
        createdAt: a.createdAt.toISOString(),
        editedAt: a.editedAt ? a.editedAt.toISOString() : null,
        status: a.status,
        news:
          a.isNews && a.newsTag
            ? {
                tag: a.newsTag,
                sourceName: a.newsSourceName,
                sourceUrl: a.newsSourceUrl,
                chosenBy: change
                  ? change.byUserId === a.authorId
                    ? "AUTHOR"
                    : "TEAM"
                  : "AUTHOR",
                chosenAt: (change?.createdAt ?? a.createdAt).toISOString(),
              }
            : null,
        likeCount: a.likeCount,
        replyCount: a.replyCount,
        agreeCount: a.agreeCount,
        disagreeCount: a.disagreeCount,
        reactionCount: a.reactionCount,
        reactionBreakdown: bd.get(a.id) ?? [],
        myReaction: myReaction.get(a.id) ?? null,
        iLiked: likedSet.has(a.id),
        iSaved: savedSet.has(a.id),
        isMine,
        // Labels are written by the ranking job (A2/A3); none are stored for these lists.
        labels: [],
        categoryName: a.question?.category?.name ?? null,
        questionText: a.question?.text ?? null,
        explainsVote: !!a.explainsVoteId,
        mood: a.mood,
      };
    });
  }

  async replies(
    rows: ReplyRow[],
    viewer: Viewer,
  ): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return [];
    const authorOf = await this.authorRefs([
      ...new Set(rows.filter((r) => !r.anonymous).map((r) => r.authorId)),
    ]);
    return rows.map((r) => ({
      id: r.id,
      answerId: r.answerId,
      // V-FIX-D: an unnamed reply has no author for anyone, the writer included (isMine says it is theirs).
      author: r.anonymous ? null : authorOf(r.authorId),
      stance: r.stance,
      kind: r.kind,
      body: r.body,
      clip: clipView(r.clip),
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      helpfulCount: r.helpfulCount,
      isMine: viewer.userId === r.authorId,
    }));
  }

  /** Question rows (loaded with QUESTION_INCLUDE) as the contract's Question, for a viewer who has saved them. */
  async savedQuestions(
    rows: QuestionRow[],
    viewer: Viewer,
  ): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return [];
    const qids = rows.map((q) => q.id);
    const catIds = [
      ...new Set(rows.map((q) => q.categoryId).filter((x): x is string => !!x)),
    ];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [openPolls, proposals, catQuestions, catVoices, recents] =
      await Promise.all([
        this.prisma.poll.groupBy({
          by: ["questionId"],
          where: { questionId: { in: qids }, status: PollStatus.OPEN },
          _count: { _all: true },
        }),
        this.prisma.proposal.groupBy({
          by: ["questionId"],
          where: { questionId: { in: qids }, status: ContentStatus.PUBLISHED },
          _count: { _all: true },
        }),
        catIds.length
          ? this.prisma.question.groupBy({
              by: ["categoryId"],
              where: {
                categoryId: { in: catIds },
                status: { not: QuestionStatus.DRAFT },
                AND: [questionReadableWhere(new Date())],
              },
              _count: { _all: true },
            })
          : [],
        catIds.length
          ? this.prisma.answer.findMany({
              where: {
                status: ContentStatus.PUBLISHED,
                createdAt: { gte: weekAgo },
                question: {
                  AND: [
                    { categoryId: { in: catIds } },
                    questionReadableWhere(new Date()),
                  ],
                },
              },
              select: { question: { select: { categoryId: true } } },
            })
          : [],
        Promise.all(
          qids.map((questionId) =>
            this.prisma.answer.findMany({
              where: {
                questionId,
                status: ContentStatus.PUBLISHED,
                anonymous: false,
                author: visibleUser(viewer.userId),
                ...answerReadableWhere(new Date()),
              },
              orderBy: { createdAt: "desc" },
              distinct: ["authorId"],
              take: 3,
              select: {
                author: {
                  select: { id: true, handle: true, avatarFileId: true },
                },
              },
            }),
          ),
        ),
      ]);
    const files = await this.prisma.storedFile.findMany({
      where: {
        id: {
          in: recents
            .flat()
            .map((r) => r.author.avatarFileId)
            .filter((x): x is string => !!x),
        },
      },
    });
    const fileKey = new Map(files.map((f) => [f.id, f.key]));
    const poll = new Set(openPolls.map((p) => p.questionId));
    const prop = new Map(proposals.map((p) => [p.questionId, p._count._all]));
    const cq = new Map(catQuestions.map((c) => [c.categoryId, c._count._all]));
    const cv = new Map<string, number>();
    for (const a of catVoices) {
      const k = a.question.categoryId;
      if (k) cv.set(k, (cv.get(k) ?? 0) + 1);
    }
    return rows.map((q, i) => ({
      iSaved: true,
      recentVoices: recents[i].map((r) => ({
        id: r.author.id,
        handle: r.author.handle,
        avatarUrl: this.avatarUrl(
          r.author.avatarFileId ? fileKey.get(r.author.avatarFileId) : null,
        ),
      })),
      id: q.id,
      kind: q.kind,
      status: q.status,
      text: q.text,
      hint: q.hint,
      moodOptions: q.moodOptions,
      category: q.category
        ? {
            id: q.category.id,
            slug: q.category.slug,
            name: q.category.name,
            blurb: q.category.blurb,
            voicesThisWeek: cv.get(q.category.id) ?? 0,
            questionCount: cq.get(q.category.id) ?? 0,
          }
        : null,
      topicId: q.topicId,
      topicTitle: q.topic?.title ?? null,
      weekNumber: q.topic?.weekNumber ?? null,
      scheduledFor: q.scheduledFor
        ? q.scheduledFor.toISOString().slice(0, 10)
        : null,
      startsAt: q.startsAt ? q.startsAt.toISOString() : null,
      endsAt: q.endsAt ? q.endsAt.toISOString() : null,
      pinned: q.pinned,
      sensitive: q.sensitive,
      voiceCount: q.voiceCount,
      answerCount: q.answerCount,
      voicesCount: q.answerCount, // lead ruling WF, 6 Nov (RW1)
      hasOpenPoll: poll.has(q.id),
      proposalCount: prop.get(q.id) ?? 0,
    }));
  }
}

export const ANSWER_INCLUDE = {
  clip: { select: CLIP_SELECT },
  question: {
    select: {
      text: true,
      status: true,
      startsAt: true,
      endsAt: true,
      category: { select: { name: true } },
    },
  },
} as const;

export const REPLY_INCLUDE = { clip: { select: CLIP_SELECT } } as const;

export const QUESTION_INCLUDE = {
  category: true,
  topic: { select: { title: true, weekNumber: true } },
} as const;

type AnswerRowBase = Awaited<
  ReturnType<PrismaService["answer"]["findMany"]>
>[number];
export type AnswerRow = AnswerRowBase & {
  clip: ClipRow | null;
  question: { text: string; category: { name: string } | null } | null;
};
type ReplyRowBase = Awaited<
  ReturnType<PrismaService["reply"]["findMany"]>
>[number];
export type ReplyRow = ReplyRowBase & { clip: ClipRow | null };
type QuestionRowBase = Awaited<
  ReturnType<PrismaService["question"]["findMany"]>
>[number];
export type QuestionRow = QuestionRowBase & {
  category: {
    id: string;
    slug: string;
    name: string;
    blurb: string | null;
  } | null;
  topic: { title: string; weekNumber: number } | null;
};
