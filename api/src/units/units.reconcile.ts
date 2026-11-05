import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { UnitsConfig } from "./units.config";
import { PaymentsService } from "./units.payments";

/**
 * Re-verifies payments that are not settled yet (V-11, V-21: there is no webhook). Payments younger than 24 hours
 * that are INITIATED, PENDING, EXPIRED or FAILED are asked about again, because a person can pay late or retry on the
 * same checkout link. Every verify is the same routine as the route, so a payment is credited once however often it runs.
 */
@Injectable()
export class ReconcileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcileService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: UnitsConfig,
    private readonly payments: PaymentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.cfg.seedDefaults();
    } catch (e) {
      this.logger.error(
        `Could not seed units defaults: ${(e as Error).message}`,
      );
    }
    if (
      process.env.UNITS_RECONCILE === "off" ||
      process.env.NODE_ENV === "test"
    )
      return;
    const minutes = await this.cfg
      .int("payment.reconcile_interval_minutes")
      .catch(() => 10);
    this.timer = setInterval(
      () => void this.run(),
      Math.max(1, minutes) * 60_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Returns what it did; never throws for one bad payment. */
  async run(
    limit = 200,
  ): Promise<{ checked: number; credited: number; errors: number }> {
    if (this.running) return { checked: 0, credited: 0, errors: 0 };
    this.running = true;
    let credited = 0;
    let errors = 0;
    try {
      const rows = await this.prisma.payment.findMany({
        where: {
          status: { in: ["INITIATED", "PENDING", "EXPIRED", "FAILED"] },
          createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
        },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: { id: true },
      });
      for (const r of rows) {
        try {
          const v = await this.payments.verifySystem(r.id);
          if (v.status === "SUCCEEDED") credited++;
        } catch (e) {
          errors++;
          this.logger.warn(
            `Reconcile of ${r.id} failed: ${(e as Error).message}`,
          );
        }
      }
      return { checked: rows.length, credited, errors };
    } finally {
      this.running = false;
    }
  }

  /** Our own books must agree: units from succeeded UNITS payments equal what the PURCHASE ledger entries credited. */
  async ledgerCheck(): Promise<{
    paymentsMilli: number;
    ledgerMilli: number;
    ok: boolean;
  }> {
    const [p] = await this.prisma.$queryRaw<
      { s: bigint | null }[]
    >`SELECT COALESCE(SUM("unitsMilli"),0) AS s FROM "Payment" WHERE kind = 'UNITS' AND status = 'SUCCEEDED'`;
    const [l] = await this.prisma.$queryRaw<
      { s: bigint | null }[]
    >`SELECT COALESCE(SUM(e."deltaMilli"),0) AS s FROM "LedgerEntry" e JOIN "LedgerTransaction" t ON t.id = e."txnId" WHERE t.kind = 'PURCHASE' AND e.account = 'USER_WALLET'`;
    const paymentsMilli = Number(p?.s ?? 0);
    const ledgerMilli = Number(l?.s ?? 0);
    return { paymentsMilli, ledgerMilli, ok: paymentsMilli === ledgerMilli };
  }
}
