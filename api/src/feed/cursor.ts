import { BadRequestException } from "@nestjs/common";

const MAX_AGE_MS = 24 * 3_600_000; // cursors expire after 24 hours (CONVENTIONS.md)

/** Opaque cursor: the id of the last row returned, plus when it was issued. */
export function encodeCursor(
  id: string,
  now = Date.now(),
  carry?: string[],
): string {
  // `a` (optional): the ids of the admin-first block shown on page 1, so later pages leave out exactly those and no others.
  return Buffer.from(
    JSON.stringify(carry ? { i: id, t: now, a: carry } : { i: id, t: now }),
  ).toString("base64url");
}

/** Like decodeCursor, and also returns the admin-first ids a cursor carries (undefined for a cursor from before they existed). */
export function decodeCursorFull(
  raw: string | undefined,
  now = Date.now(),
): { id: string; carry?: string[] } | undefined {
  const id = decodeCursor(raw, now);
  if (id === undefined) return undefined;
  try {
    const v = JSON.parse(
      Buffer.from(raw as string, "base64url").toString("utf8"),
    ) as {
      a?: unknown;
    };
    if (
      Array.isArray(v.a) &&
      v.a.length <= 50 &&
      v.a.every((x) => typeof x === "string" && x.length <= 64)
    )
      return { id, carry: v.a as string[] };
  } catch {
    /* decodeCursor already accepted it */
  }
  return { id };
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
  carry?: string[],
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor:
      rows.length > limit
        ? encodeCursor(items[items.length - 1].id, Date.now(), carry)
        : null,
  };
}
