import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import type {
  ChargeAction,
  ChargeOpts,
  ChargeResult,
  FreeLeft,
  ReverseGuard,
  ChargePlan,
  ChargeJoin,
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
/** V-DM: direct messages. Their own cap (dm.messages_per_day); never part of the 20 posts a day. */
const DM_ACTIONS: ChargeAction[] = ["DM_TEXT", "DM_VOICE"];
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

/** Thrown inside the reversal transaction to roll it back when the charge is no longer a COMMITTED, unlinked one. */
class LinkedChargeKept extends Error {}

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

  private costOf(action: ChargeAction, opts: ChargeOpts = {}) {
    return this.loadCostInputs().then((c) => this.costFrom(c, action, opts));
  }

  /** The config numbers a price is worked out from (one query on the shared pool). */
  private loadCostInputs(): Promise<Record<string, number>> {
    return this.cfg.ints([
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
      "dm.text_price_milli",
      "dm.voice_price_milli",
      "dm.voice_max_seconds",
      "dm.messages_per_day",
    ]);
  }

  /** The price of an action from numbers already read. Touches no database. */
  private costFrom(
    c: Record<string, number>,
    action: ChargeAction,
    opts: ChargeOpts = {},
  ): {
    cost: number;
    dailyLimit: number | null;
    freeCovers: boolean;
    messagesPerDay: number;
  } {
    // A direct message has its own cap; every other action reports the 20 posts a day.
    const messagesPerDay = DM_ACTIONS.includes(action)
      ? c["dm.messages_per_day"]
      : c["allowance.messages_per_day"];
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
      case "DM_TEXT": {
        const chars = opts.chars ?? c["text.price_chars"];
        return {
          cost: textCostMilli(
            chars,
            c["dm.text_price_milli"],
            c["text.price_chars"],
          ),
          dailyLimit: null,
          freeCovers: false,
          messagesPerDay,
        };
      }
      case "DM_VOICE": {
        if ((opts.durationMs ?? 0) > c["dm.voice_max_seconds"] * 1000 + 500)
          throw apiError(422, "VOICE_TOO_LONG", "That recording is too long.", {
            maxSeconds: c["dm.voice_max_seconds"],
          });
        return {
          cost: c["dm.voice_price_milli"],
          dailyLimit: null,
          freeCovers: false,
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
  /**
   * Read, on the shared pool and BEFORE any transaction is open, everything `charge` needs from config. A caller that wants its
   * charge to run inside its own transaction (`join`) calls this first, so the charge itself never asks the pool for a second
   * connection while the caller holds one.
   */
  async prepareCharge(): Promise<ChargePlan> {
    return {
      ints: await this.loadCostInputs(),
      minPack: await this.cfg.int("units.min_purchase_kobo"),
      freePosts: await this.freePostsConfig(),
    };
  }

  /**
   * Spend the free allowance or units for one action, once per (person, key). With `join` the charge runs on the caller's
   * transaction (and its connection) instead of opening its own: it commits or rolls back with the caller. Lock order for a caller
   * that holds a post row: the post row first, then the wallet row taken here.
   */
  async charge(
    userId: string,
    action: ChargeAction,
    key: string,
    opts: ChargeOpts = {},
    join?: ChargeJoin,
  ): Promise<ChargeResult> {
    if (typeof key !== "string" || !key || key.length > 200)
      throw apiError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header with this request.",
      );
    const plan = join ? join.plan : await this.prepareCharge();
    const { cost, dailyLimit, freeCovers, messagesPerDay } = this.costFrom(
      plan.ints,
      action,
      opts,
    );
    const minPack = plan.minPack;
    const freePosts = plan.freePosts;
    const run = async (tx: Tx): Promise<ChargeResult> => {
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
        if (a.freePostsRemaining > 0 && freeCovers && !opts.prepaid) {
          usedFreePost = true;
          await tx.freeAllowance.update({
            where: { userId },
            data: {
              freePostsRemaining: { decrement: 1 },
              freePostsUsed: { increment: 1 },
            },
          });
        }
      } else if (DM_ACTIONS.includes(action)) {
        // V-DM: their own cap, counted over both kinds. The wallet row lock above serialises one person's sends.
        const day = lagosDay();
        const sent = await tx.usageCounter.findMany({
          where: { userId, day, action: { in: DM_ACTIONS } },
          select: { used: true },
        });
        if (sent.reduce((n, r) => n + r.used, 0) >= messagesPerDay)
          throw apiError(
            429,
            "DAILY_LIMIT_REACHED",
            `You have sent ${messagesPerDay} direct messages today, which is the most for one day. Come back after midnight.`,
            {
              limit: messagesPerDay,
              resetsAt: nextLagosMidnight().toISOString(),
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
        const post = POST_ACTIONS.includes(action) && freeLeftBefore === 0;
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
          // The sweeper's mark (post charges only; null for every other action).
          ...(POST_ACTIONS.includes(action) && opts.refType
            ? { refType: opts.refType }
            : {}),
        },
      });
      if (costMilli > 0) {
        const after = balance - costMilli;
        const kind =
          POST_ACTIONS.includes(action) ||
          DM_ACTIONS.includes(action) ||
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
    };
    return join ? run(join.tx) : this.inTx(run);
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

  /**
   * `reverse`, but only if `guard` agrees. The guard runs inside the reversing transaction, after the wallet row is
   * locked and the charge is read as COMMITTED; it may also write (the charge sweeper deletes the dead retry record
   * there). Returning false leaves everything as it was. A parallel request with the same key waits on the wallet lock
   * and then sees either the committed charge (guard said no) or the reversed one (409 CONFLICT, start again).
   */
  async reverseGuarded(
    chargeId: string,
    reason: string,
    guard: ReverseGuard,
  ): Promise<{ reversed: boolean }> {
    const found = await this.prisma.charge.findUnique({
      where: { id: chargeId },
      select: { userId: true },
    });
    if (!found)
      throw apiError(404, "NOT_FOUND", "We could not find that charge.");
    return this.reverseCharge(found.userId, { id: chargeId }, reason, guard);
  }

  private async reverseCharge(
    userId: string,
    by: { id: string } | { idempotencyKey: string },
    reason: string,
    guard?: ReverseGuard,
  ): Promise<{ reversed: boolean }> {
    const freePosts = await this.freePostsConfig();
    return this.inTx(async (tx) => {
      const balance = await this.lockWallet(tx, userId, { freePosts });
      // The charge row is locked before it is read (V-LINK-IN-TX round 2): a transaction that is linking this charge to a
      // stored post holds this lock until it commits, so the read below waits for it and then sees the link.
      if ("id" in by)
        await tx.$queryRaw`SELECT 1 FROM "Charge" WHERE "id" = ${by.id} AND "userId" = ${userId} FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT 1 FROM "Charge" WHERE "userId" = ${userId} AND "idempotencyKey" = ${by.idempotencyKey} FOR UPDATE`;
      const c = await tx.charge.findFirst({ where: { userId, ...by } });
      if (!c)
        throw apiError(404, "NOT_FOUND", "We could not find that charge.");
      if (c.status === "REVERSED") return { reversed: false };
      // A charge linked to a stored post is never reversed, whoever asks: the post is kept, so its charge is kept. This
      // closes a commit that succeeded while the app saw an error, and two requests with the same key racing.
      if (c.refId) return { reversed: false };
      if (guard && !(await guard(tx, c))) return { reversed: false };
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
      const changed = await tx.charge.updateMany({
        where: { id: c.id, status: "COMMITTED", refId: null },
        data: { status: "REVERSED", reversalTxnId, reversedAt: new Date() },
      });
      // Cannot happen under the row lock; if it ever does, undo everything written above and change nothing.
      if (changed.count !== 1) throw new LinkedChargeKept();
      return { reversed: true };
    }).catch((e) => {
      if (e instanceof LinkedChargeKept) return { reversed: false };
      throw e;
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
