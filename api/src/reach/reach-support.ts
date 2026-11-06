import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { PrismaService } from "../common/prisma/prisma.service";

/** Cursors are opaque, keyset on (time, id), and lapse after 24 hours (CONVENTIONS.md, "Cursor pages"). */
const CURSOR_TTL_MS = 24 * 60 * 60 * 1000;

export interface CursorPoint {
  t: string;
  id: string;
}

export function encodeCursor(point: CursorPoint, now = Date.now()): string {
  return Buffer.from(JSON.stringify({ ...point, iat: now })).toString(
    "base64url",
  );
}

export function decodeCursor(
  raw: string | undefined,
  now = Date.now(),
): { at: Date; id: string } | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      t?: unknown;
      id?: unknown;
      iat?: unknown;
    };
    const at = new Date(String(p.t));
    if (
      typeof p.t !== "string" ||
      typeof p.id !== "string" ||
      typeof p.iat !== "number" ||
      Number.isNaN(at.getTime()) ||
      now - p.iat > CURSOR_TTL_MS
    )
      throw new Error("bad cursor");
    return { at, id: p.id };
  } catch {
    throw new BadRequestException({
      code: "BAD_REQUEST",
      message: "That page link has expired. Start again from the top.",
    });
  }
}

/** Notification text and share text never carry an em-dash or en-dash (V-13). */
export function plain(text: string): string {
  return text.replace(/[–—]/g, "-");
}

export function validationFailed(
  path: string,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: "VALIDATION_FAILED",
    message: "Some details need fixing.",
    details: { fields: [{ path, message }] },
  });
}

/** The VOICES user row behind a WAWU ID token. No row means no finished profile: 403 PROFILE_REQUIRED. */
export async function requireProfile(
  prisma: PrismaService,
  sub: string,
): Promise<{ id: string; status: string }> {
  const user = await prisma.user.findUnique({
    where: { wawuId: sub },
    select: { id: true, status: true },
  });
  if (!user)
    throw new ForbiddenException({
      code: "FORBIDDEN",
      message: "Finish your profile first.",
      details: { reason: "PROFILE_REQUIRED" },
    });
  return user;
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

/**
 * A short curly-quoted quote of someone's words for a notification: the first `max` characters, cut at a word when it
 * has to be cut, with an ellipsis inside the quotes (lead ruling WF, 6 Nov, RW7).
 */
export function quoteOf(
  text: string | null | undefined,
  max = 60,
): string | null {
  const t = plain((text ?? "").replace(/\s+/g, " ").trim());
  if (!t) return null;
  const chars = [...t];
  if (chars.length <= max) return `\u201c${t}\u201d`;
  let cut = chars.slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  if (space > max / 2) cut = cut.slice(0, space);
  return `\u201c${cut.trimEnd()}\u2026\u201d`;
}
