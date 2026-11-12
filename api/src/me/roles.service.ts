import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { AccountStatus, type VoicesRole } from "../generated/prisma/enums";
import type { CurrentMeInfo } from "./me-context";
import { cut, decodeCursor, pageLimit } from "./paging";
import { Views } from "./views";
import { MailEvents } from "../mail/mail-events";

export const ROLE_LOCK = 7_141_001; // pg advisory lock: role changes happen one at a time

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: Views,
    @Optional() private readonly mails?: MailEvents,
  ) {}

  /**
   * Replaces a person's roles. Admin route only (the controller's @Roles guard). Refuses to leave VOICES with no admin,
   * and to let an admin drop their own admin role; the change and its reason go to the audit log in the same transaction.
   */
  async setRoles(
    actor: CurrentMeInfo,
    targetId: string,
    roles: VoicesRole[],
    reason: string,
  ) {
    const wanted = [...new Set(roles)];
    const change = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLE_LOCK})`;
      const target = await tx.user.findUnique({
        where: { id: targetId },
        include: { roles: true },
      });
      if (!target || target.status === AccountStatus.DELETED)
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "We could not find that person.",
        });
      const before = target.roles.map((r) => r.role).sort();
      const adds = wanted.filter((r) => !before.includes(r));
      if (adds.length && target.status !== AccountStatus.ACTIVE)
        throw new ConflictException({
          code: "CONFLICT",
          message: "Only an active account can be given a role.",
        });
      const dropsAdmin = before.includes("ADMIN") && !wanted.includes("ADMIN");
      if (dropsAdmin && target.id === actor.id)
        throw new UnprocessableEntityException({
          code: "VALIDATION_FAILED",
          message: "You cannot remove your own admin role.",
          details: {
            fields: [
              {
                path: "roles",
                message: "You cannot remove your own admin role.",
              },
            ],
          },
        });
      if (dropsAdmin) {
        const admins = await tx.userRoleGrant.count({
          where: {
            role: "ADMIN",
            userId: { not: target.id },
            user: { status: AccountStatus.ACTIVE },
          },
        });
        if (admins === 0)
          throw new ConflictException({
            code: "CONFLICT",
            message: "VOICES must keep at least one admin.",
          });
      }
      await tx.userRoleGrant.deleteMany({
        where: { userId: targetId, role: { notIn: wanted } },
      });
      for (const role of adds)
        await tx.userRoleGrant.create({
          data: { userId: targetId, role, grantedById: actor.id },
        });
      const audit = await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "role.set",
          targetType: "User",
          targetId,
          reason,
          before: { roles: before },
          after: { roles: [...wanted].sort() },
        },
        select: { id: true },
      });
      return {
        id: audit.id,
        changed: before.join() !== [...wanted].sort().join(),
      };
    });
    // V-44 (M-b, G09): the person hears once per real change, after the commit.
    if (change.changed)
      void this.mails?.roleChanged(
        targetId,
        actor.id,
        change.id,
        [...wanted].sort(),
      );
    const roleRows = await this.prisma.userRoleGrant.findMany({
      where: { userId: targetId },
      select: { role: true },
    });
    const p = (await this.views.profiles([targetId])).get(targetId);
    return { user: p, roles: roleRows.map((r) => r.role).sort() };
  }

  async list(cursor: string | undefined, limitRaw: unknown, role: unknown) {
    const limit = pageLimit(limitRaw);
    if (
      role !== undefined &&
      !["MODERATOR", "EDITOR", "AD_MANAGER", "ADMIN"].includes(
        typeof role === "string" ? role : "",
      )
    )
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: { fields: [{ path: "role", message: "Not a VOICES role." }] },
      });
    const c = decodeCursor(cursor);
    const users = await this.prisma.user.findMany({
      where: {
        roles: role ? { some: { role: role as VoicesRole } } : { some: {} },
        ...(c ? { id: { gt: c.id } } : {}),
      },
      include: { roles: true },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const page = cut(users, limit, () => new Date());
    const profiles = await this.views.profiles(page.items.map((u) => u.id));
    return {
      items: page.items.map((u) => ({
        user: profiles.get(u.id),
        roles: u.roles.map((r) => r.role).sort(),
      })),
      nextCursor: page.nextCursor,
    };
  }
}
