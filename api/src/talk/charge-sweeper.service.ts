import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { UnitsAccess } from "./shared/units-access";

const MIN = 60 * 1000;
/** A post charge younger than this is left alone: its request may still be running. 30 minutes. */
export const SWEEP_MIN_AGE_MS = 30 * MIN;
/** A retry record that has stayed unfinished longer than this (30 minutes) is dead: no request runs that long. */
export const DEAD_RECORD_MS = 30 * MIN;
/** Rows read per page, and pages per pass (a pass looks at most PAGE * MAX_PAGES charges). */
const PAGE = 200;
const MAX_PAGES = 50;
/** How long after a charge its post can have been stored and still be matched to it by the repair. */
const HEAL_WINDOW_MIN = 10;

/** A charge whose reversal threw is not tried again by this instance for this long. */
const RETRY_FAILED_AFTER_MS = 60 * MIN;

type Candidate = { id: string; createdAt: Date };

/**
 * V-HOTFIX-1 round 4: a person who paid and got nothing gets it back. The job runs every 10 minutes and reverses each post charge
 * that is an ORPHAN, and only those:
 *  - action POST_TEXT or POST_VOICE (a text or voice answer, or a reply), status COMMITTED;
 *  - `refType` is set and `refId` is null. THIS code writes `refType` (what the post is) on the charge in the statement
 *    that creates it (`spendThen` passes it to the ledger), and `refId` right after the post is stored; the old code
 *    never wrote either. So a marked, unlinked charge is one this code made, and a charge with no mark (made by the
 *    old code, e.g. while a deploy was rolled back) is never read, whatever the clock says. Every post made by this
 *    code links its charge, also when the post is later deleted by its author or removed by a moderator, so an unlinked
 *    committed charge paid for a post that was never stored. There is NO matching on post content or on other posts;
 *  - made after the start time `ChargeSweeperState.startAt`. The migration 20261114220000_hotfix_1 creates the row with
 *    NO start time; this service stamps it with the current time, once, the first time the code boots (`stampStart`,
 *    in `onModuleInit`; later boots never move it). Charges made by earlier code never linked their post and are never
 *    read here, and while there is no start time the sweeper reads nothing;
 *  - older than 30 minutes;
 *  - no unfinished retry record younger than 30 minutes for the same person and key (a request in flight or a fresh retry).
 * The reversal is the ledger's own, run with a guard INSIDE its transaction (wallet row locked): the guard looks at the
 * four conditions again and, in the same transaction, deletes the dead unfinished retry record of that request. A retry
 * with the same key then reaches the ledger and is answered at once with 409 CONFLICT "start again with a new key",
 * never REQUEST_IN_PROGRESS. Reversing is once per charge and a used free post comes back in the same call.
 * Dead unfinished retry records of post requests that never charged anything (or whose charge is linked or already
 * reversed) are deleted too, so the retry simply runs. A record younger than 30 minutes is never touched.
 * A candidate whose reversal throws is logged and left; the pass goes on (the next page starts after it).
 */
