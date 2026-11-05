import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { clipView, type ClipRow } from "../media/clips.service";
import type {
  Answer,
  Category,
  Question,
  Reaction,
  Reply,
  User,
  ReactionKind,
} from "../generated/prisma/client";

export const REACTION_KINDS: {
  kind: ReactionKind;
  emoji: string;
  name: string;
}[] = [
  { kind: "POWERFUL", emoji: "\u{1F525}", name: "Powerful" },
  { kind: "WILD", emoji: "\u{1F480}", name: "Wild" },
  { kind: "RELATABLE", emoji: "❤️", name: "Relatable" },
  { kind: "FUNNY", emoji: "\u{1F602}", name: "Funny" },
  { kind: "SURPRISING", emoji: "\u{1F62E}", name: "Surprising" },
  { kind: "SAD", emoji: "\u{1F622}", name: "Sad" },
  { kind: "WELL_SAID", emoji: "\u{1F44F}", name: "Well said" },
  { kind: "THOUGHT_PROVOKING", emoji: "\u{1F914}", name: "Thought-provoking" },
  { kind: "EXACTLY", emoji: "\u{1F4AF}", name: "Exactly" },
  { kind: "DISAGREE", emoji: "\u{1F44E}", name: "Disagree" },
];

export type AnswerRow = Answer & {
  author: User;
  clip: ClipRow | null;
  question: Question & { category: Category | null };
};
export type ReplyRow = Reply & { author: User; clip: ClipRow | null };

export function authorRef(u: User) {
  return {
    id: u.id,
    handle: u.handle,
    displayName: u.displayName,
    state: u.state,
    avatarUrl: null as string | null,
  };
}

@Injectable()
export class Views {
  constructor(private readonly prisma: PrismaService) {}

  async breakdowns(answerIds: string[]) {
    const rows = answerIds.length
      ? await this.prisma.reaction.groupBy({
          by: ["answerId", "kind"],
          where: { answerId: { in: answerIds } },
          _count: { _all: true },
        })
      : [];
    const out = new Map<string, { kind: ReactionKind; count: number }[]>();
    for (const r of rows) {
      const list = out.get(r.answerId) ?? [];
      list.push({ kind: r.kind, count: r._count._all });
      out.set(r.answerId, list);
    }
    for (const list of out.values())
      list.sort(
        (a, b) =>
          REACTION_KINDS.findIndex((k) => k.kind === a.kind) -
          REACTION_KINDS.findIndex((k) => k.kind === b.kind),
      );
    return out;
  }

  async answers(rows: AnswerRow[], viewerId: string | null) {
    const ids = rows.map((r) => r.id);
    const [breakdown, mine, likes, saves] = await Promise.all([
      this.breakdowns(ids),
      viewerId && ids.length
        ? this.prisma.reaction.findMany({
            where: { answerId: { in: ids }, userId: viewerId },
          })
        : Promise.resolve([] as Reaction[]),
      viewerId && ids.length
        ? this.prisma.like.findMany({
            where: { answerId: { in: ids }, userId: viewerId },
            select: { answerId: true },
          })
        : Promise.resolve([]),
      viewerId && ids.length
        ? this.prisma.save.findMany({
            where: { answerId: { in: ids }, userId: viewerId },
            select: { answerId: true },
          })
        : Promise.resolve([]),
    ]);
    const myBy = new Map(mine.map((r) => [r.answerId, r.kind]));
    const liked = new Set(likes.map((l) => l.answerId));
    const saved = new Set(saves.map((s) => s.answerId));
    return rows.map((a) =>
      this.answer(a, viewerId, {
        breakdown: breakdown.get(a.id) ?? [],
        my: myBy.get(a.id) ?? null,
        liked: liked.has(a.id),
        saved: saved.has(a.id),
      }),
    );
  }

  answer(
    a: AnswerRow,
    viewerId: string | null,
    x: {
      breakdown: { kind: ReactionKind; count: number }[];
      my: ReactionKind | null;
      liked: boolean;
      saved: boolean;
    },
  ) {
    return {
      id: a.id,
      questionId: a.questionId,
      questionText: a.question.text,
      categoryName: a.question.category?.name ?? null,
      author: a.anonymous ? null : authorRef(a.author),
      kind: a.kind,
      body: a.body,
      clip: a.clip ? clipView(a.clip) : null,
      createdAt: a.createdAt.toISOString(),
      editedAt: a.editedAt ? a.editedAt.toISOString() : null,
      status: a.status,
      news:
        a.isNews && a.newsTag
          ? {
              tag: a.newsTag,
              sourceName: a.newsSourceName,
              sourceUrl: a.newsSourceUrl,
              chosenBy: "AUTHOR",
              chosenAt: a.createdAt.toISOString(),
            }
          : null,
      likeCount: a.likeCount,
      replyCount: a.replyCount,
      agreeCount: a.agreeCount,
      disagreeCount: a.disagreeCount,
      reactionCount: a.reactionCount,
      reactionBreakdown: x.breakdown,
      myReaction: x.my,
      iLiked: x.liked,
      iSaved: x.saved,
      isMine: !!viewerId && a.authorId === viewerId,
      labels: [] as string[],
      explainsVote: a.explainsVoteId !== null,
    };
  }

  reply(r: ReplyRow, viewerId: string | null) {
    return {
      id: r.id,
      answerId: r.answerId,
      author: authorRef(r.author),
      stance: r.stance,
      kind: r.kind,
      body: r.body,
      clip: r.clip ? clipView(r.clip) : null,
      createdAt: r.createdAt.toISOString(),
      status: r.status,
      helpfulCount: r.helpfulCount,
      isMine: !!viewerId && r.authorId === viewerId,
    };
  }
}

export const ANSWER_INCLUDE = {
  author: true,
  clip: { include: { transcript: true } },
  question: { include: { category: true } },
} as const;

export const REPLY_INCLUDE = {
  author: true,
  clip: { include: { transcript: true } },
} as const;
