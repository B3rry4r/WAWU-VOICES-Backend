import { createHmac, timingSafeEqual } from "node:crypto";
import type { UnsubscribeKind } from "./mail-templates";

/** The UserSettings switch each unsubscribe kind turns off. */
export const UNSUBSCRIBE_FIELD = {
  dq: "notifyDailyQuestion",
  wt: "notifyWeeklyTopic",
} as const satisfies Record<UnsubscribeKind, string>;

export const UNSUBSCRIBE_LABEL: Record<UnsubscribeKind, string> = {
  dq: "daily question emails",
  wt: "topic of the week emails",
};

const mac = (secret: string, body: string) =>
  createHmac("sha256", secret)
    .update(`unsub|${body}`)
    .digest("base64url")
    .slice(0, 27);

/** `<userId>.<kind>.<mac>`: it names one person and one kind of mail, and nothing else can be done with it. */
export function signUnsubscribe(
  secret: string,
  userId: string,
  kind: UnsubscribeKind,
): string {
  const body = `${userId}.${kind}`;
  return `${body}.${mac(secret, body)}`;
}

/** `secret` may be one key or several: a link made with any of them is good (the secret was set after some links went out). */
export function verifyUnsubscribe(
  secret: string | string[],
  token: string,
): { userId: string; kind: UnsubscribeKind } | null {
  const keys = (Array.isArray(secret) ? secret : [secret]).filter(Boolean);
  if (keys.length === 0 || typeof token !== "string" || token.length > 200)
    return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, kind, given] = parts;
  if (kind !== "dq" && kind !== "wt") return null;
  const got = Buffer.from(given);
  const good = keys.some((k) => {
    const want = Buffer.from(mac(k, `${userId}.${kind}`));
    return want.length === got.length && timingSafeEqual(want, got);
  });
  return good ? { userId, kind } : null;
}
