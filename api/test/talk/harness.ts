import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INestApplication,
  Global,
  HttpException,
  Module,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import {
  UNITS_PORT,
  type ChargeAction,
  type UnitsPort,
} from "../../src/units/units.port";
import type { ObjectStore } from "../../src/media/object-store";
import { MEDIA_STORE, TRANSCRIBER } from "../../src/media/object-store";
import type { Transcriber } from "../../src/audio-ref/transcribe";
import type { PrismaService } from "../../src/common/prisma/prisma.service";

export const fixture = (n: string) =>
  readFileSync(join(__dirname, "..", "fixtures", n));

/** In-memory bucket: the test PUT is store.put(key, bytes). */
export class MemoryStore implements ObjectStore {
  objects = new Map<string, Buffer>();
  deleted: string[] = [];
  presignPut(prefix: string, contentType: string, sizeBytes: number) {
    const key = `${prefix}/${randomUUID()}`;
    return Promise.resolve({
      key,
      url: `https://bucket.test/${key}?sig=put&len=${sizeBytes}`,
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + 300_000),
    });
  }
  head(key: string) {
    return Promise.resolve(
      this.objects.has(key) ? (this.objects.get(key) as Buffer).length : null,
    );
  }
  get(key: string) {
    const b = this.objects.get(key);
    return b ? Promise.resolve(b) : Promise.reject(new Error("missing " + key));
  }
  putPlay(body: Buffer) {
    const key = `voice/${randomUUID()}.m4a`;
    this.objects.set(key, body);
    return Promise.resolve(key);
  }
  delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  signedGet(key: string) {
    return Promise.resolve({
      url: `https://bucket.test/${key}?sig=get`,
      expiresAt: new Date(Date.now() + 900_000),
    });
  }
}

export class FakeTranscriber implements Transcriber {
  calls = 0;
  fail = false;
  transcribe() {
    this.calls++;
    return this.fail
      ? Promise.reject(new Error("gemini down"))
      : Promise.resolve("hello from the clip");
  }
}

const lagosDay = () =>
  new Date(
    new Date()
      .toLocaleString("en-CA", { timeZone: "Africa/Lagos", hour12: false })
      .slice(0, 10) + "T00:00:00Z",
  );

/** The test-only UNITS_PORT: real Charge, FreeAllowance, UsageCounter and Wallet rows, no ledger. */
export function makeTestUnits(
  getPrisma: () => PrismaService,
): UnitsPort & { reverse(id: string): Promise<void> } {
  const costs: Record<ChargeAction, number> = {
    POST_TEXT: 500,
    POST_VOICE: 1000,
    REACTION: 100,
    VOTE: 200,
  };
  const FREE_DAILY: Partial<Record<ChargeAction, number>> = {
    REACTION: 20,
    VOTE: 3,
  };
  const err = (code: string, costMilli: number, balanceMilli: number) =>
    new HttpException(
      {
        code,
        message: "You need more units.",
        details: { costMilli, balanceMilli, minPackKobo: 13800 },
      },
      402,
    );
  const doCharge = async (
    userId: string,
    action: ChargeAction,
    key: string,
  ) => {
    const p = getPrisma();
    const prior = await p.charge.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    });
    if (prior)
      return {
        chargeId: prior.id,
        costMilli: prior.costMilli,
        usedFreePost: prior.usedFreePost,
        usedFreeDaily: prior.usedFreeDaily,
      };
    return p.$transaction(async (tx) => {
      let usedFreePost = false;
      let usedFreeDaily = false;
      let cost = 0;
      if (action === "POST_TEXT" || action === "POST_VOICE") {
        const fa = await tx.freeAllowance.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        if (fa.freePostsRemaining > 0) {
          usedFreePost = true;
          await tx.freeAllowance.update({
            where: { userId },
            data: {
              freePostsRemaining: { decrement: 1 },
              freePostsUsed: { increment: 1 },
            },
          });
        } else cost = costs[action];
      } else {
        const day = lagosDay();
        const uc = await tx.usageCounter.upsert({
          where: { userId_day_action: { userId, day, action } },
          create: { userId, day, action },
          update: {},
        });
        if (uc.used < (FREE_DAILY[action] ?? 0)) usedFreeDaily = true;
        else cost = costs[action];
        await tx.usageCounter.update({
          where: { userId_day_action: { userId, day, action } },
          data: { used: { increment: 1 } },
        });
      }
      if (cost > 0) {
        const w = await tx.wallet.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        if (w.balanceMilli < cost)
          throw err(
            action.startsWith("POST")
              ? "FREE_POSTS_EXHAUSTED"
              : "INSUFFICIENT_UNITS",
            cost,
            w.balanceMilli,
          );
        await tx.wallet.update({
          where: { userId },
          data: { balanceMilli: { decrement: cost } },
        });
      }
      const c = await tx.charge.create({
        data: {
          userId,
          action,
          costMilli: cost,
          usedFreePost,
          usedFreeDaily,
          idempotencyKey: key,
        },
      });
      return { chargeId: c.id, costMilli: cost, usedFreePost, usedFreeDaily };
    });
  };
  const locks = new Map<string, Promise<unknown>>();
  return {
    charge(userId, action, key) {
      // the test provider serialises one person's charges (a real provider row-locks the wallet)
      const run = (locks.get(userId) ?? Promise.resolve()).then(() =>
        doCharge(userId, action, key),
      );
      locks.set(
        userId,
        run.catch(() => undefined),
      );
      return run;
    },
    async freeLeft(userId, action) {
      const p = getPrisma();
      const w = await p.wallet.findUnique({ where: { userId } });
      if (action === "POST_TEXT" || action === "POST_VOICE") {
        const fa = await p.freeAllowance.findUnique({ where: { userId } });
        return {
          freeLeft: fa ? fa.freePostsRemaining : 10,
          balanceMilli: w?.balanceMilli ?? 0,
        };
      }
      const uc = await p.usageCounter.findUnique({
        where: { userId_day_action: { userId, day: lagosDay(), action } },
      });
      return {
        freeLeft: Math.max(0, (FREE_DAILY[action] ?? 0) - (uc?.used ?? 0)),
        balanceMilli: w?.balanceMilli ?? 0,
      };
    },
    async reverse(chargeId) {
      const p = getPrisma();
      const c = await p.charge.findUniqueOrThrow({ where: { id: chargeId } });
      if (c.status === "REVERSED") return;
      await p.$transaction(async (tx) => {
        await tx.charge.update({
          where: { id: c.id },
          data: { status: "REVERSED", reversedAt: new Date() },
        });
        if (c.usedFreePost)
          await tx.freeAllowance.update({
            where: { userId: c.userId },
            data: {
              freePostsRemaining: { increment: 1 },
              freePostsUsed: { decrement: 1 },
            },
          });
        if (c.costMilli > 0)
          await tx.wallet.update({
            where: { userId: c.userId },
            data: { balanceMilli: { increment: c.costMilli } },
          });
      });
    },
  };
}

