import type { PrismaService } from "../common/prisma/prisma.service";

export interface AuthorRef {
  id: string;
  handle: string;
  displayName: string | null;
  state: string | null;
  avatarUrl: string | null;
}

interface AuthorRow {
  id: string;
  handle: string;
  displayName: string | null;
  state: string | null;
  avatarFileId: string | null;
}

export const AUTHOR_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  state: true,
  avatarFileId: true,
} as const;

/** Avatars are public images on the CDN; null when there is none (or no CDN configured). */
export async function authorRefs(
  prisma: PrismaService,
  rows: AuthorRow[],
): Promise<Map<string, AuthorRef>> {
  const base = process.env.SPACES_CDN_BASE?.replace(/\/$/, "");
  const fileIds = [
    ...new Set(rows.map((r) => r.avatarFileId).filter(Boolean)),
  ] as string[];
  const files = fileIds.length
    ? await prisma.storedFile.findMany({
        where: { id: { in: fileIds }, kind: "AVATAR" },
        select: { id: true, key: true },
      })
    : [];
  const keyById = new Map(files.map((f) => [f.id, f.key]));
  const out = new Map<string, AuthorRef>();
  for (const r of rows) {
    const key = r.avatarFileId ? keyById.get(r.avatarFileId) : undefined;
    out.set(r.id, {
      id: r.id,
      handle: r.handle,
      displayName: r.displayName,
      state: r.state,
      avatarUrl: base && key ? `${base}/${key}` : null,
    });
  }
  return out;
}
