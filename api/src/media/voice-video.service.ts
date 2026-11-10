import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { VoiceVideo } from "../generated/prisma/client";
import { webBase, apiBase } from "../reach/share.service";
import { lagosDay, nextLagosMidnight } from "../units/units.ledger";
import type { Profile } from "../talk/shared/profile.service";
import { MEDIA_STORE, type ObjectStore } from "./object-store";
import {
  MAX_SECONDS,
  SHAPES,
  renderVoiceVideo,
  type VideoShape,
} from "./voice-video-render";

/** Videos one person may ask for in a rolling day (a retry of a failed one counts again). */
export const VIDEOS_PER_PERSON_PER_DAY = Number(process.env.VIDEO_PER_DAY ?? 5);
/** Videos made at the same time. The rest wait in the queue. */
export const VIDEO_CONCURRENCY = Math.max(
  1,
  Math.min(2, Number(process.env.VIDEO_CONCURRENCY ?? 2)),
);

export interface VoiceVideoView {
  id: string;
  answerId: string;
  shape: VideoShape;
  status: "QUEUED" | "MAKING" | "READY" | "FAILED";
  durationMs: number | null;
  /** The file, for the author only; null until READY. */
  url: string | null;
  createdAt: string;
  readyAt: string | null;
}

const gone = () =>
  new NotFoundException({
    code: "NOT_FOUND",
    message: "We could not find that.",
  });

/** The answer is not one a video may be made from or served for: removed, deleted, held, or its person is leaving. */
const GONE_ANSWER = `(a.status IN ('REMOVED','DELETED_BY_AUTHOR') OR a."deletedAt" IS NOT NULL
  OR u.status IN ('DELETED','DELETION_PENDING','BANNED') OR u."deletionRequestedAt" IS NOT NULL)`;

/**
 * LCH-07: a short video of a person's own voice answer, made only when they ask. Built in the background by an
 * in-process queue (one process runs at launch, V-23): at most VIDEO_CONCURRENCY at a time, a per-person cap a day, and
 * a database sweep that re-queues work a restart interrupted. Privacy: only the answer's author can ask for or fetch
 * one; the file is served through this API on every request (never a link that outlives the answer), a removed or
 * deleted answer's videos are deleted with it, and the deletion purge removes the rest.
 */
