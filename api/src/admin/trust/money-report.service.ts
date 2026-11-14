import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { Prisma } from "../../generated/prisma/client";
import type { SubscriptionStatus } from "../../generated/prisma/client";
import { Views } from "../../me/views";
import { decodeCursor, encodeCursor, pageLimit } from "../../results/cursor";
import { creditDay, lagosDayString } from "../../units/units.subscriptions";
import type { PageQuery } from "./dto";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** One group of paid payments, every figure summed by the database. */
export interface Slice {
  count: number;
  priceKobo: number;
  vatKobo: number;
  chargeKobo: number;
  totalKobo: number;
}

const empty = (): Slice => ({
  count: 0,
  priceKobo: 0,
  vatKobo: 0,
  chargeKobo: 0,
  totalKobo: 0,
});

const num = (v: unknown): number => Number(v ?? 0);

/** Lagos is UTC+1 all year (no daylight saving): the instant a Lagos day starts. */
export function lagosDayStart(day: string): Date {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - HOUR);
}

const plusDays = (day: string, n: number): string =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY)
    .toISOString()
    .slice(0, 10);

/**
 * The money overview and the subscriptions list (V-ADMIN-MONEY). Every figure is summed here, in SQL, from the Payment
 * and ledger tables: the screen adds nothing up. A payment's own amounts (priceKobo, vatKobo, chargeKobo, totalKobo) are
 * the figures, never today's config. A payment made before the customer paid charges has no total: its total is its
 * price and its VAT and charge are nil.
 */
