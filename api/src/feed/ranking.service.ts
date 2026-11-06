import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { Client } from "pg";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  RANKING_KEYS,
  rankingConfigFrom,
  type RankingConfig,
} from "./ranking.config";
import { scoreQuestion } from "./ranking.score";

/** Held by the one process that is running the job; another process skips its tick. */
export const RANKING_LOCK = 7_310_001;
/** Answers written per statement. Short statements keep the pool free for requests. */
const WRITE_CHUNK = 500;
/** A score that moved by less than this is not rewritten: the age decay alone shifts every old score a little each tick. */
const SCORE_EPSILON = 1e-6;

export interface RankingRun {
  /** False when another run (this process or another one) held the lock, so nothing was done. */
  ran: boolean;
  questions: number;
  answers: number;
  written: number;
  ms: number;
}

const SKIPPED: RankingRun = {
  ran: false,
  questions: 0,
  answers: 0,
  written: 0,
  ms: 0,
};

/**
 * What counts as a person for one answer (manipulation guard, ruling RK): an ACTIVE account (not suspended, deleting,
 * deleted or banned), never the answer's author, and nobody the author blocked or who blocked the author. `u` is the
 * User row of the person, `a` the answer. Each kind is counted once per person by the queries that use it.
 */
const person = Prisma.sql`u.status = 'ACTIVE' AND u.id <> a."authorId" AND NOT EXISTS (
  SELECT 1 FROM "Block" b WHERE (b."blockerId" = a."authorId" AND b."blockedId" = u.id)
                             OR (b."blockerId" = u.id AND b."blockedId" = a."authorId"))`;

interface SignalRow {
  id: string;
  createdAt: Date;
  likers: number;
  reactors: number;
  repliers: number;
  sharers: number;
  listeners: number;
  guestListeners: number;
  agreeRepliers: number;
  disagreeRepliers: number;
}

/**
 * The ranking job (ruling RK, brief v4.0 section 6.4). Every `ranking.interval_minutes` (5) it recomputes
 * Answer.rankScore and Answer.debateScore for the answers of questions that are open or closed within
 * `ranking.window_days` (7). It only reads counts of different people and writes two numbers, so running it twice, or
 * twenty times at once, gives the same result: runs in this process share one in-flight run, and a session advisory
 * lock lets one process at a time work. Questions go one at a time and writes go in chunks of 500 as their own short
 * statements, never inside an interactive transaction, so reads and writes of requests are not queued behind it.
 */
