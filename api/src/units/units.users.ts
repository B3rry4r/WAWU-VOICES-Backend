import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { VoicesUser } from "../common/auth/voices-user";
import { apiError } from "./units.errors";

export interface UnitsUser {
  id: string;
  handle: string;
  status: string;
  email: string | null;
}

/** Maps the verified token (sub) to the VOICES person. The id never comes from the client. */
@Injectable()
export class UnitsUsers {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: VoicesUser | undefined): Promise<UnitsUser> {
    if (!user) throw apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    const u = await this.prisma.user.findUnique({
      where: { wawuId: user.sub },
      select: { id: true, handle: true, status: true },
    });
    if (!u)
      throw apiError(403, "FORBIDDEN", "Finish your profile first.", {
        reason: "PROFILE_REQUIRED",
      });
    return { ...u, email: user.email };
  }

  /** Writes are refused for a suspended, banned or deleted account (reads stay open). */
  assertCanWrite(u: UnitsUser): void {
    if (["SUSPENDED", "BANNED", "DELETED"].includes(u.status))
      throw apiError(
        403,
        "ACCOUNT_SUSPENDED",
        "This account cannot do that right now.",
      );
  }
}
