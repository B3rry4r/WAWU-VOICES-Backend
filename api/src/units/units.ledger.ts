import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import type {
  ChargeAction,
  ChargeOpts,
  ChargeResult,
  FreeLeft,
} from "./units.port";
import {
  textCostMilli,
  voiceCostMilli,
  voiceFreeCovers,
  voiceTooLong,
} from "./text-price";
import { UnitsConfig } from "./units.config";
import {
  MAX_ADJUST_MILLI,
  MAX_BALANCE_MILLI,
  apiError,
  isAmount,
} from "./units.errors";

export type Tx = Prisma.TransactionClient;

const POST_ACTIONS: ChargeAction[] = ["POST_TEXT", "POST_VOICE"];
const BLOCKED = new Set(["SUSPENDED", "BANNED", "DELETED"]);

/** The Africa/Lagos calendar day as a UTC-midnight Date, for the @db.Date counter key. */
export function lagosDay(now: Date = new Date()): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${s}T00:00:00.000Z`);
}

/** The next Africa/Lagos midnight (Lagos is UTC+1 all year, no daylight saving), as an instant. */
export function nextLagosMidnight(now: Date = new Date()): Date {
  return new Date(lagosDay(now).getTime() + 24 * 3_600_000 - 3_600_000);
}

/**
 * The ledger. Integer milli-units only. A person's balance is the Wallet row, changed only together with ledger
 * entries in one database transaction, under a row lock (SELECT ... FOR UPDATE) on that person's Wallet row.
 * The deferred zero-sum trigger, the balance CHECK and the append-only triggers are the database's own backstops.
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: UnitsConfig,
  ) {}

  /** The lifetime free post count from config. Call it BEFORE opening a transaction and pass it to lockWallet. */
  freePostsConfig(): Promise<number> {
    return this.cfg.int("allowance.free_posts");
  }

  /**
   * Every units transaction goes through here. Under load many wait for a pooled connection, so the wait and run limits
   * are generous. NOTHING inside the callback may use the shared pool (this.prisma / this.cfg): only the tx handed in.
   */
  inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { maxWait: 30_000, timeout: 30_000 });
  }

  /** Make sure the person's Wallet and FreeAllowance exist, then lock the Wallet row. Returns the locked balance. */
  async lockWallet(
    tx: Tx,
    userId: string,
    opts: { forWrite?: boolean; freePosts: number },
  ): Promise<number> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!user)
      throw apiError(403, "FORBIDDEN", "Finish your profile first.", {
        reason: "PROFILE_REQUIRED",
      });
    if (opts.forWrite && BLOCKED.has(user.status))
      throw apiError(
        403,
        "ACCOUNT_SUSPENDED",
        "This account cannot do that right now.",
      );
    const free = opts.freePosts; // read BEFORE the transaction: nothing here may use the pool
    await tx.$executeRaw`INSERT INTO "Wallet" ("userId","balanceMilli","updatedAt") VALUES (${userId},0,now()) ON CONFLICT ("userId") DO NOTHING`;
    await tx.$executeRaw`INSERT INTO "FreeAllowance" ("userId","freePostsRemaining","freePostsUsed","updatedAt") VALUES (${userId},${free},0,now()) ON CONFLICT ("userId") DO NOTHING`;
    const rows = await tx.$queryRaw<
      { balanceMilli: number }[]
    >`SELECT "balanceMilli" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
    return rows[0].balanceMilli;
  }

  /** Set the locked wallet's balance. The caller holds the row lock and has checked the range. */
  async setBalance(
    tx: Tx,
    userId: string,
    balanceMilli: number,
  ): Promise<void> {
    if (!isAmount(balanceMilli))
      throw apiError(
        409,
        "CONFLICT",
        "That would put the balance out of range.",
      );
    await tx.$executeRaw`UPDATE "Wallet" SET "balanceMilli" = ${balanceMilli}, "updatedAt" = now() WHERE "userId" = ${userId}`;
  }

  private async costOf(
    action: ChargeAction,
    opts: ChargeOpts = {},
  ): Promise<{
    cost: number;
    dailyLimit: number | null;
    freeCovers: boolean;
    messagesPerDay: number;
  }> {
    const c = await this.cfg.ints([
      "cost.text_post_milli",
      "text.price_chars",
      "allowance.free_post_text_chars",
      "voice.free_seconds",
      "voice.extra30.price_kobo",
      "voice.extra30.max_seconds",
      "voice.extra60.price_kobo",
      "voice.extra60.max_seconds",
      "cost.reaction_milli",
      "cost.vote_milli",
      "allowance.free_reactions_per_day",
      "allowance.free_votes_per_day",
      "allowance.messages_per_day",
      "textfix.cost_milli",
    ]);
    const messagesPerDay = c["allowance.messages_per_day"];
    switch (action) {
      case "POST_TEXT": {
        // No length given: one full price block (a 150-character message, 5 tokens).
        const chars = opts.chars ?? c["text.price_chars"];
        return {
          cost: textCostMilli(
            chars,
            c["cost.text_post_milli"],
            c["text.price_chars"],
          ),
          dailyLimit: null,
          freeCovers: chars <= c["allowance.free_post_text_chars"],
          messagesPerDay,
        };
      }
      case "POST_VOICE": {
        // Voice is priced by its length (V-36: the old extra voice tokens became these prices). 1 token = 1000 milli = 100 kobo.
        const ms = opts.durationMs ?? 0;
        if (voiceTooLong(ms, c["voice.extra60.max_seconds"]))
          throw apiError(422, "VOICE_TOO_LONG", "That recording is too long.", {
            maxSeconds: c["voice.extra60.max_seconds"],
          });
        // lead ruling LF, 9 Nov: the shared price function, the same one the web shows.
        const cost = voiceCostMilli(
          ms,
          c["voice.extra30.price_kobo"] * 10,
          c["voice.extra60.price_kobo"] * 10,
          c["voice.extra30.max_seconds"],
        );
        return {
          cost,
          dailyLimit: null,
          freeCovers: voiceFreeCovers(ms, c["voice.free_seconds"]),
          messagesPerDay,
        };
      }
      case "EDIT_TEXT": {
        // lead ruling LF, 9 Nov: a longer edit pays the difference in proportion; no free floor.
        const to = textCostMilli(
          opts.chars ?? 0,
          c["cost.text_post_milli"],
          c["text.price_chars"],
        );
        const from = textCostMilli(
          opts.fromChars ?? 0,
          c["cost.text_post_milli"],
          c["text.price_chars"],
        );
        return {
          cost: Math.max(0, to - from),
          dailyLimit: null,
          freeCovers: false,
          messagesPerDay,
        };
      }
      case "TEXT_FIX":
        return {
          cost: c["textfix.cost_milli"],
          dailyLimit: null,
          freeCovers: false,
          messagesPerDay,
        };
      case "REACTION":
        return {
          cost: c["cost.reaction_milli"],
          dailyLimit: c["allowance.free_reactions_per_day"],
          freeCovers: true,
          messagesPerDay,
        };
      case "VOTE":
        return {
          cost: c["cost.vote_milli"],
          dailyLimit: c["allowance.free_votes_per_day"],
          freeCovers: true,
          messagesPerDay,
        };
      default:
        throw apiError(422, "VALIDATION_FAILED", "Unknown action.");
    }
  }

  private toResult(c: {
    id: string;
    costMilli: number;
    usedFreePost: boolean;
    usedFreeDaily: boolean;
  }): ChargeResult {
    return {
      chargeId: c.id,
      costMilli: c.costMilli,
      usedFreePost: c.usedFreePost,
      usedFreeDaily: c.usedFreeDaily,
    };
  }

  /** Spend the free allowance or units for one action, once per (person, key). */
  async charge(
    userId: string,
    action: ChargeAction,
    key: string,
    opts: ChargeOpts = {},
  ): Promise<ChargeResult> {
    if (typeof key !== "string" || !key || key.length > 200)
      throw apiError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header with this request.",
      );
    const { cost, dailyLimit, freeCovers, messagesPerDay } = await this.costOf(
      action,
      opts,
    );
    const minPack = await this.cfg.int("units.min_purchase_kobo");
    const freePosts = await this.freePostsConfig();
    return this.inTx(async (tx) => {
      const balance = await this.lockWallet(tx, userId, {
        forWrite: true,
        freePosts,
      });
      // Everything below runs under the lock, so a parallel request with the same key waits here and then sees this row.
      const prior = await tx.charge.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      });
      if (prior) {
        if (prior.action !== action)
          throw apiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "That key was used for something else.",
          );
        if (prior.status === "REVERSED")
          throw apiError(
            409,
            "CONFLICT",
            "That attempt was reversed. Start again with a new key.",
          );
        return this.toResult(prior);
      }

      let usedFreePost = false;
      let usedFreeDaily = false;
      let freeLeftBefore = 0;
      if (POST_ACTIONS.includes(action)) {
        // At most N outgoing messages a Lagos day, free posts included. The wallet row lock above serialises one
        // person's requests, so 20 parallel posts at 19 used let exactly one through.
        const day = lagosDay();
        const sent = await tx.usageCounter.findMany({
          where: { userId, day, action: { in: POST_ACTIONS } },
          select: { used: true },
        });
        const sentToday = sent.reduce((n, r) => n + r.used, 0);
        if (sentToday >= messagesPerDay)
          throw apiError(
            429,
            "DAILY_LIMIT_REACHED",
            `You have sent ${messagesPerDay} messages today, which is the most for one day. Come back after midnight.`,
            {
              limit: messagesPerDay,
              resetsAt: nextLagosMidnight().toISOString(),
              // lead ruling LF, 9 Nov: Retry-After is the seconds until midnight Lagos time.
              retryAfterSeconds: Math.max(
                1,
                Math.ceil((nextLagosMidnight().getTime() - Date.now()) / 1000),
              ),
            },
          );
        await tx.usageCounter.upsert({
          where: { userId_day_action: { userId, day, action } },
          create: { userId, day, action, used: 1 },
          update: { used: { increment: 1 } },
        });
        const a = await tx.freeAllowance.findUniqueOrThrow({
          where: { userId },
        });
        freeLeftBefore = a.freePostsRemaining;
        if (
          a.freePostsRemaining > 0 &&
          freeCovers &&
          !opts.prepaid &&
          !opts.noFree
        ) {
          usedFreePost = true;
          await tx.freeAllowance.update({
            where: { userId },
            data: {
              freePostsRemaining: { decrement: 1 },
              freePostsUsed: { increment: 1 },
            },
          });
        }
      } else if (dailyLimit !== null) {
        const day = lagosDay();
        const used =
          (
            await tx.usageCounter.findUnique({
              where: { userId_day_action: { userId, day, action } },
            })
          )?.used ?? 0;
        if (used < dailyLimit) usedFreeDaily = true;
        // The counter counts every reaction or vote of the day, free or paid.
        await tx.usageCounter.upsert({
          where: { userId_day_action: { userId, day, action } },
          create: { userId, day, action, used: 1 },
          update: { used: { increment: 1 } },
        });
      }

      const costMilli =
        usedFreePost || usedFreeDaily || opts.prepaid ? 0 : cost;
      if (costMilli > balance) {
        // Rolled back by the throw: the free-allowance and counter writes above are undone with it.
        const post =
          POST_ACTIONS.includes(action) && freeLeftBefore === 0 && !opts.noFree;
        throw apiError(
          402,
          post ? "FREE_POSTS_EXHAUSTED" : "INSUFFICIENT_UNITS",
          post
            ? "You have used your free posts. Get tokens to post."
            : "You need more tokens for that.",
          { costMilli, balanceMilli: balance, minPackKobo: minPack },
        );
      }

      const charge = await tx.charge.create({
        data: {
          userId,
          action,
          costMilli,
          usedFreePost,
          usedFreeDaily,
          idempotencyKey: key,
        },
      });
      if (costMilli > 0) {
        const after = balance - costMilli;
        const kind =
          POST_ACTIONS.includes(action) ||
          action === "TEXT_FIX" ||
          action === "EDIT_TEXT"
            ? "SPEND_POST"
            : action === "REACTION"
              ? "SPEND_REACTION"
              : "SPEND_VOTE";
        const txn = await tx.ledgerTransaction.create({
          data: {
            kind,
            idempotencyKey: `charge:${charge.id}`,
            chargeId: charge.id,
            entries: {
              create: [
                {
                  account: "USER_WALLET",
                  walletUserId: userId,
                  deltaMilli: -costMilli,
                  balanceAfterMilli: after,
                },
                { account: "SPEND", deltaMilli: costMilli },
              ],
            },
          },
        });
        await this.setBalance(tx, userId, after);
        await tx.charge.update({
          where: { id: charge.id },
          data: { spendTxnId: txn.id },
        });
      }
      return this.toResult(charge);
    });
  }

  /** Undo a committed charge (the thing it paid for failed). Safe to call twice. */
  async reverseByKey(
    userId: string,
    key: string,
  ): Promise<{ reversed: boolean }> {
    return this.reverseCharge(userId, { idempotencyKey: key }, "action failed");
  }

  /** Undo a charge by its id (ChargeResult.chargeId). One balanced REVERSAL per charge, however often it is called. */
  async reverse(
    chargeId: string,
    reason: string,
  ): Promise<{ reversed: boolean }> {
    const found = await this.prisma.charge.findUnique({
      where: { id: chargeId },
      select: { userId: true },
    });
    if (!found)
      throw apiError(404, "NOT_FOUND", "We could not find that charge.");
    return this.reverseCharge(found.userId, { id: chargeId }, reason);
  }

  private async reverseCharge(
    userId: string,
    by: { id: string } | { idempotencyKey: string },
    reason: string,
  ): Promise<{ reversed: boolean }> {
    const freePosts = await this.freePostsConfig();
    return this.inTx(async (tx) => {
      const balance = await this.lockWallet(tx, userId, { freePosts });
      const c = await tx.charge.findFirst({ where: { userId, ...by } });
      if (!c)
        throw apiError(404, "NOT_FOUND", "We could not find that charge.");
      if (c.status === "REVERSED") return { reversed: false };
      let reversalTxnId: string | null = null;
      if (c.costMilli > 0) {
        const after = balance + c.costMilli;
        if (after > MAX_BALANCE_MILLI)
          throw apiError(
            409,
            "CONFLICT",
            "That would put the balance out of range.",
          );
        const txn = await tx.ledgerTransaction.create({
          data: {
            kind: "REVERSAL",
            idempotencyKey: `reversal:${c.id}`,
            chargeId: c.id,
            reason: String(reason ?? "").slice(0, 200) || null,
            entries: {
              create: [
                {
                  account: "USER_WALLET",
                  walletUserId: userId,
                  deltaMilli: c.costMilli,
                  balanceAfterMilli: after,
                },
                { account: "REVERSAL", deltaMilli: -c.costMilli },
              ],
            },
          },
        });
        reversalTxnId = txn.id;
        await this.setBalance(tx, userId, after);
      }
      if (c.usedFreePost)
        await tx.freeAllowance.update({
          where: { userId },
          data: {
            freePostsRemaining: { increment: 1 },
            freePostsUsed: { decrement: 1 },
          },
        });
      {
        const day = lagosDay(c.createdAt);
        // Every action counts per day (reactions and votes for their free ones, posts for the daily message limit).
        await tx.$executeRaw`UPDATE "UsageCounter" SET used = GREATEST(used - 1, 0) WHERE "userId" = ${userId} AND day = ${day} AND action = ${c.action}::"ChargeAction"`;
      }
      await tx.charge.update({
        where: { id: c.id },
        data: { status: "REVERSED", reversalTxnId, reversedAt: new Date() },
      });
      return { reversed: true };
    });
  }

  async attachRef(
    userId: string,
    key: string,
    refType: string,
    refId: string,
  ): Promise<void> {
    await this.prisma.charge.updateMany({
      where: { userId, idempotencyKey: key },
      data: { refType, refId },
    });
  }

  async freeLeft(userId: string, action: ChargeAction): Promise<FreeLeft> {
    const { dailyLimit } = await this.costOf(action, { durationMs: 0 });
    const [wallet, allowance, counter, free] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.freeAllowance.findUnique({ where: { userId } }),
      this.prisma.usageCounter.findUnique({
        where: { userId_day_action: { userId, day: lagosDay(), action } },
      }),
      this.cfg.int("allowance.free_posts"),
    ]);
    const balanceMilli = wallet?.balanceMilli ?? 0;
    if (dailyLimit === null)
      return { freeLeft: allowance?.freePostsRemaining ?? free, balanceMilli };
    return {
      freeLeft: Math.max(0, dailyLimit - (counter?.used ?? 0)),
      balanceMilli,
    };
  }

  /** An admin balance adjustment (A7 calls this). At most 1,000 units a call, never below zero, once per key. */
  async adjust(
    adminId: string,
    userId: string,
    deltaMilli: number,
    reason: string,
    key: string,
  ): Promise<{ balanceMilli: number; txnId: string }> {
    if (
      !isAmount(deltaMilli, -MAX_ADJUST_MILLI, MAX_ADJUST_MILLI) ||
      deltaMilli === 0
    )
      throw apiError(
        422,
        "VALIDATION_FAILED",
        "The change must be a whole number of milli-units, not zero, and at most 1,000 units.",
      );
    if (typeof reason !== "string" || !reason.trim())
      throw apiError(422, "VALIDATION_FAILED", "Give a reason.");
    if (typeof key !== "string" || !key || key.length > 200)
      throw apiError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header with this request.",
      );
    const freePosts = await this.freePostsConfig();
    return this.inTx(async (tx) => {
      const balance = await this.lockWallet(tx, userId, { freePosts });
      const prior = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: `adjust:${userId}:${key}` },
        include: { entries: true },
      });
      if (prior) {
        const w = prior.entries.find((e) => e.account === "USER_WALLET");
        if (w?.deltaMilli !== deltaMilli)
          throw apiError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "That key was used for something else.",
          );
        return { balanceMilli: balance, txnId: prior.id };
      }
      const after = balance + deltaMilli;
      if (after < 0 || after > MAX_BALANCE_MILLI)
        throw apiError(
          422,
          "VALIDATION_FAILED",
          "The balance cannot go below zero or above the limit.",
        );
      const txn = await tx.ledgerTransaction.create({
        data: {
          kind: "ADJUSTMENT",
          idempotencyKey: `adjust:${userId}:${key}`,
          reason: reason.trim(),
          createdById: adminId,
          entries: {
            create: [
              {
                account: "USER_WALLET",
                walletUserId: userId,
                deltaMilli,
                balanceAfterMilli: after,
              },
              { account: "ADJUSTMENT", deltaMilli: -deltaMilli },
            ],
          },
        },
      });
      await this.setBalance(tx, userId, after);
      return { balanceMilli: after, txnId: txn.id };
    });
  }
}
