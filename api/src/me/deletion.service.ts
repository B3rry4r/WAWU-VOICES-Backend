import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { likePrefix } from "../reach/like-prefix";
import { PrismaService } from "../common/prisma/prisma.service";
import { AccountStatus } from "../generated/prisma/enums";
import type { CurrentMeInfo } from "./me-context";
import { normaliseHandle } from "./handle";
import { ROLE_LOCK } from "./roles.service";
import type { DeleteAccountDto } from "./dto";
import { MailEvents } from "../mail/mail-events";

export const GRACE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class DeletionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeletionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mails?: MailEvents,
  ) {}

  onModuleInit(): void {
    const every = Number(process.env.ME_PURGE_INTERVAL_MS ?? 3_600_000);
    if (process.env.NODE_ENV === "test" || !(every > 0)) return;
    this.timer = setInterval(() => {
      this.purgeDue().catch((e) => this.logger.error(String(e)));
    }, every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** DELETE /me: start the 14-day grace. Idempotent. The person must type their handle and accept the unit loss. */
  async request(me: CurrentMeInfo, dto: DeleteAccountDto): Promise<void> {
    const fields: { path: string; message: string }[] = [];
    if (normaliseHandle(dto.confirmHandle) !== me.handle)
      fields.push({
        path: "confirmHandle",
        message: "Type your handle exactly to confirm.",
      });
    if (dto.understandUnitsForfeited !== true)
      fields.push({
        path: "understandUnitsForfeited",
        message: "Confirm that unspent tokens are lost.",
      });
    if (fields.length)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: { fields },
      });
    if (me.status === AccountStatus.DELETION_PENDING) return;
    const requestedAt = new Date();
    const started = await this.prisma.$transaction(async (tx) => {
      // The last admin cannot leave: VOICES must keep one (same lock as the role routes, so two admins cannot both leave).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLE_LOCK})`;
      if (await this.isLastAdmin(tx, me.id))
        throw new ConflictException({
          code: "CONFLICT",
          message:
            "You are the only admin. Give the admin role to someone else before you delete your account.",
          details: { reason: "LAST_ADMIN" },
        });
      const moved = await tx.user.updateMany({
        where: { id: me.id, status: { not: AccountStatus.DELETED } },
        data: {
          status: AccountStatus.DELETION_PENDING,
          deletionRequestedAt: requestedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: me.id,
          action: "account.delete_requested",
          targetType: "User",
          targetId: me.id,
          reason: "self",
        },
      });
      return moved.count === 1;
    });
    // V-44 (M-b, A10): after the commit. WAWU ID writes the mail (app "voices"); once per request.
    if (started)
      this.mails?.deletionRequested(
        me.id,
        me.wawuId,
        requestedAt,
        new Date(requestedAt.getTime() + GRACE_DAYS * DAY),
      );
  }

  private async isLastAdmin(
    tx: Pick<PrismaService, "userRoleGrant">,
    userId: string,
  ): Promise<boolean> {
    const mine = await tx.userRoleGrant.count({
      where: { userId, role: "ADMIN" },
    });
    if (mine === 0) return false;
    const others = await tx.userRoleGrant.count({
      where: {
        role: "ADMIN",
        userId: { not: userId },
        user: { status: AccountStatus.ACTIVE }, // an admin already leaving does not count
      },
    });
    return others === 0;
  }

  /** Purges every account whose grace has run out. Returns how many. */
  async purgeDue(now = new Date()): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: {
        status: AccountStatus.DELETION_PENDING,
        deletionRequestedAt: {
          lte: new Date(now.getTime() - GRACE_DAYS * DAY),
        },
      },
      select: { id: true },
      take: 50,
    });
    for (const u of due) await this.purge(u.id, now);
    return due.length;
  }

  /**
   * What is removed and what is kept (CONVENTIONS.md "Account deletion", V-9, V-16):
   * - removed: profile fields, avatar link, voice card, answers, replies, proposals (text blanked, marked deleted by author),
   *   voice clips (marked removed, transcripts blanked; the files in Spaces are deleted by the storage purge job),
   *   likes, reactions, saves, listen records, blocks, follows, notifications, settings, devices, roles, the free allowance;
   * - unspent Voice Units: forfeited with one ADJUSTMENT ledger transaction (the ledger is append-only);
   * - kept as an anonymous tombstone: the user row (handle "deleted-...", no phone hash, no WAWU ID link), votes and the ledger,
   *   payments and receipts, reports and audit rows: money and poll integrity need them, and none names the person any more.
   */
  async purge(userId: string, now = new Date()): Promise<void> {
    const gone: { wawuId: string | null } = { wawuId: null }; // the WAWU ID the account had, for the "deleted" mail (A11)
    await this.prisma.$transaction(
      async (tx) => {
        // Lock order: the role advisory lock (as in request() and the role routes), then the person's User row FOR UPDATE
        // before anything else is read or written. Export builds and share-card draws take that row FOR SHARE, so they
        // either finish first (the purge then sees their files) or wait and see DELETED.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLE_LOCK})`;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.status !== AccountStatus.DELETION_PENDING) return;
        if (await this.isLastAdmin(tx, userId)) {
          this.logger.warn(`purge of ${userId} skipped: last admin`);
          return;
        }

        gone.wawuId = user.wawuId;

        // Row lock on the wallet, then forfeit what is left.
        const locked = await tx.$queryRaw<{ balanceMilli: number }[]>`
          SELECT "balanceMilli" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
        const balance = locked[0]?.balanceMilli ?? 0;
        if (balance > 0) {
          await tx.ledgerTransaction.create({
            data: {
              kind: "ADJUSTMENT",
              idempotencyKey: `forfeit:${userId}`,
              reason: "ACCOUNT_DELETED: unspent tokens forfeited (V-9, V-16)",
              entries: {
                create: [
                  {
                    account: "USER_WALLET",
                    walletUserId: userId,
                    deltaMilli: -balance,
                    balanceAfterMilli: 0,
                  },
                  { account: "ADJUSTMENT", deltaMilli: balance },
                ],
              },
            },
          });
          await tx.wallet.update({
            where: { userId },
            data: { balanceMilli: 0 },
          });
        }

        // V-45: a running or waiting plan stops here. The monthly job credits only ACTIVE and QUEUED plans, so nothing is
        // credited after this. The subscription, its credits and its payment stay as money records.
        await tx.subscription.updateMany({
          where: { userId, status: { in: ["ACTIVE", "QUEUED"] } },
          data: { status: "CANCELLED_DELETED", cancelledAt: now },
        });

        // Posts: blank and mark, and keep the parents' stored counters in step.
        const answers = await tx.answer.findMany({
          where: { authorId: userId, status: { not: "DELETED_BY_AUTHOR" } },
          select: { id: true, questionId: true, kind: true, status: true },
        });
        const published = answers.filter((a) => a.status === "PUBLISHED");
        const perQuestion = new Map<string, { all: number; voice: number }>();
        for (const a of published) {
          const q = perQuestion.get(a.questionId) ?? { all: 0, voice: 0 };
          q.all += 1;
          if (a.kind === "VOICE") q.voice += 1;
          perQuestion.set(a.questionId, q);
        }
        for (const [questionId, c] of perQuestion)
          await tx.$executeRaw`UPDATE "Question" SET "answerCount" = GREATEST("answerCount" - ${c.all}, 0),
            "voiceCount" = GREATEST("voiceCount" - ${c.voice}, 0) WHERE id = ${questionId}`;
        await tx.answer.updateMany({
          where: { authorId: userId, status: { not: "DELETED_BY_AUTHOR" } },
          data: { status: "DELETED_BY_AUTHOR", deletedAt: now, body: null },
        });
        // Privacy fix P2: posts the author deleted earlier keep their text until now; blank them too.
        await tx.answer.updateMany({
          where: {
            authorId: userId,
            status: "DELETED_BY_AUTHOR",
            body: { not: null },
          },
          data: { body: null },
        });

        const replies = await tx.reply.findMany({
          where: {
            authorId: userId,
            status: "PUBLISHED",
          },
          select: { answerId: true, stance: true },
        });
        for (const r of replies) {
          const stance =
            r.stance === "AGREE"
              ? "agreeCount"
              : r.stance === "DISAGREE"
                ? "disagreeCount"
                : "experienceCount";
          await tx.$executeRawUnsafe(
            `UPDATE "Answer" SET "replyCount" = GREATEST("replyCount" - 1, 0), "${stance}" = GREATEST("${stance}" - 1, 0) WHERE id = $1`,
            r.answerId,
          );
        }
        await tx.reply.updateMany({
          where: { authorId: userId, status: { not: "DELETED_BY_AUTHOR" } },
          data: { status: "DELETED_BY_AUTHOR", deletedAt: now, body: null },
        });
        await tx.reply.updateMany({
          where: {
            authorId: userId,
            status: "DELETED_BY_AUTHOR",
            body: { not: null },
          },
          data: { body: null },
        });
        await tx.proposal.updateMany({
          where: { authorId: userId, status: { not: "DELETED_BY_AUTHOR" } },
          data: { status: "DELETED_BY_AUTHOR", body: null },
        });
        await tx.proposal.updateMany({
          where: {
            authorId: userId,
            status: "DELETED_BY_AUTHOR",
            body: { not: null },
          },
          data: { body: null },
        });

        // Privacy fix P2: rows that only need the person's id taken off them. The rows stay (support history, counts).
        await tx.supportMessage.updateMany({
          where: { userId },
          data: { userId: null, contactEmail: null },
        });
        await tx.analyticsEvent.updateMany({
          where: { userId },
          data: { userId: null },
        });
        await tx.shareEvent.updateMany({
          where: { userId },
          data: { userId: null },
        });
        await tx.adEvent.updateMany({
          where: { userId },
          data: { userId: null },
        });
        await tx.surveyEvent.updateMany({
          where: { userId },
          data: { userId: null },
        });

        // Result posts: the totals are a public civic record and stay; the author link and the sheet photo go.
        const posts = await tx.resultPost.findMany({
          where: { authorId: userId },
          select: { photoFileId: true },
        });
        const photoIds = posts
          .map((r) => r.photoFileId)
          .filter((x): x is string => !!x);
        if (photoIds.length)
          await tx.storedFile.updateMany({
            where: { id: { in: photoIds }, purgedAt: null },
            data: { purgeRequestedAt: now },
          });
        await tx.resultPost.updateMany({
          where: { authorId: userId },
          data: { authorId: null, photoFileId: null },
        });
        // Their avatar files, sheet photos and data-export files are deleted from Spaces by the storage purge job.
        await tx.storedFile.updateMany({
          where: {
            ownerId: userId,
            kind: { in: ["AVATAR", "RESULT_PHOTO", "DATA_EXPORT"] },
            purgedAt: null,
            purgeRequestedAt: null,
          },
          data: { purgeRequestedAt: now },
        });
        // LCH-07: their made videos are never served again and their files are deleted by the storage purge job.
        // Lock order as in the video sweep: the VoiceVideo rows first, then their StoredFile rows.
        const vids = await tx.$queryRaw<{ fileId: string | null }[]>`
          WITH old AS (
            SELECT id, "fileId" FROM "VoiceVideo" WHERE "authorId" = ${userId} AND status <> 'REMOVED' ORDER BY id FOR UPDATE
          ), upd AS (
            UPDATE "VoiceVideo" v SET status = 'REMOVED', "fileId" = NULL FROM old WHERE v.id = old.id RETURNING old."fileId" AS "fileId"
          ) SELECT "fileId" FROM upd`;
        const vfiles = vids
          .map((v) => v.fileId)
          .filter((f): f is string => !!f);
        if (vfiles.length)
          await tx.storedFile.updateMany({
            where: {
              id: { in: vfiles },
              purgedAt: null,
              purgeRequestedAt: null,
            },
            data: { purgeRequestedAt: now },
          });
        // Privacy P2-2: the export rows stop naming their file, so the storage job's in-use check lets it go.
        await tx.dataExport.updateMany({
          where: { userId },
          data: { fileId: null, status: "EXPIRED", expiresAt: now },
        });

        // Privacy P2-2: share cards drawn from this person's answers and profile show their words and @handle, so the
        // cards and their images go. Cards of other people's content (even on links this person shared) are not touched.
        const mine = await tx.answer.findMany({
          where: { authorId: userId },
          select: { id: true },
        });
        const cardLinks = await tx.shortLink.findMany({
          where: {
            OR: [
              { objectType: "PROFILE", objectId: userId },
              ...(mine.length
                ? [
                    {
                      objectType: "ANSWER" as const,
                      objectId: { in: mine.map((a) => a.id) },
                    },
                  ]
                : []),
            ],
          },
          select: { id: true, code: true },
        });
        if (cardLinks.length) {
          // Privacy P3: every card image under this person's link codes goes, not only the ones a card links today
          // (a redraw can leave an older image behind).
          // A raw LIKE with ESCAPE: Prisma's startsWith does not escape _ and %, so a code holding one would match others.
          for (const l of cardLinks)
            await tx.$executeRaw`
              UPDATE "StoredFile" SET "purgeRequestedAt" = ${now}
              WHERE kind = 'SHARE_CARD' AND "purgedAt" IS NULL AND "purgeRequestedAt" IS NULL
                AND key LIKE ${likePrefix(`share/${l.code}/`)} ESCAPE '\\'`;
          const cards = await tx.shareCard.findMany({
            where: { linkId: { in: cardLinks.map((l) => l.id) } },
            select: { id: true, storyFileId: true, squareFileId: true },
          });
          const cardFileIds = cards
            .flatMap((c) => [c.storyFileId, c.squareFileId])
            .filter((x): x is string => !!x);
          if (cards.length)
            await tx.shareCard.deleteMany({
              where: { id: { in: cards.map((c) => c.id) } },
            });
          if (cardFileIds.length)
            await tx.storedFile.updateMany({
              where: {
                id: { in: cardFileIds },
                purgedAt: null,
                purgeRequestedAt: null,
              },
              data: { purgeRequestedAt: now },
            });
        }

        // What they gave to other people's posts goes with them, and the counters follow.
        const likes = await tx.like.groupBy({
          by: ["answerId"],
          where: { userId },
          _count: { _all: true },
        });
        for (const l of likes)
          await tx.$executeRaw`UPDATE "Answer" SET "likeCount" = GREATEST("likeCount" - ${l._count._all}, 0) WHERE id = ${l.answerId}`;
        // lead ruling LF, 9 Nov: stored Fix my text results (and any other stored replay) go with the account.
        await tx.idempotencyRecord.deleteMany({ where: { actorId: userId } });
        await tx.like.deleteMany({ where: { userId } });
        const reacts = await tx.reaction.findMany({
          where: { userId },
          select: { answerId: true },
        });
        for (const r of reacts)
          await tx.$executeRaw`UPDATE "Answer" SET "reactionCount" = GREATEST("reactionCount" - 1, 0) WHERE id = ${r.answerId}`;
        await tx.reaction.deleteMany({ where: { userId } });
        await tx.save.deleteMany({ where: { userId } });
        // LISTEN-1: which voices this person played, and how much of each, goes with the account.
        // Lead ruling LS, 6 Nov (LS8): the finished rows also come off each answer's listenThroughCount, so the public
        // counter does not keep a person who is gone. (The guest clean-up leaves the counter alone.)
        await tx.$executeRaw`
          UPDATE "Answer" a SET "listenThroughCount" = GREATEST(a."listenThroughCount" - f.n, 0)
          FROM (SELECT "answerId", count(*)::int AS n FROM "AnswerListen"
                WHERE "userId" = ${userId} AND finished GROUP BY "answerId") f
          WHERE a.id = f."answerId"`;
        await tx.answerListen.deleteMany({ where: { userId } });
        await tx.savedQuestion.deleteMany({ where: { userId } });
        await tx.block.deleteMany({
          where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        });
        // LCH-06: the invite code and the friend links go, both ways (as inviter and as friend).
        await tx.inviteFriend.deleteMany({
          where: { OR: [{ inviterId: userId }, { friendId: userId }] },
        });
        await tx.invite.deleteMany({ where: { userId } });
        await tx.userCategory.deleteMany({ where: { userId } });
        await tx.newsTagFollow.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.userSettings.deleteMany({ where: { userId } });
        await tx.device.deleteMany({ where: { userId } });
        await tx.userRoleGrant.deleteMany({ where: { userId } });
        await tx.freeAllowance.deleteMany({ where: { userId } });

        // Voice clips: gone from the app now, files removed by the media housekeeping.
        const clips = await tx.voiceClip.findMany({
          where: { ownerId: userId },
          select: { id: true },
        });
        const clipIds = clips.map((c) => c.id);
        if (clipIds.length) {
          await tx.transcript.updateMany({
            where: { clipId: { in: clipIds } },
            data: { text: null, status: "FAILED" },
          });
          await tx.voiceClip.updateMany({
            where: { id: { in: clipIds } },
            data: { status: "REMOVED", removedAt: now },
          });
        }

        // The person themselves.
        const tomb = `deleted-${userId.replace(/-/g, "").slice(-12)}`;
        await tx.user.update({
          where: { id: userId },
          data: {
            status: AccountStatus.DELETED,
            wawuId: `deleted:${userId}`,
            phoneHash: null,
            mailTo: null,
            handle: tomb,
            displayName: null,
            bio: null,
            avatarFileId: null,
            voiceCardClipId: null,
            state: null,
            city: null,
            languages: [],
            suspendedUntil: null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "account.purged",
            targetType: "User",
            targetId: userId,
            reason: `grace of ${GRACE_DAYS} days ended`,
            after: { unitsForfeitedMilli: balance },
          },
        });
      },
      { timeout: 30_000 },
    );
    // V-44 (M-b, A11): after the commit, and only when the purge really ran. WAWU ID finds the address.
    if (gone.wawuId) this.mails?.deleted(userId, gone.wawuId);
  }
}
