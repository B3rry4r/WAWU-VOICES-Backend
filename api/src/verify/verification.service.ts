import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";
import { endOfPlan, lagosDayString, prettyDay } from "./verification.dates";
import { reasonText } from "./verification.reasons";
import { DOC_MAX_BYTES, sniffDocument } from "./sniff";
import {
  VERIFICATION_STORE,
  type VerificationStore,
} from "./verification.store";
import { isVerifiedNow } from "./verified";

const DAY = 24 * 60 * 60 * 1000;
/** Documents are deleted this long after a decision (V-46). */
export const DOCS_KEEP_DAYS = 90;
/** A person whose plan lapsed and who subscribes again within this many days is verified again without new documents. */
export const RESUME_DAYS = 90;
/** A draft that was never sent is thrown away (files and row) after this many days. */
export const DRAFT_KEEP_DAYS = 14;

export type DocKind = "id" | "bill";
type Db = Prisma.TransactionClient | PrismaService;

const err = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => new HttpException({ code, message, details }, status);

export const subscriptionRequired = () =>
  err(403, "subscription_required", "Subscribe to get verified.");

export type VerificationState =
  | "NOT_SUBSCRIBED"
  | "READY"
  | "UNDER_REVIEW"
  | "VERIFIED"
  | "REJECTED"
  | "LAPSED";

/**
 * V-46: verification. A person with a current subscription (V-45) sends a government ID and a utility bill; an admin approves or
 * rejects them (verification-admin.service.ts). Approved means verified until the end of the subscription: `User.verifiedUntil`
 * follows the plan chain (a renewal after the plan ended, within RESUME_DAYS, needs no new documents). Documents sit in a
 * private bucket, are deleted DOCS_KEEP_DAYS after the decision and at once when the account is deleted. Nothing here logs a
 * document key, link or file name.
 */
