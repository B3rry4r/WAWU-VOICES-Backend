import { Injectable, Logger } from "@nestjs/common";

/**
 * The in-process job queue for clip processing. BullMQ is the planned queue (it is not a dependency yet: a package.json
 * change is a request), so this keeps the same shape: enqueue(id), a handler, and a sweep that re-queues work lost in a
 * restart. One process runs on the droplet, so an in-process queue with a database sweep loses nothing.
 */
@Injectable()
export class MediaJobs {
  private readonly logger = new Logger(MediaJobs.name);
  private handler: ((clipId: string) => Promise<void>) | null = null;
  private pending: string[] = [];
  private running = 0;
  private waiters: (() => void)[] = [];
  readonly concurrency = 2;

  setHandler(h: (clipId: string) => Promise<void>): void {
    this.handler = h;
  }

  enqueue(clipId: string): void {
    this.pending.push(clipId);
    this.pump();
  }

  private pump(): void {
    while (
      this.handler &&
      this.running < this.concurrency &&
      this.pending.length
    ) {
      const id = this.pending.shift() as string;
      this.running++;
      this.handler(id)
        .catch((e) => this.logger.error(`job ${id}: ${String(e)}`))
        .finally(() => {
          this.running--;
          this.pump();
          if (!this.running && !this.pending.length) {
            this.waiters.splice(0).forEach((w) => w());
          }
        });
    }
  }

  /** Resolves when nothing is queued or running (tests, shutdown). */
  idle(): Promise<void> {
    if (!this.running && !this.pending.length) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }
}
