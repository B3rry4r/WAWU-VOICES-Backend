import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../common/prisma/prisma.service";
import { isVerifiedNow } from "../verify/verified";

/**
 * V-DM: THE gate for sending a direct message, in this one function. Verification is the subscription (owner, 14 Nov
 * 2026): a member may send while they are verified now, which `isVerifiedNow` (api/src/verify/verified.ts, V-46) says:
 * an admin approved their ID and bill (status APPROVED) AND their subscription chain has not ended (`verifiedUntil` in
 * the future). A subscriber whose ID is not approved yet, a rejected or expired request, and a lapsed plan are all no.
 * Nothing else in the module decides who may send. Receiving and reading are open to every signed-in member.
 */
export async function canSendDm(
  prisma: Pick<PrismaService, "user">,
  memberId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: memberId },
    select: { verifiedUntil: true, verificationStatus: true },
  });
  return !!u && isVerifiedNow(u, now);
}

/** The refusal for a sender who may not send: 403 verification_required. */
export function verificationRequired(): ForbiddenException {
  return new ForbiddenException({
    code: "verification_required",
    message: "Subscribe and get verified to send messages.",
  });
}
