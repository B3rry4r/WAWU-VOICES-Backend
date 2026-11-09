import { whitelistVerify } from "./verify-whitelist";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  FLW_CLIENT,
  type FlutterwavePort,
  type FlwTransaction,
} from "./flutterwave.client";
import { UnitsConfig } from "./units.config";
import { apiError } from "./units.errors";
import { LedgerService } from "./units.ledger";
import type { UnitsUser } from "./units.users";

export interface InitInput {
  kind: "UNITS" | "EXTRA_VOICE";
  tierId?: string;
  tokenKind?: "SECONDS_30" | "SECONDS_60";
  method?: "card" | "banktransfer" | "ussd";
  returnPath?: string;
}

type PaymentRow = Prisma.PaymentGetPayload<{
  include: { tier: true; token: true };
}>;

/** Flutterwave amounts are naira numbers. Convert to whole kobo, refusing a fractional kobo or a non-number. */
export function nairaToKobo(amount: unknown): number | null {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const kobo = Math.round(n * 100);
  return Math.abs(n * 100 - kobo) < 1e-6 && Number.isSafeInteger(kobo)
    ? kobo
    : null;
}

function mapMethod(t: unknown): string | null {
  if (t === "card") return "card";
  if (t === "banktransfer" || t === "bank_transfer") return "bank_transfer";
  if (t === "ussd") return "ussd";
  return null;
}

export type SettleOutcome =
  | { kind: "success"; overpaidKobo: number }
  | { kind: "pending" }
  | { kind: "failed"; reason: string }
  | { kind: "mismatch" }
  | { kind: "notfound" };

const CREDITABLE = ["INITIATED", "PENDING", "FAILED", "EXPIRED"] as const;

