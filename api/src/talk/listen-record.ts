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

/** Seconds of slack added to the time the server has seen, for the delay before the first report reaches it. */
const SLACK_SECONDS = 2;

/**
 * One record per person per answer. The maximum seconds is kept (never lowered) and finished never goes back to false.
 * Two plain statements, no interactive transaction: an INSERT that does nothing if the row exists, then an UPDATE that
 * locks the row, so twenty parallel reports from one person make one row and see each other's values.
 *
 * Lead ruling LS, 6 Nov (LS8): the server decides finished, from time it has seen. The row's firstAt is its first
 * report. The seconds credited are min(what the client claims, the clip's length, (now - firstAt) + 2 s), so nobody can
 * finish a clip faster than it plays. finished = credited at least 90% of the clip. The call that makes the row can
 * never finish it (a report with no earlier start). A clip with no stored length is never finished.
 * Returns true when this call is the one that made the row finished.
 */
export async function upsertListen(
  prisma: PrismaService,
  answerId: string,
  who: ListenWho,
  claimedSeconds: number,
  clipMs: number | null,
): Promise<boolean> {
  const match = who.userId
    ? Prisma.sql`"userId" = ${who.userId}`
    : Prisma.sql`"visitorKey" = ${who.visitorKey}`;
  const len = clipMs && clipMs > 0 ? clipMs : 0;
  const cap = len ? Math.ceil(len / 1000) : 86_400;
  const made = await prisma.$executeRaw`
    INSERT INTO "AnswerListen" ("id", "answerId", "userId", "visitorKey", "secondsPlayed", "finished", "firstAt", "lastAt")
    VALUES (${randomUUID()}, ${answerId}, ${who.userId}, ${who.visitorKey}, 0, false, now(), now())
    ON CONFLICT DO NOTHING`;
  const canFinish = made === 0 && len > 0;
  const rows = await prisma.$queryRaw<{ was: boolean; now: boolean }[]>`
    UPDATE "AnswerListen" t
    SET "secondsPlayed" = GREATEST(t."secondsPlayed", o.credited),
        "finished" = t."finished" OR (${canFinish}::boolean AND GREATEST(t."secondsPlayed", o.credited) * 1000 >= ${len}::int * ${FINISHED_SHARE}::float8),
        "lastAt" = now()
    FROM (
      SELECT id, "finished",
             LEAST(${claimedSeconds}::int, ${cap}::int, floor(extract(epoch FROM (now() - "firstAt")))::int + ${SLACK_SECONDS}) AS credited
      FROM "AnswerListen" WHERE "answerId" = ${answerId} AND ${match} FOR UPDATE) o
    WHERE t.id = o.id
    RETURNING o."finished" AS was, t."finished" AS now`;
  return rows.length > 0 && !rows[0].was && rows[0].now;
}
