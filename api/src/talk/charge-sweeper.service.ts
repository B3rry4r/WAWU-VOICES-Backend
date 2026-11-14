import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { UnitsAccess } from "./shared/units-access";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
/** A post charge younger than this is left alone: its request may still be running. */
export const SWEEP_MIN_AGE_MS = 10 * MIN;
/** The post a request stores is written within seconds of its charge; a post this long after a charge is not its post. */
const POST_WINDOW_MS = 10 * MIN;
/** An unfinished retry record younger than this means a request is (or may be) still running for that key. */
const IN_FLIGHT_MS = 30 * MIN;
/** Older orphans are not swept (money charged long ago is settled by hand, never by a job guessing). */
const LOOKBACK_MS = 30 * DAY;

/**
 * V-HOTFIX-1 round 3: a person who paid and got nothing gets it back. Every 10 minutes it reverses each post charge
 * (POST_TEXT / POST_VOICE) that is still COMMITTED, is older than 10 minutes, and has no stored post:
 *  - `refId` is null (the request stores the link right after it writes the post, so a charge that belongs to a
 *    stored post carries it, even when the post was later deleted by its author or removed by a moderator);
 *  - no answer or reply of the same kind by the same person was created from the charge to 10 minutes after it
 *    (old charges from before the link existed, or a link that failed to save, are recognised this way);
 *  - no unfinished idempotency record for the same person and key younger than 30 minutes (a request in flight).
 * Reversal is the ledger's own `reverse`, which locks the wallet and does nothing the second time, so two instances
 * at once reverse a charge once and a free post comes back through the same call.
 */
@Injectable()
export class ChargeSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChargeSweeperService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsAccess,
  ) {}

  onModuleInit(): void {
    const every = Number(process.env.CHARGE_SWEEP_INTERVAL_MS ?? 10 * MIN);
    if (process.env.NODE_ENV === "test" || !(every > 0)) return;
    this.timer = setInterval(() => {
      this.sweep().catch((e) => this.logger.error(String(e)));
    }, every);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The ids of charges that paid for nothing, as of `now`. Pass `id` to re-check one charge. */
  private orphans(now: Date, id?: string): Promise<{ id: string }[]> {
    const before = new Date(now.getTime() - SWEEP_MIN_AGE_MS);
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const flight = new Date(now.getTime() - IN_FLIGHT_MS);
    const only = id ?? null;
    return this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Charge" c
      WHERE c."status" = 'COMMITTED'
        AND c."action" IN ('POST_TEXT', 'POST_VOICE')
        AND c."refId" IS NULL
        AND c."createdAt" < ${before}
        AND c."createdAt" >= ${since}
        AND (${only}::text IS NULL OR c."id" = ${only})
        AND NOT EXISTS (
          SELECT 1 FROM "Answer" a
          WHERE a."authorId" = c."userId"
            AND a."createdAt" >= c."createdAt"
            AND a."createdAt" <= c."createdAt" + ${POST_WINDOW_MS / 1000} * interval '1 second'
            AND (a."kind"::text = 'VOICE') = (c."action"::text = 'POST_VOICE'))
        AND NOT EXISTS (
          SELECT 1 FROM "Reply" r
          WHERE r."authorId" = c."userId"
            AND r."createdAt" >= c."createdAt"
            AND r."createdAt" <= c."createdAt" + ${POST_WINDOW_MS / 1000} * interval '1 second'
            AND (r."kind"::text = 'VOICE') = (c."action"::text = 'POST_VOICE'))
        AND NOT EXISTS (
          SELECT 1 FROM "IdempotencyRecord" i
          WHERE i."actorId" = c."userId" AND i."key" = c."idempotencyKey"
            AND i."completedAt" IS NULL AND i."createdAt" > ${flight})
      ORDER BY c."createdAt" ASC
      LIMIT 200`;
  }

  /** One pass. Returns how many charges this pass reversed. */
  async sweep(now = new Date()): Promise<number> {
    let done = 0;
    for (const { id } of await this.orphans(now)) {
      // Look again just before reversing: a replay may have stored the post since.
      if (!(await this.orphans(now, id)).length) continue;
      try {
        const r = await this.units.reverseCharge(id, "no post was stored");
        if (r) done++;
      } catch (e) {
        this.logger.error(`sweep ${id}: ${String(e)}`);
      }
    }
    if (done) this.logger.log(`reversed ${done} post charge(s) with no post`);
    return done;
  }
}
