import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { INestApplication } from "@nestjs/common";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import { resetDb } from "../reach/helpers";
import { MemoryStore } from "../talk/harness";
import type { CardStore } from "../../src/reach/card-store";
import type { CardRenderer } from "../../src/reach/card-renderer";

const DAY = 24 * 3_600_000;

/** One in-memory bucket behind both seams: the card store (put, get) and the storage job's store (delete). */
class Bucket extends MemoryStore implements CardStore {
  getOpt = (k: string): Promise<Buffer | null> =>
    Promise.resolve(this.objects.get(k) ?? null);
  put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
    return Promise.resolve();
  }
}

describe("privacy P3: redrawn share cards and late draws leave no image behind", () => {
  let app: INestApplication;
  let jwks: TestJwks;
  const bucket = new Bucket();
  const hook: { render?: () => Promise<void>; afterGet?: () => Promise<void> } =
    {};
  let prisma: import("../../src/common/prisma/prisma.service").PrismaService;
  let share: import("../../src/reach/share.service").ShareService;
  let cards: import("../../src/reach/share.service").ShareCardService;
  let job: import("../../src/media/storage-purge.service").StoragePurgeService;
  let purgeSvc: import("../../src/me/deletion.service").DeletionService;
  let n = 0;

  beforeAll(async () => {
    await resetDb();
    jwks = new TestJwks();
    await jwks.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WAWU_ID_JWKS_URL = jwks.url;
    process.env.THROTTLE_LIMIT = "1000000";
    process.env.MEDIA_WORKER = "off";
    process.env.NODE_ENV = "test";
    const { AppModule } = await import("../../src/app.module.js");
    const { configureApp } = await import("../../src/app-config.js");
    const { CARD_STORE } = await import("../../src/reach/card-store.js");
    const { CARD_RENDERER, ResvgCardRenderer } =
      await import("../../src/reach/card-renderer.js");
    const { MEDIA_STORE } = await import("../../src/media/object-store.js");
    const { PrismaService } =
      await import("../../src/common/prisma/prisma.service.js");
    const { ShareService, ShareCardService } =
      await import("../../src/reach/share.service.js");
    const { StoragePurgeService } =
      await import("../../src/media/storage-purge.service.js");
    const { DeletionService } =
      await import("../../src/me/deletion.service.js");
    const real = new ResvgCardRenderer();
    const renderer: CardRenderer = {
      render: async (spec) => {
        const png = await real.render(spec);
        if (hook.render) await hook.render();
        return png;
      },
    };
    const cardStore: CardStore = {
      put: (k, b) => bucket.put(k, b),
      get: async (k) => {
        const out = await bucket.getOpt(k);
        if (hook.afterGet) await hook.afterGet();
        return out;
      },
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORE)
      .useValue(bucket)
      .overrideProvider(CARD_STORE)
      .useValue(cardStore)
      .overrideProvider(CARD_RENDERER)
      .useValue(renderer)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    share = app.get(ShareService);
    cards = app.get(ShareCardService);
    job = app.get(StoragePurgeService);
    purgeSvc = app.get(DeletionService);
    await job.run(new Date(Date.now() + 100 * DAY));
  });
  afterAll(async () => {
    await cards.idle();
    await app.close();
    await jwks.stop();
  });

  async function person() {
    n++;
    return prisma.user.create({
      data: {
        wawuId: `wawu-p3-${n}-${Date.now()}`,
        handle: `p3user${n}${Date.now() % 100000}`,
        referralCode: `P3R${n}${Date.now() % 100000}`,
        state: "Lagos",
      },
    });
  }
  async function profileLink(userId: string) {
    const v = await share.createLink(null, {
      objectType: "PROFILE",
      objectId: userId,
    });
    await cards.idle();
    return v.code;
  }
  const keysUnder = (code: string) =>
    [...bucket.objects.keys()].filter((k) => k.startsWith(`share/${code}/`));
  const retire = (id: string) =>
    prisma.user.update({
      where: { id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 20 * DAY),
      },
    });

  it("handle change, redraw, then purge: no object is left under the person's code after the job", async () => {
    const u = await person();
    const code = await profileLink(u.id);
    expect(keysUnder(code).length).toBe(1);
    await prisma.user.update({
      where: { id: u.id },
      data: { handle: `renamed${n}${Date.now() % 100000}` },
    });
    await share.createLink(null, { objectType: "PROFILE", objectId: u.id });
    await cards.idle();
    // the redraw wrote a second image; the first was dropped by the card
    expect(keysUnder(code).length).toBe(2);
    await retire(u.id);
    await purgeSvc.purge(u.id);
    await job.run();
    expect(keysUnder(code)).toEqual([]);
    const rows = await prisma.storedFile.findMany({
      where: { kind: "SHARE_CARD", key: { startsWith: `share/${code}/` } },
    });
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.purgedAt).not.toBeNull();
  });

  it("a redraw for a live person deletes the old image on the next job and keeps the new one", async () => {
    const u = await person();
    const code = await profileLink(u.id);
    const [oldKey] = keysUnder(code);
    await prisma.user.update({
      where: { id: u.id },
      data: { handle: `fresh${n}${Date.now() % 100000}` },
    });
    await share.createLink(null, { objectType: "PROFILE", objectId: u.id });
    await cards.idle();
    const card = await prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    const newFile = await prisma.storedFile.findUniqueOrThrow({
      where: { id: card.storyFileId as string },
    });
    expect(newFile.key).not.toBe(oldKey);
    expect(newFile.purgeRequestedAt).toBeNull();
    await job.run();
    expect(bucket.objects.has(oldKey)).toBe(false);
    expect(bucket.objects.has(newFile.key)).toBe(true);
    expect(keysUnder(code)).toEqual([newFile.key]);
    const again = await prisma.storedFile.findUniqueOrThrow({
      where: { id: newFile.id },
    });
    expect(again.purgedAt).toBeNull();
    // the live card still serves its image
    const res = await request(app.getHttpServer() as App).get(
      `/api/v1/share/${code}/card`,
    );
    expect(res.status).toBe(200);
  });

  it("a redraw back to an older look reuses the old key and keeps it (the mark is cleared)", async () => {
    const u = await person();
    const original = u.handle;
    const code = await profileLink(u.id);
    const [firstKey] = keysUnder(code);
    await prisma.user.update({
      where: { id: u.id },
      data: { handle: `other${n}${Date.now() % 100000}` },
    });
    await share.createLink(null, { objectType: "PROFILE", objectId: u.id });
    await cards.idle();
    await prisma.user.update({
      where: { id: u.id },
      data: { handle: original },
    });
    await share.createLink(null, { objectType: "PROFILE", objectId: u.id });
    await cards.idle();
    await job.run();
    const card = await prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    const f = await prisma.storedFile.findUniqueOrThrow({
      where: { id: card.storyFileId as string },
    });
    expect(f.key).toBe(firstKey);
    expect(f.purgeRequestedAt).toBeNull();
    expect(f.purgedAt).toBeNull();
    expect(bucket.objects.has(firstKey)).toBe(true);
  });

  it("image() racing a purge gives 404, never 500", async () => {
    const u = await person();
    const code = await profileLink(u.id);
    // the object is gone from storage, so image() resets the card; the purge deletes the card first
    const card = await prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    const file = await prisma.storedFile.findUniqueOrThrow({
      where: { id: card.storyFileId as string },
    });
    bucket.objects.delete(file.key);
    hook.afterGet = async () => {
      hook.afterGet = undefined;
      await retire(u.id);
      await purgeSvc.purge(u.id);
    };
    const res = await request(app.getHttpServer() as App).get(
      `/api/v1/share/${code}/card`,
    );
    hook.afterGet = undefined;
    expect(await prisma.shareCard.count({ where: { id: card.id } })).toBe(0);
    expect(res.status).toBe(404);
  });

  it("a late re-put onto a row the job already purged is deleted on the next run", async () => {
    const u = await person();
    const code = await profileLink(u.id);
    const card = await prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    const file = await prisma.storedFile.findUniqueOrThrow({
      where: { id: card.storyFileId as string },
    });
    // the job already deleted this key: object gone, row purged, card back to PENDING
    bucket.objects.delete(file.key);
    await prisma.shareCard.update({
      where: { id: card.id },
      data: { status: "PENDING", storyFileId: null },
    });
    await prisma.storedFile.update({
      where: { id: file.id },
      data: { purgeRequestedAt: new Date(), purgedAt: new Date() },
    });
    // a late draw is in flight (rendered) when the person is purged
    let release!: () => void;
    let entered!: () => void;
    const enteredP = new Promise<void>((r) => (entered = r));
    hook.render = () =>
      new Promise<void>((r) => {
        entered();
        release = r;
      });
    const d = cards.generate(code);
    await enteredP;
    hook.render = undefined;
    await retire(u.id);
    await purgeSvc.purge(u.id);
    release();
    await d;
    expect(bucket.objects.has(file.key)).toBe(true); // the late put landed
    const row = await prisma.storedFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(row.purgedAt).toBeNull();
    expect(row.purgeRequestedAt).not.toBeNull();
    await job.run();
    expect(bucket.objects.has(file.key)).toBe(false);
    expect(keysUnder(code)).toEqual([]);
  });

  it("a late re-put for a live person with a linked card is a normal live file", async () => {
    const u = await person();
    const code = await profileLink(u.id);
    const card = await prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    const file = await prisma.storedFile.findUniqueOrThrow({
      where: { id: card.storyFileId as string },
    });
    bucket.objects.delete(file.key);
    await prisma.shareCard.update({
      where: { id: card.id },
      data: { status: "PENDING", storyFileId: null },
    });
    await prisma.storedFile.update({
      where: { id: file.id },
      data: { purgeRequestedAt: new Date(), purgedAt: new Date() },
    });
    await cards.generate(code);
    const row = await prisma.storedFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(row.purgedAt).toBeNull();
    expect(row.purgeRequestedAt).toBeNull();
    const after = await prisma.shareCard.findUniqueOrThrow({
      where: { id: card.id },
    });
    expect(after.storyFileId).toBe(file.id);
    await job.run();
    expect(bucket.objects.has(file.key)).toBe(true);
  });
});
