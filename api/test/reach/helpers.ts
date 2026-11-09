import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import type { CardStore } from "../../src/reach/card-store";
import type { CardRenderer } from "../../src/reach/card-renderer";

/** In-memory stand-in for Spaces. Test fixture only: the real store is SpacesCardStore. */
export class MemoryCardStore implements CardStore {
  objects = new Map<string, Buffer>();
  failPuts = false;
  failGets = false;
  put(key: string, body: Buffer): Promise<void> {
    if (this.failPuts) return Promise.reject(new Error("storage down"));
    this.objects.set(key, body);
    return Promise.resolve();
  }
  get(key: string): Promise<Buffer | null> {
    if (this.failGets) return Promise.reject(new Error("storage down"));
    return Promise.resolve(this.objects.get(key) ?? null);
  }
}

export interface Harness {
  app: INestApplication;
  jwks: TestJwks;
  store: MemoryCardStore;
  renders: { count: number };
  http: () => ReturnType<typeof request>;
  tokenFor: (sub: string) => string;
  close: () => Promise<void>;
  prisma: import("../../src/common/prisma/prisma.service").PrismaService;
  reach: import("../../src/reach/reach.service").ReachService;
  weekly: import("../../src/reach/weekly.service").WeeklyService;
  cards: import("../../src/reach/share.service").ShareCardService;
}

export async function startHarness(): Promise<Harness> {
  const jwks = new TestJwks();
  await jwks.start();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.WAWU_ID_JWKS_URL = jwks.url;
  process.env.NODE_ENV = "test";
  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/app-config.js");
  const { CARD_STORE } = await import("../../src/reach/card-store.js");
  const { CARD_RENDERER, ResvgCardRenderer } =
    await import("../../src/reach/card-renderer.js");
  const { PrismaService } =
    await import("../../src/common/prisma/prisma.service.js");
  const { ReachService } = await import("../../src/reach/reach.service.js");
  const { WeeklyService } = await import("../../src/reach/weekly.service.js");
  const { ShareCardService } = await import("../../src/reach/share.service.js");
  const store = new MemoryCardStore();
  const real = new ResvgCardRenderer();
  const renders = { count: 0 };
  const counting: CardRenderer = {
    render: (spec, size) => {
      renders.count++;
      return real.render(spec, size);
    },
  };
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CARD_STORE)
    .useValue(store)
    .overrideProvider(CARD_RENDERER)
    .useValue(counting)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    jwks,
    store,
    renders,
    http: () => request(app.getHttpServer() as App),
    tokenFor: (sub) => jwks.sign({ sub }),
    prisma: app.get(PrismaService),
    reach: app.get(ReachService),
    weekly: app.get(WeeklyService),
    cards: app.get(ShareCardService),
    close: async () => {
      await app.get(ShareCardService).idle();
      await app.close();
      await jwks.stop();
    },
  };
}

/** Empties every table (the append-only ones refuse DELETE, so TRUNCATE). */
export async function resetDb(): Promise<void> {
  const c = new Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    await c.query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`,
    );
  } finally {
    await c.end();
  }
}

let n = 0;
export async function mkUser(
  h: Harness,
  over: { handle?: string; state?: string } = {},
) {
  n++;
  const u = await h.prisma.user.create({
    data: {
      wawuId: `wawu-${n}-${Date.now()}`,
      handle: over.handle ?? `user${n}`,
      referralCode: `REF${n}${Date.now() % 10000}`,
      state: over.state ?? "Lagos",
    },
  });
  return { ...u, token: h.tokenFor(u.wawuId) };
}

export async function mkTopic(h: Harness, week = 1) {
  return h.prisma.topic.create({
    data: {
      weekNumber: week,
      title: "Are You Really Fine?",
      startsOn: new Date(Date.UTC(2026, 10, 9 + (week - 1) * 7)),
      endsOn: new Date(Date.UTC(2026, 10, 15 + (week - 1) * 7)),
      status: "LIVE",
    },
  });
}

export function pngSize(png: Buffer): { w: number; h: number } {
  expectPng(png);
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}
function expectPng(png: Buffer): void {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("not a PNG");
}
