import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { VoicesUser } from "../common/auth/voices-user";
import { ContentStatus } from "../generated/prisma/enums";
import { PUBLIC_STATUSES, visibleUser } from "./blocks";
import { cut, decodeCursor, olderThan, pageLimit } from "./paging";
import {
  ANSWER_INCLUDE,
  QUESTION_INCLUDE,
  REPLY_INCLUDE,
  Views,
  type AnswerRow,
  type QuestionRow,
  type ReplyRow,
  type Viewer,
} from "./views";
import { subOf } from "./me.service";
import { HANDLE_RE } from "./handle";

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: Views,
  ) {}

  /** The viewer for an optional-auth route: a finished profile, or a guest (a token with no profile reads as a guest). */
  async viewerOf(
    token: VoicesUser | undefined,
    guestId?: string,
  ): Promise<Viewer> {
    if (!token) return { guestId };
    const u = await this.prisma.user.findUnique({
      where: { wawuId: subOf(token) },
      select: { id: true, status: true },
    });
    return u && u.status !== "DELETED" ? { userId: u.id } : { guestId };
  }

  /** The person if the viewer may see them: public status, and neither blocked the other. Else 404. */
  private async visiblePerson(userId: string, viewer: Viewer) {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, ...visibleUser(viewer.userId) },
      select: { id: true },
    });
    if (u) return { blockedByMe: false };
    // Owner ruling (lead, M3): the blocker may still open the blocked person's minimal page (Unblock, no posts); the blocked person gets 404.
    // The viewer's own block still shows the person (so they can unblock); the other direction is a plain 404.
    if (viewer.userId) {
      const mine = await this.prisma.user.findFirst({
        where: {
          id: userId,
          status: { in: PUBLIC_STATUSES },
          blocksReceived: { some: { blockerId: viewer.userId } },
          blocksMade: { none: { blockedId: viewer.userId } },
        },
        select: { id: true },
      });
      if (mine) return { blockedByMe: true };
    }
    throw new NotFoundException({
      code: "NOT_FOUND",
      message: "We could not find that person.",
    });
  }

  async getPerson(
    userId: string,
    viewer: Viewer,
    cursor: string | undefined,
    limitRaw: unknown,
  ) {
    const { blockedByMe } = await this.visiblePerson(userId, viewer);
    const limit = pageLimit(limitRaw);
    const profile = (await this.views.profiles([userId])).get(userId);
    if (!profile) throw new NotFoundException();
    let recentAnswers: Record<string, unknown>[] = [];
    let nextCursor: string | null = null;
    if (!blockedByMe) {
      const c = decodeCursor(cursor);
      const rows = (await this.prisma.answer.findMany({
        where: {
          authorId: userId,
          status: ContentStatus.PUBLISHED,
          anonymous: false,
          ...olderThan(c),
        },
        include: ANSWER_INCLUDE,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      })) as AnswerRow[];
      const page = cut(rows, limit, (r) => r.createdAt);
      recentAnswers = await this.views.answers(page.items, viewer);
      nextCursor = page.nextCursor;
    }
    return { profile, isBlockedByMe: blockedByMe, recentAnswers, nextCursor };
  }

  /** The same answer as getPerson, found by handle (stored lower case). A handle nobody holds is the same 404. */
  async getPersonByHandle(
    handleRaw: string,
    viewer: Viewer,
    cursor: string | undefined,
    limitRaw: unknown,
  ) {
    const handle = String(handleRaw ?? "")
      .replace(/^@/, "")
      .toLowerCase();
    const found = HANDLE_RE.test(handle)
      ? await this.prisma.user.findUnique({
          where: { handle },
          select: { id: true },
        })
      : null;
    if (!found)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "We could not find that person.",
      });
    return this.getPerson(found.id, viewer, cursor, limitRaw);
  }

  async listPersonReplies(
    userId: string,
    viewer: Viewer,
    cursor: string | undefined,
    limitRaw: unknown,
  ) {
    const { blockedByMe } = await this.visiblePerson(userId, viewer);
    const limit = pageLimit(limitRaw);
    if (blockedByMe) return { items: [], nextCursor: null };
    const c = decodeCursor(cursor);
    const rows = (await this.prisma.reply.findMany({
      where: {
        authorId: userId,
        status: ContentStatus.PUBLISHED,
        // Replies on removed posts, and on posts by people hidden from this viewer, are left out.
        answer: {
          status: ContentStatus.PUBLISHED,
          author: visibleUser(viewer.userId),
        },
        ...olderThan(c),
      },
      include: REPLY_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    })) as ReplyRow[];
    const page = cut(rows, limit, (r) => r.createdAt);
    return {
      items: await this.views.replies(page.items, viewer),
      nextCursor: page.nextCursor,
    };
  }

  async listMyAnswers(
    userId: string,
    cursor: string | undefined,
    limitRaw: unknown,
  ) {
    const limit = pageLimit(limitRaw);
    const c = decodeCursor(cursor);
    const rows = (await this.prisma.answer.findMany({
      where: {
        authorId: userId,
        status: { in: ["PUBLISHED", "HELD", "REMOVED"] },
        ...olderThan(c),
      },
      include: ANSWER_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    })) as AnswerRow[];
    const page = cut(rows, limit, (r) => r.createdAt);
    const answers = await this.views.answers(page.items, { userId });
    return {
      items: answers.map((answer) => ({ type: "answer", answer })),
      nextCursor: page.nextCursor,
    };
  }

  async listSaved(
    userId: string,
    cursor: string | undefined,
    limitRaw: unknown,
    kind: unknown,
  ) {
    const limit = pageLimit(limitRaw);
    if (kind !== undefined && kind !== "ANSWER" && kind !== "QUESTION")
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [{ path: "kind", message: "Use ANSWER or QUESTION." }],
        },
      });
    const c = decodeCursor(cursor);
    const wantA = kind !== "QUESTION";
    const wantQ = kind !== "ANSWER";
    const [sa, sq] = await Promise.all([
      wantA
        ? this.prisma.save.findMany({
            where: {
              userId,
              answer: {
                status: ContentStatus.PUBLISHED,
                author: visibleUser(userId),
              },
              ...olderThan(c),
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            include: { answer: { include: ANSWER_INCLUDE } },
          })
        : [],
      wantQ
        ? this.prisma.savedQuestion.findMany({
            where: { userId, ...olderThan(c) },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
            include: { question: { include: QUESTION_INCLUDE } },
          })
        : [],
    ]);
    type Row =
      | { id: string; createdAt: Date; k: "ANSWER"; a: AnswerRow }
      | { id: string; createdAt: Date; k: "QUESTION"; q: QuestionRow };
    const merged: Row[] = [
      ...sa.map((s): Row => ({
        id: s.id,
        createdAt: s.createdAt,
        k: "ANSWER",
        a: s.answer,
      })),
      ...sq.map((s): Row => ({
        id: s.id,
        createdAt: s.createdAt,
        k: "QUESTION",
        q: s.question,
      })),
    ].sort(
      (x, y) =>
        y.createdAt.getTime() - x.createdAt.getTime() ||
        (x.id < y.id ? 1 : x.id > y.id ? -1 : 0),
    );
    const page = cut(merged, limit, (r) => r.createdAt);
    const [answers, questions] = await Promise.all([
      this.views.answers(
        page.items.flatMap((r) => (r.k === "ANSWER" ? [r.a] : [])),
        { userId },
      ),
      this.views.savedQuestions(
        page.items.flatMap((r) => (r.k === "QUESTION" ? [r.q] : [])),
        { userId },
      ),
    ]);
    let ai = 0;
    let qi = 0;
    const items = page.items.map((r) =>
      r.k === "ANSWER"
        ? {
            kind: "ANSWER",
            savedAt: r.createdAt.toISOString(),
            answer: answers[ai++],
            question: null,
          }
        : {
            kind: "QUESTION",
            savedAt: r.createdAt.toISOString(),
            answer: null,
            question: questions[qi++],
          },
    );
    return { items, nextCursor: page.nextCursor };
  }

  async listBlocks(
    userId: string,
    cursor: string | undefined,
    limitRaw: unknown,
  ) {
    const limit = pageLimit(limitRaw);
    const c = decodeCursor(cursor);
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId, ...olderThan(c) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = cut(rows, limit, (r) => r.createdAt);
    const profiles = await this.views.profiles(
      page.items.map((r) => r.blockedId),
    );
    return {
      items: page.items.flatMap((r) => {
        const user = profiles.get(r.blockedId);
        return user ? [{ user, blockedAt: r.createdAt.toISOString() }] : [];
      }),
      nextCursor: page.nextCursor,
    };
  }
}
