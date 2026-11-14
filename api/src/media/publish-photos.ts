import type { PrismaClient } from "../generated/prisma/client";
import {
  PUBLIC_FILE_KINDS,
  PUBLIC_KEY_PREFIX,
  type ObjectStore,
} from "./object-store";

export interface PublishResult {
  total: number;
  made: number;
  failed: number;
  missing: number;
}

/**
 * One-off backfill: every confirmed, not-purged photo in the database (file/ keys, the public kinds) is set to
 * public-read. Uses the database's file records, so the key never needs list rights. Safe to run again: setting
 * public-read on a public object changes nothing. A file the bucket no longer has is counted, not an error.
 */
export async function publishExistingPhotos(
  prisma: Pick<PrismaClient, "storedFile">,
  store: ObjectStore,
  log: (m: string) => void = () => undefined,
): Promise<PublishResult> {
  const r: PublishResult = { total: 0, made: 0, failed: 0, missing: 0 };
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.storedFile.findMany({
      where: {
        kind: { in: [...PUBLIC_FILE_KINDS] as never[] },
        key: { startsWith: PUBLIC_KEY_PREFIX },
        confirmedAt: { not: null },
        purgedAt: null,
      },
      orderBy: { id: "asc" },
      take: 200,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, key: true },
    });
    if (rows.length === 0) break;
    for (const f of rows) {
      r.total++;
      try {
        await store.makePublic(f.key);
        r.made++;
      } catch (e) {
        const c = e as {
          name?: string;
          $metadata?: { httpStatusCode?: number };
        };
        if (c.name === "NoSuchKey" || c.$metadata?.httpStatusCode === 404)
          r.missing++;
        else {
          r.failed++;
          log(`failed ${f.id}: ${String(e)}`);
        }
      }
    }
    after = rows[rows.length - 1].id;
  }
  return r;
}
