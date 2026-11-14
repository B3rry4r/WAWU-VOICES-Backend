import { HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import {
  UNITS_PORT,
  type ChargeAction,
  type ChargeOpts,
  type ChargeResult,
  type FreeLeft,
  type UnitsPortFull,
  type ReverseGuard,
} from "../../units/units.port";

/** The only way talk and media reach Voice Units: through UNITS_PORT (never the units module's classes). */
@Injectable()
export class UnitsAccess {
  constructor(
    @Optional() @Inject(UNITS_PORT) private readonly port?: UnitsPortFull,
  ) {}

  private need(): UnitsPortFull {
    if (!this.port)
      throw new HttpException(
        {
          code: "UNAVAILABLE",
          message: "VOICES is not available right now. Try again soon.",
        },
        503,
      );
    return this.port;
  }

  charge(
    userId: string,
    action: ChargeAction,
    key: string,
    opts?: ChargeOpts,
  ): Promise<ChargeResult> {
    return this.need().charge(userId, action, key, opts);
  }

  freeLeft(userId: string, action: ChargeAction): Promise<FreeLeft> {
    return this.need().freeLeft(userId, action);
  }

  /** Undo a committed charge because the thing it paid for failed. Safe twice. */
  async reverse(chargeId: string, reason: string): Promise<void> {
    await this.need().reverse(chargeId, reason);
  }

  /** The same undo, saying whether this call did it (false: already undone). Used by the charge sweeper. */
  reverseCharge(chargeId: string, reason: string): Promise<boolean> {
    return this.need()
      .reverse(chargeId, reason)
      .then((r) => r.reversed);
  }

  /** The sweeper's undo: the guard runs in the reversing transaction; false leaves the charge alone. */
  reverseGuarded(
    chargeId: string,
    reason: string,
    guard: ReverseGuard,
  ): Promise<boolean> {
    return this.need()
      .reverseGuarded(chargeId, reason, guard)
      .then((r) => r.reversed);
  }

  reserveToken(userId: string, tokenId: string, clipId: string) {
    return this.need().reserveToken(userId, tokenId, clipId);
  }

  consumeToken(userId: string, tokenId: string, clipId: string) {
    return this.need().consumeToken(userId, tokenId, clipId);
  }

  releaseToken(userId: string, tokenId: string, clipId: string) {
    return this.need().releaseToken(userId, tokenId, clipId);
  }
}
