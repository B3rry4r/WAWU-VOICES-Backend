import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { COUNTRIES } from "./countries";
import {
  answerReadableWhere,
  isQuestionOpen,
  isShownComingUp,
  questionOpenWhere,
  questionOverWhere,
  questionReadableWhere,
} from "./question-window";
import { Prisma, type Mood } from "../generated/prisma/client";
import { MOODS } from "../mood/mood";
import { PrismaService } from "../common/prisma/prisma.service";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { displayKoboPerUnit, perUnitKobo } from "../units/units.display-rate";
import { PublicConfig, PUBLIC_KEYS } from "./public-config";
import { todayQuestionId } from "./today-question";
import { clampLimit, decodeCursor, pageOf } from "./cursor";
import { dateOnly, lagosDay } from "./lagos";
import {
  answerInclude,
  pollOpenWhere,
  presentAnswer,
  presentCategory,
  presentQuestion,
  FACES_READ,
  type Face,
  presentTopic,
  questionInclude,
  type AnswerRow,
  type QuestionRow,
  type Viewer,
} from "./present";

const liveWhere = questionOpenWhere;
const closedWhere = questionOverWhere;
/** Everything a person may see in a list: started, not a draft. Spares and future days stay hidden. */
const shownWhere = (now: Date): Prisma.QuestionWhereInput => ({
  status: { in: ["SCHEDULED", "LIVE", "CLOSED"] },
  startsAt: { lte: now },
});
/** A published answer a viewer may read: its question has opened (question-window.ts, the one rule), nobody blocked. */
const answerWhere = (viewer: Viewer, now: Date): Prisma.AnswerWhereInput => ({
  status: "PUBLISHED",
  deletedAt: null,
  AND: [answerReadableWhere(now)],
  ...(viewer.blocked.size ? { authorId: { notIn: [...viewer.blocked] } } : {}),
});

@Injectable()
export class FeedService {
  constructor(
    private readonly db: PrismaService,
    private readonly config: PublicConfig,
  ) {}

  async viewer(user: MaybeVoicesUser, guestId?: string): Promise<Viewer> {
    if (!user)
      return { userId: null, guestId: guestId ?? null, blocked: new Set() };
    const row = await this.db.user.findUnique({
      where: { wawuId: user.sub },
      select: { id: true },
    });
    if (!row)
      return { userId: null, guestId: guestId ?? null, blocked: new Set() };
    const blocks = await this.db.block.findMany({
      where: { OR: [{ blockerId: row.id }, { blockedId: row.id }] },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = new Set(
      blocks.map((b) => (b.blockerId === row.id ? b.blockedId : b.blockerId)),
    );
    return { userId: row.id, guestId: null, blocked };
  }

  // ------------------------------------------------------------------ topics and calendar

  private async topicExtras(ids: string[], now: Date) {
    const [voices, polls, reports] = await Promise.all([
      this.db.question.groupBy({
        by: ["topicId"],
        where: { topicId: { in: ids }, ...questionReadableWhere(now) },
        _sum: { voiceCount: true, answerCount: true },
      }),
      this.db.poll.findMany({
        where: { topicId: { in: ids }, kind: "WEEKLY" },
        select: { id: true, topicId: true },
      }),
      this.db.weeklyReport.findMany({
        where: { topicId: { in: ids }, status: "PUBLISHED" },
        select: { id: true, topicId: true },
      }),
    ]);
    return (id: string) => ({
      voiceCount: voices.find((v) => v.topicId === id)?._sum.voiceCount ?? 0,
      // lead ruling WF, 6 Nov (RW1): the one voices count, top-level answers.
      voicesCount: voices.find((v) => v.topicId === id)?._sum.answerCount ?? 0,
      weeklyPollId: polls.find((p) => p.topicId === id)?.id ?? null,
      reportId: reports.find((r) => r.topicId === id)?.id ?? null,
    });
  }

  private async topicsOut(rows: Prisma.TopicGetPayload<object>[], now: Date) {
    const extra = await this.topicExtras(
      rows.map((r) => r.id),
      now,
    );
    return rows.map((t) => presentTopic(t, extra(t.id), now));
  }

  /** The week that contains today; before launch, the first week to come; after the last week, the last one. */
  async currentTopicRow(now = new Date()) {
    const today = dateOnly(lagosDay(now));
    const shown = {
      status: { notIn: ["DRAFT" as const, "IN_REVIEW" as const] },
    };
    return (
      (await this.db.topic.findFirst({
        where: { ...shown, startsOn: { lte: today }, endsOn: { gte: today } },
      })) ??
      (await this.db.topic.findFirst({
        where: { ...shown, startsOn: { gt: today } },
        orderBy: { startsOn: "asc" },
      })) ??
      (await this.db.topic.findFirst({
        where: shown,
        orderBy: { startsOn: "desc" },
      }))
    );
  }

  async currentTopic() {
    const now = new Date();
    const t = await this.currentTopicRow(now);
    if (!t)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No topic is scheduled yet.",
      });
    return (await this.topicsOut([t], now))[0];
  }

