import { MailEvents } from "../mail/mail-events";
import {
  ConflictException,
  HttpException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  Optional,
} from "@nestjs/common";
import { ReachService } from "../reach/reach.service";
import { AlertsService } from "../reach/alerts.service";
import { checkSourceUrl } from "../news/source-url";
import { hiddenUserIdsOf } from "../me/blocks";
import { quoteOf } from "../reach/reach-support";
import { isQuestionOpen, isQuestionOver } from "../feed/question-window";
import { BUSY_MESSAGE } from "../common/busy/busy";
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
  requestVerified?: boolean;
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

/**
 * V-FIX-B round 6 (R5-1): an edit holds one database connection for its lock and the charge opens a second one, so edits are
 * bounded in this process: at most EDIT_SLOTS inside the lock at once (6 x 2 connections, far under the pool of 20), the rest wait
 * in memory holding no connection for up to EDIT_WAIT_MS, then are told to come back (503 busy, Retry-After 2) having charged and
 * changed nothing. One process serves production (V-23).
 */
export const EDIT_SLOTS = 6;
export const EDIT_WAIT_MS = 5000;
export class EditGate {
  private active = 0;
  private readonly waiters: ((ok: boolean) => void)[] = [];
  acquire(waitMs = EDIT_WAIT_MS, slots = EDIT_SLOTS): Promise<boolean> {
    if (this.active < slots) {
      this.active++;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(wake);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(false);
      }, waitMs);
      const wake = (ok: boolean) => {
        clearTimeout(t);
        resolve(ok);
      };
      this.waiters.push(wake);
    });
  }
  release(): void {
    const next = this.waiters.shift();
    if (next)
      next(true); // the slot passes straight to the next waiter
    else this.active--;
  }
}

@Injectable()
export class PostsService {
  private readonly editGate = new EditGate();
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
    @Optional() private readonly alerts?: AlertsService,
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

