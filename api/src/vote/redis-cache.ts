import { Injectable, Logger } from "@nestjs/common";
import { connect } from "node:net";

type Reply = string | number | null | Reply[] | Error;

/** Parse one RESP reply from the front of buf; null when it is not all here yet. */
function parse(buf: Buffer, at = 0): [Reply, number] | null {
  if (at >= buf.length) return null;
  const eol = buf.indexOf("\r\n", at);
  if (eol < 0) return null;
  const type = String.fromCharCode(buf[at]);
  const line = buf.toString("utf8", at + 1, eol);
  const next = eol + 2;
  if (type === "+") return [line, next];
  if (type === "-") return [new Error(line), next];
  if (type === ":") return [Number(line), next];
  if (type === "$") {
    const n = Number(line);
    if (n < 0) return [null, next];
    if (buf.length < next + n + 2) return null;
    return [buf.toString("utf8", next, next + n), next + n + 2];
  }
  if (type === "*") {
    const n = Number(line);
    const out: Reply[] = [];
    let pos = next;
    for (let i = 0; i < n; i++) {
      const r = parse(buf, pos);
      if (!r) return null;
      out.push(r[0]);
      pos = r[1];
    }
    return [out, pos];
  }
  return [new Error("bad reply"), next];
}

/**
 * A small Redis client over node:net (no new dependency). One short connection per call, which is cheap on the same
 * host. Every method fails soft: when Redis is down the caller falls back to the database counters, never to a row count.
 * REDIS_URL carries the db index (redis://127.0.0.1:14002/4).
 */
@Injectable()
export class RedisCache {
  private readonly logger = new Logger(RedisCache.name);
  private warned = false;

  private target(): { host: string; port: number; db: number } {
    const u = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:14002/0");
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      db: Number(u.pathname.slice(1) || 0),
    };
  }

  private run(cmds: string[][]): Promise<Reply[]> {
    const { host, port, db } = this.target();
    const all = [["SELECT", String(db)], ...cmds];
    const wire = all
      .map(
        (c) =>
          `*${c.length}\r\n` +
          c.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join(""),
      )
      .join("");
    return new Promise((resolve, reject) => {
      const sock = connect({ host, port });
      let buf = Buffer.alloc(0);
      const replies: Reply[] = [];
      const done = (err?: Error): void => {
        sock.destroy();
        if (err) reject(err);
        else resolve(replies.slice(1));
      };
      sock.setTimeout(500, () => done(new Error("redis timeout")));
      sock.on("error", done);
      sock.on("connect", () => sock.write(wire));
      sock.on("data", (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          const r = parse(buf);
          if (!r) break;
          replies.push(r[0]);
          buf = buf.subarray(r[1]);
        }
        if (replies.length === all.length) done();
      });
    });
  }

  private async safe(cmds: string[][]): Promise<Reply[] | null> {
    try {
      return await this.run(cmds);
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(`Redis unavailable, using the database: ${String(e)}`);
      }
      return null;
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const r = await this.safe([["GET", key]]);
    const v = r?.[0];
    if (typeof v !== "string") return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.safe([
      ["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)],
    ]);
  }

  async del(key: string): Promise<void> {
    await this.safe([["DEL", key]]);
  }

  /** Fixed-window counter. Returns the count and seconds left, or null when Redis is down. */
  async hit(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttl: number } | null> {
    const r = await this.safe([
      ["INCR", key],
      ["EXPIRE", key, String(windowSeconds), "NX"],
      ["TTL", key],
    ]);
    if (!r || typeof r[0] !== "number") return null;
    const ttl = typeof r[2] === "number" && r[2] > 0 ? r[2] : windowSeconds;
    return { count: r[0], ttl };
  }
}
