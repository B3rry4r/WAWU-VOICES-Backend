import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
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
  /** Keys made public-read; nothing is sent anywhere. */
  publicKeys = new Set<string>();
  makePublicCalls = 0;
  makePublic(key: string) {
    this.makePublicCalls++;
    if (!key.startsWith("file/"))
      return Promise.reject(
        new Error("makePublic refuses a key outside file/"),
      );
    this.publicKeys.add(key);
    return Promise.resolve();
  }
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
  putVideo(body: Buffer) {
    const key = `video/${randomUUID()}.mp4`;
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
  opts: {
    transcriber?: boolean;
    /** The global per-address limit: a number, or "default" to leave THROTTLE_LIMIT unset (the app's own default). */
    throttleLimit?: number | "default";
    /** DMS_LIVE for this app. The harness turns direct messages on unless a spec says "off" (the app's own default is off). */
    dms?: "on" | "off";
  } = {},
): Promise<Harness> {
  const jwks = new TestJwks();
  await jwks.start();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.WAWU_ID_JWKS_URL = jwks.url;
  if (opts.throttleLimit === "default") delete process.env.THROTTLE_LIMIT;
  else process.env.THROTTLE_LIMIT = String(opts.throttleLimit ?? 1000000);
  process.env.MEDIA_WORKER = "off";
  process.env.DMS_LIVE = opts.dms ?? "on";
  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/app-config.js");
  const { PrismaService: Prisma } =
    await import("../../src/common/prisma/prisma.service.js");
  const store = new MemoryStore();
  const transcriber = new FakeTranscriber();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MEDIA_STORE)
    .useValue(store)
    .overrideProvider(TRANSCRIBER)
    .useValue(opts.transcriber === false ? null : transcriber)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  const prismaRef: PrismaService = app.get(Prisma);
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
    /** V-46: approved and verified for 30 days (only a verified person suggests an idea). */
    verified?: boolean;
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
      ...(o.verified
        ? {
            verificationStatus: "APPROVED" as const,
            verifiedUntil: new Date(Date.now() + 30 * 86_400_000),
          }
        : {}),
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
