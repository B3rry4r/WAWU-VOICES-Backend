import { HttpException, Inject, Injectable, Optional } from "@nestjs/common";
import {
  UNITS_PORT,
  type ChargeAction,
  type ChargeResult,
  type FreeLeft,
  type UnitsPort,
} from "../../units/units.port";

/** An optional extra a units implementation may offer: undo a charge when the thing it paid for failed. */
type Reversible = { reverse?(chargeId: string): Promise<void> };

/** The only way talk and media reach Voice Units: through UNITS_PORT (never the units module's classes). */
@Injectable()
export class UnitsAccess {
  constructor(
    @Optional() @Inject(UNITS_PORT) private readonly port?: UnitsPort,
  ) {}

  private need(): UnitsPort {
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
  ): Promise<ChargeResult> {
    return this.need().charge(userId, action, key);
  }

  freeLeft(userId: string, action: ChargeAction): Promise<FreeLeft> {
    return this.need().freeLeft(userId, action);
  }

  /** Best effort: the port may not offer a reversal (request in the hand-back). */
  async reverse(chargeId: string): Promise<void> {
    const port: (UnitsPort & Reversible) | undefined = this.port;
    await port?.reverse?.(chargeId);
  }
}
