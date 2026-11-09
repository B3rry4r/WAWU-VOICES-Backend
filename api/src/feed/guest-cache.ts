import { Injectable } from "@nestjs/common";
import type { Response } from "express";

/** One response everybody who is not signed in may share. Never holds a person's own data (see FeedController). */
interface Entry {
  at: number;
  value?: unknown;
  pending?: Promise<unknown>;
}

const MAX_ENTRIES = 1000;

/**
 * LCH-09: a short in-memory cache for guest reads that are the same for everybody (today's question, a question, its
 * answers). The broadcast sends tens of thousands of people to the same few pages inside minutes; without this each
 * of them costs several database queries for an answer that is identical to the one before.
 *
 * The rules that keep it safe:
 *  - The caller only uses it when the request carried NO sign-in token, and loads with a viewer that is nobody. A
 *    signed-in person never reads from it and never writes to it.
 *  - The key is the route and its query, never a header, so there is no way for one person's data to sit under another's key.
 *  - Nothing in a cached body is personal. The one guest-specific field (iLiked, from X-Guest-Id) is added AFTER the read, on a copy.
 *  - A failure is not stored, and callers who arrive while a load is running share that one load (no stampede).
 *  - GUEST_CACHE_TTL_MS=0 switches it off. One API process runs on the droplet (V-23), so memory is the right place.
 */
@Injectable()
export class GuestReadCache {
  private entries = new Map<string, Entry>();

  private ttl(): number {
    const n = Number(process.env.GUEST_CACHE_TTL_MS ?? 5000);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Seconds a shared cache (nginx) may keep a guest answer; 0 when the cache is off. */
  sharedSeconds(): number {
    return Math.floor(this.ttl() / 1000);
  }

  clear(): void {
    this.entries.clear();
  }

  async wrap<T>(key: string, load: () => Promise<T>): Promise<T> {
    const ttl = this.ttl();
    if (ttl === 0) return load();
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit) {
      if (hit.pending) return hit.pending as Promise<T>;
      if (now - hit.at < ttl) return hit.value as T;
    }
    const pending = load().then(
      (value) => {
        this.entries.set(key, { at: Date.now(), value });
        return value;
      },
      (e: unknown) => {
        // A refusal (not found, bad query) is never kept; the next caller asks again.
        if (this.entries.get(key)?.pending === pending) this.entries.delete(key);
        throw e;
      },
    );
    this.entries.set(key, { at: now, pending });
    this.trim(now, ttl);
    return pending;
  }

  private trim(now: number, ttl: number): void {
    if (this.entries.size <= MAX_ENTRIES) return;
    for (const [k, v] of this.entries)
      if (!v.pending && now - v.at >= ttl) this.entries.delete(k);
    // Still too many (a walk through many cursors): drop the oldest first.
    for (const k of this.entries.keys()) {
      if (this.entries.size <= MAX_ENTRIES) break;
      this.entries.delete(k);
    }
  }
}

/**
 * What the response says about who may keep it. A guest answer is the same for everybody: a shared cache may hold it
 * for a few seconds. Anything for a signed-in person is private: no shared cache keeps it. `Vary: Authorization` stops
 * any cache from serving a guest copy to a request that carries a token.
 */
export function cacheHeaders(
  res: Response,
  signedIn: boolean,
  opts: { shared: number; sharedOk?: boolean },
): void {
  // A page that carries the guest's own likes also varies by the guest id; the others do not (so a proxy keeps one copy).
  res.setHeader(
    "Vary",
    opts.sharedOk === false ? "Authorization, X-Guest-Id" : "Authorization",
  );
  if (signedIn || opts.shared <= 0) {
    res.setHeader("Cache-Control", "private, no-cache");
    return;
  }
  res.setHeader("Cache-Control", `public, max-age=${opts.shared}`);
  // Only the reverse proxy reads this (nginx hides it from the visitor). Pages that vary by X-Guest-Id are not offered to it.
  if (opts.sharedOk !== false) res.setHeader("X-Accel-Expires", String(opts.shared));
}
