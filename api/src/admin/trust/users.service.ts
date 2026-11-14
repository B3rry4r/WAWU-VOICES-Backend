import { randomUUID } from "node:crypto";
import { ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { MailEvents } from "../../mail/mail-events";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { AccountStatus, Prisma } from "../../generated/prisma/client";
import type { CurrentMeInfo } from "../../me/me-context";
import { phoneHashOf } from "../../me";
import { Views } from "../../me/views";
import { lagosDayStart, lagosDayString } from "../support";
import { isVerifiedNow } from "../../verify/verified";
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
    @Optional() private readonly mails?: MailEvents,
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

  /** The where for a search term: a handle part, a name part, a phone, a phone hash, or one exact mail address. */
  private searchWhere(raw: string): Prisma.UserWhereInput {
    const term = raw.trim().replace(/^@/, "").toLowerCase();
    // "@" alone is an empty search, not "everyone".
    if (term === "") return { id: { in: [] } };
    const hex = /^[0-9a-f]{64}$/.test(term);
    if (hex) return { phoneHash: term };
    // % and _ are LIKE wildcards: they must match themselves (V-FIX-C).
    const like = term.replace(/[\\%_]/g, "\\$&");
    const byPhone = /^\+?\d{7,15}$/.test(term)
      ? phoneHashOf(term.startsWith("+") ? term : `+${term}`)
      : null;
    const or: Prisma.UserWhereInput[] = [
      { handle: { contains: like } },
      { displayName: { contains: like, mode: "insensitive" } },
    ];
    if (byPhone) or.push({ phoneHash: byPhone });
    // The mail address matches only as a whole address, never in part.
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(term)) or.push({ mailTo: term });
    return or.length === 1 ? or[0] : { OR: or };
  }

  async list(q: UserListQuery) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const match: Prisma.UserWhereInput = q.q ? this.searchWhere(q.q) : {};
    const filter: Prisma.UserWhereInput = {
      AND: [match, q.status ? { status: q.status as AccountStatus } : {}],
    };
    const now = new Date();
    const [rows, total, byStatus, today, verified] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          AND: [
            filter,
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
      }),
      this.prisma.user.count({ where: filter }),
      this.prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.user.count({
        where: { createdAt: { gte: lagosDayStart(lagosDayString(now)) } },
      }),
      this.prisma.user.count({
        where: { verificationStatus: "APPROVED", verifiedUntil: { gt: now } },
      }),
    ]);
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    const ids = slice.map((r) => r.id);
    const [base, extra, answers, replies] = await Promise.all([
      this.views_(ids),
      this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          mailTo: true,
          displayName: true,
          state: true,
          bio: true,
          avatarFileId: true,
          verifiedUntil: true,
          verificationStatus: true,
        },
      }),
      this.prisma.answer.groupBy({
        by: ["authorId"],
        where: { authorId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.reply.groupBy({
        by: ["authorId"],
        where: { authorId: { in: ids }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const ex = new Map(extra.map((u) => [u.id, u]));
    const posts = new Map<string, number>();
    for (const g of [...answers, ...replies])
      posts.set(g.authorId, (posts.get(g.authorId) ?? 0) + g._count._all);
    const by: Record<string, number> = {
      ACTIVE: 0,
      SUSPENDED: 0,
      BANNED: 0,
      DELETION_PENDING: 0,
      DELETED: 0,
    };
    for (const g of byStatus) by[g.status] = g._count._all;
    return {
      items: base.map((b) => {
        const u = ex.get(b.profile.id);
        return {
          ...b,
          mailTo: u?.mailTo ?? null,
          displayName: u?.displayName ?? null,
          state: u?.state ?? null,
          verified: u ? isVerifiedNow(u, now) : false,
          postCount: posts.get(b.profile.id) ?? 0,
          hasProfile: !!(u?.displayName || u?.bio || u?.avatarFileId),
        };
      }),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
      total,
      counts: {
        total: Object.values(by).reduce((a, b) => a + b, 0),
        today,
        verified,
        byStatus: by,
      },
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
    const heldKey = randomUUID();
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
          groupKey: `${APPEALABLE_NOTICE}${dto.ban ? "BAN" : "SUSPEND"}:${heldKey}`,
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
    // V-44 (M-b): E04, after the commit.
    this.mails?.accountHeld(
      userId,
      `user-hold:${heldKey}`,
      !!dto.ban,
      until,
      dto.reason,
    );
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
    // V-44 (M-b): E05, after the commit.
    this.mails?.accountRestored(userId, `user-restore:${randomUUID()}`);
    return (await this.views_([userId]))[0];
  }
}
