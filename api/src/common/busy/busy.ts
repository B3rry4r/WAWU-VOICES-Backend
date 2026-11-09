import { monitorEventLoopDelay } from "node:perf_hooks";
import type { NextFunction, Request, Response } from "express";

export const BUSY_MESSAGE = "We are busy. Try again in a minute.";

export interface BusyOptions {
  /** Requests being worked on at once, above which the next one is told to come back. 0 switches the check off. */
  maxInflight: number;
  /** Event loop delay (p99 over the last second, in ms) above which the next one is told to come back. 0 switches it off. */
  maxLagMs: number;
  /** How long the answer says to wait (Retry-After, seconds). */
  retryAfterSeconds: number;
  /** For tests: the current lag in ms. Defaults to a real event loop monitor. */
  lag?: () => number;
}

/**
 * The limits come from BUSY_MAX_INFLIGHT, BUSY_MAX_LAG_MS and BUSY_RETRY_AFTER_SECONDS. In production they default to 800
 * requests at once and 1.5 s of event loop delay. Outside production they are off unless one of them is set, so a slow
 * test machine never answers "busy" to a test that did not ask for it.
 */
export function busyOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BusyOptions {
  const asked =
    env.BUSY_MAX_INFLIGHT !== undefined || env.BUSY_MAX_LAG_MS !== undefined;
  const on = env.NODE_ENV === "production" || asked;
  const n = (k: string, d: number) => {
    const v = Number(env[k] ?? d);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    maxInflight: on ? n("BUSY_MAX_INFLIGHT", 800) : 0,
    maxLagMs: on ? n("BUSY_MAX_LAG_MS", 1500) : 0,
    retryAfterSeconds: n("BUSY_RETRY_AFTER_SECONDS", 60) || 60,
  };
}

/** The p99 event loop delay of the last second, refreshed once a second. */
function realLag(): () => number {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  let last = 0;
  const t = setInterval(() => {
    last = h.percentile(99) / 1e6;
    h.reset();
  }, 1000);
  t.unref();
  return () => last;
}

/**
 * LCH-09: the API's own "we are busy" answer. When too many requests are in flight, or the event loop is running far
 * behind, the next request is answered at once with 503 and the one error shape, instead of joining a queue that
 * only gets longer. nginx shows its own busy page for the web pages and for a 502 or 504 from this process.
 * /api/health is never turned away, so the check that decides a restart still tells the truth.
 */
export function busyMiddleware(opts: BusyOptions) {
  let inflight = 0;
  const lag = opts.lag ?? (opts.maxLagMs > 0 ? realLag() : () => 0);
  return (
    req: Request & { id?: string },
    res: Response,
    next: NextFunction,
  ) => {
    if (req.path.startsWith("/api/health")) return next();
    const over =
      (opts.maxInflight > 0 && inflight >= opts.maxInflight) ||
      (opts.maxLagMs > 0 && lag() >= opts.maxLagMs);
    if (over) {
      res.setHeader("Retry-After", String(opts.retryAfterSeconds));
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({
        error: {
          code: "UNAVAILABLE",
          message: BUSY_MESSAGE,
          requestId: req.id,
        },
      });
      return;
    }
    inflight++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      inflight--;
    };
    res.on("close", end);
    res.on("finish", end);
    next();
  };
}
