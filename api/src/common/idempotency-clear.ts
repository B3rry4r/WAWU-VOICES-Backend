import type { Prisma } from "../generated/prisma/client";

/** What a retry record answers with once the post it made is gone (`IdempotencyService.run` turns it into a 404). */
export const GONE_BODY = { gone: true } as const;

/**
 * V-HOTFIX-1 round 3: when a post is deleted by its author or removed by a moderator, the retry record of the request
 * that made it stops holding the post's text. The record itself stays (a replay still cannot post or charge again).
 */
export async function clearPostRecord(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  authorId: string,
  kind: "answer" | "reply",
  postId: string,
): Promise<void> {
  const path = kind === "answer" ? "{answer,id}" : "{reply,id}";
  await tx.$executeRaw`
    UPDATE "IdempotencyRecord" SET "responseBody" = ${JSON.stringify(GONE_BODY)}::jsonb
    WHERE "actorId" = ${authorId} AND "responseBody" IS NOT NULL
      AND "responseBody" #>> ${path}::text[] = ${postId}`;
}
