import type { PrismaService } from "../common/prisma/prisma.service";

export type InFlight =
  | { state: "done"; statusCode: number | null; body: unknown }
  | { state: "gone" }
  | { state: "timeout" };

/**
 * A second request with the same Idempotency-Key arrived while the first is still running (CONVENTIONS: the same key
 * returns the first result). Wait for the first to finish and hand back what it stored, so a parallel retry never sees
 * a 409. "gone" means the first one failed and removed its record: the caller starts its own run. "timeout" is the
 * caller's old REQUEST_IN_PROGRESS. Reads only; never called inside a transaction.
 */
export async function waitForInFlight(
  prisma: PrismaService,
  actorId: string,
  key: string,
  maxMs = 15_000,
): Promise<InFlight> {
  const until = Date.now() + maxMs;
  let pause = 25;
  while (Date.now() < until) {
    const rec = await prisma.idempotencyRecord.findUnique({
      where: { actorId_key: { actorId, key } },
    });
    if (!rec) return { state: "gone" };
    if (rec.completedAt)
      return {
        state: "done",
        statusCode: rec.statusCode,
        body: rec.responseBody,
      };
    await new Promise((r) => setTimeout(r, pause));
    pause = Math.min(pause * 2, 200);
  }
  return { state: "timeout" };
}
