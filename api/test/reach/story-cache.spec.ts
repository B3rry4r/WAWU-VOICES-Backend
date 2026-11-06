import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import { MemoryCardStore, resetDb } from "./helpers";
import type { CardSize, CardSpec } from "../../src/reach/card-renderer";
import { StoryCache } from "../../src/reach/story-cache";

jest.setTimeout(120000);

/** STORY-CACHE: the story PNG is cached by spec, the link is checked first, the route is throttled, long words wrap. */
const OUT = process.env.STORY_OUT;

/** Decodes an 8-bit RGBA or RGB PNG as resvg writes it (non-interlaced). */
function decodePng(png: Buffer): {
  w: number;
  h: number;
  px: Buffer;
  bpp: number;
} {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const bpp = png[25] === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    if (png.toString("ascii", o + 4, o + 8) === "IDAT")
      idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = (v + add) & 255;
    }
  }
  return { w, h, px, bpp };
}

/** The left and right-most drawn column among the rows above `maxRow` (the main group, not the full-width button). */
function contentColumns(
  png: Buffer,
  maxRow: number,
): { left: number; right: number } {
  const { w, px, bpp } = decodePng(png);
  let left = w;
  let right = -1;
  for (let y = 0; y < maxRow; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * bpp;
      if (px[i] > 110 || px[i + 1] > 110 || px[i + 2] > 110) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  return { left, right };
}

describe("STORY-CACHE", () => {
  let jwks: TestJwks;
  let app: INestApplication;
  let prisma: import("../../src/common/prisma/prisma.service").PrismaService;
  let shares: import("../../src/reach/share.service").ShareService;
  let cards: import("../../src/reach/share.service").ShareCardService;
  let deletion: import("../../src/me/deletion.service").DeletionService;
  let real: import("../../src/reach/card-renderer").ResvgCardRenderer;
  const renders = { story: 0 };
  let n = 0;

  async function boot(): Promise<INestApplication> {
    const { AppModule } = await import("../../src/app.module.js");
    const { configureApp } = await import("../../src/app-config.js");
    const { CARD_STORE } = await import("../../src/reach/card-store.js");
    const { CARD_RENDERER } = await import("../../src/reach/card-renderer.js");
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CARD_STORE)
      .useValue(new MemoryCardStore())
      .overrideProvider(CARD_RENDERER)
      .useValue({
        render: (spec: CardSpec, size?: CardSize) => {
          if (size === "story") renders.story++;
          return real.render(spec, size);
        },
      })
      .compile();
    const a = mod.createNestApplication();
    configureApp(a);
    await a.init();
    return a;
  }

  beforeAll(async () => {
    jwks = new TestJwks();
    await jwks.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WAWU_ID_JWKS_URL = jwks.url;
    process.env.THROTTLE_LIMIT = "1000000";
    process.env.MEDIA_WORKER = "off";
    process.env.NODE_ENV = "test";
    const { ResvgCardRenderer } =
      await import("../../src/reach/card-renderer.js");
    const { PrismaService } =
      await import("../../src/common/prisma/prisma.service.js");
    const { ShareCardService, ShareService } =
      await import("../../src/reach/share.service.js");
    const { DeletionService } =
      await import("../../src/me/deletion.service.js");
    real = new ResvgCardRenderer();
    app = await boot();
    prisma = app.get(PrismaService);
    cards = app.get(ShareCardService);
    shares = app.get(ShareService);
    deletion = app.get(DeletionService);
    await resetDb();
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  afterAll(async () => {
    await cards.idle();
    await app.close();
    await jwks.stop();
  });

  async function person() {
    n++;
    const u = await prisma.user.create({
      data: {
        wawuId: `wawu-${randomUUID()}`,
        handle:
          `sc${Date.now().toString(36)}${n}${Math.floor(Math.random() * 1e3)}`.slice(
            0,
            20,
          ),
        referralCode: randomUUID().slice(0, 12),
        displayName: "Test Person",
        state: "Lagos",
      },
    });
    return u;
  }
  async function profileLink() {
    const u = await person();
    const v = await shares.createLink(null, {
      objectType: "PROFILE",
      objectId: u.id,
    });
    await cards.idle();
    return { u, code: v.code };
  }

  it("a second request for the same story is served from the cache (drawn once)", async () => {
    const { code } = await profileLink();
    const before = renders.story;
    const first = await request(app.getHttpServer() as App).get(
      `/api/v1/share/${code}/story`,
    );
    const second = await request(app.getHttpServer() as App).get(
      `/api/v1/share/${code}/story`,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(Buffer.compare(first.body, second.body)).toBe(0);
    expect(renders.story - before).toBe(1);
  });

  it("parallel requests for one story share one draw", async () => {
    const { code } = await profileLink();
    const before = renders.story;
    const all = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app.getHttpServer() as App).get(`/api/v1/share/${code}/story`),
      ),
    );
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(renders.story - before).toBe(1);
  });

  it("a purged person's story is a 404 even when it is cached", async () => {
    const { u, code } = await profileLink();
    const ok = await request(app.getHttpServer() as App).get(
      `/api/v1/share/${code}/story`,
    );
    expect(ok.status).toBe(200);
    expect(await cards.storyImage(code)).not.toBeNull(); // now in the cache
    await prisma.user.update({
      where: { id: u.id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 20 * 86_400_000),
      },
    });
    await deletion.purge(u.id);
    expect(await cards.storyImage(code)).toBeNull();
    const gone = await request(app.getHttpServer() as App).get(
      `/api/v1/share/${code}/story`,
    );
    expect(gone.status).toBe(404);
    // a deleted link row is a 404 too
    const second = await profileLink();
    expect(await cards.storyImage(second.code)).not.toBeNull();
    await prisma.shortLink.delete({ where: { code: second.code } });
    expect(await cards.storyImage(second.code)).toBeNull();
  });

  it("the cache is bounded by entries and by bytes, oldest-used out first", () => {
    const c = new StoryCache(3, 1000);
    c.set("a", Buffer.alloc(100));
    c.set("b", Buffer.alloc(100));
    c.set("c", Buffer.alloc(100));
    c.get("a"); // a is now the newest
    c.set("d", Buffer.alloc(100));
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBeDefined();
    expect(c.size).toBe(3);
    c.set("big", Buffer.alloc(950));
    expect(c.totalBytes).toBeLessThanOrEqual(1000);
    expect(c.get("big")).toBeDefined();
    expect(c.size).toBe(1);
    c.set("huge", Buffer.alloc(1001)); // never kept
    expect(c.get("huge")).toBeUndefined();
  });

  it("a 280 character unbroken quote stays inside x 80 to 1000", async () => {
    const base: CardSpec = {
      kind: "voice",
      label: "Nigeria · Today's question",
      headline: "@ngozi.e on salary day",
      args: [],
      rows: [],
      pollOpen: false,
      quote: null,
      summary: "Most voices so far lean towards: gone within a day.",
      basedOnVoices: 12480,
      updated: "12 min ago",
      newsTag: "verified",
      fallback: false,
      url: "wawuafrica.com/voices",
    };
    const unbroken = "WorkAndMoneyNeverMeet".repeat(14).slice(0, 280);
    expect(unbroken).toHaveLength(280);
    for (const [name, quote] of [
      ["wide", "W".repeat(280)],
      ["mixed", unbroken],
      ["short-long", `Hi ${"x".repeat(26)}`],
    ]) {
      const png = await real.render({ ...base, quote }, "story");
      if (OUT) writeFileSync(`${OUT}/story-unbroken-${name}.png`, png);
      const { left, right } = contentColumns(png, 1330);
      expect(left).toBeGreaterThanOrEqual(78);
      expect(right).toBeLessThanOrEqual(1000);
    }
  });

  it("the story route refuses the 61st request from one address in a minute", async () => {
    const { code } = await profileLink();
    const throttled = await boot(); // a fresh throttle window
    try {
      const get = () =>
        request(throttled.getHttpServer() as App).get(
          `/api/v1/share/${code}/story`,
        );
      const codes: number[] = [];
      for (let i = 0; i < 61; i++) codes.push((await get()).status);
      expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
      expect(codes[60]).toBe(429);
    } finally {
      await throttled.close();
    }
  });

  (process.env.STORY_TIMING ? it : it.skip)(
    "timing: /health while 20 parallel story requests run",
    async () => {
      const { code } = await profileLink();
      await app.listen(0);
      const port = (
        app.getHttpServer() as import("node:http").Server
      ).address() as { port: number };
      const base = `http://127.0.0.1:${port.port}`;
      const lat: number[] = [];
      let stop = false;
      const pinger = (async () => {
        while (!stop) {
          const t = performance.now();
          await fetch(`${base}/api/health`);
          lat.push(performance.now() - t);
          await new Promise((r) => setTimeout(r, 5));
        }
      })();
      await new Promise((r) => setTimeout(r, 100));
      const t0 = performance.now();
      const res = await Promise.all(
        Array.from({ length: 20 }, () =>
          fetch(`${base}/api/v1/share/${code}/story`).then((r) => r.status),
        ),
      );
      const total = performance.now() - t0;
      stop = true;
      await pinger;
      console.log(
        `TIMING statuses=${[...new Set(res)].join(",")} total=${total.toFixed(0)}ms health_max=${Math.max(...lat).toFixed(0)}ms health_n=${lat.length}`,
      );
    },
  );
});
