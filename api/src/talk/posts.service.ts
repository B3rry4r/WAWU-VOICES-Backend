import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { ClipsService, type ClipRow } from "../media/clips.service";
import { AllowancesService } from "./shared/allowances.service";
import { ConfigReader } from "./shared/config-reader";
import { ProfileService, type Profile } from "./shared/profile.service";
import { UnitsAccess } from "./shared/units-access";
import { ANSWER_INCLUDE, REPLY_INCLUDE, Views, type AnswerRow } from "./views";
import type {
  ChargeAction,
  NewsTag,
  PostKind,
  ReplyStance,
} from "../generated/prisma/client";

export interface CreateAnswerInput {
  kind: PostKind;
  body?: string;
  clipId?: string;
  extraVoiceTokenId?: string;
  isNews?: boolean;
  newsTag?: NewsTag;
  newsSourceName?: string;
  newsSourceUrl?: string;
  anonymous?: boolean;
}

export interface CreateReplyInput {
  stance: ReplyStance;
  kind: PostKind;
  body?: string;
  clipId?: string;
  extraVoiceTokenId?: string;
}

const invalid = (path: string, message: string) =>
  new UnprocessableEntityException({
    code: "VALIDATION_FAILED",
    message: "Some details need fixing.",
    details: { fields: [{ path, message }] },
  });

