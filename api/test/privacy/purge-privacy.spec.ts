import { DeletionService } from "../../src/me/deletion.service";
import { StoragePurgeService } from "../../src/media/storage-purge.service";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
} from "../talk/harness";

const HOUR = 3_600_000;

describe("privacy fix P2 and P3: deletion purge and the storage purge job", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  it("P2: purge blanks old deleted bodies, takes the id off support, analytics, share, ad rows and result posts, and marks the sheet photo", async () => {
    const p = await makePerson(h);
    const q = await makeQuestion(h);
    const old = await h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: p.id,
        kind: "TEXT",
        body: "I said this and deleted it",
        status: "DELETED_BY_AUTHOR",
      },
    });
    await h.prisma.supportMessage.create({
      data: {
        userId: p.id,
        topic: "payment",
        message: "help",
        contactEmail: "ada@example.com",
      },
    });
    await h.prisma.analyticsEvent.create({ data: { name: "x", userId: p.id } });
    const link = await h.prisma.shortLink.create({
      data: { code: "pvt1234", objectType: "QUESTION", objectId: q.id },
    });
    await h.prisma.shareEvent.create({
      data: { linkId: link.id, kind: "intent", userId: p.id },
    });
    const ad = await h.prisma.ad.create({
      data: { brand: "B", kind: "BANNER", headline: "h", createdById: p.id },
    });
    await h.prisma.adEvent.create({
      data: { adId: ad.id, kind: "TAP", userId: p.id, day: new Date() },
    });
    const photo = await h.prisma.storedFile.create({
      data: {
        ownerId: p.id,
        kind: "RESULT_PHOTO",
        key: "result/pvt-sheet",
        mime: "image/jpeg",
        confirmedAt: new Date(),
      },
    });
    const th = await h.prisma.resultThread.create({
      data: { title: "T", heldOn: new Date(), createdById: p.id },
    });
    const post = await h.prisma.resultPost.create({
      data: {
        threadId: th.id,
        authorId: p.id,
        state: "Lagos",
        lga: "A",
        ward: "B",
        pollingUnit: "C",
        accredited: 10,
        votesCast: 8,
        rejected: 1,
        photoFileId: photo.id,
        idempotencyKey: "pvt-k",
      },
    });
    await h.prisma.user.update({
      where: { id: p.id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 20 * 24 * HOUR),
      },
    });
    expect(await h.app.get(DeletionService).purgeDue()).toBeGreaterThanOrEqual(
      1,
    );

    expect(
      (await h.prisma.answer.findUniqueOrThrow({ where: { id: old.id } })).body,
    ).toBeNull();
    const sm = await h.prisma.supportMessage.findFirstOrThrow({
      where: { topic: "payment", message: "help" },
    });
    expect(sm).toMatchObject({ userId: null, contactEmail: null });
    expect(
      await h.prisma.analyticsEvent.count({ where: { userId: p.id } }),
    ).toBe(0);
    expect(await h.prisma.shareEvent.count({ where: { userId: p.id } })).toBe(
      0,
    );
    expect(await h.prisma.adEvent.count({ where: { userId: p.id } })).toBe(0);
    expect(
      await h.prisma.shareEvent.count({ where: { linkId: link.id } }),
    ).toBe(1);
    const rp = await h.prisma.resultPost.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(rp).toMatchObject({
      authorId: null,
      photoFileId: null,
      accredited: 10,
      votesCast: 8,
      rejected: 1,
    });
    expect(
      (await h.prisma.storedFile.findUniqueOrThrow({ where: { id: photo.id } }))
        .purgeRequestedAt,
    ).not.toBeNull();
  });

  it("P3: the job deletes removed clips, replaced and purged-user files and abandoned uploads from the store, once, and logs counts", async () => {
    const svc = h.app.get(StoragePurgeService);
    await svc.run(); // drain rows other suites and the first test left, so the counts below are this test's own
    const p = await makePerson(h);
    const old = new Date(Date.now() - 30 * HOUR);
    const fresh = new Date(Date.now() - 1 * HOUR);
    const put = (k: string) => h.store.objects.set(k, Buffer.from("x"));
    const clip = (
      status: "REMOVED" | "PENDING_UPLOAD" | "READY",
      k: string,
      createdAt: Date,
    ) => {
      put(`${k}/raw`);
      put(`${k}/play`);
      return h.prisma.voiceClip.create({
        data: {
          ownerId: p.id,
          purpose: "ANSWER",
          status,
          rawKey: `${k}/raw`,
          rawMime: "audio/webm",
          playKey: `${k}/play`,
          maxDurationMs: 10000,
          createdAt,
        },
      });
    };
    const removed = await clip("REMOVED", "c-removed", fresh);
    const staleUp = await clip("PENDING_UPLOAD", "c-stale", old);
    await clip("PENDING_UPLOAD", "c-fresh", fresh);
    await clip("READY", "c-ready", old);
    const file = (k: string, o: object) => {
      put(k);
      return h.prisma.storedFile.create({
        data: {
          ownerId: p.id,
          kind: "AVATAR",
          key: k,
          mime: "image/jpeg",
          ...o,
        },
      });
    };
    const replaced = await file("f-replaced", {
      confirmedAt: old,
      purgeRequestedAt: fresh,
    });
    await file("f-kept", { confirmedAt: old });
    const staleF = await file("f-stale", { createdAt: old });
    await file("f-freshpending", { createdAt: fresh });

    const counts = await svc.run();
    expect(counts).toMatchObject({
      removedClips: 1,
      pendingClips: 1,
      requestedFiles: 1,
      pendingFiles: 1,
      objectsDeleted: 6,
      failed: 0,
    });
    for (const k of [
      "c-removed/raw",
      "c-removed/play",
      "c-stale/raw",
      "c-stale/play",
      "f-replaced",
      "f-stale",
    ])
      expect(h.store.objects.has(k)).toBe(false);
    for (const k of [
      "c-fresh/raw",
      "c-ready/raw",
      "c-ready/play",
      "f-kept",
      "f-freshpending",
    ])
      expect(h.store.objects.has(k)).toBe(true);
    expect(
      (
        await h.prisma.voiceClip.findUniqueOrThrow({
          where: { id: removed.id },
        })
      ).storagePurgedAt,
    ).not.toBeNull();
    expect(
      (
        await h.prisma.voiceClip.findUniqueOrThrow({
          where: { id: staleUp.id },
        })
      ).storagePurgedAt,
    ).not.toBeNull();
    expect(
      (
        await h.prisma.storedFile.findUniqueOrThrow({
          where: { id: replaced.id },
        })
      ).purgedAt,
    ).not.toBeNull();
    expect(
      (
        await h.prisma.storedFile.findUniqueOrThrow({
          where: { id: staleF.id },
        })
      ).purgedAt,
    ).not.toBeNull();

    // idempotent: a second run, and two at once, delete nothing more
    const before = h.store.deleted.length;
    const [a, b] = await Promise.all([svc.run(), svc.run()]);
    expect(a.objectsDeleted + b.objectsDeleted).toBe(0);
    expect(h.store.deleted.length).toBe(before);
  });

  it("P3: two processes at once never delete one object twice", async () => {
    await h.app.get(StoragePurgeService).run(); // drain leftovers first
    const p = await makePerson(h);
    for (let i = 0; i < 6; i++) {
      h.store.objects.set(`race-${i}`, Buffer.from("x"));
      await h.prisma.storedFile.create({
        data: {
          ownerId: p.id,
          kind: "AVATAR",
          key: `race-${i}`,
          mime: "image/jpeg",
          purgeRequestedAt: new Date(),
        },
      });
    }
    const svc = h.app.get(StoragePurgeService);
    const [a, b] = await Promise.all([
      svc.run(new Date(), 2),
      svc.run(new Date(), 2),
    ]);
    expect(a.requestedFiles + b.requestedFiles).toBe(6);
    const del = h.store.deleted.filter((k) => k.startsWith("race-"));
    expect(del.length).toBe(6);
    expect(new Set(del).size).toBe(6);
  });
});
