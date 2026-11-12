import { MailEvents } from "../mail/mail-events";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  Optional,
} from "@nestjs/common";
import { ReachService } from "../reach/reach.service";
import { hiddenUserIdsOf } from "../me/blocks";
import { quoteOf } from "../reach/reach-support";
import { isQuestionOpen, isQuestionOver } from "../feed/question-window";
import { PrismaService } from "../common/prisma/prisma.service";
import { ClipsService, type ClipRow } from "../media/clips.service";
import { AllowancesService } from "./shared/allowances.service";
import { ConfigReader } from "./shared/config-reader";
import { ProfileService, type Profile } from "./shared/profile.service";
import { UnitsAccess } from "./shared/units-access";
import { countChars } from "../units/text-price";
import type { ChargeOpts } from "../units/units.port";
import { ANSWER_INCLUDE, REPLY_INCLUDE, Views, type AnswerRow } from "./views";
import type {
  ChargeAction,
  Mood,
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
  mood?: Mood;
  showNameOnCard?: boolean;
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
    private readonly reach: ReachService,
    @Optional() private readonly mails?: MailEvents,
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
      if (countChars(text) > max)
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
    opts: ChargeOpts,
    write: () => Promise<T>,
  ) {
    const charge = await this.units.charge(me.id, action, key, opts);
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

  /** What the price follows: a text by its characters, a voice by its length (a token bought earlier already paid). */
  private chargeOpts(body: string | null, clip: ClipRow | null): ChargeOpts {
    return clip
      ? { durationMs: clip.durationMs ?? 0, prepaid: !!clip.extraTokenId }
      : { chars: countChars(body ?? "") };
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
    const now = new Date();
    if (!q) throw gone();
    if (isQuestionOver(q, now))
      throw new ConflictException({
        code: "QUESTION_CLOSED",
        message: "This question is closed.",
      });
    if (!isQuestionOpen(q, now)) throw gone(); // a draft, or not started yet

    // LCH-02: on a mood question every answer, voice or text, carries one of the question's words. Anywhere else it
    // carries none. Said before anything is charged.
    if (q.moodOptions.length) {
      if (!dto.mood) throw invalid("mood", "Pick one word before you post.");
      if (!q.moodOptions.includes(dto.mood))
        throw invalid("mood", "Pick one of the words shown.");
    } else if (dto.mood) {
      throw invalid("mood", "This question has no words to pick from.");
    }

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
      this.chargeOpts(body, clip),
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
              mood: q.moodOptions.length ? (dto.mood ?? null) : null,
              showNameOnCard: !!dto.showNameOnCard && !dto.anonymous,
            },
            // No include here: Prisma runs the relations of an include side by side on this transaction's one
            // connection (the pg warning, C-L8). The row is read with its relations after the commit.
          });
          if (clip && !dto.anonymous)
            await tx.user.update({
              where: { id: me.id },
              data: { voiceCount: { increment: 1 } },
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
    const full = await this.prisma.answer.findUniqueOrThrow({
      where: { id: answer.id },
      include: ANSWER_INCLUDE,
    });
    const [view] = await this.views.answers([full], me.id);
    // V-44 (M-b, B01): after the commit, only for a post that is public. The Replies switch and one an hour apply there.
    if (full.status === "PUBLISHED")
      void this.mails?.voiceLive(me.id, {
        id: full.id,
        questionId: full.questionId,
        kind: full.kind,
        isNews: full.isNews,
        newsTag: full.newsTag,
        mood: full.mood,
        durationMs: clip?.durationMs ?? null,
      });
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
    // lead ruling WF, 6 Nov (RW8, V-24): an answer by someone you blocked, or who blocked you, is 404 even by direct link.
    if (viewerId && a.authorId !== viewerId) {
      const hidden = await hiddenUserIdsOf(this.prisma, viewerId);
      if (hidden.includes(a.authorId)) throw gone();
    }
    return a;
  }

  async getAnswer(id: string, viewerId: string | null) {
    const a = await this.visibleAnswer(id, viewerId);
    const [v] = await this.views.answers([a], viewerId);
    // lead ruling WF, 6 Nov (WF-5): the reply count the viewer sees is the length of the list the viewer sees. The stored
    // count includes replies by people hidden from this viewer (blocked either way), so on this thread response (where the
    // list is shown) it is counted for that viewer; everywhere else the stored count stays (counting per viewer in feeds
    // and cards would cost a query per card).
    const hidden = await hiddenUserIdsOf(this.prisma, viewerId);
    if (hidden.length)
      v.replyCount = await this.prisma.reply.count({
        where: {
          answerId: a.id,
          status: "PUBLISHED",
          authorId: { notIn: hidden },
        },
      });
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
    if (countChars(text) > max)
      throw invalid("body", `Keep it to ${max} characters.`);
    // lead ruling LF, 9 Nov: an edit that makes the message longer pays the difference in proportion (no free floor).
    // The key names the change itself, so two taps of the same edit are charged once.
    const from = countChars(a.body ?? "");
    const to = countChars(text);
    let charge: { chargeId: string } | null = null;
    if (to > from)
      charge = await this.units.charge(
        me.id,
        "EDIT_TEXT",
        `edit:${id}:${from}:${to}`,
        { chars: to, fromChars: from },
      );
    // Update, then read with the relations: an update with an include runs the relations side by side inside Prisma's
    // own transaction on one connection (the pg warning, C-L8).
    try {
      await this.prisma.answer.update({
        where: { id },
        data: { body: text, editedAt: new Date() },
      });
    } catch (e) {
      if (charge)
        await this.units
          .reverse(charge.chargeId, "edit failed")
          .catch((r) => this.logger.error(String(r)));
      throw e;
    }
    const updated = await this.prisma.answer.findUniqueOrThrow({
      where: { id },
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
      if (
        r.count === 1 &&
        a.kind === "VOICE" &&
        !a.anonymous &&
        a.status === "PUBLISHED"
      )
        await tx.user.update({
          where: { id: a.authorId },
          data: { voiceCount: { decrement: 1 } },
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
    const nowR = new Date();
    if (isQuestionOver(a.question, nowR))
      throw new ConflictException({
        code: "QUESTION_CLOSED",
        message: "This question is closed.",
      });
    if (!isQuestionOpen(a.question, nowR)) throw gone(); // before the window, or a draft
    const blocked = await this.prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId: a.authorId, blockedId: me.id },
      },
    });
    // lead ruling WF fix round 1 (F4): someone who blocked you is not revealed. 404, the same as the GET.
    if (blocked) throw gone();
    // lead ruling WF, 6 Nov (RW8): an answer by someone you blocked is not served to you, so there is nothing to reply to.
    if (
      await this.prisma.block.findUnique({
        where: {
          blockerId_blockedId: { blockerId: me.id, blockedId: a.authorId },
        },
        select: { blockerId: true },
      })
    )
      throw gone();

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

    const { charge, value: reply } = await this.spendThen(
      me,
      action,
      key,
      this.chargeOpts(body, clip),
      () =>
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
            // No include inside the transaction (C-L8): the reply is read with its relations after the commit.
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
    // After the commit: tell the author of the voice that was replied to (never yourself).
    // lead ruling WF, 6 Nov (RW7, RW8): named, with a quote; none at all when either of you blocked the other.
    if (
      a.authorId !== me.id &&
      !(await hiddenUserIdsOf(this.prisma, me.id)).includes(a.authorId)
    )
      await this.reach.notifySafe({
        userId: a.authorId,
        type: "REPLY",
        title: `@${me.handle} replied to your voice`,
        body: quoteOf(reply.body) ?? "A voice reply",
        targetType: "answer",
        targetId: a.id,
        dedupeKey: `reply:${reply.id}`,
      });
    // V-44 (M-b): B03, the same condition, after the commit; the person's reply switch and the 30 minute limit apply there.
    if (
      a.authorId !== me.id &&
      !(await hiddenUserIdsOf(this.prisma, me.id)).includes(a.authorId)
    )
      void this.mails?.replied(
        a.id,
        reply.id,
        a.authorId,
        me.handle,
        reply.kind,
        reply.body,
      );
    const replyFull = await this.prisma.reply.findUniqueOrThrow({
      where: { id: reply.id },
      include: REPLY_INCLUDE,
    });
    return {
      reply: this.views.reply(replyFull, me.id),
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
    // lead ruling WF, 6 Nov (RW8): both directions, not only the people the viewer blocked.
    const blocked = await hiddenUserIdsOf(this.prisma, viewer?.id);
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
      counts: await this.stanceCounts(a, blocked),
    };
  }

  /** The stance tabs' counts: the stored ones, or (WF-5) the viewer's own when some authors are hidden from them. */
  private async stanceCounts(
    a: {
      id: string;
      agreeCount: number;
      disagreeCount: number;
      experienceCount: number;
    },
    hidden: string[],
  ) {
    if (!hidden.length)
      return {
        agree: a.agreeCount,
        disagree: a.disagreeCount,
        experience: a.experienceCount,
      };
    const rows = await this.prisma.reply.groupBy({
      by: ["stance"],
      where: {
        answerId: a.id,
        status: "PUBLISHED",
        authorId: { notIn: hidden },
      },
      _count: { _all: true },
    });
    const n = (st: string) =>
      rows.find((r) => r.stance === st)?._count._all ?? 0;
    return {
      agree: n("AGREE"),
      disagree: n("DISAGREE"),
      experience: n("EXPERIENCE"),
    };
  }
}