const gone = () =>
  new NotFoundException({
    code: "NOT_FOUND",
    message: "We could not find that.",
  });

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clips: ClipsService,
    private readonly units: UnitsAccess,
    private readonly allowances: AllowancesService,
    private readonly config: ConfigReader,
    private readonly views: Views,
    private readonly profiles: ProfileService,
  ) {}

  /** Text or voice content check shared by answers and replies. Returns the clip for a voice post. */
  private async content(
    me: Profile,
    kind: PostKind,
    body: string | undefined,
    clipId: string | undefined,
    extraVoiceTokenId: string | undefined,
    purpose: "ANSWER" | "REPLY",
  ): Promise<{ body: string | null; clip: ClipRow | null }> {
    if (kind === "TEXT") {
      if (clipId) throw invalid("clipId", "A text post has no recording.");
      const text = (body ?? "").trim();
      if (!text) throw invalid("body", "Write something first.");
      const max = await this.config.num("text.max_chars");
      if ([...text].length > max)
        throw invalid("body", `Keep it to ${max} characters.`);
      return { body: text, clip: null };
    }
    if (body) throw invalid("body", "A voice post has no text.");
    if (!clipId) throw invalid("clipId", "Choose your recording.");
    const clip = await this.clips.forPublish(me, clipId, purpose);
    if (extraVoiceTokenId && extraVoiceTokenId !== clip.extraTokenId)
      throw invalid(
        "extraVoiceTokenId",
        "That voice token is not on this recording.",
      );
    return { body: null, clip };
  }

  /** Charge first (idempotent on the key), then write; if the write fails the charge is reversed. */
  private async spendThen<T>(
    me: Profile,
    action: ChargeAction,
    key: string,
    write: () => Promise<T>,
  ) {
    const charge = await this.units.charge(me.id, action, key);
    try {
      return { charge, value: await write() };
    } catch (e) {
      await this.units
        .reverse(charge.chargeId, "post failed")
        .catch((r) =>
          this.logger.error(`reverse ${charge.chargeId}: ${String(r)}`),
        );
      // The question or answer vanished between the charge and the write: a missing row, not a server fault.
      if ((e as { code?: string }).code === "P2003") throw gone();
      throw e;
    }
  }

  private async receiptParts(
    me: Profile,
    charge: {
      costMilli: number;
      usedFreePost: boolean;
      usedFreeDaily: boolean;
    },
  ) {
    const allowances = await this.allowances.snapshot(me.id);
    return {
      charge: {
        costMilli: charge.costMilli,
        usedFreePost: charge.usedFreePost,
        usedFreeDaily: charge.usedFreeDaily,
        balanceMilli: allowances.balanceMilli,
      },
      allowances,
    };
  }

  async createAnswer(
    me: Profile,
    questionId: string,
    dto: CreateAnswerInput,
    key: string,
  ) {
    const q = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!q || q.status === "DRAFT" || q.status === "SCHEDULED") throw gone();
    if (q.status === "CLOSED" || (q.endsAt && q.endsAt < new Date()))
      throw new ConflictException({
        code: "QUESTION_CLOSED",
        message: "This question is closed.",
      });

    if (!dto.isNews && (dto.newsTag || dto.newsSourceName || dto.newsSourceUrl))
      throw invalid(
        "isNews",
        "Mark the post as news to give it a tag or a source.",
      );
    if (dto.isNews) {
      if (!dto.newsTag)
        throw new UnprocessableEntityException({
          code: "TAG_REQUIRED",
          message: "Choose a news tag before you post.",
        });
      if (dto.newsTag === "VERIFIED_NEWS") {
        if (!this.profiles.hasRole(me, "EDITOR"))
          throw new ForbiddenException({
            code: "VERIFIED_NEWS_FORBIDDEN",
            message: "Only WAWU editors can mark a post Verified News.",
          });
        if (!dto.newsSourceName?.trim())
          throw new UnprocessableEntityException({
            code: "SOURCE_REQUIRED",
            message: "Verified News needs a named source.",
          });
      }
    }
    const { body, clip } = await this.content(
      me,
      dto.kind,
      dto.body,
      dto.clipId,
      dto.extraVoiceTokenId,
      "ANSWER",
    );
    const action: ChargeAction =
      dto.kind === "VOICE" ? "POST_VOICE" : "POST_TEXT";

    const { charge, value: answer } = await this.spendThen(
      me,
      action,
      key,
      () =>
        this.prisma.$transaction(async (tx) => {
          const row = await tx.answer.create({
            data: {
              questionId: q.id,
              authorId: me.id,
              kind: dto.kind,
              body,
              clipId: clip?.id ?? null,
              isNews: !!dto.isNews,
              newsTag: dto.isNews ? dto.newsTag : null,
              newsSourceName: dto.isNews
                ? dto.newsSourceName?.trim() || null
                : null,
              newsSourceUrl: dto.isNews
                ? dto.newsSourceUrl?.trim() || null
                : null,
              anonymous: !!dto.anonymous,
            },
            include: ANSWER_INCLUDE,
          });
          await tx.question.update({
            where: { id: q.id },
            data: {
              answerCount: { increment: 1 },
              ...(clip ? { voiceCount: { increment: 1 } } : {}),
            },
          });
          return row;
        }),
    );
    if (clip) await this.clips.consumeToken(clip);
    const [view] = await this.views.answers([answer], me.id);
    return { answer: view, ...(await this.receiptParts(me, charge)) };
  }

  /** The answer a viewer may see: published, or their own held or removed one. */
  async visibleAnswer(id: string, viewerId: string | null): Promise<AnswerRow> {
    const a = await this.prisma.answer.findUnique({
      where: { id },
      include: ANSWER_INCLUDE,
    });
    if (!a || a.status === "DELETED_BY_AUTHOR") throw gone();
    if (a.status !== "PUBLISHED" && a.authorId !== viewerId) throw gone();
    return a;
  }

  async getAnswer(id: string, viewerId: string | null) {
    const a = await this.visibleAnswer(id, viewerId);
    const [v] = await this.views.answers([a], viewerId);
    return v;
  }

  async editAnswer(me: Profile, id: string, body: string) {
    const a = await this.prisma.answer.findUnique({
      where: { id },
      include: ANSWER_INCLUDE,
    });
    if (!a || a.status === "DELETED_BY_AUTHOR") throw gone();
    if (a.authorId !== me.id)
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You cannot do that.",
      });
    if (a.kind !== "TEXT")
      throw invalid("body", "Only text answers can be edited.");
    const windowMs = (await this.config.num("text.edit_window_seconds")) * 1000;
    if (Date.now() - a.createdAt.getTime() > windowMs)
      throw new ConflictException({
        code: "EDIT_WINDOW_PASSED",
        message: "You can only edit within 5 minutes of posting.",
      });
    const text = body.trim();
    if (!text) throw invalid("body", "Write something first.");
    const max = await this.config.num("text.max_chars");
    if ([...text].length > max)
      throw invalid("body", `Keep it to ${max} characters.`);
    const updated = await this.prisma.answer.update({
      where: { id },
      data: { body: text, editedAt: new Date() },
      include: ANSWER_INCLUDE,
    });
    const [v] = await this.views.answers([updated], me.id);
    return v;
  }

  async deleteAnswer(me: Profile, id: string): Promise<void> {
    const a = await this.prisma.answer.findUnique({
      where: { id },
      include: { clip: true },
    });
    if (!a) throw gone();
    if (a.authorId !== me.id)
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You cannot do that.",
      });
    const done = await this.prisma.$transaction(async (tx) => {
      const r = await tx.answer.updateMany({
        where: { id, status: { not: "DELETED_BY_AUTHOR" } },
        data: { status: "DELETED_BY_AUTHOR", deletedAt: new Date() },
      });
      if (r.count === 1)
        await tx.question.update({
          where: { id: a.questionId },
          data: {
            answerCount: { decrement: 1 },
            ...(a.clipId ? { voiceCount: { decrement: 1 } } : {}),
          },
        });
      return r.count === 1;
    });
    // A free post is never given back (CONVENTIONS), so nothing is reversed here.
    if (done && a.clip && a.clip.status !== "REMOVED")
      await this.clips.discard(a.clip);
  }

  async createReply(
    me: Profile,
    answerId: string,
    dto: CreateReplyInput,
    key: string,
  ) {
    const a = await this.prisma.answer.findUnique({
      where: { id: answerId },
      include: { question: true },
    });
    if (
      !a ||
      a.status === "DELETED_BY_AUTHOR" ||
      (a.status === "HELD" && a.authorId !== me.id)
    )
      throw gone();
    if (a.status === "REMOVED")
      throw new ForbiddenException({
        code: "CONTENT_REMOVED",
        message: "That post was removed.",
      });
    if (a.question.status === "CLOSED")
      throw new ConflictException({
        code: "QUESTION_CLOSED",
        message: "This question is closed.",
      });
    const blocked = await this.prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId: a.authorId, blockedId: me.id },
      },
    });
    if (blocked)
      throw new ForbiddenException({
        code: "BLOCKED_BY_USER",
        message: "You cannot reply to this person.",
      });

    const { body, clip } = await this.content(
      me,
      dto.kind,
      dto.body,
      dto.clipId,
      dto.extraVoiceTokenId,
      "REPLY",
    );
    const action: ChargeAction =
      dto.kind === "VOICE" ? "POST_VOICE" : "POST_TEXT";
    const stanceField = {
      AGREE: "agreeCount",
      DISAGREE: "disagreeCount",
      EXPERIENCE: "experienceCount",
    }[dto.stance] as "agreeCount" | "disagreeCount" | "experienceCount";

    const { charge, value: reply } = await this.spendThen(me, action, key, () =>
      this.prisma.$transaction(async (tx) => {
        const row = await tx.reply.create({
          data: {
            answerId: a.id,
            authorId: me.id,
            stance: dto.stance,
            kind: dto.kind,
            body,
            clipId: clip?.id ?? null,
          },
          include: REPLY_INCLUDE,
        });
        await tx.answer.update({
          where: { id: a.id },
          data: {
            replyCount: { increment: 1 },
            [stanceField]: { increment: 1 },
          },
        });
        await tx.user.update({
          where: { id: me.id },
          data: { replyCount: { increment: 1 } },
        });
        return row;
      }),
    );
    if (clip) await this.clips.consumeToken(clip);
    return {
      reply: this.views.reply(reply, me.id),
      ...(await this.receiptParts(me, charge)),
    };
  }

  async deleteReply(me: Profile, id: string): Promise<void> {
    const r = await this.prisma.reply.findUnique({
      where: { id },
      include: { clip: true },
    });
    if (!r) throw gone();
    if (r.authorId !== me.id)
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You cannot do that.",
      });
    const field = {
      AGREE: "agreeCount",
      DISAGREE: "disagreeCount",
      EXPERIENCE: "experienceCount",
    }[r.stance] as "agreeCount" | "disagreeCount" | "experienceCount";
    const done = await this.prisma.$transaction(async (tx) => {
      const u = await tx.reply.updateMany({
        where: { id, status: { not: "DELETED_BY_AUTHOR" } },
        data: { status: "DELETED_BY_AUTHOR", deletedAt: new Date() },
      });
      if (u.count === 1) {
        await tx.answer.update({
          where: { id: r.answerId },
          data: { replyCount: { decrement: 1 }, [field]: { decrement: 1 } },
        });
        await tx.user.update({
          where: { id: r.authorId },
          data: { replyCount: { decrement: 1 } },
        });
      }
      return u.count === 1;
    });
    if (done && r.clip && r.clip.status !== "REMOVED")
      await this.clips.discard(r.clip);
  }

  /** GET /answers/:id/replies: oldest first (a thread reads top to bottom), keyset on (createdAt, id). */
  async listReplies(
    answerId: string,
    viewer: Profile | null,
    q: { cursor?: string; limit?: number; stance?: ReplyStance },
  ) {
    const a = await this.visibleAnswer(answerId, viewer?.id ?? null);
    const limit = Math.min(50, Math.max(1, q.limit ?? 20));
    let after: { t: Date; id: string } | null = null;
    if (q.cursor) {
      try {
        const [t, id] = Buffer.from(q.cursor, "base64url")
          .toString()
          .split("|");
        const d = new Date(t);
        if (!id || Number.isNaN(d.getTime())) throw new Error();
        after = { t: d, id };
      } catch {
        throw invalid("cursor", "That page marker is not valid.");
      }
    }
    const blocked = viewer
      ? (
          await this.prisma.block.findMany({
            where: { blockerId: viewer.id },
            select: { blockedId: true },
          })
        ).map((b) => b.blockedId)
      : [];
    const rows = await this.prisma.reply.findMany({
      where: {
        answerId: a.id,
        status: "PUBLISHED",
        ...(q.stance ? { stance: q.stance } : {}),
        ...(blocked.length ? { authorId: { notIn: blocked } } : {}),
        ...(after
          ? {
              OR: [
                { createdAt: { gt: after.t } },
                { createdAt: after.t, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: REPLY_INCLUDE,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.views.reply(r, viewer?.id ?? null)),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString(
              "base64url",
            )
          : null,
      counts: {
        agree: a.agreeCount,
        disagree: a.disagreeCount,
        experience: a.experienceCount,
      },
    };
  }
}
