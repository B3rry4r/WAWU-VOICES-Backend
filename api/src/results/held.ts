import type { PrismaService } from "../common/prisma/prisma.service";

/**
 * H6: ids of posted results that were sent to moderation and still have an open item there. They are the moderators'
 * to settle, so they are not counted or listed as "to check" in Posted results while that item is open.
 */
export async function resultsHeldForModeration(
  prisma: Pick<PrismaService, "moderationItem">,
): Promise<string[]> {
  const rows = await prisma.moderationItem.findMany({
    where: { targetType: "RESULT_POST", status: "OPEN" },
    select: { targetId: true },
  });
  return rows.map((r) => r.targetId);
}
