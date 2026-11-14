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

export function verifyUnsubscribe(
  secret: string,
  token: string,
): { userId: string; kind: UnsubscribeKind } | null {
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, kind, given] = parts;
  if (kind !== "dq" && kind !== "wt") return null;
  const want = Buffer.from(mac(secret, `${userId}.${kind}`));
  const got = Buffer.from(given);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { userId, kind };
}
