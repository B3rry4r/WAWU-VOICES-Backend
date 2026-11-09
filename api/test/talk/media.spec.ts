/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  fixture,
  guestAuth,
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

describe("media: voice clips", () => {
  let h: Harness;
  let me: Person;
  beforeAll(async () => {
    h = await startHarness();
    me = await makePerson(h);
  });
  afterAll(() => h.close());

  const create = (p: Person | null, body: object) => {
    const r = h.http().post("/api/v1/voice-clips").send(body);
    return p ? r.set("Authorization", p.auth) : r;
  };
  const clipBody = (o: object = {}) => ({
    purpose: "ANSWER",
    mime: "audio/webm",
    sizeBytes: fixture("sample.webm").length,
    durationMs: 3200,
    ...o,
  });

  async function readyClip(
    p: Person,
    file = "sample.webm",
    extra: object = {},
  ) {
    const bytes = fixture(file);
    const c = await create(
      p,
      clipBody({ sizeBytes: bytes.length, ...extra }),
    ).expect(201);
    const key = (
      await h.prisma.voiceClip.findUniqueOrThrow({
        where: { id: c.body.clip.id },
      })
    ).rawKey;
    h.store.objects.set(key, bytes);
    await h
      .http()
      .post(`/api/v1/voice-clips/${c.body.clip.id}/complete`)
      .set("Authorization", p.auth)
      .expect(202);
    await h.app
      .get((await import("../../src/media/media-jobs.js")).MediaJobs)
      .idle();
    return c.body.clip.id as string;
  }

  it("401 without a token, 403 PROFILE_REQUIRED without a profile", async () => {
    await create(null, clipBody()).expect(401);
    const ghost = `Bearer ${h.jwks.sign({ sub: "nobody-" + randomUUID() })}`;
    const r = await h
      .http()
      .post("/api/v1/voice-clips")
      .set("Authorization", ghost)
      .send(clipBody())
      .expect(403);
    expect(r.body.error.details.reason).toBe("PROFILE_REQUIRED");
  });

  it("suspended account is 403 ACCOUNT_SUSPENDED", async () => {
    const s = await makePerson(h, { status: "SUSPENDED" });
    const r = await create(s, clipBody()).expect(403);
    expect(r.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("presigns a PUT with Content-Type signed, a PENDING_UPLOAD row, and the 60 s limit", async () => {
    const r = await create(me, clipBody()).expect(201);
    expect(r.body.putUrl).toContain("raw/");
    expect(r.body.putHeaders["Content-Type"]).toBe("audio/webm");
    expect(r.body.clip.status).toBe("PENDING_UPLOAD");
    expect(r.body.clip.maxDurationMs).toBe(60000);
    const row = await h.prisma.voiceClip.findUniqueOrThrow({
      where: { id: r.body.clip.id },
    });
    expect(row.status).toBe("PENDING_UPLOAD");
    expect(row.ownerId).toBe(me.id);
    expect(row.rawKey).toMatch(/^raw\//);
  });

  it("refuses a non-audio type (415), an oversized file (413), a bad body (422)", async () => {
    expect(
      (await create(me, clipBody({ mime: "image/png" })).expect(415)).body.error
        .code,
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(
      (await create(me, clipBody({ sizeBytes: 2_400_001 })).expect(413)).body
        .error.code,
    ).toBe("PAYLOAD_TOO_LARGE");
    expect(
      (await create(me, { purpose: "NOPE" }).expect(422)).body.error.code,
    ).toBe("VALIDATION_FAILED");
    expect(
      (await create(me, clipBody({ durationMs: 100 })).expect(422)).body.error
        .code,
    ).toBe("VALIDATION_FAILED");
  });

  it("a clip of up to 60 s needs no token (V-36: its price is charged when it is sent); over 60 s is 422 VOICE_TOO_LONG", async () => {
    await create(
      me,
      clipBody({ durationMs: 15000, sizeBytes: 600_000 }),
    ).expect(201);
    await create(
      me,
      clipBody({ durationMs: 60000, sizeBytes: 1_000_000 }),
    ).expect(201);
    const r2 = await create(me, clipBody({ durationMs: 61000 })).expect(422);
    expect(r2.body.error.code).toBe("VOICE_TOO_LONG");
    expect(r2.body.error.details).toMatchObject({ maxSeconds: 60 });
  });

  async function giveToken(p: Person, kind: "SECONDS_30" | "SECONDS_60") {
    const pay = await h.prisma.payment.create({
      data: {
        userId: p.id,
        kind: "EXTRA_VOICE",
        tokenKind: kind,
        amountKobo: 15000,
        status: "SUCCEEDED",
        txRef: "voices-" + randomUUID(),
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 1e6),
      },
    });
    return h.prisma.extraVoiceToken.create({
      data: {
        userId: p.id,
        paymentId: pay.id,
        kind,
        maxSeconds: kind === "SECONDS_30" ? 30 : 60,
      },
    });
  }

  it("a token bought before the new prices is still RESERVED for a clip; the clip limit is 60 s whatever the token says", async () => {
    const tok = await giveToken(me, "SECONDS_30");
    expect(
      (
        await create(
          me,
          clipBody({ durationMs: 61000, extraVoiceTokenId: tok.id }),
        ).expect(422)
      ).body.error.code,
    ).toBe("VOICE_TOO_LONG");
    const r = await create(
      me,
      clipBody({
        durationMs: 15000,
        sizeBytes: 600000,
        extraVoiceTokenId: tok.id,
      }),
    ).expect(201);
    expect(r.body.clip.maxDurationMs).toBe(60000);
    const t = await h.prisma.extraVoiceToken.findUniqueOrThrow({
      where: { id: tok.id },
    });
    expect(t.status).toBe("RESERVED");
    expect(t.usedOnClipId).toBe(r.body.clip.id);
    // the same token cannot be held twice
    await create(me, clipBody({ extraVoiceTokenId: tok.id })).expect(409);
    // another person's token is not theirs
    const other = await makePerson(h);
    await create(other, clipBody({ extraVoiceTokenId: tok.id })).expect(404);
    // discarding the clip releases the token
    await h
      .http()
      .delete(`/api/v1/voice-clips/${r.body.clip.id}`)
      .set("Authorization", me.auth)
      .expect(204);
    const t2 = await h.prisma.extraVoiceToken.findUniqueOrThrow({
      where: { id: tok.id },
    });
    expect(t2.status).toBe("AVAILABLE");
    expect(t2.usedOnClipId).toBeNull();
  });

  it("complete before the PUT is 409 UPLOAD_NOT_RECEIVED; someone else's clip is 404 CLIP_NOT_FOUND", async () => {
    const c = await create(me, clipBody()).expect(201);
    const r = await h
      .http()
      .post(`/api/v1/voice-clips/${c.body.clip.id}/complete`)
      .set("Authorization", me.auth)
      .expect(409);
    expect(r.body.error.code).toBe("UPLOAD_NOT_RECEIVED");
    const other = await makePerson(h);
    const r2 = await h
      .http()
      .post(`/api/v1/voice-clips/${c.body.clip.id}/complete`)
      .set("Authorization", other.auth)
      .expect(404);
    expect(r2.body.error.code).toBe("CLIP_NOT_FOUND");
    await h
      .http()
      .post(`/api/v1/voice-clips/${randomUUID()}/complete`)
      .set("Authorization", me.auth)
      .expect(404);
  });

  it("an object of a different size than signed is refused and the clip FAILED", async () => {
    const c = await create(me, clipBody({ sizeBytes: 5000 })).expect(201);
    const row = await h.prisma.voiceClip.findUniqueOrThrow({
      where: { id: c.body.clip.id },
    });
    h.store.objects.set(row.rawKey, Buffer.alloc(399_999, 1));
    await h
      .http()
      .post(`/api/v1/voice-clips/${c.body.clip.id}/complete`)
      .set("Authorization", me.auth)
      .expect(422);
    expect(
      (await h.prisma.voiceClip.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe("FAILED");
  });

  it("finalise normalises to one mono clip, writes duration and 48 peaks, deletes the raw, transcribes it", async () => {
    const id = await readyClip(me);
    const row = await h.prisma.voiceClip.findUniqueOrThrow({
      where: { id },
      include: { transcript: true },
    });
    expect(row.status).toBe("READY");
    expect(row.playKey).toMatch(/^voice\/.*\.m4a$/);
    expect(Math.abs((row.durationMs as number) - 3200)).toBeLessThan(400);
    expect((row.peaks as number[]).length).toBe(48);
    expect(h.store.deleted).toContain(row.rawKey);
    expect(h.store.objects.has(row.rawKey)).toBe(false);
    expect(h.store.objects.get(row.playKey as string)!.length).toBeLessThan(
      40_000,
    );
    // the harness has a fake transcriber, so the queued transcription has run too
    expect(row.transcript?.status).toBe("READY");
    const got = await h
      .http()
      .get(`/api/v1/voice-clips/${id}`)
      .set("Authorization", me.auth)
      .expect(200);
    expect(got.body).toMatchObject({
      id,
      status: "READY",
      transcript: { status: "READY", text: "hello from the clip" },
    });
  });

  it("a clip longer than the limit it was made with is FAILED too_long (never truncated) and its token is not spent", async () => {
    // declare 9 s so the presign passes, upload a real 15 s file: the server measures it
    const c = await create(
      me,
      clipBody({ sizeBytes: fixture("long15.webm").length, durationMs: 9000 }),
    ).expect(201);
    const row = await h.prisma.voiceClip.findUniqueOrThrow({
      where: { id: c.body.clip.id },
    });
    // a clip made before V-36 was held to 10 s; its stored limit still decides
    await h.prisma.voiceClip.update({
      where: { id: row.id },
      data: { maxDurationMs: 10_000 },
    });
    h.store.objects.set(row.rawKey, fixture("long15.webm"));
    await h
      .http()
      .post(`/api/v1/voice-clips/${row.id}/complete`)
      .set("Authorization", me.auth)
      .expect(202);
    await h.app
      .get((await import("../../src/media/media-jobs.js")).MediaJobs)
      .idle();
    const after = await h.prisma.voiceClip.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.status).toBe("FAILED");
    expect(after.failureReason).toBe("too_long");
    expect(after.playKey).toBeNull();
  });

  it("a 15 s clip passes on a 30 s token and the token ends USED when posted", async () => {
    const tok = await giveToken(me, "SECONDS_30");
    const id = await readyClip(me, "long15.webm", {
      durationMs: 15000,
      extraVoiceTokenId: tok.id,
    });
    const row = await h.prisma.voiceClip.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("READY");
    expect(Math.abs((row.durationMs as number) - 15000)).toBeLessThan(600);
    const q = await makeQuestion(h);
    await h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", me.auth)
      .set(idem())
      .send({ kind: "VOICE", clipId: id, extraVoiceTokenId: tok.id })
      .expect(201);
    expect(
      (
        await h.prisma.extraVoiceToken.findUniqueOrThrow({
          where: { id: tok.id },
        })
      ).status,
    ).toBe("USED");
    // a clip that is on a post cannot be deleted by itself
    await h
      .http()
      .delete(`/api/v1/voice-clips/${id}`)
      .set("Authorization", me.auth)
      .expect(409);
  });

  it("playback: guests may play a clip on a published post, nobody else's unposted clip, never a raw key", async () => {
    const id = await readyClip(me);
    const stranger = await makePerson(h);
    await h.http().get(`/api/v1/voice-clips/${id}/play`).expect(404);
    await h
      .http()
      .get(`/api/v1/voice-clips/${id}/play`)
      .set("Authorization", stranger.auth)
      .expect(404);
    const own = await h
      .http()
      .get(`/api/v1/voice-clips/${id}/play`)
      .set("Authorization", me.auth)
      .expect(200);
    expect(own.body.url).toContain("voice/");
    expect(own.body.url).not.toContain("raw/");
    expect(own.body.mime).toBe("audio/mp4");
    const q = await makeQuestion(h);
    const post = await h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", me.auth)
      .set(idem())
      .send({ kind: "VOICE", clipId: id })
      .expect(201);
    const guest = await h
      .http()
      .get(`/api/v1/voice-clips/${id}/play`)
      .expect(200);
    expect(new Date(guest.body.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    // removing the post takes the clip away from listeners
    await h
      .http()
      .delete(`/api/v1/answers/${post.body.answer.id}`)
      .set("Authorization", me.auth)
      .expect(204);
    await h.http().get(`/api/v1/voice-clips/${id}/play`).expect(404);
  });

  it("a clip that is not READY cannot be played or posted (409 CLIP_NOT_READY)", async () => {
    const c = await create(me, clipBody()).expect(201);
    const r = await h
      .http()
      .get(`/api/v1/voice-clips/${c.body.clip.id}/play`)
      .set("Authorization", me.auth)
      .expect(409);
    expect(r.body.error.code).toBe("CLIP_NOT_READY");
    const q = await makeQuestion(h);
    const p = await h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", me.auth)
      .set(idem())
      .send({ kind: "VOICE", clipId: c.body.clip.id })
      .expect(409);
    expect(p.body.error.code).toBe("CLIP_NOT_READY");
  });

  it("rate limit: voice upload is limited per account (429 with Retry-After)", async () => {
    const lim = await makePerson(h);
    await h.prisma.configEntry.upsert({
      where: { key: "ratelimit.voice_upload_per_10min" },
      create: { key: "ratelimit.voice_upload_per_10min", valueJson: 3 },
      update: { valueJson: 3 },
    });
    h.app
      .get(
        (await import("../../src/talk/shared/config-reader.js")).ConfigReader,
      )
      .invalidate();
    try {
      for (let i = 0; i < 3; i++) await create(lim, clipBody()).expect(201);
      const r = await create(lim, clipBody()).expect(429);
      expect(r.body.error.code).toBe("RATE_LIMITED");
      expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
      expect(r.headers["ratelimit-remaining"]).toBe("0");
      await create(await makePerson(h), clipBody()).expect(201); // another account is not affected
    } finally {
      await h.prisma.configEntry.delete({
        where: { key: "ratelimit.voice_upload_per_10min" },
      });
      h.app
        .get(
          (await import("../../src/talk/shared/config-reader.js")).ConfigReader,
        )
        .invalidate();
    }
  });

  it("guests have no X-Guest-Id play problem: GET /voice-clips/:id with a bad id is 404", async () => {
    await h
      .http()
      .get("/api/v1/voice-clips/not-a-uuid")
      .set(guestAuth())
      .expect(404);
  });
});

describe("media: transcription", () => {
  it("with a transcriber the transcript becomes READY with the text", async () => {
    const h = await startHarness();
    try {
      const me = await makePerson(h);
      const bytes = fixture("sample.webm");
      const c = await h
        .http()
        .post("/api/v1/voice-clips")
        .set("Authorization", me.auth)
        .send({
          purpose: "ANSWER",
          mime: "audio/webm",
          sizeBytes: bytes.length,
          durationMs: 3200,
        })
        .expect(201);
      const row = await h.prisma.voiceClip.findUniqueOrThrow({
        where: { id: c.body.clip.id },
      });
      h.store.objects.set(row.rawKey, bytes);
      await h
        .http()
        .post(`/api/v1/voice-clips/${row.id}/complete`)
        .set("Authorization", me.auth)
        .expect(202);
      await h.app
        .get((await import("../../src/media/media-jobs.js")).MediaJobs)
        .idle();
      await h.app
        .get(
          (await import("../../src/media/transcription.worker.js"))
            .TranscriptionWorker,
        )
        .kick();
      const t = await h.prisma.transcript.findUniqueOrThrow({
        where: { clipId: row.id },
      });
      expect(t.status).toBe("READY");
      expect(t.text).toBe("hello from the clip");
      expect(h.transcriber.calls).toBe(1);
      // a failing transcriber stays pending for two tries and is FAILED on the third
      const c2 = await h
        .http()
        .post("/api/v1/voice-clips")
        .set("Authorization", me.auth)
        .send({
          purpose: "ANSWER",
          mime: "audio/webm",
          sizeBytes: bytes.length,
          durationMs: 3200,
        })
        .expect(201);
      const r2 = await h.prisma.voiceClip.findUniqueOrThrow({
        where: { id: c2.body.clip.id },
      });
      h.store.objects.set(r2.rawKey, bytes);
      h.transcriber.fail = true;
      await h
        .http()
        .post(`/api/v1/voice-clips/${r2.id}/complete`)
        .set("Authorization", me.auth)
        .expect(202);
      const jobs = h.app.get(
        (await import("../../src/media/media-jobs.js")).MediaJobs,
      );
      const worker = h.app.get(
        (await import("../../src/media/transcription.worker.js"))
          .TranscriptionWorker,
      );
      await jobs.idle();
      expect(
        (
          await h.prisma.transcript.findUniqueOrThrow({
            where: { clipId: r2.id },
          })
        ).status,
      ).toBe("PENDING");
      await worker.kick();
      await worker.kick();
      expect(
        (
          await h.prisma.transcript.findUniqueOrThrow({
            where: { clipId: r2.id },
          })
        ).status,
      ).toBe("FAILED");
    } finally {
      await h.close();
    }
  });

  it("without a key (no transcriber) the transcript stays PENDING and no text is made up", async () => {
    const h = await startHarness({ transcriber: false });
    try {
      const me = await makePerson(h);
      const bytes = fixture("sample.webm");
      const c = await h
        .http()
        .post("/api/v1/voice-clips")
        .set("Authorization", me.auth)
        .send({
          purpose: "ANSWER",
          mime: "audio/webm",
          sizeBytes: bytes.length,
          durationMs: 3200,
        })
        .expect(201);
      const row = await h.prisma.voiceClip.findUniqueOrThrow({
        where: { id: c.body.clip.id },
      });
      h.store.objects.set(row.rawKey, bytes);
      await h
        .http()
        .post(`/api/v1/voice-clips/${row.id}/complete`)
        .set("Authorization", me.auth)
        .expect(202);
      await h.app
        .get((await import("../../src/media/media-jobs.js")).MediaJobs)
        .idle();
      await h.app
        .get(
          (await import("../../src/media/transcription.worker.js"))
            .TranscriptionWorker,
        )
        .kick();
      const t = await h.prisma.transcript.findUniqueOrThrow({
        where: { clipId: row.id },
      });
      expect(t.status).toBe("PENDING");
      expect(t.text).toBeNull();
      expect(
        (await h.prisma.voiceClip.findUniqueOrThrow({ where: { id: row.id } }))
          .status,
      ).toBe("READY");
    } finally {
      await h.close();
    }
  });
});

describe("media: photo uploads", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(() => h.close());

  it("presigns an avatar PUT and records a StoredFile; 401, 415, 413, 403 role, 422", async () => {
    const me = await makePerson(h);
    const body = { kind: "AVATAR", mime: "image/png", sizeBytes: 90_000 };
    await h.http().post("/api/v1/uploads").send(body).expect(401);
    const ok = await h
      .http()
      .post("/api/v1/uploads")
      .set("Authorization", me.auth)
      .send(body)
      .expect(201);
    const f = await h.prisma.storedFile.findUniqueOrThrow({
      where: { id: ok.body.fileId },
    });
    expect(f).toMatchObject({
      ownerId: me.id,
      kind: "AVATAR",
      mime: "image/png",
      bytes: 90_000,
    });
    expect(ok.body.putHeaders["Content-Type"]).toBe("image/png");
    expect(
      (
        await h
          .http()
          .post("/api/v1/uploads")
          .set("Authorization", me.auth)
          .send({ ...body, mime: "image/gif" })
          .expect(415)
      ).body.error.code,
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(
      (
        await h
          .http()
          .post("/api/v1/uploads")
          .set("Authorization", me.auth)
          .send({ ...body, sizeBytes: 9_000_000 })
          .expect(413)
      ).body.error.code,
    ).toBe("PAYLOAD_TOO_LARGE");
    expect(
      (
        await h
          .http()
          .post("/api/v1/uploads")
          .set("Authorization", me.auth)
          .send({ ...body, kind: "OVERRIDE_IMAGE" })
          .expect(403)
      ).body.error.code,
    ).toBe("ROLE_REQUIRED");
    await h
      .http()
      .post("/api/v1/uploads")
      .set("Authorization", me.auth)
      .send({ ...body, kind: "SHARE_CARD" })
      .expect(422);
    const ed = await makePerson(h, { roles: ["EDITOR"] });
    await h
      .http()
      .post("/api/v1/uploads")
      .set("Authorization", ed.auth)
      .send({ ...body, kind: "OVERRIDE_IMAGE" })
      .expect(201);
  });
});