  async topic(id: string) {
    const now = new Date();
    const t = await this.db.topic.findFirst({
      where: { id, status: { notIn: ["DRAFT", "IN_REVIEW"] } },
    });
    if (!t)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "We could not find that topic.",
      });
    return (await this.topicsOut([t], now))[0];
  }

  async calendar(q: { cursor?: string; limit?: number; status?: string }) {
    const now = new Date();
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.TopicWhereInput = {
      status: { notIn: ["DRAFT", "IN_REVIEW"] },
    };
    const today = dateOnly(lagosDay(now));
    if (q.status === "LIVE")
      Object.assign(where, {
        startsOn: { lte: today },
        endsOn: { gte: today },
      });
    else if (q.status === "SCHEDULED")
      Object.assign(where, { startsOn: { gt: today } });
    else if (q.status === "CLOSED")
      Object.assign(where, { endsOn: { lt: today } });
    else if (q.status)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            { path: "status", message: "Use LIVE, SCHEDULED or CLOSED." },
          ],
        },
      });
    const rows = await this.db.topic.findMany({
      where,
      orderBy: [{ weekNumber: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = pageOf(rows, limit);
    const topics = await this.topicsOut(page.items, now);
    return {
      items: topics.map((t) => ({
        weekNumber: t.weekNumber,
        topicId: t.id,
        title: t.title,
        startsOn: t.startsOn,
        status: t.status,
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ------------------------------------------------------------------ categories

  private catStatsCache: {
    at: number;
    value: Map<string, { voices: number; questions: number }>;
    pending?: Promise<Map<string, { voices: number; questions: number }>>;
  } | null = null;

  /**
   * LCH-09: the category counts beside a question cost a scan of every answer of the week (37 ms at 35,000 answers, on
   * every question read). They move slowly, so they are kept 30 seconds (CATEGORY_STATS_TTL_MS, 0 for always fresh;
   * 0 outside production unless set). The counts are the same for everybody: nothing personal is in them.
   */
  private async categoryStats(now: Date) {
    const ttl = Number(
      process.env.CATEGORY_STATS_TTL_MS ??
        (process.env.NODE_ENV === "production" ? 30_000 : 0),
    );
    if (!(ttl > 0)) return this.categoryStatsNow(now);
    const c = this.catStatsCache;
    if (c?.pending) return c.pending;
    if (c && Date.now() - c.at < ttl) return c.value;
    const pending = this.categoryStatsNow(now).then(
      (value) => {
        this.catStatsCache = { at: Date.now(), value };
        return value;
      },
      (e: unknown) => {
        this.catStatsCache = null;
        throw e;
      },
    );
    this.catStatsCache = {
      at: c?.at ?? 0,
      value:
        c?.value ?? new Map<string, { voices: number; questions: number }>(),
      pending,
    };
    return pending;
  }

  private async categoryStatsNow(now: Date) {
    const topic = await this.currentTopicRow(now);
    const since = topic
      ? new Date(topic.startsOn.getTime() - 3_600_000)
      : new Date(now.getTime() - 7 * 86_400_000);
    // The one rule (question-window.ts) picks the readable questions; the raw count then only counts under those.
    const readable = (
      await this.db.question.findMany({
        where: {
          AND: [questionReadableWhere(now), { categoryId: { not: null } }],
        },
        select: { id: true },
      })
    ).map((r) => r.id);
    const [voices, counts] = await Promise.all([
      this.db.$queryRaw<{ categoryId: string; n: bigint }[]>`
        SELECT q."categoryId", count(*) AS n FROM "Answer" a JOIN "Question" q ON q.id = a."questionId"
        WHERE a.status = 'PUBLISHED' AND a."deletedAt" IS NULL AND a."createdAt" >= ${since} AND q."categoryId" IS NOT NULL
          AND a."questionId" = ANY(${readable})
        GROUP BY q."categoryId"`,
      this.db.question.groupBy({
        by: ["categoryId"],
        where: { ...shownWhere(now), categoryId: { not: null } },
        _count: true,
      }),
    ]);
    const m = new Map<string, { voices: number; questions: number }>();
    for (const v of voices)
      m.set(v.categoryId, { voices: Number(v.n), questions: 0 });
    for (const c of counts) {
      const cur = m.get(c.categoryId!) ?? { voices: 0, questions: 0 };
      cur.questions = c._count;
      m.set(c.categoryId!, cur);
    }
    return m;
  }

  async categories() {
    const now = new Date();
    const [rows, stats] = await Promise.all([
      this.db.category.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      }),
      this.categoryStats(now),
    ]);
    return {
      items: rows.map((c) =>
        presentCategory(
          c,
          stats.get(c.id)?.voices ?? 0,
          stats.get(c.id)?.questions ?? 0,
        ),
      ),
    };
  }

  async categoryDetail(
    slug: string,
    q: { cursor?: string; limit?: number; tab?: string },
    viewer: Viewer,
  ) {
    const now = new Date();
    const cat = await this.db.category.findFirst({
      where: { slug, active: true },
    });
    if (!cat)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "We could not find that category.",
      });
    const tab = q.tab ?? "open";
    if (!["open", "closed", "polls"].includes(tab))
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [{ path: "tab", message: "Use open, closed or polls." }],
        },
      });
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor(q.cursor);
    const base: Prisma.QuestionWhereInput = { categoryId: cat.id };
    const tabWhere: Prisma.QuestionWhereInput =
      tab === "open"
        ? { AND: [base, liveWhere(now)] }
        : tab === "closed"
          ? { AND: [base, closedWhere(now)] }
          : {
              AND: [
                base,
                shownWhere(now),
                { polls: { some: pollOpenWhere(now) } },
              ],
            };
    const today = dateOnly(lagosDay(now));
    const rankWindow = await this.rankingWindow(now);
    const [stats, open, closed, polls, rows, todayRow, top] = await Promise.all(
      [
        this.categoryStats(now),
        this.db.question.count({ where: { AND: [base, liveWhere(now)] } }),
        this.db.question.count({ where: { AND: [base, closedWhere(now)] } }),
        this.db.question.count({
          where: {
            AND: [
              base,
              shownWhere(now),
              { polls: { some: pollOpenWhere(now) } },
            ],
          },
        }),
        this.db.question.findMany({
          where: tabWhere,
          include: questionInclude(now),
          orderBy: [{ startsAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
        this.db.question.findFirst({
          where: { ...base, scheduledFor: today, ...liveWhere(now) },
          include: questionInclude(now),
        }),
        this.db.answer.findMany({
          where: {
            ...answerWhere(viewer, now),
            question: {
              categoryId: cat.id,
              ...rankWindow,
            },
          },
          include: answerInclude,
          orderBy: [
            { rankScore: "desc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
          take: 3,
        }),
      ],
    );
    const page = pageOf(rows, limit);
    const ctx = await this.questionCtx(viewer, now, stats, [
      ...page.items.map((r) => r.id),
      ...(todayRow ? [todayRow.id] : []),
    ]);
    const topVoices = await this.answersOut(top, viewer);
    return {
      counts: { open, closed, polls },
      topVoices,
      category: presentCategory(
        cat,
        stats.get(cat.id)?.voices ?? 0,
        stats.get(cat.id)?.questions ?? 0,
      ),
      todaysQuestion: todayRow ? presentQuestion(todayRow, ctx) : null,
      questions: page.items.map((r) => presentQuestion(r, ctx)),
      topVoice: topVoices[0] ?? null,
      nextCursor: page.nextCursor,
    };
  }

  // ------------------------------------------------------------------ questions

  /**
   * The newest named people who answered each question. Read one question at a time with a LIMIT: asked as part of the
   * question (include with take), Prisma read EVERY answer of the question and cut the list in memory, which at 25,000
   * answers cost 65 ms and 25,000 rows per question read (LCH-09).
   */
  private async faces(ids: string[], now: Date): Promise<Map<string, Face[]>> {
    const out = new Map<string, Face[]>();
    await Promise.all(
      ids.map(async (questionId) => {
        out.set(
          questionId,
          await this.db.answer.findMany({
            where: {
              questionId,
              status: "PUBLISHED",
              anonymous: false,
              ...answerReadableWhere(now),
            },
            orderBy: { createdAt: "desc" },
            take: FACES_READ,
            select: {
              author: {
                select: { id: true, handle: true, avatarFileId: true },
              },
            },
          }),
        );
      }),
    );
    return out;
  }

  private async questionCtx(
    viewer: Viewer,
    now: Date,
    stats?: Map<string, { voices: number; questions: number }>,
    ids: string[] = [],
  ) {
    const [catStats, faces] = await Promise.all([
      stats ?? this.categoryStats(now),
      this.faces([...new Set(ids)], now),
    ]);
    return { now, saved: new Set<string>(), catStats, faces, viewer };
  }

  private async questionsOut(rows: QuestionRow[], viewer: Viewer, now: Date) {
    const ctx = await this.questionCtx(
      viewer,
      now,
      undefined,
      rows.map((r) => r.id),
    );
    if (viewer.userId && rows.length) {
      const saved = await this.db.savedQuestion.findMany({
        where: {
          userId: viewer.userId,
          questionId: { in: rows.map((r) => r.id) },
        },
        select: { questionId: true },
      });
      for (const s of saved) ctx.saved.add(s.questionId);
    }
    return rows.map((r) => presentQuestion(r, ctx));
  }

  /** The override if one is live, else today's daily question; before launch, the next one to come (today-question.ts). */
  async todayRow(now: Date): Promise<QuestionRow | null> {
    const id = await todayQuestionId(this.db, now);
    if (!id) return null;
    return this.db.question.findUnique({
      where: { id },
      include: questionInclude(now),
    });
  }

  async today(viewer: Viewer) {
    const now = new Date();
    const q = await this.todayRow(now);
    if (!q)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No question is scheduled yet.",
      });
    return (await this.questionsOut([q], viewer, now))[0];
  }

  async questions(
    q: {
      cursor?: string;
      limit?: number;
      categoryId?: string;
      kind?: string;
      status?: string;
    },
    viewer: Viewer,
  ) {
    const now = new Date();
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor(q.cursor);
    const and: Prisma.QuestionWhereInput[] = [shownWhere(now)];
    if (q.status === "LIVE") and.push(liveWhere(now));
    else if (q.status === "CLOSED") and.push(closedWhere(now));
    else if (q.status)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [{ path: "status", message: "Use LIVE or CLOSED." }],
        },
      });
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.kind) and.push({ kind: q.kind as never });
    const rows = await this.db.question.findMany({
      where: { AND: and },
      include: questionInclude(now),
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = pageOf(rows, limit);
    return {
      items: await this.questionsOut(page.items, viewer, now),
      nextCursor: page.nextCursor,
    };
  }

  async trendingQuestions(
    q: { cursor?: string; limit?: number; categoryId?: string },
    viewer: Viewer,
  ) {
    const now = new Date();
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.question.findMany({
      where: {
        AND: [
          liveWhere(now),
          shownWhere(now),
          ...(q.categoryId ? [{ categoryId: q.categoryId }] : []),
        ],
      },
      include: questionInclude(now),
      orderBy: [
        { voiceCount: "desc" },
        { answerCount: "desc" },
        { id: "desc" },
      ],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = pageOf(rows, limit);
    return {
      items: await this.questionsOut(page.items, viewer, now),
      nextCursor: page.nextCursor,
    };
  }

  /** New conversations: the questions that started most recently and are still open. */
  async newConversations(
    q: { cursor?: string; limit?: number },
    viewer: Viewer,
  ) {
    const now = new Date();
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.db.question.findMany({
      where: { AND: [liveWhere(now), shownWhere(now)] },
      include: questionInclude(now),
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = pageOf(rows, limit);
    return {
      items: await this.questionsOut(page.items, viewer, now),
      nextCursor: page.nextCursor,
    };
  }

  // ------------------------------------------------------------------ answers

  async answersOut(rows: AnswerRow[], viewer: Viewer, trending = false) {
    const ids = rows.map((r) => r.id);
    const [grouped, mine, likes, saves] = ids.length
      ? await Promise.all([
          this.db.reaction.groupBy({
            by: ["answerId", "kind"],
            where: { answerId: { in: ids } },
            _count: true,
          }),
          viewer.userId
            ? this.db.reaction.findMany({
                where: { userId: viewer.userId, answerId: { in: ids } },
                select: { answerId: true, kind: true },
              })
            : [],
          viewer.userId || viewer.guestId
            ? this.db.like.findMany({
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
            ? this.db.save.findMany({
                where: { userId: viewer.userId, answerId: { in: ids } },
                select: { answerId: true },
              })
            : [],
        ])
      : [[], [], [], []];
    const breakdown = new Map<string, { kind: string; count: number }[]>();
    for (const g of grouped) {
      const list = breakdown.get(g.answerId) ?? [];
      list.push({ kind: g.kind, count: g._count });
      breakdown.set(g.answerId, list);
    }
    const ctx = {
      viewer,
      breakdown,
      myReaction: new Map(mine.map((m) => [m.answerId, m.kind as string])),
      liked: new Set(likes.map((l) => l.answerId)),
      saved: new Set(saves.map((s) => s.answerId)),
      trending,
    };
    return rows.map((r) => presentAnswer(r, ctx));
  }

  /**
   * A guest-neutral page of answers with this guest's own likes put on a COPY (the cached page is shared and is never
   * touched). Only iLiked can differ between two guests; nothing else in the page is theirs.
   */
  async withGuestLikes<
    P extends {
      items: { type: string; answer: { id: string; iLiked: boolean } }[];
    },
  >(page: P, guestId: string): Promise<P> {
    const ids = page.items.map((i) => i.answer.id);
    if (!ids.length) return page;
    const likes = await this.db.like.findMany({
      where: { answerId: { in: ids }, guestId },
      select: { answerId: true },
    });
    if (!likes.length) return page;
    const liked = new Set(likes.map((l) => l.answerId));
    return {
      ...page,
      items: page.items.map((i) =>
        liked.has(i.answer.id)
          ? { ...i, answer: { ...i.answer, iLiked: true } }
          : i,
      ),
    };
  }

  /**
   * The questions the ranking job scores: open or closed within `ranking.window_days` (default 7). Scores of answers
   * outside it are never refreshed, so lists that rank across questions only read inside it.
   */
  private async rankingWindow(now: Date): Promise<Prisma.QuestionWhereInput> {
    const row = await this.db.configEntry.findUnique({
      where: { key: "ranking.window_days" },
      select: { valueJson: true },
    });
    const v = row?.valueJson;
    const days = typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 7;
    const since = new Date(now.getTime() - days * 86_400_000);
    return {
      status: { in: ["SCHEDULED", "LIVE", "CLOSED"] },
      OR: [
        { status: { not: "CLOSED" }, endsAt: null },
        { endsAt: { gt: since } },
        { status: "CLOSED", endsAt: null, updatedAt: { gt: since } },
      ],
    };
  }

  /** Ranked by the stored rankScore, which the ranking job (ranking.service.ts) writes every few minutes. */
  async trendingAnswers(
    q: {
      cursor?: string;
      limit?: number;
      categoryId?: string;
      tag?: string;
      questionId?: string;
    },
    viewer: Viewer,
  ) {
    const now = new Date();
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor(q.cursor);
    const where: Prisma.AnswerWhereInput = {
      ...answerWhere(viewer, now),
      // The job only rescores answers on questions in its window, so a score from before the window is stale: leave
      // those out of a list that mixes questions.
      question: {
        AND: [
          await this.rankingWindow(now),
          ...(q.categoryId ? [{ categoryId: q.categoryId }] : []),
        ],
      },
      ...(q.questionId ? { questionId: q.questionId } : {}),
      ...(q.tag ? { isNews: true, newsTag: q.tag as never } : {}),
    };
    const rows = await this.db.answer.findMany({
      where,
      include: answerInclude,
      orderBy: [{ rankScore: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = pageOf(rows, limit);
    const answers = await this.answersOut(page.items, viewer, true);
    return {
      items: answers.map((answer) => ({ type: "answer" as const, answer })),
      nextCursor: page.nextCursor,
    };
  }

  // ------------------------------------------------------------------ home

  private async presentPoll(
    p: Prisma.PollGetPayload<{ include: { options: true } }>,
    viewer: Viewer,
    now: Date,
  ) {
    const vote = viewer.userId
      ? await this.db.vote.findFirst({
          where: { pollId: p.id, userId: viewer.userId },
          include: { choices: true },
        })
      : null;
    const status =
      p.endsAt <= now ? "CLOSED" : p.startsAt <= now ? "OPEN" : "SCHEDULED";
    const showResults = !!vote || status === "CLOSED" || p.showLiveResults;
    const cost = await this.db.configEntry.findUnique({
      where: { key: "cost.vote_milli" },
    });
    const costMilli =
      typeof cost?.valueJson === "number" ? cost.valueJson : 200;
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      choiceMode: p.choiceMode,
      status,
      publicInterest: p.publicInterest,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt.toISOString(),
      questionId: p.questionId,
      topicId: p.topicId,
      totalVotes: p.totalVotes,
      options: p.options
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((o) =>
          showResults
            ? {
                id: o.id,
                label: o.label,
                votes: o.voteCount,
                percent: p.totalVotes
                  ? Math.round((o.voteCount / p.totalVotes) * 1000) / 10
                  : 0,
              }
            : { id: o.id, label: o.label },
        ),
      myVote: vote ? vote.choices.map((c) => c.optionId) : null,
      costToVoteMilli: p.publicInterest ? 0 : costMilli,
      label: "Open poll",
    };
  }

  async home(viewer: Viewer, user: MaybeVoicesUser) {
    const now = new Date();
    const [topicRow, todayQ, flash, news] = await Promise.all([
      this.currentTopicRow(now),
      this.todayRow(now),
      this.db.poll.findFirst({
        where: { kind: "FLASH", ...pollOpenWhere(now) },
        include: { options: true },
        orderBy: { endsAt: "asc" },
      }),
      this.newConversations({ limit: 4 }, viewer),
    ]);
    if (!topicRow)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "No topic is scheduled yet.",
      });
    // V-PRELAUNCH: the board heading is "Top voices on today's question" (Home-1440): only that question's top voices, and
    // none at all until it has opened (the list stays empty, the screen draws nothing).
    const trending =
      todayQ && isQuestionOpen(todayQ, now)
        ? await this.trendingAnswers(
            { limit: 2, questionId: todayQ.id },
            viewer,
          )
        : { items: [] as { answer: unknown }[] };
    const [topic] = await this.topicsOut([topicRow], now);
    let greetingName: string | null = null;
    if (viewer.userId) {
      const u = await this.db.user.findUnique({
        where: { id: viewer.userId },
        select: { displayName: true, handle: true },
      });
      greetingName = u?.displayName?.split(" ")[0] ?? u?.handle ?? null;
    }
    void user;
    return {
      topicOfWeek: topic,
      dailyQuestion: todayQ
        ? (await this.questionsOut([todayQ], viewer, now))[0]
        : null,
      flashPoll: flash ? await this.presentPoll(flash, viewer, now) : null,
      trending: trending.items.map((i) => i.answer),
      newConversations: news.items,
      sponsored: null,
      greetingName,
    };
  }

  // ------------------------------------------------------------------ one question, its answers and polls

  async question(id: string, viewer: Viewer) {
    const now = new Date();
    let q = await this.db.question.findFirst({
      where: { id, ...shownWhere(now) },
      include: questionInclude(now),
    });
    // V-26: a question that /home or /questions/today returns (before launch, a future-dated one) is always readable by id.
    if (!q && (await isShownComingUp(this.db, id, now)))
      q = await this.db.question.findUnique({
        where: { id },
        include: questionInclude(now),
      });
    if (!q)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "We could not find that question.",
      });
    return (await this.questionsOut([q], viewer, now))[0];
  }

  async questionAnswers(
    id: string,
    q: {
      cursor?: string;
      limit?: number;
      sort?: string;
      tag?: string;
      mood?: string;
    },
    viewer: Viewer,
  ) {
    await this.question(id, viewer);
    if (q.mood !== undefined && !MOODS.includes(q.mood as Mood))
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            { path: "mood", message: "Use ANGRY, TIRED, PROUD or HOPEFUL." },
          ],
        },
      });
    const sort = q.sort ?? "TOP";
    if (!["TOP", "NEW", "DEBATED"].includes(sort))
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [{ path: "sort", message: "Use TOP, NEW or DEBATED." }],
        },
      });
    const limit = clampLimit(q.limit);
    const cursor = decodeCursor(q.cursor);
    const orderBy: Prisma.AnswerOrderByWithRelationInput[] =
      sort === "NEW"
        ? [{ createdAt: "desc" }, { id: "desc" }]
        : sort === "DEBATED"
          ? [{ debateScore: "desc" }, { createdAt: "desc" }, { id: "desc" }]
          : [{ rankScore: "desc" }, { createdAt: "desc" }, { id: "desc" }];
    const rows = await this.db.answer.findMany({
      where: {
        ...answerWhere(viewer, new Date()),
        questionId: id,
        ...(q.tag ? { isNews: true, newsTag: q.tag as never } : {}),
        ...(q.mood ? { mood: q.mood as Mood } : {}),
      },
      include: answerInclude,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = pageOf(rows, limit);
    const answers = await this.answersOut(page.items, viewer);
    // Sponsored cards are served by the ads task; none is mixed in here.
    return {
      items: answers.map((answer) => ({ type: "answer" as const, answer })),
      nextCursor: page.nextCursor,
    };
  }

  async questionPolls(id: string, viewer: Viewer) {
    await this.question(id, viewer);
    const now = new Date();
    const polls = await this.db.poll.findMany({
      where: { questionId: id },
      include: { options: true },
      orderBy: { startsAt: "asc" },
    });
    return {
      items: await Promise.all(
        polls.map((p) => this.presentPoll(p, viewer, now)),
      ),
    };
  }

  // ------------------------------------------------------------------ public config and countries

  async publicConfig() {
    const cfg = await this.config.many(PUBLIC_KEYS);
    const n = (k: string) => cfg.get(k) as number;
    const [tiers] = await Promise.all([
      this.db.unitTier.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);
    // RX4: the one display source is the smallest pack's per-unit price, never units.base_rate_kobo.
    const base = await displayKoboPerUnit(this.db, () =>
      n("units.base_rate_kobo"),
    );
    return {
      currency: "NGN" as const,
      freePosts: n("allowance.free_posts"),
      unitBaseKobo: base,
      costs: {
        freeReactionsPerDay: n("allowance.free_reactions_per_day"),
        freeVotesPerDay: n("allowance.free_votes_per_day"),
        baseKoboPerUnit: base,
        textPostMilli: n("cost.text_post_milli"),
        voicePostMilli: n("cost.voice_post_milli"),
        reactionAfterFreeMilli: n("cost.reaction_milli"),
        voteAfterFreeMilli: n("cost.vote_milli"),
        minPackKobo: n("units.min_purchase_kobo"),
        extraVoice30Kobo: n("voice.extra30.price_kobo"),
        extraVoice60Kobo: n("voice.extra60.price_kobo"),
        textMaxChars: n("text.max_chars"),
        textPriceChars: n("text.price_chars"),
        freePostTextChars: n("allowance.free_post_text_chars"),
        messagesPerDay: n("allowance.messages_per_day"),
        textFixMilli: n("textfix.cost_milli"),
        voiceTier1Seconds: n("voice.extra30.max_seconds"),
        voiceMaxSeconds: n("voice.extra60.max_seconds"),
        freeVoiceSeconds: n("voice.free_seconds"),
      },
      tiers: tiers.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        priceKobo: t.priceKobo,
        unitsMilli: t.unitsMilli,
        bonusMilli: t.bonusMilli,
        effectiveKoboPerUnit: perUnitKobo(t.priceKobo, t.unitsMilli),
        baseKoboPerUnit: perUnitKobo(t.priceKobo, t.unitsMilli - t.bonusMilli),
      })),
      extraVoice: [
        {
          kind: "SECONDS_30",
          maxSeconds: n("voice.extra30.max_seconds"),
          priceKobo: n("voice.extra30.price_kobo"),
          label: `Up to ${n("voice.extra30.max_seconds")} seconds`,
        },
        {
          kind: "SECONDS_60",
          maxSeconds: n("voice.extra60.max_seconds"),
          priceKobo: n("voice.extra60.price_kobo"),
          label: `Up to ${n("voice.extra60.max_seconds") / 60} minute`,
        },
      ],
      voiceFreeSeconds: n("voice.free_seconds"),
    };
  }

  countries() {
    return { items: COUNTRIES.map((c) => ({ ...c })) };
  }

  // ------------------------------------------------------------------ search

  async search(
    q: {
      q: string;
      type?: string;
      tag?: string;
      cursor?: string;
      limit?: number;
    },
    viewer: Viewer,
  ) {
    const term = (q.q ?? "").trim();
    if (term.length < 2)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [{ path: "q", message: "Type at least 2 characters." }],
        },
      });
    const type = q.type;
    if (type && !["questions", "answers", "people", "topics"].includes(type))
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            {
              path: "type",
              message: "Use questions, answers, people or topics.",
            },
          ],
        },
      });
    const now = new Date();
    const limit = clampLimit(q.limit);
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const tsq = term
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
      .map((w) => `${w}:*`)
      .join(" & ");
    const want = (t: string) => !type || type === t;
    const blocked = [...viewer.blocked];

    const [qIds, aIdsAll, pIds, tIds] = await Promise.all([
      want("questions") && tsq
        ? this.db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Question" WHERE "searchTsv" @@ to_tsquery('simple', ${tsq})
            AND status IN ('SCHEDULED','LIVE','CLOSED') AND "startsAt" <= ${now} ORDER BY "startsAt" DESC, id DESC LIMIT 200`
        : [],
      want("answers") && tsq
        ? this.db.$queryRaw<{ id: string }[]>`
            SELECT a.id FROM "Answer" a LEFT JOIN "Transcript" t ON t."clipId" = a."clipId"
            WHERE a.status = 'PUBLISHED' AND a."deletedAt" IS NULL
              AND (a."searchTsv" @@ to_tsquery('simple', ${tsq}) OR t."searchTsv" @@ to_tsquery('simple', ${tsq}))
              ${q.tag ? Prisma.sql`AND a."isNews" AND a."newsTag"::text = ${q.tag}` : Prisma.empty}
              ${blocked.length ? Prisma.sql`AND a."authorId" NOT IN (${Prisma.join(blocked)})` : Prisma.empty}
            ORDER BY a."createdAt" DESC, a.id DESC LIMIT 200`
        : [],
      want("people")
        ? this.db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "User" WHERE status = 'ACTIVE'
            AND (handle LIKE ${like.toLowerCase().replace(/^%@/, "%")} ESCAPE '\\' OR lower("displayName") LIKE ${like.toLowerCase()} ESCAPE '\\')
            ${blocked.length ? Prisma.sql`AND id NOT IN (${Prisma.join(blocked)})` : Prisma.empty}
            ORDER BY handle LIMIT 200`
        : [],
      want("topics")
        ? this.db.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "Topic" WHERE status NOT IN ('DRAFT','IN_REVIEW')
            AND (lower(title) LIKE ${like.toLowerCase()} ESCAPE '\\') ORDER BY "weekNumber" LIMIT 200`
        : [],
    ]);

    // The one rule decides which answers may be found: those under a question that has opened.
    const readableA = aIdsAll.length
      ? new Set(
          (
            await this.db.answer.findMany({
              where: {
                id: { in: aIdsAll.map((x) => x.id) },
                ...answerReadableWhere(now),
              },
              select: { id: true },
            })
          ).map((x) => x.id),
        )
      : new Set<string>();
    const aIds = aIdsAll.filter((x) => readableA.has(x.id));

    // One cursor walks the type the person asked for; "all" returns the first page of each.
    const cursor = decodeCursor(q.cursor);
    const slice = (ids: { id: string }[]) => {
      const start = cursor
        ? Math.max(0, ids.findIndex((x) => x.id === cursor) + 1)
        : 0;
      return ids.slice(start, start + limit + (type ? 1 : 0)).map((x) => x.id);
    };
    const [qs, as, ps, ts] = [
      slice(qIds),
      slice(aIds),
      slice(pIds),
      slice(tIds),
    ];
    const [qRows, aRows, pRows, tRows] = await Promise.all([
      this.db.question.findMany({
        where: { id: { in: qs.slice(0, limit) } },
        include: questionInclude(now),
      }),
      this.db.answer.findMany({
        where: { id: { in: as.slice(0, limit) } },
        include: answerInclude,
      }),
      this.db.user.findMany({ where: { id: { in: ps.slice(0, limit) } } }),
      this.db.topic.findMany({ where: { id: { in: ts.slice(0, limit) } } }),
    ]);
    const voiceCounts = await this.db.answer.groupBy({
      by: ["authorId"],
      where: {
        authorId: { in: ps.slice(0, limit) },
        status: "PUBLISHED",
        deletedAt: null,
        ...answerReadableWhere(now),
      },
      _count: true,
    });
    const publicCounts = await this.db.answer.groupBy({
      by: ["authorId"],
      where: {
        authorId: { in: ps.slice(0, limit) },
        status: "PUBLISHED",
        deletedAt: null,
        anonymous: false,
        ...answerReadableWhere(now),
      },
      _count: true,
    });
    const order = <T extends { id: string }>(ids: string[], rows: T[]) =>
      ids.map((i) => rows.find((r) => r.id === i)).filter((r): r is T => !!r);
    const lastOf = { questions: qs, answers: as, people: ps, topics: ts };
    const more = type
      ? lastOf[type as keyof typeof lastOf].length > limit
      : false;
    const shownIds = type
      ? lastOf[type as keyof typeof lastOf].slice(0, limit)
      : [];
    return {
      questions: await this.questionsOut(order(qs, qRows), viewer, now),
      answers: await this.answersOut(order(as, aRows), viewer),
      people: order(ps, pRows).map((u) => ({
        id: u.id,
        handle: u.handle,
        displayName: u.displayName,
        bio: u.bio,
        avatarUrl: null,
        voiceCard: null,
        countryCode: u.countryCode,
        state: u.state,
        city: u.city,
        languages: u.languages,
        joinedAt: u.createdAt.toISOString(),
        voiceCount: voiceCounts.find((v) => v.authorId === u.id)?._count ?? 0,
        voicesCount: publicCounts.find((v) => v.authorId === u.id)?._count ?? 0,
        replyCount: u.replyCount,
        reactionsReceived: u.reactionsReceived,
      })),
      topics: await this.topicsOut(order(ts, tRows), now),
      totals: {
        questions: qIds.length,
        voices: aIds.length,
        people: pIds.length,
        topics: tIds.length,
      },
      nextCursor:
        more && shownIds.length
          ? Buffer.from(
              JSON.stringify({
                i: shownIds[shownIds.length - 1],
                t: Date.now(),
              }),
            ).toString("base64url")
          : null,
    };
  }
}
