/**
 * Why a request is rejected: a short code the admin picks, and the plain words the person reads. Free words from the
 * admin are added after these. No em-dashes anywhere a person reads (V-13).
 */
export const REJECT_REASONS = {
  ID_UNREADABLE:
    "We could not read your ID. Upload a clear, full photo or scan.",
  ID_NOT_VALID:
    "That is not a valid government ID. Use a national ID card, passport, driver's licence or voter's card.",
  ID_EXPIRED: "Your ID has expired. Upload one that is still valid.",
  BILL_UNREADABLE:
    "We could not read your utility bill. Upload a clear, full photo or scan.",
  BILL_TOO_OLD:
    "Your utility bill is too old. Upload one from the last 3 months.",
  DETAILS_DO_NOT_MATCH:
    "The name on your documents does not match. Both must show the same name.",
  SUBSCRIPTION_ENDED:
    "Your subscription ended before we could check your documents. Subscribe again and send them again.",
  OTHER: "We could not approve your documents.",
} as const;

export type RejectReasonCode = keyof typeof REJECT_REASONS;
export const REJECT_REASON_CODES = Object.keys(
  REJECT_REASONS,
) as RejectReasonCode[];

/** A dash a person would read as an em-dash becomes a plain hyphen. */
export function plain(s: string): string {
  return s.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

/** The words the person sees for a decision: the sentence for the code, then the admin's own words. */
export function reasonText(code: string | null, note: string | null): string {
  const base =
    code && code in REJECT_REASONS
      ? REJECT_REASONS[code as RejectReasonCode]
      : REJECT_REASONS.OTHER;
  return note ? `${base} ${note}` : base;
}
