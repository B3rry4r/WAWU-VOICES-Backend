/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from "node:crypto";
import { Logger, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import { MEDIA_STORE, TRANSCRIBER } from "../../src/media/object-store";
import type { PrismaService } from "../../src/common/prisma/prisma.service";
import type { VerificationStore } from "../../src/verify/verification.store";
import { VERIFICATION_STORE } from "../../src/verify/verification.store";
import { lagosDayString } from "../../src/verify/verification.dates";
import { MemoryStore, makePerson, type Person } from "../talk/harness";

/** The private bucket, in memory. Keeps what was put, what was deleted and every link it signed. */
export class FakeVerificationStore implements VerificationStore {
  objects = new Map<string, { body: Buffer; mime: string }>();
  deleted: string[] = [];
  links: { key: string; url: string; expiresAt: Date }[] = [];
  failDelete = false;
  put(body: Buffer, mime: string) {
    const key = `verification/${randomUUID()}`;
    this.objects.set(key, { body, mime });
    return Promise.resolve(key);
  }
  delete(key: string) {
    if (this.failDelete) return Promise.reject(new Error("bucket down"));
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  signedGet(key: string) {
    const expiresAt = new Date(Date.now() + 300_000);
    const url = `https://signed.test/${key}?exp=${expiresAt.getTime()}`;
    this.links.push({ key, url, expiresAt });
    return Promise.resolve({ url, expiresAt });
  }
}

export interface World {
  app: INestApplication;
  prisma: PrismaService;
  store: FakeVerificationStore;
  logs: string[];
  http: () => ReturnType<typeof request>;
  person: (o?: { roles?: ("ADMIN" | "MODERATOR")[] }) => Promise<Person>;
  close: () => Promise<void>;
}

export async function boot(): Promise<World> {
  const jwks = new TestJwks();
  await jwks.start();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.WAWU_ID_JWKS_URL = jwks.url;
  process.env.THROTTLE_LIMIT = "1000000";
  process.env.MEDIA_WORKER = "off";
  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/app-config.js");
  const { PrismaService: Prisma } =
    await import("../../src/common/prisma/prisma.service.js");
  const store = new FakeVerificationStore();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MEDIA_STORE)
    .useValue(new MemoryStore())
    .overrideProvider(TRANSCRIBER)
    .useValue(null)
    .overrideProvider(VERIFICATION_STORE)
    .useValue(store)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma: PrismaService = app.get(Prisma);
  const logs: string[] = [];
  for (const m of ["log", "warn", "error", "debug", "verbose"] as const)
    jest
      .spyOn(Logger.prototype, m)
      .mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  const h = { prisma, jwks } as never;
  return {
    app,
    prisma,
    store,
    logs,
    http: () => request(app.getHttpServer() as App),
    person: (o = {}) => makePerson(h, o),
    close: async () => {
      jest.restoreAllMocks();
      await app.close();
      await jwks.stop();
    },
  };
}

export const dayPlus = (n: number, from = new Date()): string =>
  lagosDayString(new Date(from.getTime() + n * 86_400_000));

/** A subscription row the way V-45 leaves it, without calling any payment provider. */
export async function giveSubscription(
  prisma: PrismaService,
  userId: string,
  o: {
    startDay?: string;
    endDay?: string;
    status?: "ACTIVE" | "QUEUED" | "ENDED" | "CANCELLED_DELETED";
  } = {},
) {
  const plan = await prisma.subscriptionPlan.findFirstOrThrow({
    orderBy: { sortOrder: "asc" },
  });
  const pay = await prisma.payment.create({
    data: {
      userId,
      kind: "SUBSCRIPTION",
      status: "SUCCEEDED",
      planId: plan.id,
      amountKobo: plan.priceKobo,
      txRef: `voices-${randomUUID()}`,
      idempotencyKey: randomUUID(),
      expiresAt: new Date(),
    },
  });
  return prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      paymentId: pay.id,
      status: o.status ?? "ACTIVE",
      months: 3,
      monthlyMilli: plan.monthlyMilli,
      priceKobo: plan.priceKobo,
      startDay: o.startDay ?? dayPlus(-10),
      endDay: o.endDay ?? dayPlus(80),
    },
  });
}

export const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  Buffer.from("JFIF\0"),
  Buffer.alloc(40, 1),
]);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 2),
]);
export const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
export const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypheic"),
  Buffer.alloc(30, 3),
]);
export const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(30, 4),
]);
