import type { PrismaService } from "./prisma/prisma.service";

/**
 * The one place a person's picture address is built (V-PEOPLE-ON-POSTS). Every answer, reply, list card, search row,
 * vote, DM partner and share page reads it from here. A picture is public on the CDN; no CDN base means no address.
 */
export function avatarUrl(key: string | null | undefined): string | null {
  const base = process.env.SPACES_CDN_BASE;
  return key && base ? `${base.replace(/\/$/, "")}/${key}` : null;
}

/** Only an active account shows its picture. Suspended, banned, deleting and deleted accounts show none. */
export function showsPicture(status: string | null | undefined): boolean {
  return status === "ACTIVE";
}

export interface PictureSource {
  id: string;
  avatarFileId: string | null;
  status: string | null;
}

type Db = Pick<PrismaService, "storedFile">;

/**
 * Picture addresses for many people with one query: person id to address or null. A person with no picture, a file
 * that is not an avatar or is already purged, or an account that may not show one maps to null.
 */
export async function avatarUrls(
  db: Db,
  people: Iterable<PictureSource>,
): Promise<Map<string, string | null>> {
  const list = [...people].filter((p) => showsPicture(p.status));
  const fileIds = [
    ...new Set(list.map((p) => p.avatarFileId).filter((x): x is string => !!x)),
  ];
  const files = fileIds.length
    ? await db.storedFile.findMany({
        where: { id: { in: fileIds }, kind: "AVATAR", purgedAt: null },
        select: { id: true, key: true },
      })
    : [];
  const keyById = new Map(files.map((f) => [f.id, f.key]));
  const out = new Map<string, string | null>();
  for (const p of list)
    out.set(
      p.id,
      avatarUrl(p.avatarFileId ? keyById.get(p.avatarFileId) : null),
    );
  return out;
}
