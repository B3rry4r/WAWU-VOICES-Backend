import type { Prisma } from "../generated/prisma/client";
/**
 * The Voice Units port (V-SHARED-0). Modules that spend units (talk, vote, reach) depend on this token, never on the
 * units module's classes. The units task (units/**) provides the implementation under UNITS_PORT.
 * Action names are the contract's ChargeAction (docs/contract/PRICES.md: cost.* and allowance.* per action).
 */
export const UNITS_PORT = Symbol("UNITS_PORT");

export type ChargeAction =
  "POST_TEXT" | "POST_VOICE" | "REACTION" | "VOTE" | "TEXT_FIX" | "EDIT_TEXT";

/**
 * What a post is made of, so the price follows it: text by its character count (`countChars`), voice by its length.
 * `prepaid` means the voice was paid for before (an extra voice token bought before the new prices): no charge, but it
 * still counts toward the daily limit.
 */
export interface ChargeOpts {
  chars?: number;
  /** EDIT_TEXT: the length it was, so only the difference is charged. */
  fromChars?: number;
  durationMs?: number;
  prepaid?: boolean;
}

export interface ChargeResult {
  chargeId: string;
  costMilli: number;
  usedFreePost: boolean;
  usedFreeDaily: boolean;
}

export interface FreeLeft {
  /** Free posts left (lifetime, text and voice together) or free reactions/votes left today, per the action. */
  freeLeft: number;
  balanceMilli: number;
}

export interface UnitsPort {
  /** Spend the free allowance or units for one action. Same idempotencyKey, same result. Throws a 402 error code when it cannot be paid. */
  charge(
    userId: string,
    action: ChargeAction,
    idempotencyKey: string,
    opts?: ChargeOpts,
  ): Promise<ChargeResult>;
  /** How many free actions the person has left for this action. */
  freeLeft(userId: string, action: ChargeAction): Promise<FreeLeft>;
  /** Undo a committed charge (by ChargeResult.chargeId) because a later step failed. One balanced REVERSAL, once; safe twice. */
  reverse(chargeId: string, reason?: string): Promise<{ reversed: boolean }>;
}

/**
 * What the units module adds on top of the two methods above (additive: a consumer that only needs charge and
 * freeLeft keeps typing against UnitsPort). The same UNITS_PORT provider implements all of it.
 */
/** Runs inside the reversing transaction with the wallet locked; false means "do not reverse". May write in `tx`. */
export type ReverseGuard = (
  tx: Prisma.TransactionClient,
  charge: { id: string; userId: string; idempotencyKey: string },
) => Promise<boolean>;

export interface UnitsPortFull extends UnitsPort {
  /** `reverse`, run only when `guard` (inside the reversing transaction, wallet locked) says yes. For the charge sweeper. */
  reverseGuarded(
    chargeId: string,
    reason: string,
    guard: ReverseGuard,
  ): Promise<{ reversed: boolean }>;
  /** The same undo, found by the person and the Idempotency-Key the charge was made with. */
  reverseByKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<{ reversed: boolean }>;
  /** Record what a charge paid for (refType: answer | reply | proposal | reaction | vote). */
  attachRef(
    userId: string,
    idempotencyKey: string,
    refType: string,
    refId: string,
  ): Promise<void>;
  /** Hold one AVAILABLE extra voice token for a clip in progress. Throws 409 CONFLICT if it is not available. */
  reserveToken(
    userId: string,
    tokenId: string,
    clipId: string,
  ): Promise<{ maxSeconds: number }>;
  /** Mark the reserved token USED when the post publishes. */
  consumeToken(userId: string, tokenId: string, clipId: string): Promise<void>;
  /** Give the reserved token back (clip discarded or post failed). Safe twice. */
  releaseToken(userId: string, tokenId: string, clipId: string): Promise<void>;
  /** One quote for GET /me/allowance?action=: what the action costs this person now (0 while a free one is left). */
  quote(
    userId: string,
    action: ChargeAction,
  ): Promise<{
    action: ChargeAction;
    costMilli: number;
    freeLeft: number;
    balanceMilli: number;
  }>;
  /** The Allowances object of GET /me/allowance (the me module serves that route and calls this). */
  allowances(userId: string): Promise<Allowances>;
  /** Admin balance adjustment for the admin module: at most 1,000 units a call, never below zero, once per key. */
  adjustBalance(
    adminId: string,
    userId: string,
    deltaMilli: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<{ balanceMilli: number; txnId: string }>;
}

export interface Allowances {
  freePostsRemaining: number;
  balanceMilli: number;
  maxVoiceSeconds: number;
  /** Outgoing messages (answers and replies) still allowed today, Lagos time. */
  messagesLeftToday: number;
  freeReactionsLeftToday: number;
  freeVotesLeftToday: number;
  costs: Record<string, number>;
  extraVoiceTokens: {
    id: string;
    kind: string;
    maxSeconds: number;
    status: string;
    createdAt: string;
  }[];
}
