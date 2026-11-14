import { HttpException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Prisma } from "../generated/prisma/client";
import { MailEvents } from "../mail/mail-events";
import type { CurrentMeInfo } from "../me/me-context";
import { decodeCursor, encodeCursor, pageLimit } from "../me/paging";
import { endOfPlan, lagosDayString, prettyDay } from "./verification.dates";
import { plain, reasonText, REJECT_REASONS } from "./verification.reasons";
import { VerificationService } from "./verification.service";

const err = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => new HttpException({ code, message, details }, status);

const conflictDecided = () =>
  err(
    409,
    "CONFLICT",
    "Another admin already decided this request. Reload the list.",
  );

/** V-46: the admin side of verification. ADMIN only (the controller). Every decision writes an AuditLog row. */
@Injectable()
export class VerificationAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: VerificationService,
    @Optional() private readonly mails?: MailEvents,
  ) {}

  private async planOf(userId: string, today: string) {
    const plan = await this.verification.currentPlan(
      this.prisma,
      userId,
      today,
    );
    return plan
      ? {
          planName: plan.plan.name,
          endDay: plan.endDay,
          endLabel: prettyDay(plan.endDay),
        }
      : null;
  }

  /** The queue: pending first, oldest first (status "pending", the default), or decided ones, newest first. */
  async list(q: { status?: string; cursor?: string; limit?: unknown }) {
    const limit = pageLimit(q.limit);
    const pending = (q.status ?? "pending") === "pending";
    const c = decodeCursor(q.cursor);
    const at = pending ? "submittedAt" : "decidedAt";
    const dir = pending ? "asc" : "desc";
    const cmp = pending ? "gt" : "lt";
    const where: Prisma.VerificationRequestWhereInput = {
      status: pending ? "PENDING" : { in: ["APPROVED", "REJECTED"] },
      ...(c
        ? {
            OR: [{ [at]: { [cmp]: c.t } }, { [at]: c.t, id: { [cmp]: c.id } }],
          }
        : {}),
    };
    const rows = await this.prisma.verificationRequest.findMany({
      where,
      orderBy: [{ [at]: dir }, { id: dir }],
      take: limit + 1,
      include: {
        user: { select: { id: true, handle: true, displayName: true } },
      },
    });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const lastAt = last ? (pending ? last.submittedAt : last.decidedAt) : null;
    const today = lagosDayString();
    const deciders = [
      ...new Set(
        items.map((r) => r.decidedById).filter((x): x is string => !!x),
      ),
    ];
    const who = new Map(
      (deciders.length
        ? await this.prisma.user.findMany({
            where: { id: { in: deciders } },
            select: { id: true, handle: true },
          })
        : []
      ).map((u) => [u.id, u.handle]),
    );
    return {
      items: await Promise.all(
        items.map(async (r) => ({
          id: r.id,
          status: r.status,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          person: {
            id: r.user.id,
            handle: r.user.handle,
            displayName: r.user.displayName,
          },
          subscription: await this.planOf(r.userId, today),
          decidedBy: r.decidedById ? (who.get(r.decidedById) ?? null) : null,
          reason:
            r.status === "REJECTED"
              ? reasonText(r.reasonCode, r.reasonNote)
              : null,
          documentsDeleted: !!r.docsPurgedAt,
        })),
      ),
      nextCursor:
        rows.length > limit && last && lastAt
          ? encodeCursor(lastAt, last.id)
          : null,
    };
  }

  /** One request: who, the plan, the state. The documents are not here: each is opened on its own (documentLink). */
  async detail(id: string) {
    const r = await this.prisma.verificationRequest.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, handle: true, displayName: true } },
      },
    });
    if (!r || r.status === "DRAFT")
      throw err(404, "NOT_FOUND", "We could not find that request.");
    return {
      id: r.id,
      status: r.status,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      person: r.user,
      subscription: await this.planOf(r.userId, lagosDayString()),
      reason:
        r.status === "REJECTED" ? reasonText(r.reasonCode, r.reasonNote) : null,
      documentsDeleted: !!r.docsPurgedAt,
      idDocument: r.idDocKey && r.idDocMime ? { mime: r.idDocMime } : null,
      billDocument:
        r.billDocKey && r.billDocMime ? { mime: r.billDocMime } : null,
    };
  }

  /**
   * One document as a link that stops working after 5 minutes. This is the only place a link is made, and it is made
   * when an admin opens a document: that look is written to the audit log (who and which, never the link).
   */
  async documentLink(actor: CurrentMeInfo, id: string, kind: "id" | "bill") {
    const r = await this.prisma.verificationRequest.findUnique({
      where: { id },
    });
    if (!r || r.status === "DRAFT")
      throw err(404, "NOT_FOUND", "We could not find that request.");
    const key = kind === "id" ? r.idDocKey : r.billDocKey;
    const mime = kind === "id" ? r.idDocMime : r.billDocMime;
    if (!key || !mime)
      throw err(404, "NOT_FOUND", "That document has been deleted.");
    const link = await this.verification.docLink(key, mime);
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "verification.view",
        targetType: "verification",
        targetId: r.id,
        reason: kind === "id" ? "government ID" : "utility bill",
      },
    });
    return { url: link.url, mime, expiresAt: link.expiresAt.toISOString() };
  }

  private async lockPending(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<
      { userId: string; status: string }[]
    >`SELECT "userId", "status"::text AS status FROM "VerificationRequest" WHERE id = ${id} FOR UPDATE`;
    if (!rows[0])
      throw err(404, "NOT_FOUND", "We could not find that request.");
    if (rows[0].status !== "PENDING") {
      if (rows[0].status === "DRAFT")
        throw err(404, "NOT_FOUND", "We could not find that request.");
      throw conflictDecided();
    }
    return rows[0].userId;
  }

  private selfCheck(actor: CurrentMeInfo, userId: string) {
    if (actor.id === userId)
      throw err(
        403,
        "FORBIDDEN",
        "You cannot decide your own verification. Ask another admin.",
      );
  }

  async approve(actor: CurrentMeInfo, id: string, note?: string) {
    const now = new Date();
    const today = lagosDayString(now);
    const out = await this.prisma.$transaction(async (tx) => {
      const userId = await this.lockPending(tx, id);
      this.selfCheck(actor, userId);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const end = await this.verification.chainEnd(tx, userId, today);
      if (!end)
        throw err(
          409,
          "CONFLICT",
          "This person has no current subscription. Reject the request, or wait until they subscribe.",
        );
      const until = endOfPlan(end);
      await tx.verificationRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          decidedAt: now,
          decidedById: actor.id,
          reasonCode: null,
          reasonNote: null,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { verificationStatus: "APPROVED", verifiedUntil: until },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "verification.approve",
          targetType: "verification",
          targetId: id,
          reason: note ? plain(note) : null,
          before: { status: "PENDING" },
          after: { status: "APPROVED", verifiedUntil: until.toISOString() },
        },
      });
      return { userId, until };
    });
    this.mails?.verificationApproved(out.userId, id, out.until);
    return {
      id,
      status: "APPROVED" as const,
      verifiedUntil: out.until.toISOString(),
    };
  }

  async reject(
    actor: CurrentMeInfo,
    id: string,
    dto: { reasonCode: string; note?: string },
  ) {
    const note = dto.note ? plain(dto.note) : "";
    if (dto.reasonCode === "OTHER" && !note)
      throw err(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [{ path: "note", message: "Say why, in a few words." }],
      });
    if (!(dto.reasonCode in REJECT_REASONS))
      throw err(422, "VALIDATION_FAILED", "Some details need fixing.", {
        fields: [
          { path: "reasonCode", message: "Pick a reason from the list." },
        ],
      });
    const now = new Date();
    const out = await this.prisma.$transaction(async (tx) => {
      const userId = await this.lockPending(tx, id);
      this.selfCheck(actor, userId);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      await tx.verificationRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          decidedAt: now,
          decidedById: actor.id,
          reasonCode: dto.reasonCode,
          reasonNote: note || null,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { verificationStatus: "REJECTED", verifiedUntil: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "verification.reject",
          targetType: "verification",
          targetId: id,
          reason: reasonText(dto.reasonCode, note || null),
          before: { status: "PENDING" },
          after: { status: "REJECTED", reasonCode: dto.reasonCode },
        },
      });
      return { userId };
    });
    this.mails?.verificationRejected(
      out.userId,
      id,
      reasonText(dto.reasonCode, note || null),
    );
    return { id, status: "REJECTED" as const };
  }
}
