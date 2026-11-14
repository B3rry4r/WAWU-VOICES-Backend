import { isVerifiedNow } from "../verify/verified";
import type { PrismaService } from "../common/prisma/prisma.service";
import { avatarUrls } from "../common/people";

export interface AuthorRef {
  id: string;
  handle: string;
  displayName: string | null;
  state: string | null;
  avatarUrl: string | null;
  verified?: boolean;
}

interface AuthorRow {
  id: string;
  handle: string;
  displayName: string | null;
  state: string | null;
  avatarFileId: string | null;
  status: string | null;
  verifiedUntil?: Date | null;
  verificationStatus?: string | null;
}

export const AUTHOR_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  state: true,
  avatarFileId: true,
  status: true,
  verifiedUntil: true,
  verificationStatus: true,
} as const;

/** Avatars are public images on the CDN; null when there is none (or no CDN configured). */
export async function authorRefs(
  prisma: PrismaService,
  rows: AuthorRow[],
): Promise<Map<string, AuthorRef>> {
  const urls = await avatarUrls(prisma, rows);
  const out = new Map<string, AuthorRef>();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      handle: r.handle,
      displayName: r.displayName,
      state: r.state,
      avatarUrl: urls.get(r.id) ?? null,
      verified: isVerifiedNow({
        verifiedUntil: r.verifiedUntil ?? null,
        verificationStatus: r.verificationStatus,
      }),
    });
  }
  return out;
}