/** VU-yymmdd-XXXXXXXX: the one reference a person sees for a payment, from the day it began (Lagos) and its id. */
export function paymentReference(p: {
  id: string;
  createdAt: Date;
  receiptNo?: string | null;
}): string {
  if (p.receiptNo) return p.receiptNo;
  const yymmdd = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  })
    .format(p.createdAt)
    .split("/")
    .reverse()
    .join("");
  return `VU-${yymmdd}-${p.id.replace(/-/g, "").slice(-8).toUpperCase()}`;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly verifyHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: UnitsConfig,
    private readonly ledger: LedgerService,
    @Inject(FLW_CLIENT) private readonly flw: FlutterwavePort,
  ) {}

  /** Test helper: forget the per-account verify counters. */
  resetLimits(): void {
    this.verifyHits.clear();
  }

  private include = { tier: true, token: true } as const;

  private async checkVerifyRate(userId: string): Promise<void> {
    const limit = await this.cfg.int("ratelimit.payment_per_10min");
    const now = Date.now();
    const hits = (this.verifyHits.get(userId) ?? []).filter(
      (t) => now - t < 600_000,
    );
    if (hits.length >= limit) {
      this.verifyHits.set(userId, hits);
      throw apiError(
        429,
        "RATE_LIMITED",
        "Too many tries. Wait a moment and try again.",
      );
    }
    hits.push(now);
    this.verifyHits.set(userId, hits);
  }

  // ------------------------------------------------------------------ init

  async init(user: UnitsUser, input: InitInput, key: string) {
    const prior = await this.prisma.payment.findUnique({
      where: {
        userId_idempotencyKey: { userId: user.id, idempotencyKey: key },
      },
      include: this.include,
    });
    if (prior) return this.replayInit(prior, input, user.id, key);

    const limit = await this.cfg.int("ratelimit.payment_per_10min");
    const recent = await this.prisma.payment.count({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - 600_000) },
      },
    });
    if (recent >= limit)
      throw apiError(
        429,
        "RATE_LIMITED",
        "Too many tries. Wait a moment and try again.",
      );

    // The price is read here, on the server, and copied onto the row. The browser sends no amount.
    let amountKobo: number;
    let unitsMilli: number | null = null;
    let bonusMilli: number | null = null;
    let title: string;
    if (input.kind === "UNITS") {
      if (!input.tierId || input.tokenKind)
        throw apiError(422, "VALIDATION_FAILED", "Choose a token pack.");
      const tier = await this.prisma.unitTier.findFirst({
        where: { id: input.tierId, active: true },
      });
      if (!tier)
        throw apiError(404, "NOT_FOUND", "We could not find that pack.");
      const min = await this.cfg.int("units.min_purchase_kobo");
      if (tier.priceKobo < min)
        throw apiError(
          422,
          "VALIDATION_FAILED",
          "That pack is below the smallest purchase.",
        );
      amountKobo = tier.priceKobo;
      unitsMilli = tier.unitsMilli;
      bonusMilli = tier.bonusMilli;
      title = `${tier.name} pack`;
    } else {
      // V-36: extra voice is not sold on its own any more. A longer voice message is paid with tokens when it is sent.
      throw apiError(
        422,
        "VALIDATION_FAILED",
        "Longer voice messages are paid with tokens now. Get tokens, then send your message.",
      );
    }
    if (amountKobo < 100 || amountKobo % 100 !== 0)
      throw apiError(500, "INTERNAL", "Something went wrong on our side.");

    const returnPath = this.safeReturnPath(input.returnPath);
    const expiryMin = await this.cfg.int("payment.expiry_minutes");
    const txRef = `voices-${randomUUID()}`; // V-21: every VOICES reference starts with "voices-"
    let payment: PaymentRow;
    try {
      const made = await this.prisma.payment.create({
        data: {
          userId: user.id,
          kind: input.kind,
          tierId: input.kind === "UNITS" ? input.tierId : null,
          tokenKind: null,
          amountKobo,
          unitsMilli,
          bonusMilli,
          txRef,
          idempotencyKey: key,
          method:
            input.method === "banktransfer"
              ? "bank_transfer"
              : (input.method ?? null),
          expiresAt: new Date(Date.now() + expiryMin * 60_000),
        },
      });
      // The relations are read after the insert, not in the same call (the pg warning, C-L8).
      payment = await this.prisma.payment.findUniqueOrThrow({
        where: { id: made.id },
        include: this.include,
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      // A parallel request with the same Idempotency-Key won the insert: answer with its payment (still one row).
      const first = await this.prisma.payment.findUnique({
        where: {
          userId_idempotencyKey: { userId: user.id, idempotencyKey: key },
        },
        include: this.include,
      });
      if (!first) throw e;
      return this.replayInit(first, input, user.id, key);
    }

    const base = process.env.APP_BASE_URL || "https://voices.wawuafrica.com";
    const redirectUrl = `${base}${returnPath}${returnPath.includes("?") ? "&" : "?"}paymentId=${payment.id}`;
    let link: string;
    try {
      ({ link } = await this.flw.initCheckout({
        txRef,
        amountNaira: amountKobo / 100,
        currency: "NGN",
        redirectUrl,
        customerEmail: user.email ?? `user-${user.id}@voices.wawuafrica.com`,
        title,
        paymentOptions: input.method,
        meta: { voicesPaymentId: payment.id },
      }));
    } catch (e) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", failureReason: "checkout_unavailable" },
      });
      throw e;
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { rawVerify: { init: { checkoutUrl: link } } },
    });
    // Read with the relations after the update: an update with an include runs them side by side inside Prisma's own
    // transaction on one connection (the pg warning, C-L8).
    const saved = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: this.include,
    });
    return this.initView(saved, link);
  }

  /** The first payment made with this key. If its checkout is still being opened by a parallel request, wait for it. */
  private async replayInit(
    first: PaymentRow,
    input: InitInput,
    userId: string,
    key: string,
  ) {
    const same =
      first.kind === input.kind &&
      (first.tierId ?? null) === (input.tierId ?? null) &&
      (first.tokenKind ?? null) === (input.tokenKind ?? null);
    if (!same)
      throw apiError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "That key was used for something else.",
      );
    const urlOf = (p: PaymentRow) =>
      (p.rawVerify as { init?: { checkoutUrl?: string } } | null)?.init
        ?.checkoutUrl;
    let row = first;
    const until = Date.now() + 15_000;
    let pause = 25;
    while (!urlOf(row) && row.status === "INITIATED" && Date.now() < until) {
      await new Promise((r) => setTimeout(r, pause));
      pause = Math.min(pause * 2, 200);
      const again = await this.prisma.payment.findUnique({
        where: {
          userId_idempotencyKey: { userId, idempotencyKey: key },
        },
        include: this.include,
      });
      if (!again) break;
      row = again;
    }
    const url = urlOf(row);
    if (!url)
      throw apiError(409, "CONFLICT", "That payment did not start. Try again.");
    return this.initView(row, url);
  }

  private safeReturnPath(p: string | undefined): string {
    if (p === undefined) return "/wallet/paid";
    if (p.length > 200 || !/^\/(?!\/)[A-Za-z0-9/_\-.?=&%]*$/.test(p))
      throw apiError(
        422,
        "VALIDATION_FAILED",
        "That return address is not allowed.",
        {
          fields: [
            { path: "returnPath", message: "Use a path inside VOICES." },
          ],
        },
      );
    return p;
  }

  private initView(p: PaymentRow, checkoutUrl: string) {
    return {
      paymentId: p.id,
      txRef: p.txRef,
      reference: paymentReference(p),
      amountKobo: p.amountKobo,
      currency: "NGN" as const,
      unitsMilli: p.unitsMilli,
      checkoutUrl,
      expiresAt: p.expiresAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------ read

  async view(userId: string, paymentId: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
      include: this.include,
    });
    if (!p) throw apiError(404, "NOT_FOUND", "We could not find that payment.");
    return this.toView(p);
  }

  private async toView(p: PaymentRow) {
    let balanceMilli: number | null = null;
    if (p.status === "SUCCEEDED") {
      balanceMilli =
        (await this.prisma.wallet.findUnique({ where: { userId: p.userId } }))
          ?.balanceMilli ?? 0;
    }
    return {
      id: p.id,
      kind: p.kind,
      status: p.status,
      amountKobo: p.amountKobo,
      txRef: p.txRef,
      reference: paymentReference(p),
      title: this.title(p),
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
    };
  }

  title(p: {
    kind: string;
    tokenKind: string | null;
    tier?: { name: string } | null;
  }): string {
    if (p.kind === "UNITS") return `${p.tier?.name ?? "Tokens"} pack`;
    return p.tokenKind === "SECONDS_30"
      ? "Extra voice, 30 seconds"
      : "Extra voice, 1 minute";
  }

  async receipt(userId: string, paymentId: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
      include: this.include,
    });
    if (!p) throw apiError(404, "NOT_FOUND", "We could not find that payment.");
    if (p.status !== "SUCCEEDED" || !p.receiptNo || !p.verifiedAt)
      throw apiError(
        409,
        "PAYMENT_NOT_VERIFIED",
        "There is no receipt until the payment is confirmed.",
      );
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { handle: true },
    });
    return {
      receiptNo: p.receiptNo,
      reference: paymentReference(p),
      txRef: p.txRef,
      title: this.title(p),
      amountKobo: p.amountKobo,
      unitsMilli: p.unitsMilli,
      method: p.method,
      cardLast4: p.cardLast4,
      paidAt: p.verifiedAt.toISOString(),
      buyerHandle: u.handle,
    };
  }

  // ------------------------------------------------------------------ verify

  /** POST /payments/{id}/verify: the person's own payment only. providerTxId is a hint, never trusted. */
  async verifyMine(userId: string, paymentId: string, providerTxId?: string) {
    const own = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
      select: { id: true },
    });
    if (!own)
      throw apiError(404, "NOT_FOUND", "We could not find that payment.");
    await this.checkVerifyRate(userId);
    return this.settle(paymentId, providerTxId, true);
  }

  /** Admin re-verify and the reconcile job: same routine, no person attached. */
  async verifySystem(paymentId: string) {
    return this.settle(paymentId, undefined, false);
  }

  /**
   * Ask Flutterwave, then compare the answer with OUR row: status successful, currency NGN, amount equal to the stored
   * price, tx_ref equal to ours. Only then credit, once, in one database transaction.
   */
  private async settle(
    paymentId: string,
    providerTxId: string | undefined,
    strict: boolean,
  ) {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: this.include,
    });
    if (!p) throw apiError(404, "NOT_FOUND", "We could not find that payment.");
    if (p.status === "SUCCEEDED") return this.toView(p);
    if (p.status === "REFUNDED")
      throw apiError(409, "PAYMENT_NOT_VERIFIED", "That payment was refunded.");

    const found = await this.lookup(p, providerTxId);
    const outcome = this.judge(p, found.tx);
    if (outcome.kind === "success") {
      const tx = found.tx as FlwTransaction;
      const taken = await this.prisma.payment.findUnique({
        where: { providerTxId: String(tx.id) },
        select: { id: true },
      });
      if (taken && taken.id !== p.id)
        throw apiError(
          409,
          "PAYMENT_NOT_VERIFIED",
          "That transaction belongs to another payment.",
        );
      await this.credit(p.id, tx, found.raw, outcome.overpaidKobo);
      return this.toView(
        await this.prisma.payment.findUniqueOrThrow({
          where: { id: p.id },
          include: this.include,
        }),
      );
    }
    if (outcome.kind === "mismatch") {
      const first = await this.prisma.payment.updateMany({
        where: {
          id: p.id,
          status: { not: "SUCCEEDED" },
          OR: [
            { failureReason: null },
            { failureReason: { not: "amount_or_currency_mismatch" } },
          ],
        },
        data: { failureReason: "amount_or_currency_mismatch" },
      });
      // lead ruling WF, 6 Nov (B-L6): a refused underpayment is logged once, as a warning, not on every reconcile tick.
      if (first.count > 0)
        this.logger.warn(
          `Payment ${p.id}: Flutterwave reports a different amount or currency than we stored. Nothing credited.`,
        );
      if (strict)
        throw apiError(
          422,
          "PAYMENT_AMOUNT_MISMATCH",
          "The amount paid does not match this payment. Nothing was added.",
        );
      return this.toView(p);
    }
    const expired = p.expiresAt.getTime() < Date.now();
    if (outcome.kind === "failed") {
      await this.prisma.payment.updateMany({
        where: { id: p.id, status: { in: [...CREDITABLE] } },
        data: { status: "FAILED", failureReason: outcome.reason },
      });
    } else if (outcome.kind === "pending") {
      await this.prisma.payment.updateMany({
        where: { id: p.id, status: "INITIATED" },
        data: { status: "PENDING" },
      });
    } else if (expired) {
      await this.prisma.payment.updateMany({
        where: { id: p.id, status: { in: ["INITIATED", "PENDING"] } },
        data: { status: "EXPIRED" },
      });
    }
    const fresh = await this.prisma.payment.findUniqueOrThrow({
      where: { id: p.id },
      include: this.include,
    });
    if (outcome.kind === "notfound" && strict)
      throw expired
        ? apiError(
            409,
            "PAYMENT_EXPIRED",
            "This payment expired before it was paid. Start again.",
          )
        : apiError(
            409,
            "PAYMENT_NOT_VERIFIED",
            "We could not confirm this payment yet.",
          );
    return this.toView(fresh);
  }

  /** Verify by the id the browser hinted, then by our reference. Only a transaction carrying OUR tx_ref counts. */
  private async lookup(
    p: PaymentRow,
    providerTxId?: string,
  ): Promise<{ tx?: FlwTransaction; raw: unknown }> {
    if (providerTxId !== undefined) {
      const r = await this.flw.verifyById(providerTxId);
      if (
        r.found &&
        r.data &&
        r.data.tx_ref === p.txRef &&
        r.data.status === "successful"
      )
        return { tx: r.data, raw: r.raw };
    }
    const r = await this.flw.verifyByReference(p.txRef);
    if (r.found && r.data && r.data.tx_ref === p.txRef)
      return { tx: r.data, raw: r.raw };
    return { raw: r.raw };
  }

  private judge(p: PaymentRow, tx: FlwTransaction | undefined): SettleOutcome {
    if (!tx) return { kind: "notfound" };
    if (tx.status === "successful") {
      const paid = nairaToKobo(tx.amount);
      // Underpaid, a fraction of a kobo or another currency is refused. Overpaid (V-23) still credits the
      // purchased pack once and records the extra for an admin refund.
      if (tx.currency !== "NGN" || paid === null || paid < p.amountKobo)
        return { kind: "mismatch" };
      return { kind: "success", overpaidKobo: paid - p.amountKobo };
    }
    if (tx.status === "pending" || tx.status === "new")
      return { kind: "pending" };
    return {
      kind: "failed",
      reason:
        typeof tx.processor_response === "string" && tx.processor_response
          ? tx.processor_response.slice(0, 200)
          : "The payment did not go through.",
    };
  }

  /** The one place money is credited. One transaction: payment row locked, ledger + wallet (or token) written together. */
  private async credit(
    paymentId: string,
    tx: FlwTransaction,
    raw: unknown,
    overpaidKobo: number,
  ): Promise<void> {
    const freePosts = await this.ledger.freePostsConfig();
    const maxByKind = await this.cfg.ints([
      "voice.extra30.max_seconds",
      "voice.extra60.max_seconds",
    ]);
    await this.ledger.inTx(async (db) => {
      const rows = await db.$queryRaw<
        { status: string }[]
      >`SELECT status::text AS status FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
      if (rows[0]?.status === "SUCCEEDED") return; // a parallel verify won: nothing more to do
      if (rows[0]?.status === "REFUNDED")
        throw apiError(
          409,
          "PAYMENT_NOT_VERIFIED",
          "That payment was refunded.",
        );
      const p = await db.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (overpaidKobo > 0)
        this.logger.warn(
          `Payment ${p.id} was overpaid by ${overpaidKobo} kobo: credited the pack once, flagged for an admin refund`,
        );
      const now = new Date();
      // lead ruling WF, 6 Nov (B-L2): the one reference a person sees is the same before and after the payment settles.
      const receiptNo = paymentReference(p);
      const prev = (p.rawVerify as { init?: unknown } | null)?.init;
      let notifyTitle: string;
      let notifyBody: string;
      if (p.kind === "UNITS") {
        if (p.unitsMilli === null || p.bonusMilli === null)
          throw new Error("Units payment without units");
        const balance = await this.ledger.lockWallet(db, p.userId, {
          freePosts,
        });
        const after = balance + p.unitsMilli;
        await db.ledgerTransaction.create({
          data: {
            kind: "PURCHASE",
            idempotencyKey: `payment:${p.id}`,
            paymentId: p.id,
            entries: {
              create: [
                {
                  account: "USER_WALLET",
                  walletUserId: p.userId,
                  deltaMilli: p.unitsMilli,
                  balanceAfterMilli: after,
                },
                {
                  account: "PURCHASES",
                  deltaMilli: -(p.unitsMilli - p.bonusMilli),
                },
                ...(p.bonusMilli > 0
                  ? [{ account: "BONUS" as const, deltaMilli: -p.bonusMilli }]
                  : []),
              ],
            },
          },
        });
        await this.ledger.setBalance(db, p.userId, after);
        notifyTitle = "Tokens added";
        notifyBody = `${p.unitsMilli / 1000} tokens were added to your balance.`;
      } else {
        const max =
          p.tokenKind === "SECONDS_30"
            ? maxByKind["voice.extra30.max_seconds"]
            : maxByKind["voice.extra60.max_seconds"];
        await db.extraVoiceToken.create({
          data: {
            userId: p.userId,
            paymentId: p.id,
            kind: p.tokenKind!,
            maxSeconds: max,
          },
        });
        notifyTitle = "Extra voice added";
        notifyBody = `You can record up to ${max} seconds for one message.`;
      }
      await db.payment.update({
        where: { id: p.id },
        data: {
          status: "SUCCEEDED",
          providerTxId: String(tx.id),
          verifiedAt: now,
          reconciledAt: now,
          receiptNo,
          failureReason: null,
          method: mapMethod(tx.payment_type) ?? p.method,
          cardLast4:
            typeof tx.card?.last_4digits === "string" &&
            /^\d{4}$/.test(tx.card.last_4digits)
              ? tx.card.last_4digits
              : null,
          // V-23: an overpayment is recorded (overpaidKobo, and rawVerify.overpay) for an admin refund: never refunded
          // automatically and never turned into more units.
          ...(overpaidKobo > 0 ? { overpaidKobo } : {}),
          rawVerify: {
            init: prev ?? null,
            verify: whitelistVerify(raw) as Prisma.InputJsonValue,
            ...(overpaidKobo > 0
              ? { overpay: { extraKobo: overpaidKobo, refundNeeded: true } }
              : {}),
          },
        },
      });
      await db.notification.upsert({
        where: {
          userId_groupKey: { userId: p.userId, groupKey: `payment:${p.id}` },
        },
        create: {
          userId: p.userId,
          type: p.kind === "UNITS" ? "UNITS_ADDED" : "EXTRA_VOICE_ADDED",
          title: notifyTitle,
          body: notifyBody,
          targetType: "wallet",
          targetId: p.id,
          groupKey: `payment:${p.id}`,
        },
        update: {},
      });
    });
  }
}
