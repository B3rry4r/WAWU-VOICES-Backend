import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { NotificationType, Prisma } from "../generated/prisma/client";
import { hiddenUserIdsOf } from "../me/blocks";
import { APPEALABLE_NOTICE } from "../admin/trust/common";
import { isQuestionReadable } from "../feed/question-window";
import { decodeCursor, encodeCursor, plain, quoteOf } from "./reach-support";

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
  /** The question to open for a target that is an answer or a question (RW7); null for the rest. */
  questionId: string | null;
  /** MODERATION_NOTICE only: whether the notice carries an "Appeal" action, and what it appeals (RW2). */
  appeal: {
    state: "AVAILABLE" | "SENT";
    targetType: "ANSWER" | "REPLY" | "PROPOSAL" | "RESULT_POST" | "USER";
    targetId: string;
  } | null;
  /**
   * lead ruling WF-6 (RX2): true on a removal, warning, suspension or ban notice whose appeal has been decided since the
   * notice was sent. The notice stays in the list, marked resolved, with no Appeal action. False on every other row.
   */
  resolved: boolean;
}

const NAMED_TYPES = ["REPLY", "REACTIONS"] as const;

type Notice = Prisma.NotificationGetPayload<object>;

/** A row stored without a body still reads as a sentence (every notification has a body, RW7). */
function fallbackBody(type: NotificationType): string {
  switch (type) {
    case "REPLY":
      return "Open it to read the reply.";
    case "REACTIONS":
      return "Open it to see who reacted.";
    case "POLL_CLOSED":
    case "FLASH_POLL":
      return "Open it to see the poll.";
    case "UNITS_ADDED":
    case "EXTRA_VOICE_ADDED":
      return "Open it to see your tokens.";
    case "RESULT_CHECKED":
      return "Open it to see the result.";
    case "VIDEO_READY":
      return "Open it to watch and share your video.";
    default:
      return "Open it to read more.";
  }
}

/**
 * In-app notifications (V-10: no phone push at launch). Other modules call `notify` in the wiring step; the routes in
 * notifications.controller.ts read and mark them.
 */
