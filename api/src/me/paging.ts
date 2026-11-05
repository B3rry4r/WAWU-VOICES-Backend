import { BadRequestException } from "@nestjs/common";

const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

/** Opaque keyset cursor on (time, id). Expires after 24 hours (CONVENTIONS.md, "Cursor pages"). */
export function encodeCursor(t: Date, id: string, now = new Date()): string {
  return Buffer.from(
    JSON.stringify({ t: t.toISOString(), id, iat: now.getTime() }),
  ).toString("base64url");
}

export function decodeCursor(
  raw: string | undefined,
  now = new Date(),
): { t: Date; id: string } | null {
  if (!raw) return null;
  const bad = () =>
    new BadRequestException({
      code: "BAD_REQUEST",
      message: "That page link is no longer valid. Start again.",
    });
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      t?: unknown;
      id?: unknown;
      iat?: unknown;
    };
    if (
      typeof o.t !== "string" ||
      typeof o.id !== "string" ||
      typeof o.iat !== "number" ||
      now.getTime() - o.iat > CURSOR_TTL_MS
    )
      throw bad();
    const t = new Date(o.t);
    if (Number.isNaN(t.getTime())) throw bad();
    return { t, id: o.id };
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw bad();
  }
}

export function pageLimit(raw: unknown): number {
  if (raw === undefined || raw === "") return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50)
    throw new BadRequestException({
      code: "BAD_REQUEST",
      message: "limit must be a whole number from 1 to 50.",
    });
  return n;
}

/** Keyset "older than" filter for newest-first lists on (createdAt, id). */
export function olderThan(c: { t: Date; id: string } | null) {
  return c
    ? {
        OR: [{ createdAt: { lt: c.t } }, { createdAt: c.t, id: { lt: c.id } }],
      }
    : {};
}

/** Cuts a page of limit+1 rows into items and a nextCursor. */
export function cut<T extends { id: string }>(
  rows: T[],
  limit: number,
  at: (r: T) => Date,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor:
      rows.length > limit && last ? encodeCursor(at(last), last.id) : null,
  };
}
