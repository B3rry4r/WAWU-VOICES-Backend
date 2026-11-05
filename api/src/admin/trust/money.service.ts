import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { PaymentStatus, Prisma } from "../../generated/prisma/client";
import type { CurrentMeInfo } from "../../me/me-context";
import { Views } from "../../me/views";
import { decodeCursor, encodeCursor, pageLimit } from "../../results/cursor";
import { UNITS_PORT, type UnitsPortFull } from "../../units/units.port";
import { PaymentsService } from "../../units/units.payments";
import { UnitsService } from "../../units/units.service";
import { notFound } from "./common";
import type { PageQuery } from "./dto";

type PaymentRow = Prisma.PaymentGetPayload<{
  include: { tier: true; token: true };
}>;

@Injectable()
export class AdminMoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: Views,
    private readonly ref: ModuleRef,
    @Inject(UNITS_PORT) private readonly port: UnitsPortFull,
  ) {}

  // Resolved when a money route runs, so a test app that swaps the units module for a stub still boots.
  private get units(): UnitsService {
    return this.ref.get(UnitsService, { strict: false });
  }
  private get payments(): PaymentsService {
    return this.ref.get(PaymentsService, { strict: false });
  }

  private paymentView(p: PaymentRow, balanceMilli: number | null) {
    const overpay = (
      p.rawVerify as {
        overpay?: { extraKobo?: number; refundNeeded?: boolean };
      } | null
    )?.overpay;
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      amountKobo: p.amountKobo,
      txRef: p.txRef,
      title: this.payments.title(p),
      unitsMilli: p.unitsMilli,
      bonusMilli: p.bonusMilli,
      method: p.method,
      cardLast4: p.cardLast4,
      receiptNo: p.receiptNo,
      failureReason: p.failureReason,
      balanceMilli,
      createdAt: p.createdAt.toISOString(),
      verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
      token: p.token
        ? {
            id: p.token.id,
            kind: p.token.kind,
            maxSeconds: p.token.maxSeconds,
            status: p.token.status,
            createdAt: p.token.createdAt.toISOString(),
          }
        : null,
      // V-23: what was paid over the price, for the admin to refund by hand. Never paid out by VOICES.
      overpaidKobo: p.overpaidKobo ?? overpay?.extraKobo ?? 0,
      refundNeeded: (p.overpaidKobo ?? 0) > 0 || overpay?.refundNeeded === true,
    };
  }

  async listPayments(q: PageQuery & { status?: string }) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.payment.findMany({
      where: {
        ...(q.status ? { status: q.status as PaymentStatus } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: new Date(cur.k) } },
                { createdAt: new Date(cur.k), id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      include: { tier: true, token: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      items: slice.map((p) => this.paymentView(p, null)),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Runs the same routine the reconcile job runs. Both lock the payment row, so only one credit can happen. */
  async reverify(actor: CurrentMeInfo, paymentId: string) {
    const before = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!before) throw notFound("We could not find that payment.");
    await this.payments.verifySystem(paymentId);
    const p = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { tier: true, token: true },
    });
    const wallet =
      p.status === "SUCCEEDED"
        ? await this.prisma.wallet.findUnique({ where: { userId: p.userId } })
        : null;
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: "payment.reverify",
        targetType: "payment",
        targetId: paymentId,
        before: { status: before.status },
        after: { status: p.status },
      },
    });
    return this.paymentView(
      p,
      p.status === "SUCCEEDED" ? (wallet?.balanceMilli ?? 0) : null,
    );
  }

  async wallet(userId: string, q: PageQuery) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === "DELETED")
      throw notFound("We could not find that person.");
    const limit = pageLimit(q.limit);
    const [profiles, w, ledger, pays] = await Promise.all([
      this.views.profiles([userId]),
      this.units.wallet(userId),
      this.units.history(userId, limit, q.cursor),
      this.prisma.payment.findMany({
        where: { userId },
        include: { tier: true, token: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
    ]);
    return {
      user: profiles.get(userId),
      balanceMilli: w.balanceMilli,
      freePostsRemaining: w.freePostsRemaining,
      ledger: ledger.items,
      payments: pays.map((p) => this.paymentView(p, null)),
      nextCursor: ledger.nextCursor,
    };
  }

  /** V-18: at most 1,000 units a call. The port checks the limit, the reason, the key and the floor of zero. */
  async adjust(
    actor: CurrentMeInfo,
    userId: string,
    deltaMilli: number,
    reason: string,
    key: string,
  ) {
    if (actor.id === userId)
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You cannot change your own balance.",
      });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === "DELETED")
      throw notFound("We could not find that person.");
    const r = await this.port.adjustBalance(
      actor.id,
      userId,
      deltaMilli,
      reason,
      key,
    );
    try {
      await this.prisma.auditLog.create({
        data: {
          id: await this.auditId(r.txnId),
          actorId: actor.id,
          action: "wallet.adjust",
          targetType: "user",
          targetId: userId,
          reason,
          after: { deltaMilli, balanceMilli: r.balanceMilli, txnId: r.txnId },
        },
      });
    } catch (e) {
      // A replay of the same key: the row is already there.
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
    return this.wallet(userId, {});
  }

  /** A stable audit row id per ledger transaction, so a replay writes no second row. */
  private async auditId(txnId: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256")
      .update(`wallet.adjust:${txnId}`)
      .digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
}
