import { HttpException } from "@nestjs/common";

/** One API error in the contract's shape; the exception filter adds requestId. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException({ code, message, details }, status);
}

export const MAX_BALANCE_MILLI = 2_000_000_000;
export const MAX_ADJUST_MILLI = 1_000_000;

/** A milli or kobo amount: a safe integer inside the 32-bit range the contract states. Never a float. */
export function isAmount(
  n: unknown,
  min = 0,
  max = MAX_BALANCE_MILLI,
): n is number {
  return (
    typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max
  );
}

/** An Idempotency-Key header: present, printable, at most 200 characters. */
export function requireKey(raw: string | undefined): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key || key.length > 200 || !/^[\x21-\x7e]+$/.test(key))
    throw apiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Send an Idempotency-Key header with this request.",
    );
  return key;
}
