import { randomUUID } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { AccountStatus, Prisma } from "../../generated/prisma/client";
import type { CurrentMeInfo } from "../../me/me-context";
import { phoneHashOf } from "../../me";
import { Views } from "../../me/views";
import { decodeCursor, encodeCursor, pageLimit } from "../../results/cursor";
import {
  APPEALABLE_NOTICE,
  conflict,
  invalid,
  lockRow,
  notFound,
  suspensionTitle,
} from "./common";
import type { SuspendDto, UserListQuery } from "./dto";

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: Views,
  ) {}

  private async views_(ids: string[]) {
    const [profiles, users, strikes] = await Promise.all([
      this.views.profiles(ids),
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        include: { roles: true },
      }),
      this.prisma.strike.groupBy({
        by: ["userId"],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const sc = new Map(strikes.map((s) => [s.userId, s._count._all]));
    const by = new Map(users.map((u) => [u.id, u]));
    return ids.flatMap((id) => {
      const u = by.get(id);
      const profile = profiles.get(id);
      if (!u || !profile) return [];
      return [
        {
          profile,
          status: u.status,
          roles: u.roles.map((r) => r.role).sort(),
          strikes: sc.get(id) ?? 0,
          createdAt: u.createdAt.toISOString(),
        },
      ];
    });
  }

  async list(q: UserListQuery) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const term = q.q.trim().replace(/^@/, "").toLowerCase();
    const hex = /^[0-9a-f]{64}$/.test(term);
    const byPhone = /^\+?\d{7,15}$/.test(term)
      ? phoneHashOf(term.startsWith("+") ? term : `+${term}`)
      : null;
    const match: Prisma.UserWhereInput = hex
      ? { phoneHash: term }
      : byPhone
        ? { OR: [{ phoneHash: byPhone }, { handle: { contains: term } }] }
        : { handle: { contains: term } };
    const rows = await this.prisma.user.findMany({
      where: {
        AND: [
          match,
          q.status ? { status: q.status as AccountStatus } : {},
          cur
            ? {
                OR: [
                  { createdAt: { lt: new Date(cur.k) } },
                  { createdAt: new Date(cur.k), id: { lt: cur.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, createdAt: true },
    });
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    return {
      items: await this.views_(slice.map((r) => r.id)),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async guardTarget(
    tx: Prisma.TransactionClient,
    actor: CurrentMeInfo,
    userId: string,
  ) {
    await lockRow(tx, "User", "id", userId);
    const u = await tx.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!u || u.status === "DELETED")
      throw notFound("We could not find that person.");
    if (u.id === actor.id)
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You cannot do that to your own account.",
      });
    if (u.roles.length > 0 && !actor.roles.includes("ADMIN"))
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Only an admin can do that to a member of the team.",
      });
    return u;
  }

  async suspend(actor: CurrentMeInfo, userId: string, dto: SuspendDto) {
    let until: Date | null = null;
    if (!dto.ban && dto.until === null) {
      const row = await this.prisma.configEntry.findUnique({
        where: { key: "moderation.suspend_days" },
      });
      const days =
        typeof row?.valueJson === "number" && row.valueJson > 0
          ? row.valueJson
          : 7;
      until = new Date(Date.now() + days * 86_400_000);
    }
    if (!dto.ban && dto.until !== null) {
      until = new Date(dto.until);
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now())
        throw invalid("until", "Pick a time in the future.");
    }
    await this.prisma.$transaction(async (tx) => {
      const u = await this.guardTarget(tx, actor, userId);
      if (u.status === "DELETION_PENDING")
        throw conflict("This account is waiting to be deleted.");
      const status = dto.ban ? "BANNED" : "SUSPENDED";
      await tx.user.update({
        where: { id: userId },
        data: { status, suspendedUntil: dto.ban ? null : until },
      });
      await tx.notification.create({
        data: {
          userId,
          type: "MODERATION_NOTICE",
          // lead ruling WF, 6 Nov (C-M9): one word, "suspended", and the day it ends.
          title: dto.ban ? "Your account is closed" : suspensionTitle(until),
          body: dto.reason,
          targetType: "user",
          targetId: userId,
          groupKey: `${APPEALABLE_NOTICE}${dto.ban ? "BAN" : "SUSPEND"}:${randomUUID()}`,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: dto.ban ? "user.ban" : "user.suspend",
          targetType: "user",
          targetId: userId,
          reason: dto.reason,
          before: { status: u.status, suspendedUntil: u.suspendedUntil },
          after: { status, suspendedUntil: dto.ban ? null : until },
        },
      });
    });
    return (await this.views_([userId]))[0];
  }

  async restore(actor: CurrentMeInfo, userId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const u = await this.guardTarget(tx, actor, userId);
      if (u.status !== "SUSPENDED" && u.status !== "BANNED")
        throw conflict("This account is not suspended.");
      await tx.user.update({
        where: { id: userId },
        data: { status: "ACTIVE", suspendedUntil: null },
      });
      await tx.notification.create({
        data: {
          userId,
          type: "MODERATION_NOTICE",
          title: "Your account is back",
          body: reason,
          targetType: "user",
          targetId: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.restore",
          targetType: "user",
          targetId: userId,
          reason,
          before: { status: u.status, suspendedUntil: u.suspendedUntil },
          after: { status: "ACTIVE", suspendedUntil: null },
        },
      });
    });
    return (await this.views_([userId]))[0];
  }
}