@Injectable()
export class AdminMoneyReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: Views,
  ) {}

  private async paid(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      {
        kind: string;
        n: bigint;
        price: bigint;
        vat: bigint;
        charge: bigint;
        total: bigint;
        over: bigint;
      }[]
    >(Prisma.sql`
      SELECT "kind"::text AS kind,
             COUNT(*)::bigint AS n,
             COALESCE(SUM("amountKobo"), 0)::bigint AS price,
             COALESCE(SUM(COALESCE("vatKobo", 0)), 0)::bigint AS vat,
             COALESCE(SUM(COALESCE("chargeKobo", 0)), 0)::bigint AS charge,
             COALESCE(SUM(COALESCE("totalKobo", "amountKobo")), 0)::bigint AS total,
             COALESCE(SUM(COALESCE("overpaidKobo", 0)), 0)::bigint AS over
        FROM "Payment"
       WHERE "status" = 'SUCCEEDED'
         AND COALESCE("verifiedAt", "createdAt") >= ${from}
         AND COALESCE("verifiedAt", "createdAt") < ${to}
       GROUP BY "kind"`);
    const packs = empty();
    const subscriptions = empty();
    const other = empty();
    let overpaidKobo = 0;
    for (const r of rows) {
      const s =
        r.kind === "UNITS"
          ? packs
          : r.kind === "SUBSCRIPTION"
            ? subscriptions
            : other;
      s.count += num(r.n);
      s.priceKobo += num(r.price);
      s.vatKobo += num(r.vat);
      s.chargeKobo += num(r.charge);
      s.totalKobo += num(r.total);
      overpaidKobo += num(r.over);
    }
    const total = empty();
    for (const s of [packs, subscriptions, other])
      for (const k of Object.keys(total) as (keyof Slice)[]) total[k] += s[k];
    return { packs, subscriptions, other, total, overpaidKobo };
  }

  private async counts(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<{ status: string; n: bigint }[]>(
      Prisma.sql`
      SELECT "status"::text AS status, COUNT(*)::bigint AS n
        FROM "Payment"
       WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
       GROUP BY "status"`,
    );
    const by = new Map(rows.map((r) => [r.status, num(r.n)]));
    return {
      failed: by.get("FAILED") ?? 0,
      pending: (by.get("INITIATED") ?? 0) + (by.get("PENDING") ?? 0),
      expired: by.get("EXPIRED") ?? 0,
      refunded: by.get("REFUNDED") ?? 0,
    };
  }

  /** People whose first confirmed payment ever falls in the window. */
  private async newPayers(from: Date, to: Date): Promise<number> {
    const r = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n FROM (
        SELECT "userId", MIN(COALESCE("verifiedAt", "createdAt")) AS first
          FROM "Payment" WHERE "status" = 'SUCCEEDED' GROUP BY "userId"
      ) f WHERE f.first >= ${from} AND f.first < ${to}`);
    return num(r[0]?.n);
  }

  /** Wallet-side ledger movement by transaction kind, from the entries themselves. */
  private async tokens(from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<
      { kind: string; pos: bigint; neg: bigint }[]
    >(Prisma.sql`
      SELECT t."kind"::text AS kind,
             COALESCE(SUM(e."deltaMilli") FILTER (WHERE e."deltaMilli" > 0), 0)::bigint AS pos,
             COALESCE(SUM(-e."deltaMilli") FILTER (WHERE e."deltaMilli" < 0), 0)::bigint AS neg
        FROM "LedgerEntry" e
        JOIN "LedgerTransaction" t ON t."id" = e."txnId"
       WHERE e."account" = 'USER_WALLET'
         AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
       GROUP BY t."kind"`);
    let sold = 0;
    let fromPlans = 0;
    let spent = 0;
    let reversed = 0;
    let adjIn = 0;
    let adjOut = 0;
    let other = 0;
    let change = 0;
    for (const r of rows) {
      const pos = num(r.pos);
      const neg = num(r.neg);
      change += pos - neg;
      if (r.kind === "PURCHASE") sold += pos;
      else if (r.kind === "SUBSCRIPTION_CREDIT") fromPlans += pos;
      else if (r.kind.startsWith("SPEND_")) spent += neg - pos;
      else if (r.kind === "REVERSAL") reversed += pos - neg;
      else if (r.kind === "ADJUSTMENT") {
        adjIn += pos;
        adjOut += neg;
      } else other += pos - neg;
    }
    return {
      soldMilli: sold,
      fromPlansMilli: fromPlans,
      spentMilli: spent,
      reversedMilli: reversed,
      adjustedInMilli: adjIn,
      adjustedOutMilli: adjOut,
      otherMilli: other,
      netSpentMilli: spent - reversed,
      walletChangeMilli: change,
    };
  }

  private async window(
    label: string,
    fromDay: string,
    toDay: string,
    now: Date,
  ) {
    const from = lagosDayStart(fromDay);
    const to = now;
    const [paid, counts, newPayers, tokens] = await Promise.all([
      this.paid(from, to),
      this.counts(from, to),
      this.newPayers(from, to),
      this.tokens(from, to),
    ]);
    return {
      label,
      fromDay,
      toDay,
      from: from.toISOString(),
      to: to.toISOString(),
      received: {
        packs: paid.packs,
        subscriptions: paid.subscriptions,
        other: paid.other,
        total: paid.total,
      },
      overpaidKobo: paid.overpaidKobo,
      payments: { paid: paid.total.count, ...counts },
      newPayers,
      tokens,
    };
  }

  /** Today, the last 7 and the last 30 Lagos days (each includes today). */
  async overview(now = new Date()) {
    const today = lagosDayString(now);
    const [t, w7, w30, held] = await Promise.all([
      this.window("Today", today, today, now),
      this.window("Last 7 days", plusDays(today, -6), today, now),
      this.window("Last 30 days", plusDays(today, -29), today, now),
      this.prisma.wallet.aggregate({ _sum: { balanceMilli: true } }),
    ]);
    return {
      asOf: now.toISOString(),
      lagosDay: today,
      tokensHeldMilli: Number(held._sum.balanceMilli ?? 0),
      windows: { today: t, last7: w7, last30: w30 },
    };
  }

  /** Current and ended plans, newest first. Read only. */
  async subscriptions(q: PageQuery & { status?: string }) {
    const limit = pageLimit(q.limit);
    const cur = decodeCursor(q.cursor);
    const rows = await this.prisma.subscription.findMany({
      where: {
        ...(q.status ? { status: q.status as SubscriptionStatus } : {}),
        ...(cur
          ? {
              OR: [
                { createdAt: { lt: new Date(cur.k) } },
                { createdAt: new Date(cur.k), id: { lt: cur.id } },
              ],
            }
          : {}),
      },
      include: { plan: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const more = rows.length > limit;
    const slice = more ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    const profiles = await this.views.profiles([
      ...new Set(slice.map((r) => r.userId)),
    ]);
    const counts = await this.prisma.subscription.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    return {
      items: slice.map((s) => {
        const p = profiles.get(s.userId);
        const running = s.status === "ACTIVE" || s.status === "QUEUED";
        return {
          id: s.id,
          user: p
            ? { id: p.id, handle: p.handle, displayName: p.displayName ?? null }
            : { id: s.userId, handle: "(deleted)", displayName: null },
          plan: { slug: s.plan.slug, name: s.plan.name },
          status: s.status,
          startDay: s.startDay,
          endDay: s.endDay,
          months: s.months,
          creditedMonths: s.creditedMonths,
          monthlyMilli: s.monthlyMilli,
          priceKobo: s.priceKobo,
          nextCreditDay:
            running && s.creditedMonths < s.months
              ? creditDay(s.startDay, s.creditedMonths + 1)
              : null,
          paymentId: s.paymentId,
          createdAt: s.createdAt.toISOString(),
        };
      }),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      nextCursor:
        more && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }
}
