import { BadRequestException } from "@nestjs/common";

/** Opaque keyset cursor: (sort key, id), good for 24 hours (CONVENTIONS, "Cursor pages"). */
const TTL_MS = 24 * 60 * 60 * 1000;

export interface CursorKey {
  /** The sort key as an ISO string (or a YYYY-MM-DD date). */
  k: string;
  id: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify({ ...key, t: Date.now() })).toString(
    "base64url",
  );
}

export function decodeCursor(raw: string | undefined): CursorKey | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      k?: unknown;
      id?: unknown;
      t?: unknown;
    };
    if (
      typeof v.k !== "string" ||
      typeof v.id !== "string" ||
      typeof v.t !== "number" ||
      Date.now() - v.t > TTL_MS
    )
      throw new Error("bad cursor");
    return { k: v.k, id: v.id };
  } catch {
    throw new BadRequestException({
      code: "BAD_REQUEST",
      message: "That page link has expired. Reload the list.",
    });
  }
}

/** 1 to 50, default 20. */
export function pageLimit(raw: number | string | undefined): number {
  const n = Number(raw ?? 20);
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(1, Math.floor(n)));
}
