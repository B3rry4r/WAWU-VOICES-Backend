/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { Logger } from "@nestjs/common";
import { makePerson, startHarness, type Harness } from "../talk/harness";
import { publishPhoto } from "../../src/media/object-store";
import { publishExistingPhotos } from "../../src/media/publish-photos";

describe("photos are made public-read when they become usable", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.store.publicKeys.clear();
    h.store.makePublicCalls = 0;
  });

  async function upload(auth: string, kind = "AVATAR") {
    const up = await h
      .http()
      .post("/api/v1/uploads")
      .set("Authorization", auth)
      .send({ kind, mime: "image/png", sizeBytes: 1200 })
      .expect(201);
    const id = up.body.fileId as string;
    const f = await h.prisma.storedFile.findUniqueOrThrow({ where: { id } });
    h.store.objects.set(f.key, Buffer.alloc(1200));
    return { id, key: f.key };
  }

  it("an avatar attach makes the object public", async () => {
    const me = await makePerson(h);
    const { id, key } = await upload(me.auth);
    expect(h.store.publicKeys.has(key)).toBe(false);
    await h
      .http()
      .patch("/api/v1/me/profile")
      .set("Authorization", me.auth)
      .send({ avatarFileId: id })
      .expect(200);
    expect(h.store.publicKeys.has(key)).toBe(true);
  });

  it("POST /uploads/{id}/complete makes the object public, and a repeat is safe", async () => {
    const me = await makePerson(h);
    const { id, key } = await upload(me.auth);
    await h
      .http()
      .post(`/api/v1/uploads/${id}/complete`)
      .set("Authorization", me.auth)
      .expect(200);
    expect(h.store.publicKeys.has(key)).toBe(true);
    await h
      .http()
      .post(`/api/v1/uploads/${id}/complete`)
      .set("Authorization", me.auth)
      .expect(200);
    expect(h.store.publicKeys.size).toBe(1);
  });

  it("when the provider fails the attach still succeeds, one warning is logged, and the next attach retries", async () => {
    const me = await makePerson(h);
    const { id, key } = await upload(me.auth);
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const real = h.store.makePublic.bind(h.store);
    h.store.makePublic = () => Promise.reject(new Error("503 from provider"));
    try {
      await h
        .http()
        .patch("/api/v1/me/profile")
        .set("Authorization", me.auth)
        .send({ avatarFileId: id })
        .expect(200);
      expect(h.store.publicKeys.has(key)).toBe(false);
      const mine = warn.mock.calls.filter((c) =>
        String(c[0]).includes("makePublic"),
      );
      expect(mine).toHaveLength(1);
    } finally {
      h.store.makePublic = real;
      warn.mockRestore();
    }
    await h
      .http()
      .patch("/api/v1/me/profile")
      .set("Authorization", me.auth)
      .send({ avatarFileId: id })
      .expect(200);
    expect(h.store.publicKeys.has(key)).toBe(true);
  });

  it("a voice clip, a result sheet, an export and a card are never made public", async () => {
    const log = { warn: jest.fn() };
    const clip = await h.store.putPlay(Buffer.from("x"));
    for (const f of [
      { id: "1", kind: "AVATAR", key: clip },
      { id: "2", kind: "RESULT_PHOTO", key: "file/result_photo/a" },
      { id: "3", kind: "DATA_EXPORT", key: "file/data_export/a" },
      { id: "4", kind: "SHARE_CARD", key: "share/abc/card.png" },
      { id: "5", kind: "VOICE_VIDEO", key: "video/a.mp4" },
    ])
      expect(await publishPhoto(h.store, f, log)).toBe(false);
    expect(h.store.makePublicCalls).toBe(0);
    // and the store itself refuses a key outside file/
    await expect(h.store.makePublic(clip)).rejects.toThrow();
    expect(h.store.publicKeys.size).toBe(0);
  });

  it("the backfill publishes only live photos from the database and is idempotent", async () => {
    const mk = (kind: string, key: string, extra: object = {}) =>
      h.prisma.storedFile.create({
        data: {
          kind: kind as never,
          key,
          mime: "image/png",
          confirmedAt: new Date(),
          ...extra,
        },
      });
    const tag = Math.random().toString(36).slice(2);
    await mk("AVATAR", `file/avatar/bf-${tag}-1`);
    await mk("AD_CREATIVE", `file/ad_creative/bf-${tag}-2`);
    await mk("OVERRIDE_IMAGE", `file/override_image/bf-${tag}-3`);
    await mk("AVATAR", `file/avatar/bf-${tag}-4`, { confirmedAt: null });
    await mk("AVATAR", `file/avatar/bf-${tag}-5`, { purgedAt: new Date() });
    await mk("RESULT_PHOTO", `file/result_photo/bf-${tag}-6`);
    await mk("DATA_EXPORT", `exports/bf-${tag}-7`);
    await mk("SHARE_CARD", `share/bf-${tag}/card.png`);
    const mine = (s: Set<string>) =>
      [...s].filter((k) => k.includes(`bf-${tag}`)).sort();
    const one = await publishExistingPhotos(h.prisma, h.store);
    const first = mine(h.store.publicKeys);
    expect(first).toEqual([
      `file/ad_creative/bf-${tag}-2`,
      `file/avatar/bf-${tag}-1`,
      `file/override_image/bf-${tag}-3`,
    ]);
    expect(one.failed).toBe(0);
    expect(one.made).toBe(one.total);
    const two = await publishExistingPhotos(h.prisma, h.store);
    expect(two).toEqual(one);
    expect(mine(h.store.publicKeys)).toEqual(first);
  });
});
