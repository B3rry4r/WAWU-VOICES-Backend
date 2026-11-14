import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { VoicesUser } from "../common/auth/voices-user";
import type { NewsTag, Prisma } from "../generated/prisma/client";
import { ActorService, type Actor } from "../results/actor.service";
import { AUTHOR_SELECT, authorRefs } from "../results/author";
import { decodeCursor, encodeCursor, pageLimit } from "../results/cursor";
import { checkSourceUrl } from "./source-url";
import { questionReadableWhere } from "../feed/question-window";

const TAGS: NewsTag[] = ["VERIFIED_NEWS", "UNVERIFIED_NEWS", "GOSSIP"];

/** Plain-language disclaimers: the exact words of the Newsroom board (docs/boards/Newsroom.md, "What the tags mean"). Counsel reviews this wording before launch. */
export const TAG_INFO: Record<NewsTag, { label: string; meaning: string }> = {
  VERIFIED_NEWS: {
    label: "Verified News",
    meaning:
      "Confirmed by WAWU’s editors against a named source. The source is linked.",
  },
  UNVERIFIED_NEWS: {
    label: "Unverified News",
    meaning: "A news claim WAWU has not confirmed. Treat it with care.",
  },
  GOSSIP: {
    label: "Gossip",
    meaning: "Talk, rumour or opinion. Not presented as fact.",
  },
};