@Injectable()
export class VoiceVideoService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(VoiceVideoService.name);
  private pending: string[] = [];
  private running = 0;
  private waiters: (() => void)[] = [];
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** How many were being made at once, at most (tests read it). */
  peakRunning = 0;
  /** The renderer; tests swap it for a quick one when they are testing the queue and not the picture. */
  render: typeof renderVoiceVideo = renderVoiceVideo;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORE) private readonly store: ObjectStore | null,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.MEDIA_WORKER === "off" || process.env.NODE_ENV === "test")
      return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
    this.timer.unref();
  }

  /** One sweep, never overlapping the last and never throwing: a failed sweep is logged and tried again next time. */
  private tick(): void {
    if (this.sweeping) return;
    this.sweeping = true;
    this.sweep()
      .catch((e) => this.logger.error(`video sweep: ${String(e)}`))
      .finally(() => {
        this.sweeping = false;
      });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private view(v: VoiceVideo): VoiceVideoView {
    return {
      id: v.id,
      answerId: v.answerId,
      shape: v.shape as VideoShape,
      status: v.status === "REMOVED" ? "FAILED" : v.status,
      durationMs: v.durationMs,
      url:
        v.status === "READY" && v.fileId
          ? `${apiBase()}/voice-videos/${v.id}/file`
          : null,
      createdAt: v.createdAt.toISOString(),
      readyAt: v.readyAt?.toISOString() ?? null,
    };
  }

  private async liveAnswer(answerId: string) {
    const a = await this.prisma.answer.findUnique({
      where: { id: answerId },
      include: {
        author: true,
        question: { select: { text: true, moodOptions: true } },
        clip: { include: { transcript: true } },
      },
    });
    if (
      !a ||
      a.status !== "PUBLISHED" ||
      a.deletedAt ||
      a.author.status === "DELETED" ||
      a.author.status === "DELETION_PENDING" ||
      a.author.status === "BANNED" ||
      a.author.deletionRequestedAt
    )
      return null;
    return a;
  }

  /** "Make a video": only the author of a published voice answer. Returns at once; the video is made in the background. */
  async request(me: Profile, answerId: string, shape: string) {
    if (!SHAPES.includes(shape as VideoShape))
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: { fields: [{ path: "shape", message: "Use 9x16 or 1x1." }] },
      });
    if (!this.store)
      throw new ServiceUnavailableException({
        code: "UNAVAILABLE",
        message: "Videos are not available right now.",
      });
    const a = await this.liveAnswer(answerId);
    if (!a) throw gone();
    if (a.authorId !== me.id)
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "You can only make a video of your own answer.",
      });
    if (
      a.kind !== "VOICE" ||
      !a.clip ||
      a.clip.status !== "READY" ||
      !a.clip.playKey
    )
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Only a voice answer can be made into a video.",
      });
    // One person's requests are taken one at a time, so a double tap is one build and the cap is exact.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"video:" + me.id}))`;
      const latest = await tx.voiceVideo.findFirst({
        where: { answerId, shape, status: { notIn: ["REMOVED", "FAILED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (latest) return { video: latest, fresh: false };
      // A Lagos day, the same rule as the 20 messages a day. Every build counts, whatever its outcome.
      const since = new Date(lagosDay().getTime() - 3_600_000);
      const today = await tx.voiceVideo.count({
        where: { authorId: me.id, createdAt: { gte: since } },
      });
      if (today >= VIDEOS_PER_PERSON_PER_DAY) {
        const resetsAt = nextLagosMidnight();
        throw new HttpException(
          {
            code: "RATE_LIMITED",
            message: `You can make ${VIDEOS_PER_PERSON_PER_DAY} videos a day. You can make more after midnight.`,
            details: {
              limit: VIDEOS_PER_PERSON_PER_DAY,
              resetsAt: resetsAt.toISOString(),
              retryAfterSeconds: Math.max(
                1,
                Math.ceil((resetsAt.getTime() - Date.now()) / 1000),
              ),
            },
          },
          429,
        );
      }
      const video = await tx.voiceVideo.create({
        data: { answerId, authorId: me.id, shape },
      });
      return { video, fresh: true };
    });
    if (row.fresh) this.enqueue(row.video.id);
    return this.view(row.video);
  }

  /** The author's videos of one answer, newest first. Anyone else gets a 404. */
  async list(me: Profile, answerId: string) {
    const a = await this.prisma.answer.findUnique({
      where: { id: answerId },
      select: { authorId: true },
    });
    if (!a || a.authorId !== me.id) throw gone();
    const live = await this.liveAnswer(answerId);
    if (!live) return { items: [] };
    const rows = await this.prisma.voiceVideo.findMany({
      where: { answerId, status: { notIn: ["REMOVED"] } },
      orderBy: { createdAt: "desc" },
    });
    // the newest build of each shape (an earlier failed one is history)
    const seen = new Set<string>();
    const latest = rows.filter(
      (r) => !seen.has(r.shape) && !!seen.add(r.shape),
    );
    return { items: latest.map((r) => this.view(r)) };
  }

  /** The MP4, for its author, while the answer is published. Everything else is a 404. */
  async file(me: Profile, id: string): Promise<Buffer> {
    const v = await this.prisma.voiceVideo.findUnique({ where: { id } });
    if (!v || v.authorId !== me.id || v.status !== "READY" || !v.fileId)
      throw gone();
    if (!(await this.liveAnswer(v.answerId))) throw gone();
    const f = await this.prisma.storedFile.findUnique({
      where: { id: v.fileId },
    });
    if (!f || f.purgedAt || f.purgeRequestedAt || !this.store) throw gone();
    try {
      return await this.store.get(f.key);
    } catch {
      throw gone();
    }
  }

  // ---------------------------------------------------------------- the queue

  enqueue(id: string): void {
    if (!this.pending.includes(id)) this.pending.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.running < VIDEO_CONCURRENCY && this.pending.length) {
      const id = this.pending.shift() as string;
      this.running++;
      this.peakRunning = Math.max(this.peakRunning, this.running);
      this.process(id)
        .catch((e) => this.logger.error(`video ${id}: ${String(e)}`))
        .finally(() => {
          this.running--;
          this.pump();
          if (!this.running && !this.pending.length)
            this.waiters.splice(0).forEach((w) => w());
        });
    }
  }

  /** Resolves when nothing is queued or being made (tests, shutdown). */
  idle(): Promise<void> {
    if (!this.running && !this.pending.length) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  /** Re-queue what a restart interrupted (QUEUED rows, and MAKING rows older than ten minutes). */
  async sweep(): Promise<void> {
    await this.prisma.voiceVideo.updateMany({
      where: {
        status: "MAKING",
        startedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      data: { status: "QUEUED", startedAt: null },
    });
    const waiting = await this.prisma.voiceVideo.findMany({
      where: { status: "QUEUED" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    waiting.forEach((w) => this.enqueue(w.id));
    await this.sweepGone();
  }

  private async fail(id: string, why: string): Promise<void> {
    const r = await this.prisma.voiceVideo.updateMany({
      where: { id, status: "MAKING" },
      data: { status: "FAILED", failureReason: why.slice(0, 300) },
    });
    if (r.count === 1) await this.notice(id, false);
  }

  /**
   * The in-app alert that a build finished or failed, opening the answer's share screen. One notice per build: the
   * group key is the build's own id and outcome, and the table's unique key makes a repeat write nothing.
   */
  private async notice(id: string, ok: boolean): Promise<void> {
    try {
      const v = await this.prisma.voiceVideo.findUnique({ where: { id } });
      if (!v) return;
      await this.prisma.notification.createMany({
        data: [
          {
            userId: v.authorId,
            type: "VIDEO_READY",
            title: ok
              ? "Your video is ready."
              : "We could not make your video. Try again.",
            body: ok
              ? "Open it to watch and share your video."
              : "Open your answer to ask for it again.",
            targetType: "answer",
            targetId: v.answerId,
            groupKey: `video:${v.id}:${ok ? "ready" : "failed"}`,
          },
        ],
        skipDuplicates: true,
      });
    } catch (e) {
      this.logger.warn(`video notice ${id}: ${String(e)}`);
    }
  }

  async process(id: string): Promise<void> {
    const claimed = await this.prisma.voiceVideo.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: "MAKING", startedAt: new Date() },
    });
    if (claimed.count === 0 || !this.store) return;
    const v = await this.prisma.voiceVideo.findUniqueOrThrow({ where: { id } });
    const a = await this.liveAnswer(v.answerId);
    if (!a || !a.clip?.playKey) {
      await this.sweepGone();
      return;
    }
    let key: string | null = null;
    try {
      const audio = await this.store.get(a.clip.playKey);
      const showName = a.showNameOnCard && !a.anonymous;
      const place = a.author.state ?? a.author.city ?? null;
      const who = showName
        ? [a.author.displayName?.trim() || `@${a.author.handle}`, place]
            .filter(Boolean)
            .join(" · ")
        : null;
      const made = await this.render({
        shape: v.shape as VideoShape,
        question: a.question.text,
        mood: a.mood,
        who,
        transcript:
          a.clip.transcript?.status === "READY" ? a.clip.transcript.text : null,
        audio,
        durationMs: a.clip.durationMs
          ? Math.min(a.clip.durationMs, MAX_SECONDS * 1000)
          : null,
        host: webBase().replace(/^https?:\/\//, ""),
      });
      key = await this.store.putVideo(made.mp4);
      const file = await this.prisma.storedFile.create({
        data: {
          ownerId: v.authorId,
          kind: "VOICE_VIDEO",
          key,
          mime: "video/mp4",
          bytes: made.mp4.length,
          confirmedAt: new Date(),
        },
      });
      const done = await this.prisma.voiceVideo.updateMany({
        where: { id, status: "MAKING" },
        data: {
          status: "READY",
          fileId: file.id,
          durationMs: made.durationMs,
          readyAt: new Date(),
        },
      });
      if (done.count === 0) {
        // the answer was removed while it was being made: the file goes at once
        await this.prisma.storedFile.update({
          where: { id: file.id },
          data: { purgeRequestedAt: new Date() },
        });
        await this.store.delete(key).catch(() => undefined);
      } else await this.notice(id, true);
    } catch (e) {
      this.logger.warn(`video ${id}: ${String(e)}`);
      await this.fail(id, String(e));
    }
  }

  // ---------------------------------------------------------------- removal

  /**
   * Videos of answers that are removed or deleted, or whose person is leaving or banned: the row becomes REMOVED (never
   * served again), and its file is handed to the storage purge job, which deletes it from Spaces. Safe to repeat.
   */
  async sweepGone(): Promise<number> {
    // First look, with no locks at all: most of the time there is nothing to do and nothing is locked.
    const gone = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT v.id FROM "VoiceVideo" v
       JOIN "Answer" a ON a.id = v."answerId" JOIN "User" u ON u.id = a."authorId"
       WHERE v.status <> 'REMOVED' AND ${GONE_ANSWER} LIMIT 200`,
    );
    if (!gone.length) return 0;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`);
        // One fixed order everywhere: VoiceVideo rows first (skipping any another process holds), then StoredFile.
        const ids = gone.map((g) => g.id);
        const done = await tx.$queryRaw<{ fileId: string | null }[]>`
          WITH old AS (
            SELECT id, "fileId" FROM "VoiceVideo" WHERE id = ANY(${ids}) AND status <> 'REMOVED'
            ORDER BY id FOR UPDATE SKIP LOCKED
          ), upd AS (
            UPDATE "VoiceVideo" v SET status = 'REMOVED', "fileId" = NULL FROM old WHERE v.id = old.id RETURNING old."fileId" AS "fileId"
          ) SELECT "fileId" FROM upd`;
        const files = done
          .map((d) => d.fileId)
          .filter((f): f is string => !!f)
          .sort();
        if (files.length)
          await tx.$executeRaw`
            UPDATE "StoredFile" SET "purgeRequestedAt" = now()
            WHERE id = ANY(${files}) AND "purgedAt" IS NULL AND "purgeRequestedAt" IS NULL`;
        return done.length;
      });
    } catch (e) {
      // a lock that would not come in 2 seconds: leave it for the next sweep
      this.logger.warn(`video sweepGone: ${String(e)}`);
      return 0;
    }
  }
}
