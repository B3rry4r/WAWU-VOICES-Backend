import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { dayString, type Db, type Json } from "./support";

type TopicRow = Prisma.TopicGetPayload<object>;
type QuestionRow = Prisma.QuestionGetPayload<object>;
type PollRow = Prisma.PollGetPayload<{ include: { options: true } }>;

export const POLL_INCLUDE = {
  options: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.PollInclude;

/** Builds the contract shapes the admin module returns. Everything is read from the database. */
@Injectable()
export class AdminViews {
  constructor(private readonly prisma: PrismaService) {}

  async numConfig(
    key: string,
    fallback: number,
    db: Db = this.prisma,
  ): Promise<number> {
    const row = await db.configEntry.findUnique({ where: { key } });
    return typeof row?.valueJson === "number" ? row.valueJson : fallback;
  }

  adminQuestion(q: QuestionRow): Json {
    return {
      id: q.id,
      kind: q.kind,
      slotIndex: q.slotIndex,
      day: q.scheduledFor ? dayString(q.scheduledFor) : null,
      text: q.text,
      hint: q.hint,
      status: q.status,
      pinned: q.pinned,
      isSpare: q.isSpare,
      categoryId: q.categoryId,
      voiceCount: q.voiceCount,
    };
  }

  /** Topic.voiceCount is the sum of its questions' stored voice counters (never counted per request). */
  async topic(t: TopicRow, db: Db = this.prisma): Promise<Json> {
    // One after the other: `db` may be a transaction's connection (C-L8).
    const sum = await db.question.aggregate({
      where: { topicId: t.id },
      _sum: { voiceCount: true, answerCount: true },
    });
    const poll = await db.poll.findFirst({
      where: { topicId: t.id, kind: "WEEKLY" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    const report = await db.weeklyReport.findUnique({
      where: { topicId: t.id },
      select: { id: true },
    });
    return {
      id: t.id,
      weekNumber: t.weekNumber,
      title: t.title,
      blurb: t.blurb,
      countryCode: t.countryCode,
      startsOn: dayString(t.startsOn),
      endsOn: dayString(t.endsOn),
      status: t.status,
      sensitive: t.sensitive,
      whatNextPrompt: t.whatNextPrompt,
      questionCount: t.questionCount,
      voiceCount: sum._sum.voiceCount ?? 0,
      voicesCount: sum._sum.answerCount ?? 0, // lead ruling WF, 6 Nov (RW1)
      weeklyPollId: poll?.id ?? null,
      reportId: report?.id ?? null,
    };
  }

  async poll(p: PollRow, db: Db = this.prisma): Promise<Json> {
    const cost = p.publicInterest
      ? 0
      : await this.numConfig("cost.vote_milli", 200, db);
    const total = p.options.reduce((s, o) => s + o.voteCount, 0);
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      choiceMode: p.choiceMode,
      status: p.status,
      publicInterest: p.publicInterest,
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt.toISOString(),
      questionId: p.questionId,
      topicId: p.topicId,
      totalVotes: p.totalVotes,
      options: p.options.map((o) => ({
        id: o.id,
        label: o.label,
        votes: o.voteCount,
        percent: total > 0 ? Math.round((o.voteCount / total) * 1000) / 10 : 0,
      })),
      myVote: null,
      costToVoteMilli: cost,
      label: "Open poll",
    };
  }

  /** The Question card the admin console shows (the same shape readers get, without anything personal). */
  async questionCard(q: QuestionRow, db: Db = this.prisma): Promise<Json> {
    // One after the other: `db` may be a transaction's connection (C-L8).
    const topic = q.topicId
      ? await db.topic.findUnique({ where: { id: q.topicId } })
      : null;
    const category = q.categoryId
      ? await db.category.findUnique({ where: { id: q.categoryId } })
      : null;
    const openPoll = await db.poll.findFirst({
      where: {
        OR: [
          { questionId: q.id },
          ...(q.topicId
            ? [{ topicId: q.topicId, kind: "WEEKLY" as const }]
            : []),
        ],
        status: "OPEN",
        endsAt: { gt: new Date() },
      },
      select: { id: true },
    });
    const proposals = await db.proposal.count({
      where: { questionId: q.id, status: "PUBLISHED" },
    });
    const override =
      q.kind === "OVERRIDE"
        ? await db.override.findUnique({ where: { questionId: q.id } })
        : null;
    const catCounts = category
      ? [
          await db.answer.count({
            where: {
              status: "PUBLISHED",
              deletedAt: null,
              createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
              question: { categoryId: category.id },
            },
          }),
          await db.question.count({ where: { categoryId: category.id } }),
        ]
      : [0, 0];
    return {
      id: q.id,
      topicId: q.topicId,
      topicTitle: topic?.title ?? null,
      weekNumber: topic?.weekNumber ?? null,
      kind: q.kind,
      status: q.status,
      text: q.text,
      hint: q.hint,
      scheduledFor: q.scheduledFor ? dayString(q.scheduledFor) : null,
      startsAt: q.startsAt?.toISOString() ?? null,
      endsAt: q.endsAt?.toISOString() ?? null,
      pinned: q.pinned,
      sensitive: q.sensitive || (topic?.sensitive ?? false),
      voiceCount: q.voiceCount,
      answerCount: q.answerCount,
      voicesCount: q.answerCount, // lead ruling WF, 6 Nov (RW1)
      hasOpenPoll: !!openPoll,
      proposalCount: proposals,
      iSaved: false,
      recentVoices: [],
      category: category
        ? {
            id: category.id,
            slug: category.slug,
            name: category.name,
            blurb: category.blurb,
            voicesThisWeek: catCounts[0],
            questionCount: catCounts[1],
          }
        : null,
      override: override
        ? {
            contentKind: override.contentKind,
            body: override.body,
            audioUrl: null,
            imageUrl: null,
            linkUrl: override.linkUrl,
            endsAt: override.endsAt.toISOString(),
          }
        : null,
    };
  }
}