/** The fields the question window rule reads (feed/question-window.ts). */
const QUESTION_WINDOW = {
  status: true,
  startsAt: true,
  endsAt: true,
} as const;

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
    const hidden = new Set(await hiddenUserIdsOf(this.prisma, userId));
    const items = await this.render(userId, page, hidden);
    return {
      items,
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
      unread: await this.unread(userId),
    };
  }

  /**
   * lead ruling WF, 6 Nov (RW7, RW8): replies and reactions are worded at read time from who did them now, so a person
   * blocked since (either way) is never named and their notice is not shown; a reaction notice names the first
   * reactor you can see and counts the others. Every row carries a body and the question to open.
   */
  private async render(
    userId: string,
    rows: Notice[],
    hidden: Set<string>,
  ): Promise<NotificationView[]> {
    const keyed = (n: Notice, prefix: string) =>
      n.groupKey?.startsWith(prefix) ? n.groupKey.slice(prefix.length) : null;
    const replyIds = [
      ...new Set(
        rows.flatMap((n) => [
          ...(keyed(n, "reply:") ? [keyed(n, "reply:") as string] : []),
          ...(n.targetType === "reply" && n.targetId ? [n.targetId] : []),
        ]),
      ),
    ];
    const reactAnswerIds = rows.flatMap((n) => keyed(n, "reactions:") ?? []);
    const answerIds = [
      ...new Set([
        ...rows.flatMap((n) =>
          n.targetType === "answer" && n.targetId ? [n.targetId] : [],
        ),
        ...reactAnswerIds,
      ]),
    ];
    const appealRows = rows.filter((n) =>
      n.groupKey?.startsWith(APPEALABLE_NOTICE),
    );
    const appealTarget = (n: Notice) => {
      const kind = (n.groupKey as string)
        .slice(APPEALABLE_NOTICE.length)
        .split(":")[0];
      if (kind === "SUSPEND" || kind === "BAN" || n.targetType === "user")
        return { targetType: "USER" as const, targetId: userId };
      return {
        targetType: (n.targetType ?? "").toUpperCase() as
          "ANSWER" | "REPLY" | "PROPOSAL" | "RESULT_POST",
        targetId: n.targetId as string,
      };
    };
    const [replies, reactions, answers, appeals] = await Promise.all([
      replyIds.length
        ? this.prisma.reply.findMany({
            where: { id: { in: replyIds } },
            select: {
              id: true,
              body: true,
              status: true,
              author: { select: { id: true, handle: true, status: true } },
              answer: { select: { question: { select: QUESTION_WINDOW } } },
            },
          })
        : [],
      reactAnswerIds.length
        ? this.prisma.reaction.findMany({
            where: { answerId: { in: reactAnswerIds } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              answerId: true,
              user: { select: { id: true, handle: true, status: true } },
            },
          })
        : [],
      answerIds.length
        ? this.prisma.answer.findMany({
            where: { id: { in: answerIds } },
            select: {
              id: true,
              questionId: true,
              body: true,
              question: { select: QUESTION_WINDOW },
              clip: { select: { transcript: { select: { text: true } } } },
            },
          })
        : [],
      appealRows.length
        ? this.prisma.appeal.findMany({
            where: {
              userId,
              OR: appealRows.map((n) => appealTarget(n)),
            },
            select: {
              targetType: true,
              targetId: true,
              status: true,
              decidedAt: true,
            },
          })
        : [],
    ]);
    const replyBy = new Map(replies.map((r) => [r.id, r]));
    const answerBy = new Map(answers.map((a) => [a.id, a]));
    const shown = (u: { id: string; status: string }) =>
      !hidden.has(u.id) && (u.status === "ACTIVE" || u.status === "SUSPENDED");
    const out: NotificationView[] = [];
    const now = new Date();
    for (const n of rows) {
      // V-PRELAUNCH: a notice about a voice or a reply under a question that has not opened is not served.
      const linkedAnswer =
        n.targetType === "answer" && n.targetId
          ? answerBy.get(n.targetId)
          : undefined;
      const linkedReply =
        n.targetType === "reply" && n.targetId
          ? replyBy.get(n.targetId)
          : undefined;
      const reactAnswer = keyed(n, "reactions:")
        ? answerBy.get(keyed(n, "reactions:") as string)
        : undefined;
      const replyOf = keyed(n, "reply:")
        ? replyBy.get(keyed(n, "reply:") as string)
        : undefined;
      const windows = [
        linkedAnswer?.question,
        linkedReply?.answer.question,
        reactAnswer?.question,
        replyOf?.answer.question,
      ];
      if (windows.some((w) => w && !isQuestionReadable(w, now))) continue;
      let title = n.title;
      let body = n.body;
      let actorCount = n.actorCount;
      const replyKey = keyed(n, "reply:");
      const reactKey = keyed(n, "reactions:");
      if (replyKey && n.type === "REPLY") {
        const r = replyBy.get(replyKey);
        if (r) {
          if (hidden.has(r.author.id)) continue; // blocked either way: not served (RW8)
          title = shown(r.author)
            ? `@${r.author.handle} replied to your voice`
            : "Someone replied to your voice";
          // F6: quote the reply only while it is up; otherwise plain words and no quote.
          body =
            r.status === "PUBLISHED"
              ? (quoteOf(r.body) ?? "A voice reply")
              : fallbackBody("REPLY");
        }
      } else if (reactKey && n.type === "REACTIONS") {
        const all = reactions.filter((x) => x.answerId === reactKey);
        if (all.length) {
          const visible = all.filter((x) => shown(x.user));
          const hiddenCount = all.filter((x) => hidden.has(x.user.id)).length;
          if (visible.length === 0) continue;
          const total = Math.max(1, n.actorCount - hiddenCount);
          const others = total - 1;
          title = `@${visible[0].user.handle}${
            others > 0
              ? ` and ${others} ${others === 1 ? "other" : "others"}`
              : ""
          } reacted to your voice`;
          actorCount = total;
        }
        const a = answerBy.get(reactKey);
        body =
          quoteOf(a?.body ?? a?.clip?.transcript?.text) ??
          body ??
          "Your voice answer";
      }
      if (!body) body = fallbackBody(n.type);
      const ans =
        n.targetType === "answer" && n.targetId
          ? answerBy.get(n.targetId)
          : undefined;
      let appeal: NotificationView["appeal"] = null;
      let resolved = false;
      if (n.groupKey?.startsWith(APPEALABLE_NOTICE)) {
        const t = appealTarget(n);
        const a = appeals.find(
          (x) => x.targetType === t.targetType && x.targetId === t.targetId,
        );
        if (!a) appeal = { state: "AVAILABLE", ...t };
        else if (a.status === "OPEN") appeal = { state: "SENT", ...t };
        else
          resolved =
            !!a.decidedAt && a.decidedAt.getTime() >= n.createdAt.getTime();
      }
      out.push({
        id: n.id,
        type: n.type,
        title,
        body,
        targetType: n.targetType,
        targetId: n.targetId,
        actorCount,
        read: n.readAt !== null,
        createdAt: n.createdAt.toISOString(),
        questionId:
          n.targetType === "question" ? n.targetId : (ans?.questionId ?? null),
        appeal,
        resolved,
      });
    }
    return out;
  }

  /**
   * Unread, without the replies and reactions the person cannot see (blocked either way). The other kinds are one
   * count query; the named kinds are rendered the same way the list is, so the bell and the list never disagree.
   */
  async unread(userId: string): Promise<number> {
    const [plainCount, named, hiddenIds] = await Promise.all([
      this.prisma.notification.count({
        where: { userId, readAt: null, type: { notIn: [...NAMED_TYPES] } },
      }),
      this.prisma.notification.findMany({
        where: { userId, readAt: null, type: { in: [...NAMED_TYPES] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 500,
      }),
      hiddenUserIdsOf(this.prisma, userId),
    ]);
    if (named.length === 0) return plainCount;
    const shown = await this.render(userId, named, new Set(hiddenIds));
    return plainCount + shown.length;
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
