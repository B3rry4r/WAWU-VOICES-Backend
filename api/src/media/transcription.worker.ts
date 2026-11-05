import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import type { Transcriber } from "../audio-ref/transcribe";
import { ClipsService } from "./clips.service";
import { MediaJobs } from "./media-jobs";
import { MEDIA_STORE, TRANSCRIBER, type ObjectStore } from "./object-store";

const MAX_TRIES = 3;

/**
 * Transcription queue (Gemini). A Transcript row in PENDING is the queue entry. Without a GEMINI_API_KEY there is no
 * transcriber: rows stay PENDING and no text is ever made up.
 */
@Injectable()
export class TranscriptionWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(TranscriptionWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private tries = new Map<string, number>();
  private busy: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clips: ClipsService,
    private readonly jobs: MediaJobs,
    @Inject(MEDIA_STORE) private readonly store: ObjectStore | null,
    @Optional()
    @Inject(TRANSCRIBER)
    private readonly transcriber: Transcriber | null,
  ) {}

  onApplicationBootstrap(): void {
    this.jobs.setHandler(async (id) => {
      await this.clips.process(id);
      await this.kick();
    });
    if (process.env.MEDIA_WORKER === "off") return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-queue clips a restart interrupted, then transcribe whatever is waiting. */
  async sweep(): Promise<void> {
    const stale = new Date(Date.now() - 5 * 60_000);
    await this.prisma.voiceClip.updateMany({
      // Judged by when processing started, not by when the upload finished (a clip uploaded long ago but claimed just
      // now is still being worked on). Rows from before the column existed fall back to uploadedAt.
      where: {
        status: "PROCESSING",
        OR: [
          { processingStartedAt: { lt: stale } },
          { processingStartedAt: null, uploadedAt: { lt: stale } },
        ],
      },
      data: { status: "UPLOADED", processingStartedAt: null },
    });
    const waiting = await this.prisma.voiceClip.findMany({
      where: { status: "UPLOADED" },
      select: { id: true },
      take: 50,
    });
    waiting.forEach((c) => this.jobs.enqueue(c.id));
    await this.kick();
  }

  /** Transcribe every READY clip whose transcript is PENDING. Safe to call at any time. */
  kick(): Promise<void> {
    this.busy = this.busy.then(() => this.runPending()).catch(() => undefined);
    return this.busy;
  }

  private async runPending(): Promise<void> {
    if (!this.transcriber || !this.store) return;
    const rows = await this.prisma.transcript.findMany({
      where: { status: "PENDING", clip: { status: "READY" } },
      include: { clip: true },
      take: 20,
      orderBy: { createdAt: "asc" },
    });
    for (const t of rows) {
      if (!t.clip.playKey) continue;
      try {
        const audio = await this.store.get(t.clip.playKey);
        const text = await this.transcriber.transcribe(
          audio,
          t.clip.playMime ?? "audio/mp4",
        );
        await this.prisma.transcript.update({
          where: { id: t.id },
          data: { status: "READY", text, readyAt: new Date() },
        });
      } catch (e) {
        const n = (this.tries.get(t.id) ?? 0) + 1;
        this.tries.set(t.id, n);
        this.logger.warn(`transcript ${t.id} try ${n}: ${String(e)}`);
        if (n >= MAX_TRIES)
          await this.prisma.transcript.update({
            where: { id: t.id },
            data: { status: "FAILED" },
          });
      }
    }
  }
}
