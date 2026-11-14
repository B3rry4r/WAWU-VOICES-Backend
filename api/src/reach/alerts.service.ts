import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { hiddenUserIdsOf } from "../me/blocks";
import type { NewsTag, Prisma } from "../generated/prisma/client";

/** People are read and written in batches this big: one read for the page, one for who is eligible, one insert. */
export const ALERT_BATCH = 500;

/** A poll closed this long ago is still announced if the sweep missed it (a restart); older ones are left alone. */
const POLL_WINDOW_MS = 2 * 24 * 3_600_000;
/** A question that opened this long ago is still announced; older ones are left alone. */
const QUESTION_WINDOW_MS = 12 * 3_600_000;
const SWEEP_EVERY_MS = 60_000;

const TAG_LABEL: Record<NewsTag, string> = {
  VERIFIED_NEWS: "Verified News",
  UNVERIFIED_NEWS: "Unverified News",
  GOSSIP: "Gossip",
};

type Setting = "notifyPollResults" | "notifyCategoryAlerts";

interface Page {
  /** People in this page (may repeat across sources; the unique groupKey keeps one notice each). */
  ids: string[];
  /** The cursor for the next page, or null at the end. */
  next: string | null;
}

/**
 * V-FIX-B: the in-app notices nothing wrote. POLL_CLOSED (a poll closed), CATEGORY_ALERT (a new question in a category
 * someone turned "Alerts on" for) and TAG_FOLLOW (a new post under a tag someone follows). In-app only (V-10: no mail,
 * no push). Every fan-out reads people a page at a time, asks once which of them may be told, and inserts the page in
 * one statement with skipDuplicates against the unique (userId, groupKey), so running a fan-out twice adds nothing and
 * no step is one query per person.
 *
 * A person's own switches decide: notifyPollResults (the Notification settings "Poll results"), notifyCategoryAlerts
 * plus the category's own "Alerts on" chip, and the tag follow itself. A suspended, banned or deleting account gets none.
 */
