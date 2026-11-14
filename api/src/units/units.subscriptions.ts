import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { computeQuote, readRates } from "./units.charges";
import { UnitsConfig } from "./units.config";
import { apiError } from "./units.errors";
import { LedgerService, type Tx } from "./units.ledger";

/** The Africa/Lagos calendar day as "YYYY-MM-DD" (Lagos is UTC+1 all year). */
export function lagosDayString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The same day of the month, `k` months on, never past the end of a short month (start on the 31st: the 28th in February,
 * the 31st again in March). Always counted from the START day, so the date never drifts.
 */
export function addMonthsClamped(day: string, k: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = m - 1 + k;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12; // 0..11
  const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dd = Math.min(d, dim);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Credit month `n` (1 based) of a plan that started on `startDay` falls on this Lagos day. */
export const creditDay = (startDay: string, n: number): string =>
  addMonthsClamped(startDay, n - 1);

/** How many of the plan's months are due by `today` (never more than the plan's months). */
export function monthsDue(
  startDay: string,
  months: number,
  today: string,
): number {
  let due = 0;
  for (let n = 1; n <= months; n++) {
    if (creditDay(startDay, n) <= today) due = n;
    else break;
  }
  return due;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "14 Feb 2027" for a "YYYY-MM-DD" day. */
export function prettyDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

type SubRow = {
  id: string;
  userId: string;
  planId: string;
  status: string;
  months: number;
  monthlyMilli: number;
  priceKobo: number;
  startDay: string;
  endDay: string;
  creditedMonths: number;
  paymentId: string;
};

const LIVE = ["ACTIVE", "QUEUED"] as const;
const NO_CREDIT_USER = new Set(["DELETION_PENDING", "DELETED"]);

/**
 * V-45: subscriptions. A plan is paid once through the payments path (units.payments.ts); this class makes the
 * subscription when that payment is confirmed, credits the months one at a time and keeps the person's view of it.
 * Nothing here is reachable by an admin: no route takes a user id, and no admin adjustment calls it (V-28).
 */
@Injectable()
export class SubscriptionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly cfg: UnitsConfig,
  ) {}

  onModuleInit(): void {
    if (
      process.env.SUBSCRIPTIONS_JOB === "off" ||
      process.env.NODE_ENV === "test"
    )
      return;
    // Hourly, and once a minute after boot: a server that was down on the day catches the months up on its next run.
    const first = setTimeout(() => void this.runDue(), 60_000);
    first.unref();
    this.timer = setInterval(() => void this.runDue(), 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------ views

  async plans() {
    const [rows, rates] = await Promise.all([
      this.prisma.subscriptionPlan.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      readRates(this.cfg),
    ]);
    return {
      vatRateBps: rates.vatRateBps,
      plans: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        months: p.months,
        priceKobo: p.priceKobo,
        monthlyMilli: p.monthlyMilli,
        totalMilli: p.months * p.monthlyMilli,
        quote: computeQuote(p.priceKobo, rates),
      })),
    };
  }

  private view(s: SubRow & { plan: { slug: string; name: string } }) {
    return {
      id: s.id,
      planSlug: s.plan.slug,
      planName: s.plan.name,
      status: s.status,
      months: s.months,
      monthlyMilli: s.monthlyMilli,
      totalMilli: s.months * s.monthlyMilli,
      priceKobo: s.priceKobo,
      creditedMonths: s.creditedMonths,
      startDay: s.startDay,
      endDay: s.endDay,
      nextCreditDay:
        s.status === "CANCELLED_DELETED" || s.creditedMonths >= s.months
          ? null
          : creditDay(s.startDay, s.creditedMonths + 1),
      paymentId: s.paymentId,
    };
  }

  /** GET /subscriptions/me: the running plan, the plan waiting to start, and the finished ones. */
  async mine(userId: string, now = new Date()) {
    const today = lagosDayString(now);
    const rows = await this.prisma.subscription.findMany({
      where: { userId },
      include: { plan: true },
      orderBy: [{ startDay: "desc" }, { id: "desc" }],
      take: 50,
    });
    const live = rows.filter((r) => LIVE.includes(r.status as "ACTIVE"));
    const running = live.filter(
      (r) => r.status === "ACTIVE" && r.endDay > today,
    );
    const queued = live.filter((r) => r.status === "QUEUED");
    const past = rows.filter(
      (r) => !running.includes(r) && !queued.includes(r),
    );
    return {
      current: running[0] ? this.view(running[0]) : null,
      queued: queued[0] ? this.view(queued[0]) : null,
      past: past.map((r) => this.view(r)),
      canBuy: running.length === 0 && queued.length === 0,
    };
  }

  /** Refuse a second plan while one runs or waits (the second-plan rule). Called when a payment is started. */
  async assertCanBuy(userId: string, now = new Date()): Promise<void> {
    const today = lagosDayString(now);
    const live = await this.prisma.subscription.findFirst({
      where: { userId, status: { in: [...LIVE] }, endDay: { gt: today } },
      include: { plan: true },
      orderBy: { endDay: "desc" },
    });
    if (live)
      throw apiError(
        409,
        "SUBSCRIPTION_ACTIVE",
        `You already have ${live.plan.name} until ${prettyDay(live.endDay)}. You can buy another plan after it ends. You can still buy token packs.`,
        { endDay: live.endDay },
      );
  }

  // ------------------------------------------------------------------ money

  /**
   * Called from inside the payment's own transaction, after its row was locked and found not yet SUCCEEDED, so a plan is
   * made once per confirmed payment (and Subscription.paymentId is unique as the second guard). Month 1 is credited here,
   * in the same transaction, so a payment and its first tokens succeed or fail together.
   */
  async startFromPayment(
    db: Tx,
    payment: {
      id: string;
      userId: string;
      planId: string | null;
      amountKobo: number;
      planMonths?: number | null;
      planMonthlyMilli?: number | null;
    },
    freePosts: number,
    now = new Date(),
  ): Promise<{
    subscriptionId: string;
    firstMonthMilli: number;
    cancelled?: boolean;
  }> {
    if (!payment.planId) throw new Error("Subscription payment without a plan");
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"sub:" + payment.userId}))`;
    const user = (
      await db.$queryRaw<
        { status: string }[]
      >`SELECT status::text AS status FROM "User" WHERE id = ${payment.userId} FOR SHARE`
    )[0];
    const prior = await db.subscription.findUnique({
      where: { paymentId: payment.id },
    });
    if (prior) return { subscriptionId: prior.id, firstMonthMilli: 0 };
    const plan = await db.subscriptionPlan.findUniqueOrThrow({
      where: { id: payment.planId },
    });
    if (plan.priceKobo !== payment.amountKobo)
      this.logger.warn(
        `Plan ${plan.slug} price changed since payment ${payment.id} began: the buyer keeps the months and tokens they were shown`,
      );
    // The terms quoted at checkout start (stored on the payment). An older payment has none: read the plan row, as before.
    const months = payment.planMonths ?? plan.months;
    const monthlyMilli = payment.planMonthlyMilli ?? plan.monthlyMilli;
    const today = lagosDayString(now);
    // Two checkouts open at once: the later payment waits for the earlier plan to end. Never two plans crediting together.
    const latest = await db.subscription.findFirst({
      where: {
        userId: payment.userId,
        status: { in: [...LIVE] },
        endDay: { gt: today },
      },
      orderBy: { endDay: "desc" },
    });
    const startDay = latest ? latest.endDay : today;
    const gone = !user || NO_CREDIT_USER.has(user.status);
    const sub = await db.subscription.create({
      data: {
        userId: payment.userId,
        planId: plan.id,
        paymentId: payment.id,
        status: gone
          ? "CANCELLED_DELETED"
          : startDay > today
            ? "QUEUED"
            : "ACTIVE",
        cancelledAt: gone ? now : null,
        months,
        monthlyMilli,
        priceKobo: payment.amountKobo,
        startDay,
        endDay: addMonthsClamped(startDay, months),
      },
    });
    if (gone)
      return { subscriptionId: sub.id, firstMonthMilli: 0, cancelled: true };
    if (startDay > today) return { subscriptionId: sub.id, firstMonthMilli: 0 };
    await this.creditMonth(db, sub.id, sub.userId, 1, freePosts);
    return { subscriptionId: sub.id, firstMonthMilli: monthlyMilli };
  }

  /**
   * Credit month `n` of one subscription, inside `db`. Exactly once: the subscription row is locked, month n must be the
   * next one, the ledger key `subcredit:<id>:<n>` is unique, and so is (subscription, month). Returns false when there is
   * nothing to do. Lock order is User, Subscription, Wallet, the same as the account purge (User, Wallet).
   */
  async creditMonth(
    db: Tx,
    subId: string,
    userId: string,
    n: number,
    freePosts: number,
    today?: string,
  ): Promise<boolean> {
    const u = (
      await db.$queryRaw<
        { status: string }[]
      >`SELECT status::text AS status FROM "User" WHERE id = ${userId} FOR SHARE`
    )[0];
    if (!u || NO_CREDIT_USER.has(u.status)) return false; // no credits after deletion
    const s = (
      await db.$queryRaw<
        SubRow[]
      >`SELECT * FROM "Subscription" WHERE id = ${subId} FOR UPDATE`
    )[0];
    if (!s || !LIVE.includes(s.status as "ACTIVE")) return false;
    if (s.creditedMonths !== n - 1 || n > s.months) return false;
    if (today !== undefined && creditDay(s.startDay, n) > today) return false;
    const balance = await this.ledger.lockWallet(db, s.userId, { freePosts });
    const after = balance + s.monthlyMilli;
    const txn = await db.ledgerTransaction.create({
      data: {
        kind: "SUBSCRIPTION_CREDIT",
        idempotencyKey: `subcredit:${s.id}:${n}`,
        reason: `Plan month ${n} of ${s.months}`,
        entries: {
          create: [
            {
              account: "USER_WALLET",
              walletUserId: s.userId,
              deltaMilli: s.monthlyMilli,
              balanceAfterMilli: after,
            },
            { account: "SUBSCRIPTIONS", deltaMilli: -s.monthlyMilli },
          ],
        },
      },
    });
    await this.ledger.setBalance(db, s.userId, after);
    await db.subscriptionCredit.create({
      data: {
        subscriptionId: s.id,
        monthNo: n,
        amountMilli: s.monthlyMilli,
        ledgerTxnId: txn.id,
      },
    });
    await db.subscription.update({
      where: { id: s.id },
      data: { creditedMonths: n, status: "ACTIVE" },
    });
    await db.notification.upsert({
      where: {
        userId_groupKey: {
          userId: s.userId,
          groupKey: `subcredit:${s.id}:${n}`,
        },
      },
      create: {
        userId: s.userId,
        type: "UNITS_ADDED",
        title: "Monthly tokens added",
        body: `${s.monthlyMilli / 1000} tokens from your plan were added to your balance (month ${n} of ${s.months}).`,
        targetType: "wallet",
        targetId: s.id,
        groupKey: `subcredit:${s.id}:${n}`,
      },
      update: {},
    });
    return true;
  }

  /**
   * The monthly job. Credits every month that is due and not yet credited, one transaction per month, so a crash leaves
   * whole months done and the next run carries on; a missed day is caught up on the next run, never past the plan's
   * months. Safe to run twice at once.
   */
  async runDue(
    now = new Date(),
  ): Promise<{ credited: number; errors: number; ended: number }> {
    const today = lagosDayString(now);
    let credited = 0;
    let errors = 0;
    const freePosts = await this.ledger.freePostsConfig();
    const subs = await this.prisma.subscription.findMany({
      where: { status: { in: [...LIVE] }, startDay: { lte: today } },
      select: { id: true, userId: true, months: true, creditedMonths: true },
    });
    for (const s of subs) {
      if (s.creditedMonths >= s.months) continue;
      for (let i = 0; i < s.months; i++) {
        try {
          const did = await this.ledger.inTx(async (db) => {
            const cur = await db.subscription.findUnique({
              where: { id: s.id },
              select: { creditedMonths: true },
            });
            if (!cur) return false;
            return this.creditMonth(
              db,
              s.id,
              s.userId,
              cur.creditedMonths + 1,
              freePosts,
              today,
            );
          });
          if (!did) break;
          credited++;
        } catch (e) {
          errors++;
          this.logger.warn(
            `Subscription ${s.id} credit failed: ${(e as Error).message}`,
          );
          break;
        }
      }
    }
    const ended = await this.prisma.$executeRaw`
      UPDATE "Subscription" SET status = 'ENDED', "updatedAt" = now()
      WHERE status = 'ACTIVE' AND "creditedMonths" = months AND "endDay" <= ${today}`;
    return { credited, errors, ended };
  }

  /** Our books: every plan credit row has its ledger entry, with the same total. */
  async ledgerCheck(): Promise<{
    creditsMilli: number;
    ledgerMilli: number;
    ok: boolean;
  }> {
    const [c] = await this.prisma.$queryRaw<
      { s: bigint | null }[]
    >`SELECT COALESCE(SUM("amountMilli"),0) AS s FROM "SubscriptionCredit"`;
    const [l] = await this.prisma.$queryRaw<
      { s: bigint | null }[]
    >`SELECT COALESCE(SUM(e."deltaMilli"),0) AS s FROM "LedgerEntry" e JOIN "LedgerTransaction" t ON t.id = e."txnId" WHERE t.kind = 'SUBSCRIPTION_CREDIT' AND e.account = 'USER_WALLET'`;
    const creditsMilli = Number(c?.s ?? 0);
    const ledgerMilli = Number(l?.s ?? 0);
    return { creditsMilli, ledgerMilli, ok: creditsMilli === ledgerMilli };
  }
}
