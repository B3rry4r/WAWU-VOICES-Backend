import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { VoicesUser } from "../common/auth/voices-user";
import type { VoicesRole } from "../generated/prisma/client";

export interface Actor {
  id: string;
  handle: string;
  roles: VoicesRole[];
}

/** Who is calling, as a VOICES row: finished profile, account standing, roles. */
@Injectable()
export class ActorService {
  constructor(private readonly prisma: PrismaService) {}

  /** Reads and writes need a finished profile (403 PROFILE_REQUIRED). A write also needs standing (403 ACCOUNT_SUSPENDED). */
  async resolve(user: VoicesUser, opts: { write: boolean }): Promise<Actor> {
    const row = await this.prisma.user.findUnique({
      where: { wawuId: user.sub },
      select: {
        id: true,
        handle: true,
        status: true,
        suspendedUntil: true,
        roles: { select: { role: true } },
      },
    });
    if (!row || row.status === "DELETED" || row.status === "DELETION_PENDING")
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Finish your profile to continue.",
        details: { reason: "PROFILE_REQUIRED" },
      });
    if (opts.write) {
      const lapsed = row.suspendedUntil && row.suspendedUntil <= new Date();
      if (row.status === "BANNED" || (row.status === "SUSPENDED" && !lapsed))
        throw new ForbiddenException({
          code: "ACCOUNT_SUSPENDED",
          message:
            "Your account is suspended, so you cannot do that right now.",
          details: { until: row.suspendedUntil?.toISOString() ?? null },
        });
    }
    return {
      id: row.id,
      handle: row.handle,
      roles: row.roles.map((r) => r.role),
    };
  }

  /** The viewer on a guest-or-signed-in route: null for a guest or a person with no profile yet. */
  async viewer(user: VoicesUser | undefined): Promise<Actor | null> {
    if (!user) return null;
    const row = await this.prisma.user.findUnique({
      where: { wawuId: user.sub },
      select: { id: true, handle: true, roles: { select: { role: true } } },
    });
    return row
      ? { id: row.id, handle: row.handle, roles: row.roles.map((r) => r.role) }
      : null;
  }

  /** Staff gate for the team's tools. ADMIN includes every role. */
  async requireRole(
    user: VoicesUser,
    allowed: VoicesRole[],
    opts: { write: boolean } = { write: true },
  ): Promise<Actor> {
    const actor = await this.resolve(user, opts);
    if (
      !actor.roles.includes("ADMIN") &&
      !actor.roles.some((r) => allowed.includes(r))
    )
      throw new ForbiddenException({
        code: "ROLE_REQUIRED",
        message: "Only the WAWU team can do that.",
        details: { roles: allowed },
      });
    return actor;
  }

  forbidden(message: string): ForbiddenException {
    return new ForbiddenException({ code: "FORBIDDEN", message });
  }

  notFound(): NotFoundException {
    return new NotFoundException({
      code: "NOT_FOUND",
      message: "We could not find that.",
    });
  }
}
