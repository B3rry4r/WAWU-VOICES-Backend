import { Global, Inject, Injectable, Module, Optional } from "@nestjs/common";
import type { FileKind } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { MEDIA_STORE, SpacesStore, type ObjectStore } from "./object-store";

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
    if (file.confirmedAt) return true;
    if (!this.store) return false;
    const size = await this.store.head(file.key);
    if (size === null) return false;
    if (file.bytes !== null && size !== file.bytes) return false;
    await this.prisma.storedFile.updateMany({
      where: { id: file.id, confirmedAt: null },
      data: { confirmedAt: new Date() },
    });
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
