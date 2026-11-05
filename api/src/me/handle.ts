import { UnprocessableEntityException } from "@nestjs/common";

/** Handles are stored lower case: 3 to 20 of a-z 0-9 . _ (contract, User.handle). */
export const HANDLE_RE = /^[a-z0-9._]{3,20}$/;

/**
 * Words nobody may take as a handle. A handle is also refused when, with dots and underscores removed, it equals one
 * of these or starts with a brand word, so "v.o.i.c.e.s" and "voices_team" do not slip through.
 */
const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "staff",
  "team",
  "official",
  "moderator",
  "mod",
  "editor",
  "editors",
  "news",
  "newsroom",
  "desk",
  "press",
  "security",
  "billing",
  "payments",
  "wallet",
  "api",
  "www",
  "me",
  "you",
  "null",
  "undefined",
  "anonymous",
  "anon",
  "guest",
  "deleted",
  "inec",
  "police",
  "nigeria",
  "ceo",
]);
const BRAND_PREFIXES = ["wawu", "voices"];

export type HandleProblem =
  "TOO_SHORT" | "TOO_LONG" | "BAD_CHARACTERS" | "BAD_SHAPE" | "RESERVED";

export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

/** Returns the reason a (normalised) handle is not allowed, or null when its shape is fine. */
export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < 3) return "TOO_SHORT";
  if (handle.length > 20) return "TOO_LONG";
  if (!HANDLE_RE.test(handle)) return "BAD_CHARACTERS";
  if (/^[._]|[._]$|[._]{2}/.test(handle)) return "BAD_SHAPE";
  const squashed = handle.replace(/[._]/g, "");
  if (RESERVED.has(squashed) || RESERVED.has(handle)) return "RESERVED";
  if (BRAND_PREFIXES.some((p) => squashed.startsWith(p))) return "RESERVED";
  return null;
}

export const HANDLE_MESSAGES: Record<HandleProblem | "TAKEN", string> = {
  TOO_SHORT: "A handle needs at least 3 characters.",
  TOO_LONG: "A handle can have at most 20 characters.",
  BAD_CHARACTERS: "Use only letters, numbers, dots and underscores.",
  BAD_SHAPE: "A handle cannot start or end with a dot or underscore.",
  RESERVED: "That handle is not available.",
  TAKEN: "That handle is taken.",
};

/** Normalises and validates a handle for a write: 422 VALIDATION_FAILED with the field and the reason. */
export function assertHandleShape(raw: string, path = "handle"): string {
  const handle = normaliseHandle(raw);
  const problem = handleProblem(handle);
  if (problem)
    throw new UnprocessableEntityException({
      code: "VALIDATION_FAILED",
      message: "Some details need fixing.",
      details: {
        fields: [{ path, message: HANDLE_MESSAGES[problem] }],
        reason: problem,
      },
    });
  return handle;
}
