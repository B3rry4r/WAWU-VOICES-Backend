/**
 * The Voice Units port (V-SHARED-0). Modules that spend units (talk, vote, reach) depend on this token, never on the
 * units module's classes. The units task (units/**) provides the implementation under UNITS_PORT.
 * Action names are the contract's ChargeAction (docs/contract/PRICES.md: cost.* and allowance.* per action).
 */
export const UNITS_PORT = Symbol("UNITS_PORT");

export type ChargeAction = "POST_TEXT" | "POST_VOICE" | "REACTION" | "VOTE";

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
  ): Promise<ChargeResult>;
  /** How many free actions the person has left for this action. */
  freeLeft(userId: string, action: ChargeAction): Promise<FreeLeft>;
}
