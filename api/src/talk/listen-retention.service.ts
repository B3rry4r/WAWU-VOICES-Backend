import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { ConfigReader } from "./shared/config-reader";

const DAY = 24 * 60 * 60 * 1000;
const CHUNK = 5000;

/**
 * LISTEN-1 (LS5): a visitor who is not signed in has no account to delete, so their listen records expire: rows with
 * a visitorKey older than `privacy.listen_guest_days` (90) are deleted, in short statements of up to 5,000 rows.
 * Runs hourly; deleting twice is harmless.
 */
@Injectable()
export class ListenRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ListenRetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigReader,
  ) {}

  onModuleInit(): void {
    const every = Number(process.env.LISTEN_RETENTION_INTERVAL_MS ?? 3_600_000);
    if (process.env.NODE_ENV === "test" || !(every > 0)) return;
    this.timer = setInterval(() => {
      this.purgeGuests().catch((e) => this.logger.error(String(e)));
    }, every);
    this.timer.unref();
    this.purgeGuests().catch((e) => this.logger.error(String(e)));
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes guest rows whose last report is older than the configured days. Returns how many. */
  async purgeGuests(now = new Date()): Promise<number> {
    const days = await this.config.num("privacy.listen_guest_days");
    const cutoff = new Date(now.getTime() - Math.max(1, days) * DAY);
    let total = 0;
    for (;;) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM "AnswerListen" WHERE id IN (
          SELECT id FROM "AnswerListen"
          WHERE "visitorKey" IS NOT NULL AND "lastAt" < ${cutoff} LIMIT ${CHUNK})`;
      total += n;
      if (n < CHUNK) return total;
    }
  }
}