    if (
      !dto.isNews &&
      (dto.newsTag ||
        dto.newsSourceName ||
        dto.newsSourceUrl ||
        dto.requestVerified)
    )
      throw invalid(
        "isNews",
        "Mark the post as news to give it a tag or a source.",
      );
    const askVerified = !!dto.isNews && !!dto.requestVerified;
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
      if (askVerified) {
        // A request is a post that asks the editors to promote it: it goes up as Unverified News (or an editor's own tag
        // is kept) and the source named here travels with the request, not with the post.
        if (dto.newsTag !== "UNVERIFIED_NEWS")
          throw invalid(
            "newsTag",
            "To ask for Verified News, post it as Unverified News first.",
          );
        if (!dto.newsSourceName?.trim())
          throw new UnprocessableEntityException({
            code: "SOURCE_REQUIRED",
            message: "Name the source you checked.",
            details: {
              fields: [
                {
                  path: "newsSourceName",
                  message: "Name the source you checked.",
                },
              ],
            },
          });
        checkSourceUrl(dto.newsSourceUrl);
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
              paidChars: dto.kind === "TEXT" ? countChars(body ?? "") : null,
              body,
              clipId: clip?.id ?? null,
              isNews: !!dto.isNews,
              newsTag: dto.isNews ? dto.newsTag : null,
              newsSourceName:
                dto.isNews && !askVerified
                  ? dto.newsSourceName?.trim() || null
                  : null,
              newsSourceUrl:
                dto.isNews && !askVerified
                  ? dto.newsSourceUrl?.trim() || null
                  : null,
              newsReviewStatus: askVerified ? "VERIFIED_REQUESTED" : undefined,
              anonymous: !!dto.anonymous,
              mood: q.moodOptions.length ? (dto.mood ?? null) : null,
              showNameOnCard: !!dto.showNameOnCard && !dto.anonymous,
            },
            // No include here: Prisma runs the relations of an include side by side on this transaction's one
            // connection (the pg warning, C-L8). The row is read with its relations after the commit.
          });
          if (askVerified)
            await tx.newsVerificationRequest.create({
              data: {
                answerId: row.id,
                requestedById: me.id,
                sourceName: (dto.newsSourceName as string).trim(),
                sourceUrl: dto.newsSourceUrl?.trim() || null,
              },
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
    // V-FIX-B: a published post under a tag is news to the people who follow that tag (in-app, after the commit).
    if (full.status === "PUBLISHED" && full.isNews && full.newsTag)
      this.alerts?.tagPostSafe(full.id);
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

  /** The Verified News lock (V-FIX-B): a poster cannot edit a post that is Verified or has an open request. An editor or admin may. */
  private async assertEditable(
    db: Pick<PrismaService, "newsVerificationRequest">,
    me: Profile,
    id: string,
    newsTag: NewsTag | null,
    reviewStatus: string,
  ): Promise<void> {
    if (this.profiles.hasRole(me, "EDITOR")) return;
    if (newsTag === "VERIFIED_NEWS")
      throw new ConflictException({
        code: "CONFLICT",
        message:
          "This post was checked as Verified News and can no longer be edited.",
        details: { reason: "VERIFIED_NEWS_LOCKED" },
      });
    if (
      reviewStatus === "VERIFIED_REQUESTED" ||
      (await db.newsVerificationRequest.findFirst({
        where: { answerId: id, status: "OPEN" },
        select: { id: true },
      }))
    )
      throw new ConflictException({
        code: "CONFLICT",
        message:
          "An editor is checking this post. It cannot be edited until they decide.",
        details: { reason: "VERIFIED_REQUEST_OPEN" },
      });
  }

  async editAnswer(me: Profile, id: string, body: string) {
    // Everything an edit does, even its first checks, happens inside one of the few slots: an edit that waits holds no connection.
    if (!(await this.editGate.acquire()))
      throw new HttpException(
        {
          code: "UNAVAILABLE",
          message: BUSY_MESSAGE,
          details: { retryAfterSeconds: 2 },
        },
        503,
      );
    try {
      return await this.editAnswerInSlot(me, id, body);
    } finally {
      this.editGate.release();
    }
  }

  private async editAnswerInSlot(me: Profile, id: string, body: string) {
    // Checks that cost nothing and do not depend on the post's current text: who, what kind, the window, the words.
    const a = await this.prisma.answer.findUnique({
      where: { id },
      select: { authorId: true, kind: true, status: true, createdAt: true },
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

    // V-FIX-B round 5 (lead ruling): the order is lock, read, price, charge, write, commit, so a refusal never has a charge to give
    // back. The post's row is locked first (the lock an editor's decision takes), and under it the post is read again: its status,
    // the Verified News lock rule and its CURRENT text. Edits of one post queue on the lock; each is priced from the text it
    // actually changes, in the order they ran (33 to 100 and 33 to 140 at once are 33 to 100, then 100 to 140), and an edit that
    // finds the text already equal answers with the post as it stands and charges nothing.
    // lead ruling LF, 9 Nov: an edit that makes the message longer pays the difference in proportion (no free floor).
    // Lock order: the post's row, then the wallet (inside the charge). No other path holds the wallet and then waits for a post.
    let paid: { chargeId: string } | null = null;
    let committed = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Answer" WHERE id = ${id} FOR UPDATE`;
        const cur = await tx.answer.findUniqueOrThrow({
          where: { id },
          select: {
            body: true,
            editedAt: true,
            paidChars: true,
            status: true,
            newsTag: true,
            newsReviewStatus: true,
          },
        });
        if (cur.status === "DELETED_BY_AUTHOR" || cur.status === "REMOVED")
          throw gone();
        await this.assertEditable(
          tx,
          me,
          id,
          cur.newsTag,
          cur.newsReviewStatus,
        );
        if ((cur.body ?? "") === text) return; // already what was asked for: nothing to charge, nothing to write
        const from = countChars(cur.body ?? "");
        const to = countChars(text);
        // V-FIX-B round 6 (R5-2): a person never pays twice for the same length. The post keeps the longest length already paid for
        // (a post from before that was kept takes the text's length now); an edit pays only for what goes beyond it.
        const paidBefore = Math.max(from, cur.paidChars ?? 0);
        if (to > paidBefore) {
          // The key names this state of the post (its text length and when it last changed), so two taps of the same edit are one
          // charge and a later, different lengthening is a new one. A charge given back because its write failed is counted by
          // the exact key, so the retry starts a fresh charge (the ledger will not reuse a reversed key).
          const base = `edit:${id}:${paidBefore}:${to}:${cur.editedAt?.getTime() ?? 0}`;
          const given = await tx.charge.count({
            where: {
              userId: me.id,
              action: "EDIT_TEXT",
              status: "REVERSED",
              OR: [
                { idempotencyKey: base },
                { idempotencyKey: { startsWith: `${base}:r` } },
              ],
            },
          });
          paid = await this.units.charge(
            me.id,
            "EDIT_TEXT",
            given ? `${base}:r${given}` : base,
            { chars: to, fromChars: paidBefore },
          );
        }
        try {
          await tx.answer.update({
            where: { id },
            data: {
              body: text,
              editedAt: new Date(),
              paidChars: Math.max(paidBefore, to),
            },
          });
        } catch (e) {
          // The only give-back left: this call's own charge, when its own write fails, before the lock is let go.
          if (paid)
            await this.units
              .reverse(paid.chargeId, "edit failed")
              .catch((r) => this.logger.error(String(r)));
          paid = null;
          throw e;
        }
      });
      committed = true;
    } catch (e) {
      // A failure after the write (the commit itself) leaves a charge for an edit that did not land: give it back.
      if (paid && !committed)
        await this.units
          .reverse((paid as { chargeId: string }).chargeId, "edit failed")
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
