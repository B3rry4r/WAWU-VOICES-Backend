import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

/**
 * lead ruling LF, 9 Nov: Fix my text results (the corrected text) live in IdempotencyRecord for 10 minutes only.
 * This job deletes every stored answer past its time, every minute, so the privacy line "up to 10 minutes" is true
 * (a row lives at most about 11). Deleting twice is harmless.
 */
export const TEXTFIX_CLEANUP_EVERY_MS = 60_000;

@Injectable()
export class TextFixCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TextFixCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const every = Number(
      process.env.TEXTFIX_CLEANUP_INTERVAL_MS ?? TEXTFIX_CLEANUP_EVERY_MS,
    );
    if (process.env.NODE_ENV === "test" || !(every > 0)) return;
    this.timer = setInterval(() => {
      this.run().catch((e) => this.logger.error(String(e)));
    }, every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes expired stored answers. Returns how many. */
  async run(now = new Date()): Promise<number> {
    const r = await this.prisma.idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    return r.count;
  }
}
