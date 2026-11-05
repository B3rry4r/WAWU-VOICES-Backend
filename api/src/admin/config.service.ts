import { Injectable } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { cut, decodeCursor, olderThan, pageLimit } from "../me/paging";
import { AdminWriteLimitGuard } from "./admin-access";
import {
  CATALOGUE_BY_KEY,
  CONFIG_CATALOGUE,
  checkConfigValue,
  type CatalogueItem,
} from "./config-catalogue";
import {
  conflict,
  invalid,
  notFound,
  writeAudit,
  type Db,
  type Json,
} from "./support";

type EntryRow = Prisma.ConfigEntryGetPayload<object>;

const jsonIn = (v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue);

/**
 * Prices, costs, allowances and limits: the ConfigEntry rows other modules read. A change takes effect at once (they read
 * the row), is logged in ConfigChange and AuditLog in the same transaction, and can be rolled back.
 */
@Injectable()
export class ConfigAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: AdminWriteLimitGuard,
  ) {}

  /** Writes the default row for every catalogue key that has none yet (never changes an existing row). */
  private async ensureRows(db: Db): Promise<void> {
    await db.configEntry.createMany({
      data: CONFIG_CATALOGUE.map((c) => ({
        key: c.key,
        valueJson: jsonIn(c.value),
        description: c.description,
        placeholder: c.placeholder ?? false,
      })),
      skipDuplicates: true,
    });
  }

  private async handles(ids: (string | null)[]): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (want.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: want } },
      select: { id: true, handle: true },
    });
    return new Map(users.map((u) => [u.id, u.handle]));
  }

  private view(r: EntryRow, who: Map<string, string>): Json {
    return {
      key: r.key,
      value: r.valueJson,
      description: r.description,
      placeholder: r.placeholder,
      version: r.version,
      updatedAt: r.updatedAt.toISOString(),
      updatedBy: r.updatedById ? (who.get(r.updatedById) ?? null) : null,
    };
  }

  async list(): Promise<Json> {
    await this.ensureRows(this.prisma);
    const rows = await this.prisma.configEntry.findMany({
      orderBy: { key: "asc" },
    });
    const who = await this.handles(rows.map((r) => r.updatedById));
    return { items: rows.map((r) => this.view(r, who)) };
  }

  private item(key: string): CatalogueItem {
    const item = CATALOGUE_BY_KEY.get(key);
    if (!item) throw notFound("that setting");
    return item;
  }

  async update(
    actorId: string,
    key: string,
    value: unknown,
    reason: string,
  ): Promise<Json> {
    const item = this.item(key);
    if (item.fixed)
      throw invalid({
        path: "key",
        message: "This value is fixed and cannot be changed.",
      });
    if (value === undefined)
      throw invalid({ path: "value", message: "A value is needed." });
    const bad = checkConfigValue(item, value);
    if (bad) throw invalid({ path: "value", message: bad });
    const row = await this.prisma.$transaction(async (tx) => {
      await this.ensureRows(tx);
      await tx.$queryRaw`SELECT "key" FROM "ConfigEntry" WHERE "key" = ${key} FOR UPDATE`;
      const cur = await tx.configEntry.findUniqueOrThrow({ where: { key } });
      if (isDeepStrictEqual(cur.valueJson, value)) return cur;
      const next = await tx.configEntry.update({
        where: { key },
        data: {
          valueJson: jsonIn(value),
          version: { increment: 1 },
          updatedById: actorId,
          // the owner has now confirmed the number
          placeholder: false,
        },
      });
      await tx.configChange.create({
        data: {
          key,
          oldValue: jsonIn(cur.valueJson),
          newValue: jsonIn(value),
          reason,
          changedById: actorId,
        },
      });
      await writeAudit(tx, {
        actorId,
        action: "config.update",
        targetType: "ConfigEntry",
        targetId: key,
        reason,
        before: { value: cur.valueJson, version: cur.version },
        after: { value, version: next.version },
      });
      return next;
    });
    if (key === "ratelimit.admin_write_per_min") this.limiter.resetCache();
    const who = await this.handles([row.updatedById]);
    return this.view(row, who);
  }

  async changes(
    cursorRaw: string | undefined,
    limitRaw: unknown,
    key: string | undefined,
  ): Promise<Json> {
    const limit = pageLimit(limitRaw);
    const c = decodeCursor(cursorRaw);
    const rows = await this.prisma.configChange.findMany({
      where: { ...(key ? { key } : {}), ...olderThan(c) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const page = cut(rows, limit, (r) => r.createdAt);
    const who = await this.handles(page.items.map((r) => r.changedById));
    return {
      items: page.items.map((r) => ({
        id: r.id,
        key: r.key,
        oldValue: r.oldValue,
        newValue: r.newValue,
        reason: r.reason,
        by: who.get(r.changedById) ?? r.changedById,
        createdAt: r.createdAt.toISOString(),
        rollbackOfId: r.rollbackOfId,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async rollback(
    actorId: string,
    changeId: string,
    reason: string,
  ): Promise<Json> {
    const change = await this.prisma.configChange.findUnique({
      where: { id: changeId },
    });
    if (!change) throw notFound("that change");
    const item = CATALOGUE_BY_KEY.get(change.key);
    if (!item || item.fixed)
      throw conflict("That setting can no longer be changed.");
    const row = await this.prisma.$transaction(async (tx) => {
      await this.ensureRows(tx);
      await tx.$queryRaw`SELECT "key" FROM "ConfigEntry" WHERE "key" = ${change.key} FOR UPDATE`;
      const cur = await tx.configEntry.findUniqueOrThrow({
        where: { key: change.key },
      });
      const done = await tx.configChange.findFirst({
        where: { rollbackOfId: change.id },
        select: { id: true },
      });
      if (done) throw conflict("That change was already rolled back.");
      if (!isDeepStrictEqual(cur.valueJson, change.newValue))
        throw conflict(
          "This setting has changed since then. Roll back the latest change instead.",
        );
      // a change written before the key existed has no old value: go back to the default
      const target =
        change.oldValue === null || change.oldValue === undefined
          ? item.value
          : change.oldValue;
      const bad = checkConfigValue(item, target);
      if (bad) throw conflict("The earlier value is no longer allowed.");
      const next = await tx.configEntry.update({
        where: { key: change.key },
        data: {
          valueJson: jsonIn(target),
          version: { increment: 1 },
          updatedById: actorId,
        },
      });
      await tx.configChange.create({
        data: {
          key: change.key,
          oldValue: jsonIn(cur.valueJson),
          newValue: jsonIn(target),
          reason,
          changedById: actorId,
          rollbackOfId: change.id,
        },
      });
      await writeAudit(tx, {
        actorId,
        action: "config.rollback",
        targetType: "ConfigEntry",
        targetId: change.key,
        reason,
        before: { value: cur.valueJson, version: cur.version, changeId },
        after: { value: target, version: next.version },
      });
      return next;
    });
    if (change.key === "ratelimit.admin_write_per_min")
      this.limiter.resetCache();
    const who = await this.handles([row.updatedById]);
    return this.view(row, who);
  }
}
