import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { FileKind } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  MEDIA_STORE,
  SpacesStore,
  publishPhoto,
  type ObjectStore,
} from "./object-store";

/** The part of a Prisma transaction client that attaching a file needs. */
export interface FileTx {
  storedFile: PrismaService["storedFile"];
}

/**
 * Privacy fix PF2: attaching an uploaded file to a row (avatar, result photo, ad creative, override image).
 * - confirm(): the same checks the /uploads/:id/complete route makes (the person's own file, the right kind, the object
 *   is in the bucket at the size that was signed). A file the person never completed is confirmed here.
 * - claim(): called INSIDE the transaction that writes the reference. It UPDATEs the StoredFile row, so it takes the
 *   row lock. The storage purge claims rows FOR UPDATE SKIP LOCKED: it either holds the lock first (this waits, then
 *   sees purgedAt and refuses), or this holds it first (the purge skips the row). It also clears purgeRequestedAt.
 */
@Injectable()
export class FileAttachService {
  private readonly logger = new Logger(FileAttachService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(MEDIA_STORE) private readonly store: ObjectStore | null,
  ) {}

  async confirm(
    fileId: string,
    want: { kind: FileKind; ownerId?: string },
  ): Promise<boolean> {
    const file = await this.prisma.storedFile.findFirst({
      where: {
        id: fileId,
        kind: want.kind,
        ...(want.ownerId ? { ownerId: want.ownerId } : {}),
        purgedAt: null,
      },
    });
    if (!file) return false;
    if (file.confirmedAt) {
      // Retry: a photo whose first makePublic failed is made public on its next attach.
      if (this.store) await publishPhoto(this.store, file, this.logger);
      return true;
    }
    if (!this.store) return false;
    let size: number | null;
    try {
      size = await this.store.head(file.key);
    } catch (e) {
      // An unreachable bucket is our side being down, not a bad request and not a 500.
      this.logger.error(
        `confirm ${file.id}: storage check failed: ${String(e)}`,
      );
      throw new ServiceUnavailableException({
        code: "UNAVAILABLE",
        message: "Uploads are not available right now. Try again in a minute.",
      });
    }
    if (size === null) return false;
    if (file.bytes !== null && size !== file.bytes) return false;
    await this.prisma.storedFile.updateMany({
      where: { id: file.id, confirmedAt: null },
      data: { confirmedAt: new Date() },
    });
    // Photos are read through the public CDN link, so the object is made public-read here. A failure is logged and
    // never fails the attach.
    await publishPhoto(this.store, file, this.logger);
    return true;
  }

  /** False when the file is already gone from the bucket (the purge got there first). */
  async claim(tx: FileTx, fileId: string): Promise<boolean> {
    const r = await tx.storedFile.updateMany({
      where: { id: fileId, purgedAt: null, confirmedAt: { not: null } },
      data: { purgeRequestedAt: null },
    });
    return r.count === 1;
  }
}

@Global()
@Module({
  providers: [
    { provide: MEDIA_STORE, useFactory: () => SpacesStore.fromEnv() },
    FileAttachService,
  ],
  exports: [FileAttachService],
})
export class FileAttachModule {}
