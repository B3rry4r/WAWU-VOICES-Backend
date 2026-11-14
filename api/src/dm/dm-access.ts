import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../common/prisma/prisma.service";
import { lagosDayString } from "../units/units.subscriptions";

/**
 * V-DM: THE gate for sending a direct message, in this one function. Today "verification is the subscription" (owner,
 * 14 Nov 2026), so a member may send while a subscription is running: status ACTIVE and its end day not yet reached
 * (the same test as `current` in GET /subscriptions/me). A plan that is only QUEUED does not count yet.
 *
 * When V-VERIFY merges, the lead replaces the body of this function with the verified check
 * (`isVerifiedNow` from api/src/verify/verified.ts). Nothing else in the module decides who may send.
 * Receiving and reading are open to every signed-in member and never come through here.
 */
export async function canSendDm(
  prisma: Pick<PrismaService, "subscription">,
  memberId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const running = await prisma.subscription.findFirst({
    where: {
      userId: memberId,
      status: "ACTIVE",
      endDay: { gt: lagosDayString(now) },
    },
    select: { id: true },
  });
  return !!running;
}

/** The refusal for a sender who may not send: 403 verification_required. */
export function verificationRequired(): ForbiddenException {
  return new ForbiddenException({
    code: "verification_required",
    message: "Subscribe and get verified to send messages.",
  });
}
