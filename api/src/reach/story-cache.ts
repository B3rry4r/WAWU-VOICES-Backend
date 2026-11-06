import { createHash } from "node:crypto";

/**
 * A bounded in-memory LRU for the Instagram Stories PNG. The key is a hash of the render spec, so a card whose look
 * changed (new counts, a flagged post) is a different entry and an old picture is never served for it. It holds at most
 * STORY_CACHE_MAX_ENTRIES pictures and STORY_CACHE_MAX_BYTES bytes, whichever limit is hit first; the oldest-used goes.
 */
export const STORY_CACHE_MAX_ENTRIES = 200;
export const STORY_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export function storyCacheKey(spec: unknown): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

export class StoryCache {
  private readonly map = new Map<string, Buffer>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = STORY_CACHE_MAX_ENTRIES,
    private readonly maxBytes = STORY_CACHE_MAX_BYTES,
  ) {}

  get(key: string): Buffer | undefined {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }

  set(key: string, png: Buffer): void {
    if (png.length > this.maxBytes) return;
    const old = this.map.get(key);
    if (old) {
      this.bytes -= old.length;
      this.map.delete(key);
    }
    this.map.set(key, png);
    this.bytes += png.length;
    for (const [k, v] of this.map) {
      if (this.map.size <= this.maxEntries && this.bytes <= this.maxBytes)
        break;
      this.map.delete(k);
      this.bytes -= v.length;
    }
  }

  get size(): number {
    return this.map.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }
}
