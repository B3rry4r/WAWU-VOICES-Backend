import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { cut, decodeCursor, olderThan, pageLimit } from "../me/paging";
import { invalid, type Json } from "./support";

/** GET /admin/audit: the append-only log, newest first. */
@Injectable()
export class AuditAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: {
    cursor?: string;
    limit?: unknown;
    action?: string;
    targetType?: string;
    targetId?: string;
  }): Promise<Json> {
    const limit = pageLimit(q.limit);
    const c = decodeCursor(q.cursor);
    for (const k of ["action", "targetType", "targetId"] as const)
      if (q[k] !== undefined && (typeof q[k] !== "string" || q[k].length > 120))
        throw invalid({ path: k, message: "Use a short word." });
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.targetType ? { targetType: q.targetType } : {}),
      ...(q.targetId ? { targetId: q.targetId } : {}),
      ...olderThan(c),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = cut(rows, limit, (r) => r.createdAt);
    const ids = [
      ...new Set(
        page.items.map((r) => r.actorId).filter((x): x is string => !!x),
      ),
    ];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, handle: true },
        })
      : [];
    const who = new Map(users.map((u) => [u.id, u.handle]));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        actor: r.actorId ? (who.get(r.actorId) ?? r.actorId) : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        before: r.before,
        after: r.after,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
