import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { MEDIA_STORE, type ObjectStore } from "./object-store";

const HOUR = 60 * 60 * 1000;
/** A presigned upload is good for minutes; an object still unconfirmed after this long is abandoned. */
export const PENDING_UPLOAD_MAX_AGE_MS = 24 * HOUR;

export interface StoragePurgeCounts {
  removedClips: number;
  pendingClips: number;
  requestedFiles: number;
  pendingFiles: number;
  objectsDeleted: number;
  failed: number;
}

interface Row {
  id: string;
  keys: string[];
}

/**
 * Privacy fix P3: the timed job that deletes the files behind rows VOICES no longer shows. It removes, from Spaces:
 * - voice clips marked REMOVED (raw and normalised files);
 * - avatar files that were replaced and avatar and result-sheet files of purged people (StoredFile.purgeRequestedAt);
 * - uploads that never finished (PENDING_UPLOAD clips and unconfirmed files) after 24 hours.
 * Every row is claimed with FOR UPDATE SKIP LOCKED inside its own transaction, so two processes never take the same
 * row, and it is marked (storagePurgedAt / purgedAt) in the same transaction as the deletes, so no file is deleted
 * twice. A failed delete leaves the row unmarked for the next run. Deleting a missing key is not an error in S3.
 */
@Injectable()
export class StoragePurgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoragePurgeService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORE) private readonly store: ObjectStore | null,
  ) {}

  onModuleInit(): void {
    const every = Number(process.env.STORAGE_PURGE_INTERVAL_MS ?? 900_000);
    if (process.env.NODE_ENV === "test" || !(every > 0)) return;
    this.timer = setInterval(() => {
      this.run().catch((e) => this.logger.error(String(e)));
    }, every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date(), batch = 50): Promise<StoragePurgeCounts> {
    const counts: StoragePurgeCounts = {
      removedClips: 0,
      pendingClips: 0,
      requestedFiles: 0,
      pendingFiles: 0,
      objectsDeleted: 0,
      failed: 0,
    };
    if (!this.store) {
      this.logger.warn("storage purge skipped: no object store configured");
      return counts;
    }
    const cutoff = new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS);
    await this.sweep(
      counts,
      "removedClips",
      batch,
      (tx, ex, n) => this.claimClips(tx, ex, n, "REMOVED", null),
      "VoiceClip",
      now,
    );
    await this.sweep(
      counts,
      "pendingClips",
      batch,
      (tx, ex, n) => this.claimClips(tx, ex, n, "PENDING_UPLOAD", cutoff),
      "VoiceClip",
      now,
    );
    await this.sweep(
      counts,
      "requestedFiles",
      batch,
      (tx, ex, n) => this.claimFiles(tx, ex, n, "requested", cutoff),
      "StoredFile",
      now,
    );
    await this.sweep(
      counts,
      "pendingFiles",
      batch,
      (tx, ex, n) => this.claimFiles(tx, ex, n, "pending", cutoff),
      "StoredFile",
      now,
    );
    this.logger.log(
      `storage purge: ${counts.removedClips} removed clips, ${counts.pendingClips} abandoned clip uploads, ` +
        `${counts.requestedFiles} replaced or purged files, ${counts.pendingFiles} abandoned file uploads, ` +
        `${counts.objectsDeleted} objects deleted, ${counts.failed} failed`,
    );
    return counts;
  }

  private async sweep(
    counts: StoragePurgeCounts,
    field: keyof StoragePurgeCounts,
    batch: number,
    claim: (tx: PrismaService, exclude: string[], n: number) => Promise<Row[]>,
    table: "VoiceClip" | "StoredFile",
    now: Date,
  ): Promise<void> {
    const failedIds: string[] = [];
    for (;;) {
      let got = 0;
      await this.prisma.$transaction(
        async (tx) => {
          const rows = await claim(
            tx as unknown as PrismaService,
            failedIds,
            batch,
          );
          got = rows.length;
          const done: string[] = [];
          for (const r of rows) {
            try {
              for (const k of r.keys) {
                await (this.store as ObjectStore).delete(k);
                counts.objectsDeleted++;
              }
              done.push(r.id);
            } catch (e) {
              counts.failed++;
              failedIds.push(r.id);
              this.logger.error(`storage purge ${table} ${r.id}: ${String(e)}`);
            }
          }
          if (done.length) {
            if (table === "VoiceClip")
              await tx.$executeRaw`UPDATE "VoiceClip" SET "storagePurgedAt" = ${now} WHERE id = ANY(${done})`;
            else
              await tx.$executeRaw`UPDATE "StoredFile" SET "purgedAt" = ${now} WHERE id = ANY(${done})`;
            counts[field] += done.length;
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      if (got < batch) break;
    }
  }

  private async claimClips(
    tx: PrismaService,
    exclude: string[],
    n: number,
    status: "REMOVED" | "PENDING_UPLOAD",
    olderThan: Date | null,
  ): Promise<Row[]> {
    const rows = olderThan
      ? await tx.$queryRaw<
          { id: string; rawKey: string; playKey: string | null }[]
        >`SELECT id, "rawKey", "playKey" FROM "VoiceClip"
          WHERE status = ${status}::"VoiceClipStatus" AND "storagePurgedAt" IS NULL
            AND "createdAt" < ${olderThan} AND NOT (id = ANY(${exclude}))
          ORDER BY "createdAt" LIMIT ${n} FOR UPDATE SKIP LOCKED`
      : await tx.$queryRaw<
          { id: string; rawKey: string; playKey: string | null }[]
        >`SELECT id, "rawKey", "playKey" FROM "VoiceClip"
          WHERE status = ${status}::"VoiceClipStatus" AND "storagePurgedAt" IS NULL
            AND NOT (id = ANY(${exclude}))
          ORDER BY "createdAt" LIMIT ${n} FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => ({
      id: r.id,
      keys: [r.rawKey, r.playKey].filter((k): k is string => !!k),
    }));
  }

  private async claimFiles(
    tx: PrismaService,
    exclude: string[],
    n: number,
    which: "requested" | "pending",
    olderThan: Date,
  ): Promise<Row[]> {
    const rows =
      which === "requested"
        ? await tx.$queryRaw<{ id: string; key: string }[]>`
            SELECT id, key FROM "StoredFile"
            WHERE "purgeRequestedAt" IS NOT NULL AND "purgedAt" IS NULL AND NOT (id = ANY(${exclude}))
            ORDER BY "purgeRequestedAt" LIMIT ${n} FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<{ id: string; key: string }[]>`
            SELECT id, key FROM "StoredFile"
            WHERE "confirmedAt" IS NULL AND "purgedAt" IS NULL AND "createdAt" < ${olderThan}
              AND NOT (id = ANY(${exclude}))
            ORDER BY "createdAt" LIMIT ${n} FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => ({ id: r.id, keys: [r.key] }));
  }
}