@Injectable()
export class RankingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RankingService.name);
  private timer?: NodeJS.Timeout;
  private inflight: Promise<RankingRun> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test" || process.env.RANKING_JOB === "off")
      return;
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** The first run is at boot; the next one is scheduled from the interval in config each time. */
  private async tick(): Promise<void> {
    let minutes = RANKING_KEYS[0].value;
    try {
      await this.run();
      minutes = (await this.config()).intervalMinutes;
    } catch (e) {
      this.logger.error(`ranking run failed: ${(e as Error).message}`);
    }
    this.timer = setTimeout(
      () => void this.tick(),
      Math.max(1, minutes) * 60_000,
    );
    this.timer.unref();
  }

  async config(): Promise<RankingConfig> {
    const rows = await this.prisma.configEntry.findMany({
      where: { key: { in: RANKING_KEYS.map((k) => k.key) } },
      select: { key: true, valueJson: true },
    });
    return rankingConfigFrom(rows);
  }

  /** One pass. Callers that arrive while a pass is running get that pass's result. */
  run(now = new Date()): Promise<RankingRun> {
    if (!this.inflight) {
      this.inflight = this.locked(now).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async locked(now: Date): Promise<RankingRun> {
    // A session lock on its own connection: the pool is not touched for it, and it is released if this process dies.
    const lock = new Client({ connectionString: process.env.DATABASE_URL });
    // A dropped lock connection (a restart, a network drop, pg_terminate_backend) is emitted as an 'error' event; with
    // no listener Node ends the whole process. The server frees the session lock when the connection goes, so the run
    // stops at the next question and the next tick starts again.
    const state = { lost: false };
    lock.on("error", (e: Error) => {
      state.lost = true;
      this.logger.error(`ranking lock connection lost: ${e.message}`);
    });
    await lock.connect();
    try {
      const got = await lock.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS ok",
        [RANKING_LOCK],
      );
      if (!got.rows[0]?.ok) return SKIPPED;
      try {
        return await this.pass(now, state);
      } finally {
        await lock
          .query("SELECT pg_advisory_unlock($1)", [RANKING_LOCK])
          .catch(() => undefined);
      }
    } finally {
      await lock.end().catch(() => undefined);
    }
  }

  private async pass(
    now: Date,
    state: { lost: boolean } = { lost: false },
  ): Promise<RankingRun> {
    const started = Date.now();
    const c = await this.config();
    const since = new Date(now.getTime() - c.windowDays * 86_400_000);
    const qs = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT q.id FROM "Question" q
      WHERE q.status IN ('SCHEDULED', 'LIVE', 'CLOSED')
        AND (q."endsAt" IS NULL OR q."endsAt" > ${since})
        AND (q.status <> 'CLOSED' OR COALESCE(q."endsAt", q."updatedAt") > ${since})
        -- the question bank holds about 1,000 scheduled questions with no answers: only a live question, or one with a
        -- published answer, has anything to score
        AND (q.status = 'LIVE' OR EXISTS (
          SELECT 1 FROM "Answer" a
          WHERE a."questionId" = q.id AND a.status = 'PUBLISHED' AND a."deletedAt" IS NULL))
      ORDER BY q.id`;
    let answers = 0;
    let written = 0;
    for (const q of qs) {
      if (state.lost) {
        this.logger.warn("ranking run stopped: the lock connection was lost");
        break;
      }
      const rows = await this.signals(q.id, c);
      answers += rows.length;
      const scored = scoreQuestion(rows, now, c);
      for (let i = 0; i < scored.length; i += WRITE_CHUNK) {
        const part = scored.slice(i, i + WRITE_CHUNK);
        written += await this.prisma.$executeRaw`
          UPDATE "Answer" SET "rankScore" = v.r, "debateScore" = v.d
          FROM unnest(${part.map((p) => p.id)}::text[], ${part.map((p) => p.rankScore)}::float8[],
                      ${part.map((p) => p.debateScore)}::float8[]) AS v(id, r, d)
          WHERE "Answer".id = v.id
            AND (abs("Answer"."rankScore" - v.r) > ${SCORE_EPSILON} OR abs("Answer"."debateScore" - v.d) > ${SCORE_EPSILON})`;
        await new Promise((r) => setImmediate(r));
      }
    }
    const run = {
      ran: true,
      questions: qs.length,
      answers,
      written,
      ms: Date.now() - started,
    };
    this.logger.log(
      `ranking: ${run.questions} questions, ${run.answers} answers, ${run.written} changed, ${run.ms} ms`,
    );
    return run;
  }

  /** Counts of different people per published answer of one question, in one statement. */
  private signals(questionId: string, c: RankingConfig): Promise<SignalRow[]> {
    return this.prisma.$queryRaw<SignalRow[]>`
      SELECT a.id, a."createdAt",
        (SELECT count(DISTINCT u.id) FROM "Like" x JOIN "User" u ON u.id = x."userId"
          WHERE x."answerId" = a.id AND ${person})::int AS likers,
        (SELECT count(DISTINCT u.id) FROM "Reaction" x JOIN "User" u ON u.id = x."userId"
          WHERE x."answerId" = a.id AND ${person})::int AS reactors,
        (SELECT count(DISTINCT u.id) FROM "ShareEvent" e
          JOIN "ShortLink" l ON l.id = e."linkId" AND l."objectType" = 'ANSWER' AND l."objectId" = a.id
          JOIN "User" u ON u.id = e."userId"
          WHERE e.kind = 'intent' AND ${person})::int AS sharers,
        -- LISTEN-1: people who played the voice to at least 90%. A signed-in person counts once (same exclusions as the
        -- other inputs); a guest counts once by visitor key (no account to exclude).
        (SELECT count(DISTINCT u.id) FROM "AnswerListen" x JOIN "User" u ON u.id = x."userId"
           WHERE x."answerId" = a.id AND x.finished AND ${person})::int AS listeners,
        (SELECT count(DISTINCT x."visitorKey") FROM "AnswerListen" x
           WHERE x."answerId" = a.id AND x.finished AND x."visitorKey" IS NOT NULL)::int AS "guestListeners",
        r.repliers, r."agreeRepliers", r."disagreeRepliers"
      FROM "Answer" a
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS repliers,
               count(*) FILTER (WHERE p.agrees AND NOT p.disagrees)::int AS "agreeRepliers",
               count(*) FILTER (WHERE p.disagrees AND NOT p.agrees)::int AS "disagreeRepliers"
        FROM (
          SELECT u.id, bool_or(x.stance = 'AGREE') AS agrees, bool_or(x.stance = 'DISAGREE') AS disagrees
          FROM "Reply" x JOIN "User" u ON u.id = x."authorId"
          WHERE x."answerId" = a.id AND x.status = 'PUBLISHED' AND x."deletedAt" IS NULL
            AND (x.kind = 'VOICE' OR char_length(btrim(COALESCE(x.body, ''))) >= ${c.meaningfulReplyChars})
            AND ${person}
          GROUP BY u.id
        ) p
      ) r ON true
      WHERE a."questionId" = ${questionId} AND a.status = 'PUBLISHED' AND a."deletedAt" IS NULL`;
  }
}