@Injectable()
export class VerificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VerificationService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(VERIFICATION_STORE)
    private readonly store: VerificationStore | null,
  ) {}

  onModuleInit(): void {
    if (
      process.env.VERIFICATION_JOBS === "off" ||
      process.env.NODE_ENV === "test"
    )
      return;
    const every = (ms: number, first: number, fn: () => Promise<unknown>) => {
      const a = setTimeout(
        () => void fn().catch((e) => this.logger.error(String(e))),
        first,
      );
      a.unref();
      const b = setInterval(
        () => void fn().catch((e) => this.logger.error(String(e))),
        ms,
      );
      b.unref();
      this.timers.push(a, b);
    };
    every(10 * 60_000, 90_000, () => this.syncAll());
    every(DAY, 150_000, () => this.purgeDue());
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  private needStore(): VerificationStore {
    if (!this.store)
      throw err(
        503,
        "UNAVAILABLE",
        "Verification is not available right now. Try again soon.",
      );
    return this.store;
  }

  /** A signed link to one stored document, for the admin route only. Stops working after 5 minutes. */
  docLink(key: string, mime: string) {
    return this.needStore().signedGet(key, mime);
  }

  // ------------------------------------------------------------------ subscription (read only)

  /** The plan running today (or just starting: the monthly job may not have flipped it yet). */
  async currentPlan(db: Db, userId: string, today: string) {
    return db.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "QUEUED"] },
        startDay: { lte: today },
        endDay: { gt: today },
      },
      include: { plan: { select: { name: true } } },
      orderBy: { endDay: "desc" },
    });
  }

  /** The last day of the running plan and of any plan waiting behind it, or null with none. */
  async chainEnd(
    db: Db,
    userId: string,
    today: string,
  ): Promise<string | null> {
    const r = await db.subscription.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "QUEUED"] },
        endDay: { gt: today },
      },
      orderBy: { endDay: "desc" },
      select: { endDay: true },
    });
    return r?.endDay ?? null;
  }

  // ------------------------------------------------------------------ keeping verifiedUntil in step with the plan

  /**
   * Brings one approved person's `verifiedUntil` in step with their subscription chain and returns the two columns. A
   * renewal or upgrade extends it, a plan that is gone ends it now. A person whose approval lapsed more than RESUME_DAYS ago is
   * left alone: they send documents again.
   */
  async fresh<
    T extends {
      id: string;
      verifiedUntil: Date | null;
      verificationStatus: string | null;
    },
  >(
    u: T,
    now: Date = new Date(),
  ): Promise<{
    verifiedUntil: Date | null;
    verificationStatus: string | null;
  }> {
    if (u.verificationStatus !== "APPROVED" || isVerifiedNow(u, now)) return u;
    return (await this.syncOne(u.id, now)) ?? u;
  }

  async syncOne(
    userId: string,
    now: Date = new Date(),
  ): Promise<{
    verifiedUntil: Date | null;
    verificationStatus: string | null;
  } | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { verificationStatus: true, verifiedUntil: true, status: true },
    });
    if (!u || u.verificationStatus !== "APPROVED" || !u.verifiedUntil)
      return null;
    const end = await this.chainEnd(this.prisma, userId, lagosDayString(now));
    const target = this.targetFor(u.verifiedUntil, end, now);
    if (!target || target.getTime() === u.verifiedUntil.getTime()) return u;
    await this.prisma.user.updateMany({
      where: { id: userId, verificationStatus: "APPROVED" },
      data: { verifiedUntil: target },
    });
    return { verifiedUntil: target, verificationStatus: "APPROVED" };
  }

  private targetFor(
    stored: Date,
    chainEnd: string | null,
    now: Date,
  ): Date | null {
    if (chainEnd) {
      // A lapse older than the resume window is not healed by a new plan.
      if (stored.getTime() <= now.getTime() - RESUME_DAYS * DAY) return null;
      return endOfPlan(chainEnd);
    }
    // No plan any more: verification ends now (never later than it was).
    return stored.getTime() > now.getTime() ? now : null;
  }

  /** Every approved person, in step with their plan. Runs every ten minutes; safe to run twice. */
  async syncAll(now: Date = new Date()): Promise<number> {
    const today = lagosDayString(now);
    const windowStart = new Date(now.getTime() - RESUME_DAYS * DAY);
    let changed = 0;
    let after: string | undefined;
    for (;;) {
      const users = await this.prisma.user.findMany({
        where: {
          verificationStatus: "APPROVED",
          verifiedUntil: { gt: windowStart },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true, verifiedUntil: true },
        orderBy: { id: "asc" },
        take: 500,
      });
      if (users.length === 0) break;
      after = users[users.length - 1].id;
      const ends = await this.prisma.subscription.groupBy({
        by: ["userId"],
        where: {
          userId: { in: users.map((u) => u.id) },
          status: { in: ["ACTIVE", "QUEUED"] },
          endDay: { gt: today },
        },
        _max: { endDay: true },
      });
      const endOf = new Map(ends.map((e) => [e.userId, e._max.endDay]));
      for (const u of users) {
        const target = this.targetFor(
          u.verifiedUntil as Date,
          endOf.get(u.id) ?? null,
          now,
        );
        if (!target || target.getTime() === (u.verifiedUntil as Date).getTime())
          continue;
        const r = await this.prisma.user.updateMany({
          where: { id: u.id, verificationStatus: "APPROVED" },
          data: { verifiedUntil: target },
        });
        changed += r.count;
      }
    }
    return changed;
  }

  // ------------------------------------------------------------------ the person's own view

  async state(userId: string, now: Date = new Date()) {
    const today = lagosDayString(now);
    let u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, verificationStatus: true, verifiedUntil: true },
    });
    const healed = await this.fresh(u, now);
    u = { ...u, ...healed } as typeof u;
    const [plan, latest] = await Promise.all([
      this.currentPlan(this.prisma, userId, today),
      this.prisma.verificationRequest.findFirst({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    ]);
    const verified = isVerifiedNow(u, now);
    let state: VerificationState;
    if (verified) state = "VERIFIED";
    else if (latest?.status === "PENDING") state = "UNDER_REVIEW";
    else if (!plan) state = "NOT_SUBSCRIBED";
    else if (latest?.status === "DRAFT") state = "READY";
    else if (latest?.status === "REJECTED") state = "REJECTED";
    else if (u.verificationStatus === "APPROVED") state = "LAPSED";
    else state = "READY";
    const draft = latest?.status === "DRAFT" ? latest : null;
    const decided = latest && ["APPROVED", "REJECTED"].includes(latest.status);
    return {
      state,
      verified,
      verifiedUntil:
        verified && u.verifiedUntil ? u.verifiedUntil.toISOString() : null,
      subscription: plan
        ? {
            planName: plan.plan.name,
            endDay: plan.endDay,
            endLabel: prettyDay(plan.endDay),
          }
        : null,
      // What the person may do now. The words for a rejection are the admin's, in plain language.
      canUpload: !!plan && state !== "VERIFIED" && state !== "UNDER_REVIEW",
      canSubmit: !!draft && !!draft.idDocKey && !!draft.billDocKey && !!plan,
      documents: {
        id: !!draft?.idDocKey,
        bill: !!draft?.billDocKey,
      },
      request: latest
        ? {
            id: latest.id,
            status: latest.status,
            submittedAt: latest.submittedAt?.toISOString() ?? null,
            decidedAt: latest.decidedAt?.toISOString() ?? null,
            reason:
              latest.status === "REJECTED"
                ? reasonText(latest.reasonCode, latest.reasonNote)
                : null,
          }
        : null,
      // Kept for the screens: a decided request the person has not replaced.
      lastDecision:
        decided && !draft
          ? {
              outcome: latest.status as "APPROVED" | "REJECTED",
              decidedAt: latest.decidedAt?.toISOString() ?? null,
            }
          : null,
    };
  }

  // ------------------------------------------------------------------ uploading

  /** Locks the person's User row for the rest of the transaction: two uploads from one person run one after the other. */
  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  }

  /** Throws 403 subscription_required when the person has no running plan. Cheap: called before a file is read. */
  async assertCanUpload(userId: string, now: Date = new Date()): Promise<void> {
    if (!(await this.currentPlan(this.prisma, userId, lagosDayString(now))))
      throw subscriptionRequired();
  }

  async putDocument(
    userId: string,
    kind: DocKind,
    body: Buffer,
    now: Date = new Date(),
  ) {
    const store = this.needStore();
    const today = lagosDayString(now);
    // The subscription is checked first: a person without one learns that before anything else.
    if (!(await this.currentPlan(this.prisma, userId, today)))
      throw subscriptionRequired();
    await this.syncOne(userId, now); // a person whose approval can resume is verified again, not asked for new documents
    if (body.length === 0)
      throw err(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [{ path: "file", message: "Choose a file to upload." }],
      });
    if (body.length > DOC_MAX_BYTES)
      throw err(413, "PAYLOAD_TOO_LARGE", "That file is larger than 10 MB.");
    const mime = sniffDocument(body);
    if (!mime)
      throw err(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Upload a JPEG, PNG, WebP or HEIC photo, or a PDF.",
      );

    const key = await store.put(body, mime);
    const hold: { replaced: string | null; oldRequestId: string | null } = {
      replaced: null,
      oldRequestId: null,
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        // Re-check inside the lock: the plan may have ended, or an upload from another tab got here first.
        const plan = await this.currentPlan(tx, userId, today);
        if (!plan) throw subscriptionRequired();
        const u = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { verificationStatus: true, verifiedUntil: true },
        });
        if (isVerifiedNow(u, now))
          throw err(409, "CONFLICT", "You are already verified.");
        const open = await tx.verificationRequest.findFirst({
          where: { userId, status: { in: ["DRAFT", "PENDING"] } },
        });
        if (open?.status === "PENDING")
          throw err(
            409,
            "CONFLICT",
            "Your documents are being checked. You cannot change them now.",
          );
        let draft = open;
        if (!draft) {
          // A new request replaces a rejected (or lapsed) one: the old documents are deleted now.
          const old = await tx.verificationRequest.findFirst({
            where: {
              userId,
              docsPurgedAt: null,
              status: { in: ["REJECTED", "APPROVED"] },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          hold.oldRequestId = old?.id ?? null;
          draft = await tx.verificationRequest.create({
            data: { userId, status: "DRAFT", subscriptionId: plan.id },
          });
        }
        hold.replaced = kind === "id" ? draft.idDocKey : draft.billDocKey;
        await tx.verificationRequest.update({
          where: { id: draft.id },
          data:
            kind === "id"
              ? { idDocKey: key, idDocMime: mime, idDocBytes: body.length }
              : {
                  billDocKey: key,
                  billDocMime: mime,
                  billDocBytes: body.length,
                },
        });
      });
    } catch (e) {
      await store.delete(key).catch(() => undefined);
      throw e;
    }
    if (hold.replaced)
      await store.delete(hold.replaced).catch(() => this.warnLeft());
    if (hold.oldRequestId) await this.purgeRequestDocs(hold.oldRequestId);
    return this.state(userId, now);
  }

  private warnLeft(): void {
    // Never the key or a name: only that a deletion must be retried by the purge job.
    this.logger.warn(
      "a verification document could not be deleted now; the purge job will retry",
    );
  }

  /** The person sends both documents to the team. */
  async submit(userId: string, now: Date = new Date()) {
    const today = lagosDayString(now);
    await this.syncOne(userId, now);
    await this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const plan = await this.currentPlan(tx, userId, today);
      if (!plan) throw subscriptionRequired();
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { verificationStatus: true, verifiedUntil: true },
      });
      if (isVerifiedNow(u, now))
        throw err(409, "CONFLICT", "You are already verified.");
      const open = await tx.verificationRequest.findFirst({
        where: { userId, status: { in: ["DRAFT", "PENDING"] } },
      });
      if (open?.status === "PENDING")
        throw err(409, "CONFLICT", "Your documents are already with the team.");
      if (!open || !open.idDocKey || !open.billDocKey)
        throw err(422, "VALIDATION_FAILED", "Some details need fixing.", {
          fields: [
            ...(open?.idDocKey
              ? []
              : [{ path: "id", message: "Add your government ID." }]),
            ...(open?.billDocKey
              ? []
              : [{ path: "bill", message: "Add your utility bill." }]),
          ],
        });
      await tx.verificationRequest.update({
        where: { id: open.id },
        data: { status: "PENDING", submittedAt: now, subscriptionId: plan.id },
      });
      await tx.user.update({
        where: { id: userId },
        data: { verificationStatus: "PENDING" },
      });
    });
    return this.state(userId, now);
  }

  // ------------------------------------------------------------------ deleting documents

  /** Deletes both files of one request and clears the keys. A file that cannot be deleted keeps its key for the next pass. */
  async purgeRequestDocs(
    requestId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const r = await this.prisma.verificationRequest.findUnique({
      where: { id: requestId },
    });
    if (!r) return true;
    const store = this.store;
    const keys = [r.idDocKey, r.billDocKey];
    if (keys.some(Boolean) && !store) return false;
    const gone = { id: !r.idDocKey, bill: !r.billDocKey };
    try {
      if (r.idDocKey && store) {
        await store.delete(r.idDocKey);
        gone.id = true;
      }
      if (r.billDocKey && store) {
        await store.delete(r.billDocKey);
        gone.bill = true;
      }
    } catch {
      this.warnLeft();
    }
    await this.prisma.verificationRequest.update({
      where: { id: requestId },
      data: {
        ...(gone.id
          ? { idDocKey: null, idDocMime: null, idDocBytes: null }
          : {}),
        ...(gone.bill
          ? { billDocKey: null, billDocMime: null, billDocBytes: null }
          : {}),
        ...(gone.id && gone.bill ? { docsPurgedAt: now } : {}),
      },
    });
    return gone.id && gone.bill;
  }

  /**
   * The daily pass: documents of requests decided more than DOCS_KEEP_DAYS ago, documents of deleted accounts, and drafts
   * nobody sent. Returns how many requests it cleared. The decision rows stay.
   */
  async purgeDue(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DOCS_KEEP_DAYS * DAY);
    const draftCutoff = new Date(now.getTime() - DRAFT_KEEP_DAYS * DAY);
    const due = await this.prisma.verificationRequest.findMany({
      where: {
        docsPurgedAt: null,
        OR: [
          { decidedAt: { lt: cutoff } },
          { user: { status: "DELETED" } },
          { status: "DRAFT", createdAt: { lt: draftCutoff } },
        ],
      },
      select: { id: true, status: true },
      take: 200,
    });
    let n = 0;
    for (const r of due) {
      if (await this.purgeRequestDocs(r.id, now)) {
        n++;
        if (r.status === "DRAFT")
          await this.prisma.verificationRequest
            .delete({ where: { id: r.id } })
            .catch(() => undefined);
      }
    }
    return n;
  }

  /**
   * The account was deleted (V-16): the documents go at once, a request still waiting is closed (nobody is left to verify)
   * and a draft is thrown away. The decision rows stay with who, when and the outcome. Never throws: the purge job is the net.
   */
  async purgeUser(userId: string, now: Date = new Date()): Promise<void> {
    try {
      await this.prisma.verificationRequest.updateMany({
        where: { userId, status: "PENDING" },
        data: {
          status: "REJECTED",
          decidedAt: now,
          reasonCode: "ACCOUNT_DELETED",
        },
      });
      const rows = await this.prisma.verificationRequest.findMany({
        where: { userId },
        select: { id: true, status: true },
      });
      for (const r of rows) {
        const cleared = await this.purgeRequestDocs(r.id, now);
        if (cleared && r.status === "DRAFT")
          await this.prisma.verificationRequest.delete({ where: { id: r.id } });
      }
    } catch {
      this.logger.warn(
        "verification documents of a deleted account are left for the purge job",
      );
    }
  }
}
