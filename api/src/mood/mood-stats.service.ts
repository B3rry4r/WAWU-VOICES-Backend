import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { RedisCache } from "../vote/redis-cache";
import type { Mood } from "../generated/prisma/client";
import {
  emptyCounts,
  MIN_GROUP,
  MOODS,
  percentOf,
  sitLine,
  totalOf,
  type MoodCounts,
  type Scope,
} from "./mood";

export interface MoodStats {
  questionId: string;
  /** When the counts were read, ms since epoch. */
  at: number;
  nigeria: MoodCounts;
  world: MoodCounts;
}

export interface WhereYouSit {
  mood: Mood;
  nigeria: { percent: number | null; voices: number | null };
  world: { percent: number | null; voices: number | null };
  /** The group the line speaks about: Nigeria when it has a percentage, else the world. */
  defaultScope: Scope;
  /** True when at least one group has a percentage, so the Nigeria / World switch is worth showing. */
  showSwitch: boolean;
  line: string;
  /** The same line as the card draws it: the word in lower case. */
  cardLine: string;
  updatedAt: string;
}

const KEY = (questionId: string) => `mood:stats:${questionId}`;
const KEY_TTL_SECONDS = 3600;
const REFRESH_MS = Number(process.env.MOOD_REFRESH_MS ?? 15_000);
/** A question nobody has read for this long stops being refreshed in the background. */
const IDLE_MS = 30 * 60_000;

interface Row {
  mood: Mood;
  ng: boolean;
  n: bigint;
}

/**
 * LCH-04: the counts behind "where you sit". A valid answer is the latest PUBLISHED, not deleted answer of a person
 * on that mood question, by a person who is not suspended, banned or deleted: one person counts once. The counts sit in
 * Redis (a request never counts rows) and a timer refreshes every question that was read lately, so a broadcast burst
 * costs one grouped query per question per refresh, not one per post or per read. If Redis is down the same counts are
 * held in this process for one refresh period.
 */
@Injectable()
export class MoodStatsService implements OnModuleDestroy {
  private readonly logger = new Logger(MoodStatsService.name);
  private readonly redis = new RedisCache();
  private readonly local = new Map<string, MoodStats>();
  private readonly lastRead = new Map<string, number>();
  private readonly loading = new Map<string, Promise<MoodStats>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {
    if (process.env.NODE_ENV !== "test") {
      this.timer = setInterval(() => void this.tick(), REFRESH_MS);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** The one database read: grouped counts for a question, by word and by Nigeria or not. */
  private async count(questionId: string): Promise<MoodStats> {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT l.mood::text AS mood, (l."countryCode" = 'NG') AS ng, count(*) AS n
      FROM (
        SELECT DISTINCT ON (a."authorId") a."authorId", a.mood, u."countryCode"
        FROM "Answer" a
        JOIN "User" u ON u.id = a."authorId"
        WHERE a."questionId" = ${questionId}
          AND a.mood IS NOT NULL
          AND a.status = 'PUBLISHED'
          AND a."deletedAt" IS NULL
          AND u.status NOT IN ('BANNED', 'DELETED', 'DELETION_PENDING')
          AND NOT (u.status = 'SUSPENDED' AND (u."suspendedUntil" IS NULL OR u."suspendedUntil" > now()))
        ORDER BY a."authorId", a."createdAt" DESC, a.id DESC
      ) l
      GROUP BY l.mood, (l."countryCode" = 'NG')`;
    const nigeria = emptyCounts();
    const world = emptyCounts();
    for (const r of rows) {
      const n = Number(r.n);
      world[r.mood] += n;
      if (r.ng) nigeria[r.mood] += n;
    }
    return { questionId, at: Date.now(), nigeria, world };
  }

  /** Recount now and store the result (the timer, the seed and the tests use this). */
  async refresh(questionId: string): Promise<MoodStats> {
    const running = this.loading.get(questionId);
    if (running) return running;
    const p = this.count(questionId)
      .then(async (s) => {
        this.local.set(questionId, s);
        await this.redis.setJson(KEY(questionId), s, KEY_TTL_SECONDS);
        return s;
      })
      .finally(() => this.loading.delete(questionId));
    this.loading.set(questionId, p);
    return p;
  }

  /** The stored counts. Only a question never counted (or whose key expired) reads the database. */
  async get(questionId: string): Promise<MoodStats> {
    this.lastRead.set(questionId, Date.now());
    const fromRedis = await this.redis.getJson<MoodStats>(KEY(questionId));
    if (fromRedis) return fromRedis;
    const mine = this.local.get(questionId);
    if (mine && Date.now() - mine.at < REFRESH_MS * 2) return mine;
    return this.refresh(questionId);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [qid, at] of this.lastRead) {
      if (now - at > IDLE_MS) {
        this.lastRead.delete(qid);
        this.local.delete(qid);
        continue;
      }
      await this.refresh(qid).catch((e) =>
        this.logger.warn(`mood refresh ${qid}: ${String(e)}`),
      );
    }
  }

  /**
   * Where a person sits. Their own answer is added when it is newer than the counts and is their only one on the
   * question, so the Posted screen never leaves them out of their own percentage.
   */
  async whereYouSit(answer: {
    id: string;
    questionId: string;
    authorId: string;
    mood: Mood;
    createdAt: Date;
    countryCode: string;
  }): Promise<WhereYouSit> {
    const s = await this.get(answer.questionId);
    const nigeria = { ...s.nigeria };
    const world = { ...s.world };
    if (answer.createdAt.getTime() > s.at) {
      const earlier = await this.prisma.answer.count({
        where: {
          questionId: answer.questionId,
          authorId: answer.authorId,
          mood: { not: null },
          status: "PUBLISHED",
          deletedAt: null,
          id: { not: answer.id },
        },
      });
      if (earlier === 0) {
        world[answer.mood] += 1;
        if (answer.countryCode === "NG") nigeria[answer.mood] += 1;
      }
    }
    const pn = percentOf(nigeria, answer.mood);
    const pw = percentOf(world, answer.mood);
    const defaultScope: Scope = pn !== null ? "NIGERIA" : "WORLD";
    return {
      mood: answer.mood,
      nigeria: {
        percent: pn,
        voices: totalOf(nigeria) >= MIN_GROUP ? totalOf(nigeria) : null,
      },
      world: {
        percent: pw,
        voices: totalOf(world) >= MIN_GROUP ? totalOf(world) : null,
      },
      defaultScope,
      showSwitch: pw !== null,
      line: sitLine(defaultScope === "NIGERIA" ? pn : pw, answer.mood, "upper"),
      cardLine: sitLine(
        defaultScope === "NIGERIA" ? pn : pw,
        answer.mood,
        "lower",
      ),
      updatedAt: new Date(s.at).toISOString(),
    };
  }

  /** Counts per word for the "How Nigeria feels so far" bar: everyone, whole numbers. */
  async perWord(questionId: string) {
    const s = await this.get(questionId);
    const total = totalOf(s.world);
    return {
      questionId,
      total,
      updatedAt: new Date(s.at).toISOString(),
      items: MOODS.map((mood) => ({
        mood,
        count: s.world[mood],
        percent: total ? Math.round((100 * s.world[mood]) / total) : 0,
      })),
    };
  }
}
