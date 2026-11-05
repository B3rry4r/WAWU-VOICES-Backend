import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import type { VoicesRole } from "../generated/prisma/enums";
import { ROLE_LOCK } from "./roles.service";

export const ALL_ROLES: VoicesRole[] = [
  "MODERATOR",
  "EDITOR",
  "AD_MANAGER",
  "ADMIN",
];

export interface GrantArgs {
  handle?: string;
  wawuId?: string;
  role: VoicesRole;
  revoke?: boolean;
  /** Who ran it, for the audit row (the person at the terminal). */
  by?: string;
}

/**
 * The bootstrap path for roles (the first admin has no one to grant it): the person must already have a VOICES profile
 * (they signed in and finished POST /me). Writes the grant and one AuditLog row. Idempotent.
 */
export async function grantRole(
  prisma: PrismaClient,
  a: GrantArgs,
): Promise<string> {
  if (!ALL_ROLES.includes(a.role))
    throw new Error(`Role must be one of ${ALL_ROLES.join(", ")}.`);
  if (!!a.handle === !!a.wawuId)
    throw new Error("Give exactly one of --handle or --wawu-id.");
  const user = await prisma.user.findFirst({
    where: a.handle
      ? { handle: a.handle.trim().replace(/^@/, "").toLowerCase() }
      : { wawuId: a.wawuId },
  });
  if (!user)
    throw new Error(
      "No VOICES profile for that person. They must sign in and finish setup first.",
    );
  if (user.status === "DELETED") throw new Error("That account is deleted.");
  const existing = await prisma.userRoleGrant.findUnique({
    where: { userId_role: { userId: user.id, role: a.role } },
  });
  if (a.revoke) {
    if (!existing) return `@${user.handle} does not have ${a.role}.`;
    return prisma.$transaction(async (tx) => {
      // Same lock and rule as PUT /admin/users/{id}/roles: VOICES must keep at least one active admin.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROLE_LOCK})`;
      if (a.role === "ADMIN") {
        const others = await tx.userRoleGrant.count({
          where: {
            role: "ADMIN",
            userId: { not: user.id },
            user: { status: "ACTIVE" },
          },
        });
        if (others === 0)
          throw new Error(
            `@${user.handle} is the only admin. Give ADMIN to someone else first.`,
          );
      }
      await tx.userRoleGrant.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: "role.revoke",
          targetType: "User",
          targetId: user.id,
          reason: `roles:grant script${a.by ? ` by ${a.by}` : ""}`,
          before: { role: a.role },
        },
      });
      return `Removed ${a.role} from @${user.handle}.`;
    });
  }
  if (existing) return `@${user.handle} already has ${a.role}.`;
  await prisma.$transaction([
    prisma.userRoleGrant.create({
      data: { userId: user.id, role: a.role, grantedById: user.id },
    }),
    prisma.auditLog.create({
      data: {
        actorId: null,
        action: "role.grant",
        targetType: "User",
        targetId: user.id,
        reason: `roles:grant script${a.by ? ` by ${a.by}` : ""}`,
        after: { role: a.role },
      },
    }),
  ]);
  return `Gave ${a.role} to @${user.handle}.`;
}

export function clientFromEnv(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}
