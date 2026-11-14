import { ForbiddenException } from "@nestjs/common";

/**
 * V-46: the one place that says whether a person is verified. Everything that unlocks something for verified people
 * (suggesting an idea, DMs) asks here, so the rule is written once.
 *
 * A person is verified now when an admin approved their ID and utility bill AND their subscription has not ended:
 * `verifiedUntil` is the end of the subscription chain, so it is simply "in the future".
 *
 * Pass the two columns of the User row (select `verifiedUntil` and, if you can, `verificationStatus`):
 *   - `verificationStatus` given: it must be APPROVED (a person who sent new documents is PENDING, a rejected one REJECTED);
 *   - `verificationStatus` left out (undefined): only `verifiedUntil` decides.
 * It never reads the database. A stale `verifiedUntil` is healed by VerificationService.fresh() (renewals) and by its
 * ten-minute job, so a caller that must be exact calls that first.
 */
export function isVerifiedNow(
  m: { verifiedUntil: Date | null; verificationStatus?: string | null },
  now: Date = new Date(),
): boolean {
  if (!m.verifiedUntil) return false;
  if (m.verificationStatus !== undefined && m.verificationStatus !== "APPROVED")
    return false;
  return m.verifiedUntil.getTime() > now.getTime();
}

/** What the suggest-an-idea route says to someone who is not verified. */
export const VERIFICATION_REQUIRED_IDEAS =
  "Subscribe and get verified to suggest ideas.";

/**
 * Throws 403 `{ code: "verification_required", message }` unless the person is verified now. Use it at the top of a
 * route that only verified people may use, with the words that fit that route (the DM gate passes its own).
 */
export function requireVerified(
  m: { verifiedUntil: Date | null; verificationStatus?: string | null },
  opts: { message?: string; now?: Date } = {},
): void {
  if (isVerifiedNow(m, opts.now)) return;
  throw new ForbiddenException({
    code: "verification_required",
    message: opts.message ?? VERIFICATION_REQUIRED_IDEAS,
  });
}
