import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { OverridesAdminService } from "./overrides.service";
import {
  dateOnly,
  lagosDayStart,
  lagosDayString,
  lagosInstant,
  notFound,
  type Json,
} from "./support";
import { AdminViews } from "./views";

const SHARE_TARGETS = [
  "WHATSAPP",
  "WHATSAPP_STATUS",
  "INSTAGRAM_STORIES",
  "FACEBOOK",
  "X",
  "TELEGRAM",
  "TIKTOK",
  "SMS",
  "COPY_LINK",
  "SYSTEM_SHEET",
];

/** GET /admin/today: the numbers and the schedule behind the admin home. Every count is a count query, never a list. */
@Injectable()
export class TodayAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: AdminViews,
    private readonly overrides: OverridesAdminService,
  ) {}

  async today(now = new Date()): Promise<Json> {
    const day = lagosDayString(now);
    const dayDate = dateOnly(day);
    const dayStart = lagosDayStart(day);
    const nextDayStart = new Date(dayStart.getTime() + 86_400_000);

    const live = await this.overrides.liveNow(now);
    const [topicNow, topicNext, topicLast] = await Promise.all([
      this.prisma.topic.findFirst({
        where: { startsOn: { lte: dayDate }, endsOn: { gte: dayDate } },
      }),
      this.prisma.topic.findFirst({
        where: { startsOn: { gt: dayDate } },
        orderBy: { startsOn: "asc" },
      }),
      this.prisma.topic.findFirst({ orderBy: { startsOn: "desc" } }),
    ]);
    const topic = topicNow ?? topicNext ?? topicLast;
    const dailyWhere = {
      kind: "DAILY" as const,
      isSpare: false,
      status: { in: ["SCHEDULED" as const, "LIVE" as const] },
    };
    const question = live
      ? await this.prisma.question.findUnique({
          where: { id: live.questionId },
        })
      : ((await this.prisma.question.findFirst({
          where: { ...dailyWhere, scheduledFor: dayDate },
          orderBy: { pinned: "desc" },
        })) ??
        (await this.prisma.question.findFirst({
          where: { ...dailyWhere, scheduledFor: { gt: dayDate } },
          orderBy: { scheduledFor: "asc" },
        })));
    if (!topic || !question) throw notFound("a week or a question for today");

    const nextQ = await this.prisma.question.findFirst({
      where: {
        ...dailyWhere,
        scheduledFor: {
          gt:
            question.kind === "OVERRIDE"
              ? dayDate
              : (question.scheduledFor ?? dayDate),
        },
        id: { not: question.id },
      },
      orderBy: { scheduledFor: "asc" },
    });

    const [
      answers,
      voiceAnswers,
      replies,
      voiceReplies,
      pollRow,
      shareRows,
      openReports,
      oldest,
    ] = await Promise.all([
      this.prisma.answer.count({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          createdAt: { gte: dayStart, lt: nextDayStart },
        },
      }),
      this.prisma.answer.count({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          kind: "VOICE",
          createdAt: { gte: dayStart, lt: nextDayStart },
        },
      }),
      this.prisma.reply.count({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          createdAt: { gte: dayStart, lt: nextDayStart },
        },
      }),
      this.prisma.reply.count({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          kind: "VOICE",
          createdAt: { gte: dayStart, lt: nextDayStart },
        },
      }),
      this.prisma.poll.findFirst({
        where: { topicId: topic.id, kind: "WEEKLY" },
        select: { totalVotes: true },
      }),
      this.prisma.shareEvent.groupBy({
        by: ["target"],
        where: {
          kind: "intent",
          createdAt: { gte: dayStart, lt: nextDayStart },
        },
        _count: { _all: true },
      }),
      this.prisma.report.count({ where: { status: "OPEN" } }),
      this.prisma.report.findFirst({
        where: { status: "OPEN" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    const voices = answers + replies;
    const voiceKind = voiceAnswers + voiceReplies;
    const byTarget = shareRows
      .filter((s) => s.target)
      .map((s) => ({ target: s.target as string, count: s._count._all }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          SHARE_TARGETS.indexOf(a.target) - SHARE_TARGETS.indexOf(b.target),
      );

    const [
      flagged,
      asking,
      adsWaiting,
      openModeration,
      openSensitive,
      resultPosts,
      drafts,
    ] = await Promise.all([
      this.prisma.answer.count({
        where: { isNews: true, newsReviewStatus: "FLAGGED" },
      }),
      this.prisma.newsVerificationRequest.count({ where: { status: "OPEN" } }),
      this.prisma.ad.count({ where: { status: "AWAITING_APPROVAL" } }),
      this.prisma.moderationItem.count({
        where: { status: "OPEN", queue: { not: "SENSITIVE" } },
      }),
      this.prisma.moderationItem.count({
        where: { status: "OPEN", queue: "SENSITIVE" },
      }),
      this.prisma.resultPost.count({
        where: { status: "NOT_VERIFIED", checkedAt: null },
      }),
      this.prisma.weeklyReport.count({ where: { status: "DRAFT" } }),
    ]);

    return {
      date: day,
      weekNumber: topic.weekNumber,
      topic: await this.views.topic(topic),
      flowState: live ? "OVERRIDE_LIVE" : "NORMAL",
      todaysQuestion: await this.views.questionCard(question),
      stats: {
        sharesByTarget: byTarget,
        voicesToday: voices,
        voicePercent: voices > 0 ? Math.round((voiceKind / voices) * 100) : 0,
        pollVotes: pollRow?.totalVotes ?? 0,
        shares: byTarget.reduce((s, t) => s + t.count, 0),
        openReports,
        oldestReportMinutes: oldest
          ? Math.max(
              0,
              Math.floor((now.getTime() - oldest.createdAt.getTime()) / 60_000),
            )
          : null,
      },
      schedule: await this.schedule(
        day,
        dayStart,
        nextDayStart,
        now,
        question.id,
      ),
      nextQuestion: nextQ ? await this.views.questionCard(nextQ) : null,
      needsAttention: {
        newsFlagged: flagged,
        newsAskingVerified: asking,
        adsAwaiting: adsWaiting,
        moderationOpen: openModeration + openSensitive,
        newsTags: flagged + asking,
        resultPosts,
        ads: adsWaiting,
        weeklyReports: drafts,
        moderation: openModeration,
        sensitive: openSensitive,
      },
    };
  }

  /** Today's rows in time order: the question going live, flash polls, overrides, the weekly report. */
  private async schedule(
    day: string,
    dayStart: Date,
    nextDayStart: Date,
    now: Date,
    questionId: string,
  ) {
    type Row = {
      at: Date;
      title: string;
      state: "DONE" | "SCHEDULED" | "NEEDS_YOU";
    };
    const rows: Row[] = [];
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (q) {
      const at =
        q.kind === "OVERRIDE" ? (q.startsAt ?? dayStart) : lagosInstant(day, 8);
      rows.push({
        at,
        title:
          at <= now
            ? "Today's question went live"
            : "Today's question goes live",
        state: at <= now ? "DONE" : "SCHEDULED",
      });
    }
    const flash = await this.prisma.poll.findMany({
      where: { kind: "FLASH", startsAt: { gte: dayStart, lt: nextDayStart } },
      orderBy: { startsAt: "asc" },
    });
    for (const p of flash)
      rows.push({
        at: p.startsAt,
        title: `Flash poll: ${p.title}`,
        state: p.startsAt <= now ? "DONE" : "SCHEDULED",
      });
    const overrides = await this.prisma.override.findMany({
      where: {
        cancelledAt: null,
        startsAt: { gte: dayStart, lt: nextDayStart },
      },
      orderBy: { startsAt: "asc" },
    });
    if (overrides.length) {
      const qs = await this.prisma.question.findMany({
        where: { id: { in: overrides.map((o) => o.questionId) } },
        select: { id: true, text: true },
      });
      const text = new Map(qs.map((x) => [x.id, x.text]));
      for (const o of overrides)
        rows.push({
          at: o.startsAt,
          title: `Override: ${text.get(o.questionId) ?? "a message from VOICES"}`,
          state: o.startsAt <= now ? "DONE" : "SCHEDULED",
        });
    }
    const hour = await this.views.numConfig("weekly.default_publish_hour", 18);
    const reports = await this.prisma.weeklyReport.findMany({
      where: {
        OR: [
          {
            status: "APPROVED",
            publishAt: { gte: dayStart, lt: nextDayStart },
          },
          {
            status: "PUBLISHED",
            publishedAt: { gte: dayStart, lt: nextDayStart },
          },
          { status: { in: ["DRAFT", "HELD"] } },
        ],
      },
      include: { topic: { select: { weekNumber: true } } },
    });
    for (const r of reports) {
      const week = r.topic.weekNumber;
      if (r.status === "PUBLISHED")
        rows.push({
          at: r.publishedAt ?? now,
          title: `Week ${week} report published`,
          state: "DONE",
        });
      else if (r.status === "APPROVED")
        rows.push({
          at: r.publishAt ?? now,
          title: `Week ${week} report publishes`,
          state: "SCHEDULED",
        });
      else
        rows.push({
          at: r.publishAt ?? lagosInstant(day, hour),
          title: `Week ${week} report publishes, once approved`,
          state: "NEEDS_YOU",
        });
    }
    return rows
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((r) => ({ at: r.at.toISOString(), title: r.title, state: r.state }));
  }
}
