import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ReachService } from "../reach/reach.service";
import { isQuestionOpen, isQuestionOver } from "../feed/question-window";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Profile } from "./shared/profile.service";
import { UnitsAccess } from "./shared/units-access";
import { Views } from "./views";
import type { ReactionKind } from "../generated/prisma/client";

const gone = () =>
  new NotFoundException({
    code: "NOT_FOUND",
    message: "We could not find that.",
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsAccess,
    private readonly views: Views,
    private readonly reach: ReachService,
  ) {}

  private async publishedAnswer(id: string) {
    const a = await this.prisma.answer.findUnique({ where: { id } });
    if (!a || a.status !== "PUBLISHED") throw gone();
    return a;
  }

  // ---- likes (the free heart; guests too, by X-Guest-Id) ----

  private guest(id: string | undefined): string | null {
    if (id === undefined || id === "") return null;
    if (!UUID.test(id))
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: { fields: [{ path: "X-Guest-Id", message: "Send a UUID." }] },
      });
    return id.toLowerCase();
  }

  /** PUT like: idempotent. When a signed-in person sends their old guest id too, that guest's like moves to the account. */
  async like(
    answerId: string,
    me: Profile | null,
    guestHeader: string | undefined,
  ) {
    await this.publishedAnswer(answerId);
    const guestId = this.guest(guestHeader);
    if (!me && !guestId)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            {
              path: "X-Guest-Id",
              message: "Send a guest id when you are not signed in.",
            },
          ],
        },
      });
    return this.prisma.$transaction(async (tx) => {
      let delta = 0;
      if (me && guestId) {
        const moved = await tx.like.deleteMany({
          where: { answerId, guestId, userId: null },
        });
        delta -= moved.count;
      }
      const made = await tx.like.createMany({
        data: [me ? { answerId, userId: me.id } : { answerId, guestId }],
        skipDuplicates: true,
      });
      delta += made.count;
      const a = delta
        ? await tx.answer.update({
            where: { id: answerId },
            data: { likeCount: { increment: delta } },
          })
        : await tx.answer.findUniqueOrThrow({ where: { id: answerId } });
      return { answerId, iLiked: true, likeCount: a.likeCount };
    });
  }

  async unlike(
    answerId: string,
    me: Profile | null,
    guestHeader: string | undefined,
  ) {
    const a = await this.prisma.answer.findUnique({ where: { id: answerId } });
    if (!a || a.status === "DELETED_BY_AUTHOR") throw gone();
    const guestId = this.guest(guestHeader);
    return this.prisma.$transaction(async (tx) => {
      const del = me
        ? await tx.like.deleteMany({ where: { answerId, userId: me.id } })
        : guestId
          ? await tx.like.deleteMany({
              where: { answerId, guestId, userId: null },
            })
          : { count: 0 };
      const row = del.count
        ? await tx.answer.update({
            where: { id: answerId },
            data: { likeCount: { decrement: del.count } },
          })
        : await tx.answer.findUniqueOrThrow({ where: { id: answerId } });
      return { answerId, iLiked: false, likeCount: row.likeCount };
    });
  }

  // ---- reactions (the 10, one per person per answer, change free) ----

  private async state(
    answerId: string,
    userId: string,
    mine: ReactionKind | null,
    charge?: object,
  ) {
    const [a, bd] = await Promise.all([
      this.prisma.answer.findUniqueOrThrow({ where: { id: answerId } }),
      this.views.breakdowns([answerId]),
    ]);
    return {
      answerId,
      myReaction: mine,
      reactionCount: a.reactionCount,
      reactionBreakdown: bd.get(answerId) ?? [],
      ...(charge ? { charge } : {}),
    };
  }

  async setReaction(
    me: Profile,
    answerId: string,
    kind: ReactionKind,
    key: string,
  ) {
    const a = await this.publishedAnswer(answerId);
    const existing = await this.prisma.reaction.findUnique({
      where: { answerId_userId: { answerId, userId: me.id } },
    });
    if (existing) {
      // Changing is never charged again.
      if (existing.kind !== kind)
        await this.prisma.reaction.update({
          where: { id: existing.id },
          data: { kind },
        });
      return this.state(answerId, me.id, kind);
    }
    const charge = await this.units.charge(me.id, "REACTION", key);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.reaction.create({
          data: { answerId, userId: me.id, kind, chargeId: charge.chargeId },
        });
        await tx.answer.update({
          where: { id: answerId },
          data: { reactionCount: { increment: 1 } },
        });
        await tx.user.update({
          where: { id: a.authorId },
          data: { reactionsReceived: { increment: 1 } },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        // Two taps at once: the other one won. This tap becomes a change, and its charge is undone.
        await this.units
          .reverse(charge.chargeId, "reaction failed")
          .catch(() => undefined);
        await this.prisma.reaction.updateMany({
          where: { answerId, userId: me.id },
          data: { kind },
        });
        return this.state(answerId, me.id, kind);
      }
      await this.units
        .reverse(charge.chargeId, "reaction failed")
        .catch((r) => this.logger.error(String(r)));
      throw e;
    }
    // After the commit: reactions on one voice fold into one alert for its author.
    if (a.authorId !== me.id)
      await this.reach.notifySafe({
        userId: a.authorId,
        type: "REACTIONS",
        title: "People reacted to your voice",
        targetType: "answer",
        targetId: answerId,
        dedupeKey: `reactions:${answerId}`,
        fold: true,
      });
    const snap = await this.units.freeLeft(me.id, "REACTION");
    return this.state(answerId, me.id, kind, {
      costMilli: charge.costMilli,
      usedFreePost: charge.usedFreePost,
      usedFreeDaily: charge.usedFreeDaily,
      balanceMilli: snap.balanceMilli,
    });
  }

  /** Removing is free and never refunds. */
  async removeReaction(me: Profile, answerId: string) {
    const a = await this.prisma.answer.findUnique({ where: { id: answerId } });
    if (!a || a.status === "DELETED_BY_AUTHOR") throw gone();
    await this.prisma.$transaction(async (tx) => {
      const del = await tx.reaction.deleteMany({
        where: { answerId, userId: me.id },
      });
      if (del.count) {
        await tx.answer.update({
          where: { id: answerId },
          data: { reactionCount: { decrement: 1 } },
        });
        await tx.user.update({
          where: { id: a.authorId },
          data: { reactionsReceived: { decrement: 1 } },
        });
      }
    });
    return this.state(answerId, me.id, null);
  }

  // ---- saves and listens ----

  async saveAnswer(me: Profile, answerId: string, on: boolean) {
    if (on) {
      await this.publishedAnswer(answerId);
      await this.prisma.$transaction(async (tx) => {
        const made = await tx.save.createMany({
          data: [{ userId: me.id, answerId }],
          skipDuplicates: true,
        });
        if (made.count)
          await tx.user.update({
            where: { id: me.id },
            data: { savedCount: { increment: 1 } },
          });
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        const del = await tx.save.deleteMany({
          where: { userId: me.id, answerId },
        });
        if (del.count)
          await tx.user.update({
            where: { id: me.id },
            data: { savedCount: { decrement: 1 } },
          });
      });
    }
  }

  async saveQuestion(me: Profile, questionId: string, on: boolean) {
    if (on) {
      const q = await this.prisma.question.findUnique({
        where: { id: questionId },
      });
      if (
        !q ||
        !(isQuestionOpen(q, new Date()) || isQuestionOver(q, new Date()))
      )
        throw gone();
      await this.prisma.$transaction(async (tx) => {
        const made = await tx.savedQuestion.createMany({
          data: [{ userId: me.id, questionId }],
          skipDuplicates: true,
        });
        if (made.count)
          await tx.user.update({
            where: { id: me.id },
            data: { savedCount: { increment: 1 } },
          });
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        const del = await tx.savedQuestion.deleteMany({
          where: { userId: me.id, questionId },
        });
        if (del.count)
          await tx.user.update({
            where: { id: me.id },
            data: { savedCount: { decrement: 1 } },
          });
      });
    }
  }

  async listen(answerId: string, completed: boolean): Promise<void> {
    await this.prisma.answer.updateMany({
      where: { id: answerId, status: "PUBLISHED", kind: "VOICE" },
      data: {
        listenCount: { increment: 1 },
        ...(completed ? { listenThroughCount: { increment: 1 } } : {}),
      },
    });
  }

  // ---- reports ----

  async report(
    me: Profile,
    dto: {
      targetType: "ANSWER" | "REPLY" | "PROPOSAL" | "RESULT_POST" | "USER";
      targetId: string;
      reason: string;
      note?: string;
      alsoBlock?: boolean;
    },
  ) {
    let authorId: string | null = null;
    let isNewsPost = false;
    switch (dto.targetType) {
      case "ANSWER": {
        const t = await this.prisma.answer.findUnique({
          where: { id: dto.targetId },
        });
        if (!t || t.status === "DELETED_BY_AUTHOR") throw gone();
        authorId = t.authorId;
        isNewsPost = t.isNews;
        break;
      }
      case "REPLY": {
        const t = await this.prisma.reply.findUnique({
          where: { id: dto.targetId },
        });
        if (!t || t.status === "DELETED_BY_AUTHOR") throw gone();
        authorId = t.authorId;
        break;
      }
      case "PROPOSAL": {
        const t = await this.prisma.proposal.findUnique({
          where: { id: dto.targetId },
        });
        if (!t) throw gone();
        authorId = t.authorId;
        break;
      }
      case "RESULT_POST": {
        const t = await this.prisma.resultPost.findUnique({
          where: { id: dto.targetId },
        });
        if (!t) throw gone();
        authorId = t.authorId;
        break;
      }
      case "USER": {
        const t = await this.prisma.user.findUnique({
          where: { id: dto.targetId },
        });
        if (!t) throw gone();
        authorId = t.id;
        break;
      }
    }
    if (authorId === me.id)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            { path: "targetId", message: "You cannot report yourself." },
          ],
        },
      });
    if (
      dto.reason === "MISLEADING_NEWS_TAG" &&
      !(dto.targetType === "ANSWER" && isNewsPost)
    )
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            {
              path: "reason",
              message: "Only a news post can have a misleading tag.",
            },
          ],
        },
      });

    const priority = dto.reason === "ABOUT_ME";
    return this.prisma.$transaction(async (tx) => {
      // One report per person per item: the unique key answers a repeat with 409 CONFLICT.
      const report = await tx.report.create({
        data: {
          reporterId: me.id,
          targetType: dto.targetType,
          targetId: dto.targetId,
          reason: dto.reason as never,
          note: dto.note?.trim() || null,
          priority,
          alsoBlocked: !!dto.alsoBlock && !!authorId,
        },
      });
      for (const queue of priority
        ? (["REPORTED", "PRIORITY"] as const)
        : (["REPORTED"] as const)) {
        const key = {
          targetType: dto.targetType,
          targetId: dto.targetId,
          queue,
        };
        const item = await tx.moderationItem.findUnique({
          where: { targetType_targetId_queue: key },
        });
        if (item) {
          await tx.moderationItem.update({
            where: { id: item.id },
            data: {
              reportCount: { increment: 1 },
              status: "OPEN",
              resolvedAt: null,
              priority: item.priority || priority,
              reasons: item.reasons.includes(dto.reason)
                ? item.reasons
                : [...item.reasons, dto.reason],
            },
          });
        } else {
          await tx.moderationItem.create({
            data: { ...key, reasons: [dto.reason], reportCount: 1, priority },
          });
        }
      }
      if (dto.reason === "MISLEADING_NEWS_TAG")
        await tx.answer.update({
          where: { id: dto.targetId },
          data: {
            newsFlagCount: { increment: 1 },
            newsReviewStatus: "FLAGGED",
          },
        });
      let blocked = false;
      if (dto.alsoBlock && authorId) {
        await tx.block.createMany({
          data: [{ blockerId: me.id, blockedId: authorId }],
          skipDuplicates: true,
        });
        blocked = true;
      }
      return { id: report.id, status: report.status, blocked };
    });
  }

  // ---- helpful marks ----
  // One row per person and answer in Helpful (unique answerId + userId); the answer's helpfulCount is the count.

  async helpful(me: Profile, answerId: string, on: boolean): Promise<void> {
    const a = on
      ? await this.publishedAnswer(answerId)
      : await this.prisma.answer.findUnique({ where: { id: answerId } });
    if (!a) return;
    if (a.authorId === me.id) return; // your own answer is never "helpful" to you
    await this.prisma.$transaction(async (tx) => {
      if (on) {
        const made = await tx.helpful.createMany({
          data: [{ answerId, userId: me.id }],
          skipDuplicates: true,
        });
        if (made.count)
          await tx.answer.update({
            where: { id: answerId },
            data: { helpfulCount: { increment: 1 } },
          });
      } else {
        const del = await tx.helpful.deleteMany({
          where: { answerId, userId: me.id },
        });
        if (del.count)
          await tx.answer.update({
            where: { id: answerId },
            data: { helpfulCount: { decrement: 1 } },
          });
      }
    });
  }

  // ---- appeals and support ----

  async appeal(
    me: Profile,
    dto: {
      targetType: "ANSWER" | "REPLY" | "PROPOSAL" | "RESULT_POST" | "USER";
      targetId: string;
      note: string;
    },
  ) {
    const note = dto.note.trim();
    if (!note)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [{ path: "note", message: "Tell us why you are appealing." }],
        },
      });
    let removed = false;
    switch (dto.targetType) {
      case "ANSWER": {
        const t = await this.prisma.answer.findFirst({
          where: { id: dto.targetId, authorId: me.id },
        });
        if (!t) throw gone();
        removed = t.status === "REMOVED" || t.status === "HELD";
        break;
      }
      case "REPLY": {
        const t = await this.prisma.reply.findFirst({
          where: { id: dto.targetId, authorId: me.id },
        });
        if (!t) throw gone();
        removed = t.status === "REMOVED" || t.status === "HELD";
        break;
      }
      case "PROPOSAL": {
        const t = await this.prisma.proposal.findFirst({
          where: { id: dto.targetId, authorId: me.id },
        });
        if (!t) throw gone();
        removed = t.status === "REMOVED" || t.status === "HELD";
        break;
      }
      case "RESULT_POST": {
        const t = await this.prisma.resultPost.findFirst({
          where: { id: dto.targetId, authorId: me.id },
        });
        if (!t) throw gone();
        removed = true; // result posts have their own statuses; the moderator decides
        break;
      }
      case "USER":
        if (dto.targetId !== me.id) throw gone();
        removed = me.status !== "ACTIVE";
        break;
    }
    if (!removed)
      throw new ConflictException({
        code: "CONFLICT",
        message: "Only a removed or held post can be appealed.",
      });
    return this.prisma.$transaction(async (tx) => {
      const key = {
        targetType: dto.targetType,
        targetId: dto.targetId,
        queue: "APPEAL" as const,
      };
      const item = await tx.moderationItem.upsert({
        where: { targetType_targetId_queue: key },
        create: { ...key, reasons: ["APPEAL"], reportCount: 1 },
        update: {
          status: "OPEN",
          resolvedAt: null,
          reportCount: { increment: 1 },
        },
      });
      const ap = await tx.appeal.create({
        data: {
          userId: me.id,
          targetType: dto.targetType,
          targetId: dto.targetId,
          note,
          itemId: item.id,
        },
      });
      return { id: ap.id, status: ap.status as "OPEN" | "DECIDED" };
    });
  }

  async support(
    me: Profile | null,
    guestHeader: string | undefined,
    dto: {
      topic: string;
      message: string;
      paymentId?: string;
      contactEmail?: string;
    },
  ) {
    const guestId = this.guest(guestHeader);
    const message = dto.message.trim();
    const bad = (path: string, m: string) =>
      new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: { fields: [{ path, message: m }] },
      });
    if (!message) throw bad("message", "Write your message.");
    if (message.length > 2000)
      throw bad("message", "Keep it under 2000 characters.");
    if (
      dto.contactEmail &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dto.contactEmail)
    )
      throw bad("contactEmail", "That email is not valid.");
    if (dto.paymentId) {
      const pay = me
        ? await this.prisma.payment.findFirst({
            where: { id: dto.paymentId, userId: me.id },
          })
        : null;
      if (!pay)
        throw bad("paymentId", "We could not match that payment to you.");
    }
    const row = await this.prisma.supportMessage.create({
      data: {
        userId: me?.id ?? null,
        guestId: me ? null : guestId,
        topic: dto.topic,
        message,
        paymentId: dto.paymentId ?? null,
        contactEmail: dto.contactEmail?.trim() || null,
      },
    });
    return { id: row.id };
  }
}