@Injectable()
export class ChargeSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChargeSweeperService.name);
  private timer?: NodeJS.Timeout;
  /** charge id -> time before which this instance does not try it again (its reversal threw). */
  private readonly failed = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly units: UnitsAccess,
  ) {}

  /**
   * Sets the start time to `now` if, and only if, it is not set yet. One statement: when several processes boot at once
   * the row is locked and exactly one value is stored; a later boot finds it set and changes nothing. Returns the start
   * time in force. Never throws: when it fails the sweeper simply stays idle (no start time, nothing read).
   */
  async stampStart(now = new Date()): Promise<Date | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ startAt: Date }[]>`
        INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, ${now})
        ON CONFLICT ("id") DO UPDATE
          SET "startAt" = COALESCE("ChargeSweeperState"."startAt", EXCLUDED."startAt")
        RETURNING "startAt"`;
      return rows[0]?.startAt ?? null;
    } catch (e) {
      this.logger.error(`sweeper start time not stamped: ${String(e)}`);
      return null;
    }
  }

  /**
   * One-time, idempotent repair, run at every start before the sweeper loops (V-LINK-IN-TX round 2). Code from before
   * the link moved into the post's own transaction could leave a stored post whose marked charge was still unlinked; the
   * sweeper would then give that post back for free. A marked, COMMITTED, unlinked charge is linked to its post only when
   * it is unambiguous: same person, same kind, the post created at or after the charge and within HEAL_WINDOW_MIN
   * minutes, the post has no charge linked yet, and no other such charge or post competes for the pair. Anything else is
   * left as it was (the sweeper still treats a charge with no post as an orphan) and only counted. Safe to run twice and
   * on a database with none of these rows. Returns the counts (no personal data) and never throws.
   */
  async healUnlinked(): Promise<{ linked: number; ambiguous: number }> {
    let linked = 0;
    let ambiguous = 0;
    try {
      for (const [refType, table] of [
        ["answer", "Answer"],
        ["reply", "Reply"],
      ] as const) {
        const rows = await this.prisma.$queryRawUnsafe<
          { linked: number; ambiguous: number }[]
        >(
          `WITH pairs AS (
             SELECT c."id" AS cid, p."id" AS pid FROM "Charge" c
             JOIN "${table}" p ON p."authorId" = c."userId"
              AND p."kind" = (CASE c."action" WHEN 'POST_TEXT' THEN 'TEXT' ELSE 'VOICE' END)::"PostKind"
              AND p."createdAt" >= c."createdAt"
              AND p."createdAt" <= c."createdAt" + make_interval(mins => ${HEAL_WINDOW_MIN})
             WHERE c."status" = 'COMMITTED' AND c."refId" IS NULL AND c."refType" = '${refType}'
               AND c."action" IN ('POST_TEXT', 'POST_VOICE')
               AND NOT EXISTS (SELECT 1 FROM "Charge" x WHERE x."refId" = p."id")
           ), counted AS (
             SELECT cid, pid, count(*) OVER (PARTITION BY cid) AS per_charge, count(*) OVER (PARTITION BY pid) AS per_post
             FROM pairs
           ), done AS (
             UPDATE "Charge" c SET "refId" = k.pid FROM counted k
             WHERE c."id" = k.cid AND k.per_charge = 1 AND k.per_post = 1
               AND c."refId" IS NULL AND c."status" = 'COMMITTED'
             RETURNING c."id"
           )
           SELECT (SELECT count(*) FROM done)::int AS linked,
                  (SELECT count(DISTINCT cid) FROM counted WHERE per_charge > 1 OR per_post > 1)::int AS ambiguous`,
        );
        linked += rows[0]?.linked ?? 0;
        ambiguous += rows[0]?.ambiguous ?? 0;
      }
      if (linked || ambiguous)
        this.logger.log(
          `linked ${linked} unlinked post charge(s) to their stored post; left ${ambiguous} ambiguous one(s) alone`,
        );
    } catch (e) {
      this.logger.error(`unlinked post charges not healed: ${String(e)}`);
    }
    return { linked, ambiguous };
  }

  async onModuleInit(): Promise<void> {
    await this.stampStart();
    await this.healUnlinked();
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

  /**
   * One page of orphans after (`afterAt`, `afterId`), oldest first. Written with the literal conditions of the partial
   * index "Charge_sweep_idx" so the planner reads only the unlinked committed post charges.
   */
  private page(
    now: Date,
    afterAt: Date,
    afterId: string,
  ): Promise<Candidate[]> {
    const before = new Date(now.getTime() - SWEEP_MIN_AGE_MS);
    const flight = new Date(now.getTime() - DEAD_RECORD_MS);
    return this.prisma.$queryRaw<Candidate[]>`
      SELECT c."id", c."createdAt" FROM "Charge" c
      WHERE c."status" = 'COMMITTED'
        AND c."refId" IS NULL
        AND c."action" IN ('POST_TEXT', 'POST_VOICE')
        AND c."refType" IS NOT NULL
        AND c."createdAt" > (SELECT s."startAt" FROM "ChargeSweeperState" s WHERE s."id" = 1)
        AND c."createdAt" < ${before}
        AND (c."createdAt", c."id") > (${afterAt}, ${afterId})
        AND NOT EXISTS (
          SELECT 1 FROM "IdempotencyRecord" i
          WHERE i."actorId" = c."userId" AND i."key" = c."idempotencyKey"
            AND i."completedAt" IS NULL AND i."createdAt" > ${flight})
      ORDER BY c."createdAt" ASC, c."id" ASC
      LIMIT ${PAGE}`;
  }

  /** One pass. Returns how many charges this pass reversed. */
  async sweep(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - SWEEP_MIN_AGE_MS);
    const flight = new Date(now.getTime() - DEAD_RECORD_MS);
    let done = 0;
    let afterAt = new Date(0);
    let afterId = "";
    for (let p = 0; p < MAX_PAGES; p++) {
      const rows = await this.page(now, afterAt, afterId);
      for (const { id } of rows) {
        const retryAt = this.failed.get(id);
        if (retryAt !== undefined && retryAt > now.getTime()) continue;
        try {
          const reversed = await this.units.reverseGuarded(
            id,
            "no post was stored",
            async (tx, c) => {
              // Under the wallet lock: the same four conditions again, then the dead record goes in this transaction.
              const still = await tx.$queryRaw<{ one: number }[]>`
                SELECT 1 AS one FROM "Charge" c
                WHERE c."id" = ${c.id} AND c."status" = 'COMMITTED' AND c."refId" IS NULL
                  AND c."action" IN ('POST_TEXT', 'POST_VOICE')
                  AND c."refType" IS NOT NULL
                  AND c."createdAt" > (SELECT s."startAt" FROM "ChargeSweeperState" s WHERE s."id" = 1)
                  AND c."createdAt" < ${before}
                  AND NOT EXISTS (
                    SELECT 1 FROM "IdempotencyRecord" i
                    WHERE i."actorId" = c."userId" AND i."key" = c."idempotencyKey"
                      AND i."completedAt" IS NULL AND i."createdAt" > ${flight})
                FOR UPDATE OF c`;
              if (!still.length) return false;
              await tx.$executeRaw`
                DELETE FROM "IdempotencyRecord"
                WHERE "actorId" = ${c.userId} AND "key" = ${c.idempotencyKey} AND "completedAt" IS NULL`;
              return true;
            },
          );
          this.failed.delete(id);
          if (reversed) done++;
        } catch (e) {
          this.failed.set(id, now.getTime() + RETRY_FAILED_AFTER_MS);
          this.logger.error(`sweep ${id}: ${String(e)}`);
        }
      }
      if (rows.length < PAGE) break;
      const last = rows[rows.length - 1];
      afterAt = last.createdAt;
      afterId = last.id;
    }
    if (this.failed.size > 5000) this.failed.clear();
    const dead = await this.clearDeadRecords(flight);
    if (done || dead)
      this.logger.log(
        `reversed ${done} post charge(s) with no post; removed ${dead} dead retry record(s)`,
      );
    return done;
  }

  /**
   * Unfinished retry records of post requests that stayed unfinished for more than 30 minutes are dead: removed, so a
   * retry with the same key reaches the ledger (answered by what the ledger holds: the stored post, the old charge, a
   * reversed charge, or nothing, in which case it simply runs). Younger records are never touched.
   */
  private async clearDeadRecords(before: Date): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "IdempotencyRecord"
      WHERE "completedAt" IS NULL AND "createdAt" < ${before}
        AND "method" = 'POST' AND "path" ~ '/(answers|replies)$'`;
  }
}