@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.REACH_JOBS === "off")
      return;
    this.timer = setInterval(() => {
      this.sweep().catch((e) =>
        this.logger.error(`alert sweep failed: ${String(e)}`),
      );
    }, SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The timer's job: announce every poll that has closed and every question that has opened since the last pass. */
  async sweep(now = new Date()): Promise<{ polls: number; questions: number }> {
    if (this.running) return { polls: 0, questions: 0 };
    this.running = true;
    try {
      const polls = await this.prisma.poll.findMany({
        where: {
          closeAlertedAt: null,
          endsAt: {
            lte: now,
            gte: new Date(now.getTime() - POLL_WINDOW_MS),
          },
        },
        select: { id: true },
        orderBy: { endsAt: "asc" },
        take: 50,
      });
      let p = 0;
      for (const row of polls) p += await this.pollClosed(row.id);
      const questions = await this.prisma.question.findMany({
        where: {
          categoryAlertedAt: null,
          categoryId: { not: null },
          kind: { in: ["DAILY", "FLASH"] },
          isSpare: false,
          status: { in: ["SCHEDULED", "LIVE"] },
          startsAt: {
            lte: now,
            gte: new Date(now.getTime() - QUESTION_WINDOW_MS),
          },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        select: { id: true },
        orderBy: { startsAt: "asc" },
        take: 50,
      });
      let q = 0;
      for (const row of questions) q += await this.categoryOpened(row.id);
      return { polls: p, questions: q };
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------- the three fan-outs

  /**
   * A poll closed: one POLL_CLOSED notice for each person who voted in it and each person who saved its question, if they
   * allow poll results. Marks the poll when every page is written, so the sweep never reads it again.
   */
  async pollClosed(pollId: string): Promise<number> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: { id: true, title: true, questionId: true, totalVotes: true },
    });
    if (!poll) return 0;
    const voters = poll.totalVotes;
    const body = `${poll.title} See how ${voters} ${voters === 1 ? "voter" : "voters"} answered.`;
    const make = (userId: string): Prisma.NotificationCreateManyInput => ({
      userId,
      type: "POLL_CLOSED",
      title: "Poll closed",
      body,
      targetType: "poll",
      targetId: poll.id,
      groupKey: `poll-closed:${poll.id}`,
    });
    let sent = await this.fanOut(
      async (after) => {
        const rows = await this.prisma.vote.findMany({
          where: { pollId: poll.id },
          select: { id: true, userId: true },
          orderBy: { id: "asc" },
          take: ALERT_BATCH,
          ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        });
        return {
          ids: rows.map((r) => r.userId),
          next: rows.length === ALERT_BATCH ? rows[rows.length - 1].id : null,
        };
      },
      "notifyPollResults",
      make,
    );
    if (poll.questionId)
      sent += await this.fanOut(
        async (after) => {
          const rows = await this.prisma.savedQuestion.findMany({
            where: { questionId: poll.questionId as string },
            select: { id: true, userId: true },
            orderBy: { id: "asc" },
            take: ALERT_BATCH,
            ...(after ? { cursor: { id: after }, skip: 1 } : {}),
          });
          return {
            ids: rows.map((r) => r.userId),
            next: rows.length === ALERT_BATCH ? rows[rows.length - 1].id : null,
          };
        },
        "notifyPollResults",
        make,
      );
    await this.prisma.poll.updateMany({
      where: { id: poll.id, closeAlertedAt: null },
      data: { closeAlertedAt: new Date() },
    });
    return sent;
  }

  /**
   * A question opened in a category: one CATEGORY_ALERT notice for each person who has "Alerts on" for that category
   * and allows category alerts. Marks the question when every page is written.
   */
  async categoryOpened(questionId: string): Promise<number> {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        text: true,
        categoryId: true,
        category: { select: { name: true } },
      },
    });
    if (!q?.categoryId) return 0;
    const categoryId = q.categoryId;
    const sent = await this.fanOut(
      async (after) => {
        const rows = await this.prisma.userCategory.findMany({
          where: {
            categoryId,
            alertsOn: true,
            ...(after ? { userId: { gt: after } } : {}),
          },
          select: { userId: true },
          orderBy: { userId: "asc" },
          take: ALERT_BATCH,
        });
        return {
          ids: rows.map((r) => r.userId),
          next:
            rows.length === ALERT_BATCH ? rows[rows.length - 1].userId : null,
        };
      },
      "notifyCategoryAlerts",
      (userId) => ({
        userId,
        type: "CATEGORY_ALERT",
        title: `New in ${q.category?.name ?? "a category you follow"}`,
        body: q.text,
        targetType: "question",
        targetId: q.id,
        groupKey: `category-alert:${q.id}`,
      }),
    );
    await this.prisma.question.updateMany({
      where: { id: q.id, categoryAlertedAt: null },
      data: { categoryAlertedAt: new Date() },
    });
    return sent;
  }

  /**
   * A post went live under a tag: one TAG_FOLLOW notice for each person who follows that tag, except the poster and
   * anyone blocked either way with them. A person gets at most one notice per tag per hour (the groupKey carries the
   * hour), so a busy tag is a nudge, never a flood. The tag follow is the switch: unfollow and nothing is written.
   */
  async tagPost(answerId: string, now = new Date()): Promise<number> {
    const a = await this.prisma.answer.findUnique({
      where: { id: answerId },
      select: {
        id: true,
        authorId: true,
        newsTag: true,
        isNews: true,
        status: true,
        deletedAt: true,
        question: { select: { text: true } },
      },
    });
    if (
      !a ||
      !a.isNews ||
      !a.newsTag ||
      a.status !== "PUBLISHED" ||
      a.deletedAt
    )
      return 0;
    const tag = a.newsTag;
    const hour = now.toISOString().slice(0, 13);
    const skip = new Set([
      a.authorId,
      ...(await hiddenUserIdsOf(this.prisma, a.authorId)),
    ]);
    return this.fanOut(
      async (after) => {
        const rows = await this.prisma.newsTagFollow.findMany({
          where: { tag, ...(after ? { userId: { gt: after } } : {}) },
          select: { userId: true },
          orderBy: { userId: "asc" },
          take: ALERT_BATCH,
        });
        return {
          ids: rows.map((r) => r.userId).filter((id) => !skip.has(id)),
          next:
            rows.length === ALERT_BATCH ? rows[rows.length - 1].userId : null,
        };
      },
      null,
      (userId) => ({
        userId,
        type: "TAG_FOLLOW",
        title: `New under ${TAG_LABEL[tag]}`,
        body: a.question.text,
        targetType: "answer",
        targetId: a.id,
        groupKey: `tag-follow:${tag}:${hour}`,
      }),
    );
  }

  /** Runs tagPost after the request, never failing it. */
  tagPostSafe(answerId: string): void {
    void this.tagPost(answerId).catch((e) =>
      this.logger.error(`tag follow alert ${answerId} failed: ${String(e)}`),
    );
  }

  // ---------------------------------------------------------------- the one loop

  /**
   * Reads people a page at a time, keeps those who are active and have not switched `setting` off, and writes their
   * notices with one insert per page. Returns how many rows this run wrote.
   */
  private async fanOut(
    read: (after: string | null) => Promise<Page>,
    setting: Setting | null,
    make: (userId: string) => Prisma.NotificationCreateManyInput,
  ): Promise<number> {
    let after: string | null = null;
    let sent = 0;
    for (;;) {
      const page: Page = await read(after);
      if (page.ids.length) {
        const ids = [...new Set(page.ids)];
        const users = await this.prisma.user.findMany({
          where: {
            id: { in: ids },
            status: "ACTIVE",
            deletionRequestedAt: null,
            ...(setting
              ? { OR: [{ settings: null }, { settings: { [setting]: true } }] }
              : {}),
          },
          select: { id: true },
        });
        if (users.length) {
          const res = await this.prisma.notification.createMany({
            data: users.map((u) => make(u.id)),
            skipDuplicates: true,
          });
          sent += res.count;
        }
      }
      if (!page.next) return sent;
      after = page.next;
    }
  }
}
