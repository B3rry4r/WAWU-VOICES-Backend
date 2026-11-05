import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { VoicesUser } from "../../common/auth/voices-user";
import type { User, VoicesRole } from "../../generated/prisma/client";

export type Profile = User & { roleNames: VoicesRole[] };

/** Maps the verified WAWU ID `sub` to the VOICES user (a "finished profile"). */
@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async find(user: VoicesUser | undefined): Promise<Profile | null> {
    if (!user) return null;
    const row = await this.prisma.user.findUnique({
      where: { wawuId: user.sub },
      include: { roles: true },
    });
    if (!row || row.status === "DELETED") return null;
    const { roles, ...rest } = row;
    return { ...rest, roleNames: roles.map((r) => r.role) };
  }

  /** For reads that add personal fields: the profile or null, never throws. */
  async optional(user: VoicesUser | undefined): Promise<Profile | null> {
    return this.find(user);
  }

  /** For every write: a finished profile that is not suspended. */
  async requireWriter(user: VoicesUser | undefined): Promise<Profile> {
    const p = await this.find(user);
    if (!p || p.status === "DELETION_PENDING")
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Finish setting up your profile first.",
        details: { reason: "PROFILE_REQUIRED" },
      });
    const suspendedNow =
      p.status === "BANNED" ||
      (p.status === "SUSPENDED" &&
        (!p.suspendedUntil || p.suspendedUntil > new Date()));
    if (suspendedNow)
      throw new ForbiddenException({
        code: "ACCOUNT_SUSPENDED",
        message: "Your account is suspended.",
        details: { until: p.suspendedUntil?.toISOString() ?? null },
      });
    return p;
  }

  hasRole(p: Profile, ...roles: VoicesRole[]): boolean {
    return (
      p.roleNames.includes("ADMIN") ||
      roles.some((r) => p.roleNames.includes(r))
    );
  }
}
