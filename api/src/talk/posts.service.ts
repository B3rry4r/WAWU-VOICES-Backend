import { clearPostRecord } from "../common/idempotency-clear";
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
import {
  blockHidesAuthorOf,
  hiddenUserIdsOf,
  replyNotBlocked,
} from "../me/blocks";
import { ADMIN_FIRST_CAP, adminIdsOf } from "../me/admin-first";
import { quoteOf } from "../reach/reach-support";
import {
  isQuestionOpen,
  isQuestionOver,
  isQuestionReadable,
  notOpenYet,
} from "../feed/question-window";
import { PrismaService } from "../common/prisma/prisma.service";
import { ClipsService, type ClipRow } from "../media/clips.service";
import { AllowancesService } from "./shared/allowances.service";
import { ConfigReader } from "./shared/config-reader";
import { ProfileService, type Profile } from "./shared/profile.service";
import { UnitsAccess } from "./shared/units-access";
import { countChars } from "../units/text-price";
import type { ChargeOpts, ChargeResult } from "../units/units.port";
/** What an earlier request left on the charge it made (the same key sent again). */
type PriorCharge = {
  refType: string | null;
  refId: string | null;
  createdAt: Date;
};

import {
  ANSWER_INCLUDE,
  REPLY_INCLUDE,
  Views,
  type AnswerRow,
  type ReplyRow,
} from "./views";
import type {
  ChargeAction,
  Prisma,
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
  anonymous?: boolean;
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

/**
 * C2.1 L-2: the 404 of a question that exists and has not opened (V-27). Same body as any 404. Since C22 the controller
 * gives no try back for it (only the 409 QUESTION_NOT_OPEN gets one); the class stays so the two 404s can be told apart.
 */
export class UnopenedNotFound extends NotFoundException {
  constructor() {
    super({ code: "NOT_FOUND", message: "We could not find that." });
  }
}

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
    if (
      extraVoiceTokenId &&
      clip.extraTokenId &&
      extraVoiceTokenId !== clip.extraTokenId
    )
      throw invalid(
        "extraVoiceTokenId",
        "That voice token is not on this recording.",
      );
    return { body: null, clip };
  }

  /**
   * Charge first (idempotent on the key), then write; if the write fails the charge is reversed.
   * V-HOTFIX-1: only a charge THIS request created is ever reversed. A charge that was already there (the same key
   * sent again after its idempotency record expired) belongs to an earlier request: when that request's post is
   * stored, `find` hands it back (`stored: true`, nothing is written, charged, reversed or given back again); when no
   * post is stored the write goes on under the old charge, and a failure leaves that charge alone.
   */
  private async spendThen<T extends { id: string }>(
    me: Profile,
    action: ChargeAction,
    key: string,
    opts: ChargeOpts,
    write: () => Promise<T>,
    refType: "answer" | "reply",
    find?: (prior: PriorCharge | null) => Promise<T | null>,
  ): Promise<{ charge: ChargeResult; value: T; stored: boolean }> {
    const prior = await this.prisma.charge.findUnique({
      where: { userId_idempotencyKey: { userId: me.id, idempotencyKey: key } },
      select: { refType: true, refId: true, createdAt: true },
    });
    const charge = await this.units.charge(me.id, action, key, {
      ...opts,
      refType,
    });
    // A charge that was already there before this request asked for it was made by an earlier request.
    const replayed = !!prior;
    if (replayed && find) {
      const done = await find(prior);
      if (done) return { charge, value: done, stored: true };
      // The charge belongs to a stored post, and this request is for something else: never write a second post under it.
      if (prior?.refId)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "That key was already used for a different request.",
        });
    }
    try {
      const value = await write();
      await this.prisma.charge
        .updateMany({
          where: { userId: me.id, idempotencyKey: key, refId: null },
          data: { refType, refId: value.id },
        })
        .catch((r) => this.logger.error(`attach ${charge.chargeId}: ${r}`));
      return { charge, value, stored: false };
    } catch (e) {
      if (replayed)
        this.logger.error(
          `not reversing ${charge.chargeId}: it was made by an earlier request`,
        );
      else
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

  /**
   * LOW 3 (BATCH-C2 round 3): an idempotent replay answered from a stored post is allowed only if that post's question is
   * readable now (src/feed/question-window.ts `isQuestionReadable`). Otherwise the replay answers what a fresh request
   * would: 409 QUESTION_NOT_OPEN for the question shown as coming up, 404 for any other. Nothing is charged, written or
   * reversed here, and the retry record is left as it is.
   */
  async assertReplayReadable(
    where: { questionId: string } | { answerId: string },
  ): Promise<void> {
    const q =
      "questionId" in where
        ? await this.prisma.question.findUnique({
            where: { id: where.questionId },
          })
        : (
            await this.prisma.answer.findUnique({
              where: { id: where.answerId },
              select: { question: true },
            })
          )?.question;
    if (!q) return; // no such question or answer: left to the stored answer (a fresh request would be 404, and the post exists)
    const now = new Date();
    if (isQuestionReadable(q, now)) return;
    throw (await notOpenYet(this.prisma, q, now)) ?? gone();
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
    if (!isQuestionOpen(q, now))
      throw (await notOpenYet(this.prisma, q, now)) ?? new UnopenedNotFound(); // a draft, or not started yet

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

    const {
      charge,
      value: answer,
      stored,
    } = await this.spendThen(
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
      "answer",
      async (prior) => {
        // The same key again, after its idempotency record expired: the answer that request made, if it is stored.
        const content = clip
          ? { clipId: clip.id, questionId: q.id }
          : { kind: "TEXT" as const, body, questionId: q.id };
        const where =
          prior?.refType === "answer" && prior.refId
            ? { id: prior.refId, ...content }
            : {
                ...content,
                createdAt: { gte: prior?.createdAt ?? new Date(0) },
              };
        return this.prisma.answer.findFirst({
          where: { ...where, authorId: me.id },
          orderBy: { createdAt: "asc" },
        });
      },
    );
    // V-HOTFIX-1 round 4: a replay (also after its record expired) that finds its post deleted by the author OR removed by a
    // moderator answers 404 and stores nothing: the thrown error makes the retry record go, never keep the text.
    if (
      stored &&
      (answer.status === "DELETED_BY_AUTHOR" || answer.status === "REMOVED")
    )
      throw gone();
    if (clip && !stored) await this.clips.consumeToken(clip);
    const full = await this.prisma.answer.findUniqueOrThrow({
      where: { id: answer.id },
      include: ANSWER_INCLUDE,
    });
    const [view] = await this.views.answers([full], me.id);
    // V-44 (M-b, B01): after the commit, only for a post that is public. The Replies switch and one an hour apply there.
    if (!stored && full.status === "PUBLISHED")
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
    // V-PRELAUNCH: nothing under a question that has not opened is readable by anyone, its author included.
    if (!isQuestionReadable(a.question, new Date())) throw gone();
    // lead ruling WF, 6 Nov (RW8, V-24): an answer by someone you blocked, or who blocked you, is 404 even by direct link.
    if (viewerId && a.authorId !== viewerId) {
      const hidden = await hiddenUserIdsOf(this.prisma, viewerId);
      if (blockHidesAuthorOf(hidden, a)) throw gone();
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
          ...replyNotBlocked(hidden),
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
      // The retry record of the request that made this post stops holding its text.
      await clearPostRecord(tx, a.authorId, "answer", id);
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
    // The lead's rule: the writer of a nameless answer who replies under their own answer always replies nameless. The server
    // decides; the client cannot turn the name on there (a reply by anyone else follows their own switch).
    const anon = !!dto.anonymous || (a.authorId === me.id && a.anonymous);
    const nowR = new Date();
    if (isQuestionOver(a.question, nowR))
      throw new ConflictException({
        code: "QUESTION_CLOSED",
        message: "This question is closed.",
      });
    if (!isQuestionOpen(a.question, nowR))
      throw (
        (await notOpenYet(this.prisma, a.question, nowR)) ??
        new UnopenedNotFound()
      ); // before the window, or a draft
    // V-HOTFIX-1: a post made without a name is open to everyone whatever blocks exist, so a 404 here cannot name the writer.
    if (!a.anonymous) {
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
    }

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

    const {
      charge,
      value: reply,
      stored,
    } = await this.spendThen(
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
              anonymous: anon,
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
          // The profile's reply count is the named replies only, as its voice count is: an unnamed one must not be countable.
          if (!anon)
            await tx.user.update({
              where: { id: me.id },
              data: { replyCount: { increment: 1 } },
            });
          return row;
        }),
      "reply",
      async (prior) => {
        // The same key again, after its idempotency record expired: the reply that request made, if it is stored.
        const content = clip
          ? { clipId: clip.id, answerId: a.id }
          : { kind: "TEXT" as const, body, answerId: a.id };
        const where =
          prior?.refType === "reply" && prior.refId
            ? { id: prior.refId, ...content }
            : {
                ...content,
                createdAt: { gte: prior?.createdAt ?? new Date(0) },
              };
        return this.prisma.reply.findFirst({
          where: { ...where, authorId: me.id },
          orderBy: { createdAt: "asc" },
        });
      },
    );
    if (stored && reply.status === "DELETED_BY_AUTHOR") throw gone();
    // V-HOTFIX-1 round 4: a replay that finds its reply removed by a moderator answers 403 CONTENT_REMOVED, as a reply on a
    // removed answer does. The answer holds no text and the thrown error leaves nothing stored in the retry record.
    if (stored && reply.status === "REMOVED")
      throw new ForbiddenException({
        code: "CONTENT_REMOVED",
        message: "That post was removed.",
      });
    if (clip && !stored) await this.clips.consumeToken(clip);
    // After the commit: tell the author of the voice that was replied to (never yourself).
    // lead ruling WF, 6 Nov (RW7, RW8): named, with a quote; none at all when either of you blocked the other.
    // V-HOTFIX-1 r3: nothing is sent to the writer of a nameless answer about a reply they cannot see in their own list
    // (a block either way between them and the replier). That is the writer's own view only; no one else's list changes.
    const writerSeesIt =
      !stored &&
      a.authorId !== me.id &&
      // V-FIX-D: a reply made without a name ignores blocks as an answer does (blocks never suppress its notice).
      !blockHidesAuthorOf(await hiddenUserIdsOf(this.prisma, me.id), {
        authorId: a.authorId,
        anonymous: a.anonymous || anon,
      }) &&
      (anon ||
        !(await hiddenUserIdsOf(this.prisma, a.authorId)).includes(me.id));
    if (writerSeesIt)
      await this.reach.notifySafe({
        userId: a.authorId,
        type: "REPLY",
        // An unnamed reply never names its author, in the stored row either (the list is worded again at read time).
        title: anon
          ? "Someone replied to your voice"
          : `@${me.handle} replied to your voice`,
        body: quoteOf(reply.body) ?? "A voice reply",
        targetType: "answer",
        targetId: a.id,
        dedupeKey: `reply:${reply.id}`,
      });
    // V-44 (M-b): B03, the same condition, after the commit; the person's reply switch and the 30 minute limit apply there.
    if (writerSeesIt)
      void this.mails?.replied(
        a.id,
        reply.id,
        a.authorId,
        me.handle,
        reply.kind,
        reply.body,
        anon,
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
        if (!r.anonymous)
          await tx.user.update({
            where: { id: r.authorId },
            data: { replyCount: { decrement: 1 } },
          });
      }
      await clearPostRecord(tx, r.authorId, "reply", id);
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
    // V-ADMIN-FIRST: replies of a current ADMIN go on top of the first page, newest first (the stance tab still applies).
    // THE BLOCK EXCEPTION IS HERE: this query has no replyNotBlocked(), so a person who blocked the admin (or was blocked
    // by them) still gets them; replies have no `anonymous` flag, so every reply by an ADMIN is a named one. The normal
    // query leaves the same replies out (`id notIn`), so none shows twice on any page.
    const adminIds = await adminIdsOf(this.prisma);
    const adminWhere: Prisma.ReplyWhereInput = {
      answerId: a.id,
      status: "PUBLISHED",
      ...(q.stance ? { stance: q.stance } : {}),
      authorId: { in: adminIds },
    };
    const adminOrder: Prisma.ReplyOrderByWithRelationInput[] = [
      { createdAt: "desc" },
      { id: "desc" },
    ];
    let top: ReplyRow[] = [];
    let topIds: string[] = [];
    if (adminIds.length && !after) {
      top = await this.prisma.reply.findMany({
        where: adminWhere,
        orderBy: adminOrder,
        take: ADMIN_FIRST_CAP,
        include: REPLY_INCLUDE,
      });
      topIds = top.map((r) => r.id);
    } else if (adminIds.length) {
      topIds = (
        await this.prisma.reply.findMany({
          where: adminWhere,
          select: { id: true },
          orderBy: adminOrder,
          take: ADMIN_FIRST_CAP,
        })
      ).map((r) => r.id);
    }
    const rows = await this.prisma.reply.findMany({
      where: {
        answerId: a.id,
        status: "PUBLISHED",
        ...(q.stance ? { stance: q.stance } : {}),
        ...replyNotBlocked(blocked),
        ...(topIds.length ? { id: { notIn: topIds } } : {}),
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
    // On top of the page, not inside `limit`: `limit` still counts ordinary replies only, so the cursor keeps its meaning.
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: [...top, ...page].map((r) =>
        this.views.reply(r, viewer?.id ?? null),
      ),
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
        ...replyNotBlocked(hidden),
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
