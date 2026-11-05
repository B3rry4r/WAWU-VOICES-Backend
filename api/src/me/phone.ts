import { createHmac } from "node:crypto";

/** Dial codes of the launch countries (the same list as COUNTRY_CODES in me.service.ts). */
const DIAL: Record<string, string> = {
  NG: "234",
  GH: "233",
  KE: "254",
  ZA: "27",
};

/**
 * One E.164 form for one phone, however it was typed: "+234 809 999 0001", "+234-809-999-0001", "08099990001",
 * "2348099990001" and "00234 809 999 0001" all become "+2348099990001". A national number (leading 0) uses the
 * token's country claim, Nigeria when there is none. Returns null when it cannot be a phone number.
 */
export function normalisePhone(raw: unknown, country?: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (plus) return `+${digits}`;
  const dial =
    DIAL[typeof country === "string" ? country.toUpperCase() : "NG"] ?? DIAL.NG;
  if (digits.startsWith("0")) return `+${dial}${digits.slice(1)}`;
  if (
    Object.values(DIAL).some((d) => digits.startsWith(d) && digits.length >= 11)
  )
    return `+${digits}`;
  return `+${dial}${digits}`;
}

const TEST_PEPPER = "voices-test-pepper-not-a-secret";
const DEV_PEPPER = "voices-dev-pepper-not-a-secret";

/** The server secret that keys the phone hash (a plain SHA-256 of a phone number can be reversed by trying every number). */
export function phonePepper(env = process.env): string {
  const p = env.VOICES_PHONE_PEPPER;
  if (p) return p;
  if (env.NODE_ENV === "test") return TEST_PEPPER;
  if (env.NODE_ENV === "production")
    throw new Error("VOICES_PHONE_PEPPER must be set in production.");
  return DEV_PEPPER;
}

/** HMAC-SHA256(pepper, E.164 phone) as hex, or null when the claim is missing or not a phone number. */
export function phoneHashOf(phone: unknown, country?: unknown): string | null {
  const e164 = normalisePhone(phone, country);
  return e164
    ? createHmac("sha256", phonePepper()).update(e164).digest("hex")
    : null;
}
