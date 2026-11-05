import type { AccountStatus, VoicesRole } from "../generated/prisma/enums";

/** What ProfileGuard puts on `req.me` for every signed-in request with a finished profile. */
export interface CurrentMeInfo {
  id: string;
  wawuId: string;
  handle: string;
  status: AccountStatus;
  suspendedUntil: Date | null;
  roles: VoicesRole[];
  /** The verified claims of the token that made this request. */
  token: { sub: string; iat?: number; phone?: string };
}
