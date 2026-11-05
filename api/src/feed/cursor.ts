import { BadRequestException } from "@nestjs/common";

const MAX_AGE_MS = 24 * 3_600_000; // cursors expire after 24 hours (CONVENTIONS.md)

/** Opaque cursor: the id of the last row returned, plus when it was issued. */
export function encodeCursor(id: string, now = Date.now()): string {
  return Buffer.from(JSON.stringify({ i: id, t: now })).toString("base64url");
}

export function decodeCursor(
  raw: string | undefined,
  now = Date.now(),
): string | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      i?: unknown;
      t?: unknown;
    };
    if (
      typeof v.i === "string" &&
      typeof v.t === "number" &&
      now - v.t <= MAX_AGE_MS
    )
      return v.i;
  } catch {
    /* fall through */
  }
  throw new BadRequestException({
    code: "BAD_REQUEST",
    message: "That page link has expired. Reload the list.",
  });
}

export function clampLimit(raw: number | string | undefined, def = 20): number {
  const n = Number(raw ?? def);
  if (!Number.isFinite(n)) return def;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

/** Takes limit+1 rows, returns the page and the cursor for the next one. */
export function pageOf<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor:
      rows.length > limit ? encodeCursor(items[items.length - 1].id) : null,
  };
}
