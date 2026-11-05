import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { NotificationType } from "../generated/prisma/client";
import { decodeCursor, encodeCursor, plain } from "./reach-support";

/** What another module hands to ReachService.notify. */
export interface NotifyInput {
  /** VOICES User.id (not the WAWU ID sub). */
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  /** question | answer | poll | wallet | result_post | weekly_report */
  targetType?: string | null;
  targetId?: string | null;
  /**
   * Stable key for this event, for example `reply:<replyId>` or `units:<paymentId>`. Calling notify twice with the
   * same key for the same person writes one row. Required.
   */
  dedupeKey: string;
  /**
   * Reactions on one answer fold into one row: with fold true, a repeat of the same key adds one to actorCount, marks
   * the row unread again and moves it to the top, instead of being ignored.
   */
  fold?: boolean;
  /**
   * A repeat of the same key rewrites the row's title and body and marks it unread again (no count change). For an
   * alert about one thing whose state can change, such as a result that is decided again.
   */
  refresh?: boolean;
}

export interface NotifyResult {
  id: string;
  /** true when this call wrote the row; false when the key was already there. */
  created: boolean;
}

/** Which in-app alert types the person can switch off (UserSettings). The rest always arrive. */
const SETTING_FOR_TYPE: Partial<
  Record<
    NotificationType,
    | "notifyDailyQuestion"
    | "notifyReplies"
    | "notifyReactions"
    | "notifyPollResults"
    | "notifyFlashPolls"
    | "notifyCategoryAlerts"
  >
> = {
  DAILY_QUESTION: "notifyDailyQuestion",
  REPLY: "notifyReplies",
  REACTIONS: "notifyReactions",
  POLL_CLOSED: "notifyPollResults",
  FLASH_POLL: "notifyFlashPolls",
  CATEGORY_ALERT: "notifyCategoryAlerts",
};

const TYPES_FOR_FILTER: Record<string, NotificationType[] | undefined> = {
  replies: ["REPLY"],
  reactions: ["REACTIONS"],
  polls: ["POLL_CLOSED", "FLASH_POLL"],
  all: undefined,
};

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  targetType: string | null;
  targetId: string | null;
  actorCount: number;
  read: boolean;
  createdAt: string;
}

/**
 * In-app notifications (V-10: no phone push at launch). Other modules call `notify` in the wiring step; the routes in
 * notifications.controller.ts read and mark them.
 */
@Injectable()
export class ReachService {
  private readonly logger = new Logger(ReachService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The call every other module uses (SHARED-1a): after the request's own transaction has committed, never inside one.
   * A notification that cannot be written is logged and swallowed: it must never fail the request that caused it.
   */
  async notifySafe(input: NotifyInput): Promise<void> {
    try {
      await this.notify(input);
    } catch (e) {
      this.logger.error(
        `notify ${input.type} ${input.dedupeKey} failed: ${String(e)}`,
      );
    }
  }

  async notify(input: NotifyInput): Promise<NotifyResult | null> {
    const title = plain(input.title).trim();
    if (!title) throw new Error("notify: title is required");
    if (!input.dedupeKey) throw new Error("notify: dedupeKey is required");

    // A person who switched this kind off gets no row (settings are read-only here).
    const setting = SETTING_FOR_TYPE[input.type];
    if (setting) {
      const s = await this.prisma.userSettings.findUnique({
        where: { userId: input.userId },
        select: { [setting]: true },
      });
      if (s && (s as Record<string, boolean>)[setting] === false) return null;
    }

    const data = {
      userId: input.userId,
      type: input.type,
      title,
      body: input.body ? plain(input.body) : null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      groupKey: input.dedupeKey,
    };
    const where = {
      userId_groupKey: { userId: input.userId, groupKey: input.dedupeKey },
    };

    try {
      const row = await this.prisma.notification.create({
        data,
        select: { id: true },
      });
      return { id: row.id, created: true };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      // Already there. A folding call adds one to the count and lifts the row; any other call changes nothing.
      const row = input.refresh
        ? await this.prisma.notification.update({
            where,
            data: { title, body: data.body, readAt: null },
            select: { id: true },
          })
        : input.fold
          ? await this.prisma.notification.update({
              where,
              data: {
                actorCount: { increment: 1 },
                readAt: null,
                createdAt: new Date(),
                title,
              },
              select: { id: true },
            })
          : await this.prisma.notification.findUniqueOrThrow({
              where,
              select: { id: true },
            });
      return { id: row.id, created: false };
    }
  }

  async list(
    userId: string,
    q: { cursor?: string; limit: number; unreadOnly?: boolean; type?: string },
  ): Promise<{
    items: NotificationView[];
    nextCursor: string | null;
    unread: number;
  }> {
    const cur = decodeCursor(q.cursor);
    const types = TYPES_FOR_FILTER[q.type ?? "all"];
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(q.unreadOnly ? { readAt: null } : {}),
        ...(types ? { type: { in: types } } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: cur.at } },
                { createdAt: cur.at, id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        targetType: n.targetType,
        targetId: n.targetId,
        actorCount: n.actorCount,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
      unread: await this.unread(userId),
    };
  }

  unread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Empty or missing ids marks everything. Only the caller's own rows are touched. */
  async markRead(userId: string, ids?: string[]): Promise<number> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(ids && ids.length ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return this.unread(userId);
  }
}
