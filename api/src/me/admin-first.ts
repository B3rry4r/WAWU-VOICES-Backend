import { PrismaService } from "../common/prisma/prisma.service";

/**
 * V-ADMIN-FIRST (owner order, 14 Nov): under a question and in a thread, the NAMED posts of a person who has the ADMIN
 * role now are listed first, newest first, before everyone else's. Only the two lists that page a question's answers and
 * an answer's replies use this; Home, profiles, search and the weekly report are not reordered.
 *
 * The role is read at request time from the role table (one query per request, never per row), so taking it away puts the
 * person's posts back in their normal places at once. Nothing is stored on a post.
 */

/** At most this many admin posts are put on top of one list. Older ones stay in their normal place (never dropped). */
export const ADMIN_FIRST_CAP = 20;

/** The ids of everyone who has the ADMIN role right now. A handful of rows: the whole table is read in one query. */
export async function adminIdsOf(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.userRoleGrant.findMany({
    where: { role: "ADMIN" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