export interface Harness {
  app: INestApplication;
  jwks: TestJwks;
  prisma: PrismaService;
  store: MemoryStore;
  transcriber: FakeTranscriber;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function startHarness(
  opts: { transcriber?: boolean } = {},
): Promise<Harness> {
  const jwks = new TestJwks();
  await jwks.start();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.WAWU_ID_JWKS_URL = jwks.url;
  process.env.THROTTLE_LIMIT = "1000000";
  process.env.MEDIA_WORKER = "off";
  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/app-config.js");
  const { UnitsModule } = await import("../../src/units/units.module.js");
  const { PrismaService: Prisma } =
    await import("../../src/common/prisma/prisma.service.js");
  const store = new MemoryStore();
  const transcriber = new FakeTranscriber();
  const ref: { p?: PrismaService } = {};
  @Global()
  @Module({
    providers: [
      {
        provide: UNITS_PORT,
        useFactory: () => makeTestUnits(() => ref.p as PrismaService),
      },
    ],
    exports: [UNITS_PORT],
  })
  class TestUnitsModule {}
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(UnitsModule)
    .useModule(TestUnitsModule)
    .overrideProvider(MEDIA_STORE)
    .useValue(store)
    .overrideProvider(TRANSCRIBER)
    .useValue(opts.transcriber === false ? null : transcriber)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  const prismaRef: PrismaService = app.get(Prisma);
  ref.p = prismaRef;
  return {
    app,
    jwks,
    prisma: prismaRef,
    store,
    transcriber,
    http: () => request(app.getHttpServer() as App),
    close: async () => {
      await app.close();
      await jwks.stop();
    },
  };
}

export interface Person {
  id: string;
  wawuId: string;
  auth: string;
}

let n = 0;
export async function makePerson(
  h: Harness,
  o: {
    roles?: ("EDITOR" | "MODERATOR" | "ADMIN")[];
    balanceMilli?: number;
    freePosts?: number;
    status?: "SUSPENDED";
  } = {},
): Promise<Person> {
  n++;
  const wawuId = `wawu-${randomUUID()}`;
  const u = await h.prisma.user.create({
    data: {
      wawuId,
      handle:
        `t${Date.now().toString(36)}${n}${Math.floor(Math.random() * 1e4)}`.slice(
          0,
          20,
        ),
      referralCode: randomUUID().slice(0, 12),
      displayName: "Test Person",
      state: "Lagos",
      ...(o.status
        ? {
            status: o.status,
            suspendedUntil: new Date(Date.now() + 86_400_000),
          }
        : {}),
      ...(o.roles
        ? {
            roles: {
              create: o.roles.map((role) => ({ role, grantedById: "seed" })),
            },
          }
        : {}),
    },
  });
  if (o.balanceMilli)
    await h.prisma.wallet.create({
      data: { userId: u.id, balanceMilli: o.balanceMilli },
    });
  if (o.freePosts !== undefined)
    await h.prisma.freeAllowance.create({
      data: { userId: u.id, freePostsRemaining: o.freePosts },
    });
  return { id: u.id, wawuId, auth: `Bearer ${h.jwks.sign({ sub: wawuId })}` };
}

export const guestAuth = () => ({ "X-Guest-Id": randomUUID() });

export async function makeQuestion(
  h: Harness,
  status: "LIVE" | "CLOSED" | "DRAFT" = "LIVE",
) {
  return h.prisma.question.create({
    data: {
      text: "When salary arrives, how many hours pass before it disappears?",
      status,
    },
  });
}

export const idem = () => ({ "Idempotency-Key": randomUUID() });

export async function textAnswer(
  h: Harness,
  p: Person,
  questionId: string,
  body = "Salary goes in two hours.",
) {
  const res = await h
    .http()
    .post(`/api/v1/questions/${questionId}/answers`)
    .set("Authorization", p.auth)
    .set(idem())
    .send({ kind: "TEXT", body });
  return res;
}
