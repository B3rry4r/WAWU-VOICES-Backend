/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion -- supertest bodies are untyped JSON; one fake store is slipped into a service */
import { randomUUID } from "node:crypto";
import { ClipsService } from "../../src/media/clips.service";
import { bootAdmin, type Admin } from "./helpers";

/**
 * V-FIX-B, items 3 to 5: the daily override carries a link, a picture and a voice note that Home can show; an audio
 * advert is served, played and counted once per person per day; both follow the media rules (roles, type, size, the
 * public CDN for pictures, private voice).
 */
describe("V-FIX-B override and audio advert media", () => {
  let a: Admin;
  const CDN = "https://cdn.fixb.test";
  const fakeStore = {
    presignPut: (prefix: string, contentType: string) =>
      Promise.resolve({
        key: `${prefix}/${randomUUID()}`,
        url: "https://put.test/x",
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + 60_000),
      }),
    signedGet: (key: string) =>
      Promise.resolve({
        url: `https://signed.test/${key}`,
        expiresAt: new Date(Date.now() + 60_000),
      }),
  };
  const clip = (
    ownerId: string,
    purpose: string,
    durationMs = 12_000,
    over = {},
  ) =>
    a.prisma.voiceClip.create({
      data: {
        ownerId,
        purpose: purpose as never,
        status: "READY",
        rawKey: `raw/${randomUUID()}`,
        rawMime: "audio/webm",
        playKey: `voice/${randomUUID()}.m4a`,
        playMime: "audio/mp4",
        maxDurationMs: 60_000,
        durationMs,
        transcript: {
          create: {
            status: "READY",
            language: "en",
            text: "Hear our soup of the day.",
          },
        },
        ...over,
      },
    });

  beforeAll(async () => {
    process.env.SPACES_CDN_BASE = CDN;
    a = await bootAdmin();
    (a.h.app.get(ClipsService) as any).store = fakeStore;
    await a.person("editor", ["EDITOR"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("plain");
    await a.person("plain2");
  });
  afterAll(async () => {
    delete process.env.SPACES_CDN_BASE;
    await a.close();
  });

  describe("the daily override: link, picture and voice note reach Home", () => {
    let ovId: string;
    let clipId: string;
    let imageKey: string;

    it("an editor sets a voice note and a picture and a link under a text message; they are checked", async () => {
      const note = await clip(a.people.editor.id, "OVERRIDE_NOTE", 14_000);
      clipId = note.id;
      const file = await a.prisma.storedFile.create({
        data: {
          ownerId: a.people.editor.id,
          kind: "OVERRIDE_IMAGE",
          key: `file/override_image/${randomUUID()}`,
          mime: "image/png",
          bytes: 1000,
          confirmedAt: new Date(),
        },
      });
      imageKey = file.key;
      const notAnImage = await a.prisma.storedFile.create({
        data: {
          ownerId: a.people.editor.id,
          kind: "AVATAR",
          key: `file/avatar/${randomUUID()}`,
          mime: "image/png",
          bytes: 1000,
          confirmedAt: new Date(),
        },
      });
      const ownAnswer = await clip(a.people.editor.id, "ANSWER");
      const base = {
        headline: "Lagos floods: are you safe?",
        contentKind: "TEXT",
        body: "Tell us where you are. If you are safe, say so.",
        linkUrl: "https://example.com/flood-help",
        emergency: true,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      };
      const post = (b: object, who = "editor") =>
        a.h.http().post("/api/v1/admin/overrides").set(a.auth(who)).send(b);
      // each piece is checked whatever the type
      expect((await post({ ...base, voiceClipId: ownAnswer.id })).status).toBe(
        422,
      );
      expect((await post({ ...base, imageFileId: notAnImage.id })).status).toBe(
        422,
      );
      expect((await post({ ...base, contentKind: "VOICE" })).status).toBe(422);
      expect((await post({ ...base, contentKind: "IMAGE" })).status).toBe(422);
      expect(
        (await post({ ...base, linkUrl: "http://example.com" })).status,
      ).toBe(422);
      expect(
        (await post({ ...base, voiceClipId: clipId }, "plain")).status,
      ).toBe(403);
      const ok = await post({
        ...base,
        voiceClipId: clipId,
        imageFileId: file.id,
      });
      expect(ok.status).toBe(201);
      ovId = ok.body.id;
      expect(ok.body).toMatchObject({
        imageUrl: `${CDN}/${imageKey}`,
        audioClipId: clipId,
        linkUrl: base.linkUrl,
      });
    });

    it("Home carries the message, the link, the picture (public link) and the voice note for the day", async () => {
      const today = await a.h.http().get("/api/v1/questions/today").expect(200);
      const o = today.body.override;
      expect(o).toMatchObject({
        contentKind: "TEXT",
        body: "Tell us where you are. If you are safe, say so.",
        linkUrl: "https://example.com/flood-help",
        imageUrl: `${CDN}/${imageKey}`,
        audioClipId: clipId,
        audioDurationMs: 14_000,
      });
      // the voice stays private: it plays through a short-lived link, for anyone, while the override is on
      const play = await a.h
        .http()
        .get(`/api/v1/voice-clips/${clipId}/play`)
        .expect(200);
      expect(play.body.url).toMatch(/^https:\/\/signed\.test\/voice\//);
      // and stops when the editor cancels it
      await a.h
        .http()
        .post(`/api/v1/admin/overrides/${ovId}/cancel`)
        .set(a.auth("editor"))
        .send({ reason: "Done for today." })
        .expect(200);
      await a.h.http().get(`/api/v1/voice-clips/${clipId}/play`).expect(404);
    });

    it("the team's recordings and pictures follow the role rule (a reader cannot make an advert recording or an editor note)", async () => {
      const mk = (who: string, purpose: string) =>
        a.h.http().post("/api/v1/voice-clips").set(a.auth(who)).send({
          purpose,
          mime: "audio/webm",
          sizeBytes: 50_000,
          durationMs: 9_000,
        });
      expect((await mk("plain", "AD_AUDIO")).status).toBe(403);
      expect((await mk("plain", "OVERRIDE_NOTE")).status).toBe(403);
      expect((await mk("editor", "AD_AUDIO")).status).toBe(403);
      expect((await mk("adman", "AD_AUDIO")).status).toBe(201);
      expect((await mk("editor", "OVERRIDE_NOTE")).status).toBe(201);
      // a normal voice is still anyone's
      expect((await mk("plain", "ANSWER")).status).toBe(201);
    });
  });

  describe("an audio advert is served, played and counted once a day", () => {
    let adId: string;
    let audioId: string;
    const G1 = "11111111-1111-4111-8111-111111111111";
    const G2 = "22222222-2222-4222-8222-222222222222";
    const event = (kind: string, guest?: string, who?: string) => {
      let r = a.h.http().post(`/api/v1/ads/${adId}/events`).send({ kind });
      if (guest) r = r.set("X-Guest-Id", guest);
      if (who) r = r.set(a.auth(who));
      return r;
    };
    const count = (kind: string) =>
      a.prisma.adEvent.count({ where: { adId, kind: kind as never } });

    it("the ad manager makes it with a recording of its own kind and a short length; it waits for approval", async () => {
      const good = await clip(a.people.adman.id, "AD_AUDIO", 15_000);
      const wrong = await clip(a.people.adman.id, "ANSWER", 15_000);
      const long = await clip(a.people.adman.id, "AD_AUDIO", 45_000);
      const body = {
        brand: "Mama Nkechi's Kitchen",
        kind: "AUDIO_SLOT",
        headline: "Hear this week's soup of the day",
        ctaLabel: "Visit page",
        linkUrl: "https://example.com/kitchen",
        startsOn: "2026-01-01",
        endsOn: "2099-01-01",
      };
      const mk = (c: string) =>
        a.h
          .http()
          .post("/api/v1/admin/ads")
          .set(a.auth("adman"))
          .send({ ...body, audioClipId: c });
      expect((await mk(wrong.id)).status).toBe(422);
      expect((await mk(long.id)).status).toBe(422);
      const made = await mk(good.id);
      expect(made.status).toBe(201);
      adId = made.body.id;
      audioId = good.id;
      // not approved yet: nothing public, not even the sound
      await a.h.http().get(`/api/v1/voice-clips/${audioId}/play`).expect(404);
      await a.h
        .http()
        .post(`/api/v1/admin/ads/${adId}/decision`)
        .set(a.auth("adman"))
        .send({ decision: "APPROVE" })
        .expect(200);
    });

    it("the public asks for the audio slot, gets it labelled Ad with its clip, and plays it through a short-lived link", async () => {
      const r = await a.h
        .http()
        .get("/api/v1/ads/placement?kind=AUDIO_SLOT")
        .set("X-Guest-Id", G1)
        .expect(200);
      expect(r.body.ad).toMatchObject({
        id: adId,
        kind: "AUDIO_SLOT",
        label: "Ad",
        brand: "Mama Nkechi's Kitchen",
        audioClipId: audioId,
        audioDurationMs: 15_000,
      });
      // a feed-card slot never gets the audio ad
      const card = await a.h
        .http()
        .get("/api/v1/ads/placement?kind=FEED_CARD")
        .expect(200);
      expect(card.body.ad).toBeNull();
      const play = await a.h
        .http()
        .get(`/api/v1/voice-clips/${audioId}/play`)
        .expect(200);
      expect(play.body.url).toMatch(/^https:\/\/signed\.test\/voice\//);
      // pausing the ad stops the sound
      await a.h
        .http()
        .post(`/api/v1/admin/ads/${adId}/decision`)
        .set(a.auth("adman"))
        .send({ decision: "PAUSE" })
        .expect(200);
      await a.h.http().get(`/api/v1/voice-clips/${audioId}/play`).expect(404);
      await a.h
        .http()
        .post(`/api/v1/admin/ads/${adId}/decision`)
        .set(a.auth("adman"))
        .send({ decision: "RESUME" })
        .expect(200);
    });

    it("a listen counts once per person per ad per day; a view and a tap still count each time", async () => {
      await event("LISTEN", G1).expect(204);
      await event("LISTEN", G1).expect(204);
      expect(await count("LISTEN")).toBe(1);
      await event("LISTEN", G2).expect(204);
      expect(await count("LISTEN")).toBe(2);
      // a signed-in person: once, whatever device
      await event("LISTEN", undefined, "plain").expect(204);
      await event("LISTEN", G1, "plain").expect(204);
      expect(
        await a.prisma.adEvent.count({
          where: { adId, kind: "LISTEN", userId: a.people.plain.id },
        }),
      ).toBe(1);
      // nobody to tell apart: not counted
      await event("LISTEN").expect(204);
      expect(await count("LISTEN")).toBe(3);
      // taps and views are not collapsed
      await event("IMPRESSION", G1).expect(204);
      await event("IMPRESSION", G1).expect(204);
      await event("TAP", G1).expect(204);
      expect(await count("IMPRESSION")).toBe(2);
      expect(await count("TAP")).toBe(1);
      // the next day counts again
      await a.prisma.adEvent.updateMany({
        where: { adId, kind: "LISTEN" },
        data: { day: new Date("2026-01-01T00:00:00Z") },
      });
      await event("LISTEN", G1).expect(204);
      expect(await count("LISTEN")).toBe(4);
    });

    it("five listens that arrive together count once", async () => {
      const G3 = "33333333-3333-4333-8333-333333333333";
      await Promise.all(
        Array.from({ length: 5 }, () => event("LISTEN", G3).expect(204)),
      );
      expect(
        await a.prisma.adEvent.count({
          where: { adId, kind: "LISTEN", guestId: G3 },
        }),
      ).toBe(1);
    });

    it("the admin's numbers show the listens", async () => {
      const list = await a.h
        .http()
        .get("/api/v1/admin/ads")
        .set(a.auth("adman"))
        .expect(200);
      expect(list.body.items.find((x: any) => x.id === adId).listens).toBe(5);
    });
  });
});
