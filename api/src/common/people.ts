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

type Db = Pick<PrismaService, "storedFile" | "userRoleGrant">;

/** What comes with a person's name on a post: their picture address and the Admin mark. */
export interface Marks {
  avatarUrl: string | null;
  admin: boolean;
}
export const NO_MARKS: Marks = { avatarUrl: null, admin: false };
export type MarkMap = Map<string, Marks>;

/** The marks of one person, to spread into their shape. A person not looked up has none. */
export const markOf = (m: MarkMap, id: string): Marks => m.get(id) ?? NO_MARKS;

/**
 * Picture address and Admin mark for many people in two queries, however many people: person id to marks.
 * - avatarUrl: null for no picture, a file that is not an avatar or is purged, and any account that is not active.
 * - admin: true only while the person holds the ADMIN role right now (UserRoleGrant is read at request time, so taking
 *   the role away turns it off at once). Editors, moderators and ad managers are not marked.
 * A post made without a name never asks: its author is null and nothing here is read for it.
 */
export async function personMarks(
  db: Db,
  people: Iterable<PictureSource>,
): Promise<MarkMap> {
  const list = [...people];
  const fileIds = [
    ...new Set(
      list
        .filter((p) => showsPicture(p.status))
        .map((p) => p.avatarFileId)
        .filter((x): x is string => !!x),
    ),
  ];
  const ids = [...new Set(list.map((p) => p.id))];
  const [files, admins] = await Promise.all([
    fileIds.length
      ? db.storedFile.findMany({
          where: { id: { in: fileIds }, kind: "AVATAR", purgedAt: null },
          select: { id: true, key: true },
        })
      : [],
    ids.length
      ? db.userRoleGrant.findMany({
          where: { userId: { in: ids }, role: "ADMIN" },
          select: { userId: true },
        })
      : [],
  ]);
  const keyById = new Map(files.map((f) => [f.id, f.key]));
  const adminIds = new Set(admins.map((r) => r.userId));
  const out: MarkMap = new Map();
  for (const p of list)
    out.set(p.id, {
      avatarUrl:
        showsPicture(p.status) && p.avatarFileId
          ? avatarUrl(keyById.get(p.avatarFileId))
          : null,
      admin: adminIds.has(p.id),
    });
  return out;
}
