/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { BUSY_MESSAGE, busyMiddleware } from "../../src/common/busy/busy";
import { startHarness, type Harness } from "../talk/harness";

const REPO = join(__dirname, "..", "..", "..");
const EM_DASH = "—";

/** A fake request and response that record what the middleware did. */
function run(mw: ReturnType<typeof busyMiddleware>, path = "/api/v1/home") {
  const res = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>;
    statusCode?: number;
    body?: any;
    setHeader: (k: string, v: string) => void;
    status: (n: number) => any;
    json: (b: unknown) => void;
  };
  res.headers = {};
  res.setHeader = (k, v) => void (res.headers[k] = v);
  res.status = (n) => {
    res.statusCode = n;
    return res;
  };
  res.json = (b) => void (res.body = b);
  let passed = false;
  mw({ path, id: "req-1" } as unknown as Request, res as unknown as Response, (() => {
    passed = true;
  }) as NextFunction);
  return { res, passed, finish: () => res.emit("finish") };
}

describe("the API's own busy answer", () => {
  it("lets requests in until the limit, then says to come back, and lets in again as they finish", () => {
    const mw = busyMiddleware({
      maxInflight: 2,
      maxLagMs: 0,
      retryAfterSeconds: 60,
    });
    const a = run(mw);
    const b = run(mw);
    expect([a.passed, b.passed]).toEqual([true, true]);
    const c = run(mw);
    expect(c.passed).toBe(false);
    expect(c.res.statusCode).toBe(503);
    expect(c.res.headers["Retry-After"]).toBe("60");
    expect(c.res.headers["Cache-Control"]).toBe("no-store");
    expect(c.res.body).toEqual({
      error: {
        code: "UNAVAILABLE",
        message: "We are busy. Try again in a minute.",
        requestId: "req-1",
      },
    });
    a.finish();
    a.finish(); // a request finishing twice (finish then close) is counted once
    expect(run(mw).passed).toBe(true);
    expect(run(mw).passed).toBe(false);
  });

  it("says to come back when the event loop is far behind, and never turns the health check away", () => {
    let lag = 10;
    const mw = busyMiddleware({
      maxInflight: 0,
      maxLagMs: 1500,
      retryAfterSeconds: 30,
      lag: () => lag,
    });
    expect(run(mw).passed).toBe(true);
    lag = 2500;
    const r = run(mw);
    expect(r.passed).toBe(false);
    expect(r.res.headers["Retry-After"]).toBe("30");
    expect(run(mw, "/api/health").passed).toBe(true);
    lag = 100;
    expect(run(mw).passed).toBe(true);
  });

  it("the words are plain: no em-dash, a full stop at each end", () => {
    expect(BUSY_MESSAGE).toBe("We are busy. Try again in a minute.");
    expect(BUSY_MESSAGE).not.toContain(EM_DASH);
  });
});

describe("the busy answer in the running app", () => {
  let h: Harness;
  beforeAll(async () => {
    process.env.BUSY_MAX_INFLIGHT = "2";
    process.env.BUSY_MAX_LAG_MS = "0";
    h = await startHarness();
  });
  afterAll(async () => {
    delete process.env.BUSY_MAX_INFLIGHT;
    delete process.env.BUSY_MAX_LAG_MS;
    await h.close();
  });

  it("answers 503 in the one error shape when too many are in flight, and the health check stays up", async () => {
    const calls = Array.from({ length: 40 }, () =>
      h.http().get("/api/v1/questions/today"),
    );
    const rs = await Promise.all(calls);
    const busy = rs.filter((r) => r.status === 503);
    expect(busy.length).toBeGreaterThan(0);
    for (const r of busy) {
      expect(r.body.error.code).toBe("UNAVAILABLE");
      expect(r.body.error.message).toBe("We are busy. Try again in a minute.");
      expect(r.headers["retry-after"]).toBe("60");
      expect(typeof r.body.error.requestId).toBe("string");
    }
    // nothing but the busy answer and the normal answers (200, or 404 when this database has no question yet)
    for (const r of rs) expect([200, 404, 503]).toContain(r.status);
    await h.http().get("/api/health").expect(200);
  });
});

describe("the busy page nginx shows", () => {
  const page = readFileSync(join(REPO, "infra/nginx/busy.html"), "utf8");
  const site = readFileSync(join(REPO, "infra/nginx/voices.conf"), "utf8");

  it("says the plain words and no em-dash", () => {
    expect(page).toContain('content="We are busy. Try again in a minute."');
    expect(page).toContain("<h1>We are busy.</h1>");
    expect(page).toContain("<p>Try again in a minute.</p>");
    expect(page).not.toContain(EM_DASH);
    expect(page).not.toContain("&mdash;");
    expect(page).not.toMatch(/\bRant\b/);
  });

  it("is one self-contained file: no script, no outside address, light and dark", () => {
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/https?:\/\//i);
    expect(page).toContain("prefers-color-scheme: dark");
    expect(page).toContain('name="viewport"');
    expect(page).toContain('name="robots"');
  });

  it("is wired in: the pages show it, the API gets the one error shape, and nobody is cached on the busy answer", () => {
    expect(site).toMatch(/error_page\s+502\s+503\s+504\s+=503\s+\/busy\.html/);
    expect(site).toContain("UNAVAILABLE");
    expect(site).toContain("We are busy. Try again in a minute.");
    expect(site).not.toContain(EM_DASH);
    expect(site).toMatch(/limit_req_status\s+429/);
  });
});
