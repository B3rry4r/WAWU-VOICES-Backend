import { createHmac, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import type { PrismaService } from "../common/prisma/prisma.service";
import { phonePepper } from "../me/phone";

/** A clip counts as finished once this share of it was played (LISTEN-1, LS1). */
export const FINISHED_SHARE = 0.9;

const VISITOR_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The key a guest is stored under: HMAC-SHA256 of the random id the browser keeps in its own first-party cookie,
 * keyed by a server secret. The id itself is never stored and neither is an IP. Returns null when the header is
 * missing or is not a plain random id (a guest then still counts as a start, but no record is kept).
 */
export function visitorKeyOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !VISITOR_ID.test(raw)) return null;
  return createHmac("sha256", phonePepper())
    .update(`listen-visitor:${raw}`)
    .digest("hex");
}

export interface ListenWho {
  userId: string | null;
  visitorKey: string | null;
}

/**
 * Seconds to store and whether the clip is finished. The server decides "finished" from the clip's own length when it
 * knows it (at least 90% played, seconds capped at the length); a client that says finished is believed only for a
 * clip with no stored length.
 */
export function playedOf(
  secondsPlayed: number,
  claimedFinished: boolean,
  durationMs: number | null,
): { seconds: number; finished: boolean } {
  if (!durationMs || durationMs <= 0)
    return { seconds: secondsPlayed, finished: claimedFinished };
  const seconds = Math.min(secondsPlayed, Math.ceil(durationMs / 1000));
  return {
    seconds,
    finished: seconds * 1000 >= durationMs * FINISHED_SHARE,
  };
}

/**
 * One record per person per answer. The maximum seconds is kept (never lowered) and finished never goes back to
 * false. Two plain statements, no interactive transaction: an INSERT that does nothing if the row exists, then an
 * UPDATE that locks the row, so twenty parallel reports from one person make one row and see each other's values.
 * Returns true when this call is the one that made the row finished.
 */
export async function upsertListen(
  prisma: PrismaService,
  answerId: string,
  who: ListenWho,
  seconds: number,
  finished: boolean,
): Promise<boolean> {
  const match = who.userId
    ? Prisma.sql`"userId" = ${who.userId}`
    : Prisma.sql`"visitorKey" = ${who.visitorKey}`;
  await prisma.$executeRaw`
    INSERT INTO "AnswerListen" ("id", "answerId", "userId", "visitorKey", "secondsPlayed", "finished", "firstAt", "lastAt")
    VALUES (${randomUUID()}, ${answerId}, ${who.userId}, ${who.visitorKey}, 0, false, now(), now())
    ON CONFLICT DO NOTHING`;
  const rows = await prisma.$queryRaw<{ was: boolean; now: boolean }[]>`
    UPDATE "AnswerListen" t
    SET "secondsPlayed" = GREATEST(t."secondsPlayed", ${seconds}::int),
        "finished" = t."finished" OR ${finished}::boolean,
        "lastAt" = now()
    FROM (SELECT id, "finished" FROM "AnswerListen" WHERE "answerId" = ${answerId} AND ${match} FOR UPDATE) o
    WHERE t.id = o.id
    RETURNING o."finished" AS was, t."finished" AS now`;
  return rows.length > 0 && !rows[0].was && rows[0].now;
}