const ANSWER_INCLUDE = {
  question: { select: { text: true, category: { select: { name: true } } } },
  clip: { include: { transcript: true } },
  tagChanges: { orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.AnswerInclude;

type AnswerRow = Prisma.AnswerGetPayload<{ include: typeof ANSWER_INCLUDE }>;

@Injectable()
export class NewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorService,
  ) {}

  private async threshold(): Promise<number> {
    const row = await this.prisma.configEntry.findUnique({
      where: { key: "news.flag_threshold" },
    });
    return typeof row?.valueJson === "number" ? row.valueJson : 4;
  }

  /** Only live, published news. A held, removed or deleted post is not in the Newsroom. */
  private get visible(): Prisma.AnswerWhereInput {
    return {
      isNews: true,
      newsTag: { not: null },
      status: "PUBLISHED",
      deletedAt: null,
      // V-FIX-B round 2: not from a question that has not opened (or a draft): nothing there is readable yet
      question: questionReadableWhere(new Date()),
    };
  }

  private async map(rows: AnswerRow[], viewer: Actor | null) {
    const ids = rows.map((r) => r.id);
    const authorIds = [
      ...new Set(rows.filter((r) => !r.anonymous).map((r) => r.authorId)),
    ];
    const tagUserIds = [
      ...new Set(rows.flatMap((r) => r.tagChanges.map((t) => t.byUserId))),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set([...authorIds, ...tagUserIds])] } },
      select: AUTHOR_SELECT,
    });
    const refs = await authorRefs(this.prisma, users);
    const [breakdown, mine, liked, saved] = await Promise.all([
      this.prisma.reaction.groupBy({
        by: ["answerId", "kind"],
        where: { answerId: { in: ids } },
        _count: { _all: true },
      }),
      viewer
        ? this.prisma.reaction.findMany({
            where: { answerId: { in: ids }, userId: viewer.id },
            select: { answerId: true, kind: true },
          })
        : [],
      viewer
        ? this.prisma.like.findMany({
            where: { answerId: { in: ids }, userId: viewer.id },
            select: { answerId: true },
          })
        : [],
      viewer
        ? this.prisma.save.findMany({
            where: { answerId: { in: ids }, userId: viewer.id },
            select: { answerId: true },
          })
        : [],
    ]);
    return rows.map((a) => {
      const change = a.tagChanges[0];
      const chooser = change ? refs.get(change.byUserId) : undefined;
      const poster = refs.get(a.authorId);
      // Who chose the tag. An anonymous post never shows its poster's handle, here or anywhere.
      let chosenBy: string;
      if (change && change.byUserId !== a.authorId) chosenBy = "the WAWU team";
      else if (a.anonymous) chosenBy = "the poster";
      else chosenBy = `@${(chooser ?? poster)?.handle ?? "the poster"}`;
      return {
        id: a.id,
        questionId: a.questionId,
        author: a.anonymous ? null : (poster ?? null),
        kind: a.kind,
        body: a.body,
        clip: a.clip
          ? {
              id: a.clip.id,
              status: a.clip.status,
              durationMs: a.clip.durationMs,
              maxDurationMs: a.clip.maxDurationMs,
              peaks: (a.clip.peaks as number[] | null) ?? null,
              transcript: a.clip.transcript
                ? {
                    status: a.clip.transcript.status,
                    language: a.clip.transcript.language,
                    text: a.clip.transcript.text,
                  }
                : null,
            }
          : null,
        createdAt: a.createdAt.toISOString(),
        editedAt: a.editedAt?.toISOString() ?? null,
        status: a.status,
        news: a.newsTag
          ? {
              tag: a.newsTag,
              sourceName: a.newsSourceName,
              sourceUrl: a.newsSourceUrl,
              chosenBy,
              chosenAt: (change?.createdAt ?? a.createdAt).toISOString(),
            }
          : null,
        likeCount: a.likeCount,
        replyCount: a.replyCount,
        agreeCount: a.agreeCount,
        disagreeCount: a.disagreeCount,
        reactionCount: a.reactionCount,
        reactionBreakdown: breakdown
          .filter((b) => b.answerId === a.id)
          .map((b) => ({ kind: b.kind, count: b._count._all })),
        myReaction: mine.find((m) => m.answerId === a.id)?.kind ?? null,
        iLiked: liked.some((l) => l.answerId === a.id),
        iSaved: saved.some((s) => s.answerId === a.id),
        isMine: viewer?.id === a.authorId,
        labels: [] as string[],
        categoryName: a.question.category?.name ?? null,
        questionText: a.question.text,
        explainsVote: !!a.explainsVoteId,
        mood: a.mood,
      };
    });
  }

  async list(
    user: VoicesUser | undefined,
    q: { cursor?: string; limit?: number; tag?: string; categoryId?: string },
  ) {
    const viewer = await this.actors.viewer(user);
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const blocked = await this.actors.blockedEitherWay(viewer?.id);
    const rows = await this.prisma.answer.findMany({
      where: {
        AND: [
          this.visible,
          q.tag ? { newsTag: q.tag as NewsTag } : {},
          q.categoryId ? { question: { categoryId: q.categoryId } } : {},
          blocked.length ? { authorId: { notIn: blocked } } : {},
          cur
            ? {
                OR: [
                  { createdAt: { lt: new Date(cur.k) } },
                  { createdAt: new Date(cur.k), id: { lt: cur.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: ANSWER_INCLUDE,
    });
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    return {
      items: await this.map(slice, viewer),
      nextCursor: more
        ? encodeCursor({
            k: slice[slice.length - 1].createdAt.toISOString(),
            id: slice[slice.length - 1].id,
          })
        : null,
    };
  }

  async get(user: VoicesUser | undefined, answerId: string) {
    const viewer = await this.actors.viewer(user);
    const blocked = await this.actors.blockedEitherWay(viewer?.id);
    const row = await this.prisma.answer.findFirst({
      where: {
        id: answerId,
        ...this.visible,
        ...(blocked.length ? { authorId: { notIn: blocked } } : {}),
      },
      include: ANSWER_INCLUDE,
    });
    if (!row) throw this.actors.notFound();
    return (await this.map([row], viewer))[0];
  }

  /** The three tags, their plain meaning, how many posts each has, and which ones I follow. Verified News is always followed. */
  async tags(user: VoicesUser | undefined) {
    const viewer = await this.actors.viewer(user);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [counts, fresh, follows] = await Promise.all([
      this.prisma.answer.groupBy({
        by: ["newsTag"],
        where: this.visible,
        _count: { _all: true },
      }),
      this.prisma.answer.groupBy({
        by: ["newsTag"],
        where: { ...this.visible, createdAt: { gt: since } },
        _count: { _all: true },
      }),
      viewer
        ? this.prisma.newsTagFollow.findMany({
            where: { userId: viewer.id },
            select: { tag: true },
          })
        : [],
    ]);
    return {
      items: TAGS.map((tag) => ({
        tag,
        label: TAG_INFO[tag].label,
        meaning: TAG_INFO[tag].meaning,
        count: counts.find((c) => c.newsTag === tag)?._count._all ?? 0,
        newCount: fresh.find((c) => c.newsTag === tag)?._count._all ?? 0,
        followed: tag === "VERIFIED_NEWS" || follows.some((f) => f.tag === tag),
      })),
    };
  }

  /** "This tag is misleading". One flag per person per post; the threshold in config sends the post to the admin news review queue. */
  async flag(actor: Actor, answerId: string, note: string | undefined) {
    const post = await this.prisma.answer.findFirst({
      where: { id: answerId, ...this.visible },
      select: { id: true, authorId: true, newsReviewStatus: true },
    });
    if (!post) throw this.actors.notFound();
    if (post.authorId === actor.id)
      throw new ConflictException({
        code: "CONFLICT",
        message: "You cannot flag your own post.",
        details: { reason: "OWN_POST" },
      });
    const threshold = await this.threshold();
    return this.prisma.$transaction(async (tx) => {
      const dupe = await tx.report.findUnique({
        where: {
          reporterId_targetType_targetId: {
            reporterId: actor.id,
            targetType: "ANSWER",
            targetId: answerId,
          },
        },
      });
      if (dupe)
        throw new ConflictException({
          code: "CONFLICT",
          message: "You already flagged this post.",
          details: { reason: "ALREADY_FLAGGED" },
        });
      const report = await tx.report.create({
        data: {
          reporterId: actor.id,
          targetType: "ANSWER",
          targetId: answerId,
          reason: "MISLEADING_NEWS_TAG",
          note: note || null,
        },
      });
      const updated = await tx.answer.update({
        where: { id: answerId },
        data: { newsFlagCount: { increment: 1 } },
        select: { newsFlagCount: true },
      });
      if (
        updated.newsFlagCount >= threshold &&
        post.newsReviewStatus === "NONE"
      )
        await tx.answer.update({
          where: { id: answerId },
          data: { newsReviewStatus: "FLAGGED" },
        });
      return { id: report.id, status: report.status, blocked: false };
    });
  }

  /**
   * V-FIX-B (addendum 1): "Request Verified News". Only the poster asks, once at a time, for a post that is live and not
   * already Verified. It writes the request row the editors' queue reads and moves the post to "asking verified" (a post
   * the readers flagged stays in the flagged tab; the request shows on it either way). Nobody gets the tag from here:
   * only an editor's decision does (POST /admin/news/{id}/decision).
   */
  async requestVerified(
    actor: Actor,
    answerId: string,
    dto: { sourceName: string; sourceUrl?: string },
  ) {
    const post = await this.prisma.answer.findFirst({
      where: { id: answerId, ...this.visible },
      select: {
        id: true,
        authorId: true,
        newsTag: true,
        newsReviewStatus: true,
      },
    });
    if (!post || post.authorId !== actor.id) throw this.actors.notFound();
    if (post.newsTag === "VERIFIED_NEWS")
      throw new ConflictException({
        code: "CONFLICT",
        message: "This post is already Verified News.",
        details: { reason: "ALREADY_VERIFIED" },
      });
    if (!dto.sourceName?.trim())
      throw new UnprocessableEntityException({
        code: "SOURCE_REQUIRED",
        message: "Name the source you checked.",
        details: {
          fields: [
            { path: "sourceName", message: "Name the source you checked." },
          ],
        },
      });
    checkSourceUrl(dto.sourceUrl);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Answer" WHERE id = ${answerId} FOR UPDATE`;
      const open = await tx.newsVerificationRequest.findFirst({
        where: { answerId, status: "OPEN" },
        select: { id: true },
      });
      if (open)
        throw new ConflictException({
          code: "CONFLICT",
          message: "You already asked for Verified News on this post.",
          details: { reason: "ALREADY_REQUESTED" },
        });
      const row = await tx.newsVerificationRequest.create({
        data: {
          answerId,
          requestedById: actor.id,
          sourceName: dto.sourceName.trim(),
          sourceUrl: dto.sourceUrl?.trim() || null,
        },
      });
      if (post.newsReviewStatus !== "FLAGGED")
        await tx.answer.update({
          where: { id: answerId },
          data: { newsReviewStatus: "VERIFIED_REQUESTED" },
        });
      return { id: row.id, status: row.status };
    });
  }
}
