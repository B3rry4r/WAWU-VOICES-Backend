/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { TokensService } from "../../src/units/units.tokens";
import { MediaJobs } from "../../src/media/media-jobs";
import {
  fixture,
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/** The REAL UnitsModule (no stand-in): extra voice tokens move only through UNITS_PORT. */
describe("extra voice tokens through the real units module", () => {
  let h: Harness;
  let me: Person;
  beforeAll(async () => {
    h = await startHarness();
    me = await makePerson(h);
  });
  afterAll(() => h.close());

  async function giveToken(p: Person) {
    const pay = await h.prisma.payment.create({
      data: {
        userId: p.id,
        kind: "EXTRA_VOICE",
        tokenKind: "SECONDS_30",
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
        kind: "SECONDS_30",
        maxSeconds: 30,
      },
    });
  }
  const tokenRow = (id: string) =>
    h.prisma.extraVoiceToken.findUniqueOrThrow({ where: { id } });
  const newClip = (p: Person, tokenId: string) =>
    h
      .http()
      .post("/api/v1/voice-clips")
      .set("Authorization", p.auth)
      .send({
        purpose: "ANSWER",
        mime: "audio/webm",
        sizeBytes: fixture("long15.webm").length,
        durationMs: 15000,
        extraVoiceTokenId: tokenId,
      });
  async function readyClip(p: Person, tokenId: string) {
    const c = await newClip(p, tokenId).expect(201);
    const row = await h.prisma.voiceClip.findUniqueOrThrow({
      where: { id: c.body.clip.id },
    });
    h.store.objects.set(row.rawKey, fixture("long15.webm"));
    await h
      .http()
      .post(`/api/v1/voice-clips/${row.id}/complete`)
      .set("Authorization", p.auth)
      .expect(202);
    await h.app.get(MediaJobs).idle();
    return row.id;
  }

  it("reserve then abandon: releaseStale past the window gives the token back, usable on a new clip", async () => {
    const tok = await giveToken(me);
    const c = await newClip(me, tok.id).expect(201);
    const t = await tokenRow(tok.id);
    expect(t.status).toBe("RESERVED");
    expect(t.usedOnClipId).toBe(c.body.clip.id);
    expect(t.reservedAt).not.toBeNull(); // the reservation time, so the stale sweep can see it
    expect(t.usedAt).toBeNull(); // usedAt means used
    // inside the window nothing is released
    expect(await h.app.get(TokensService).releaseStale(new Date())).toBe(0);
    expect((await tokenRow(tok.id)).status).toBe("RESERVED");
    // past the window the abandoned clip's token is AVAILABLE again
    const later = new Date(Date.now() + 48 * 3600_000);
    expect(
      await h.app.get(TokensService).releaseStale(later),
    ).toBeGreaterThanOrEqual(1);
    const back = await tokenRow(tok.id);
    expect(back.status).toBe("AVAILABLE");
    expect(back.usedOnClipId).toBeNull();
    // and a new clip can hold it
    const c2 = await newClip(me, tok.id).expect(201);
    expect((await tokenRow(tok.id)).usedOnClipId).toBe(c2.body.clip.id);
  });

  it("a clip whose token was swept away cannot be posted for free (409), the old pointer is cleared", async () => {
    const tok = await giveToken(me);
    const id = await readyClip(me, tok.id);
    await h.app
      .get(TokensService)
      .releaseStale(new Date(Date.now() + 48 * 3600_000));
    const q = await makeQuestion(h);
    await h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", me.auth)
      .set(idem())
      .send({ kind: "VOICE", clipId: id })
      .expect(409);
    expect(await h.prisma.answer.count({ where: { clipId: id } })).toBe(0);
  });

  it("a held token cannot be held twice; another person's token is 404", async () => {
    const tok = await giveToken(me);
    await newClip(me, tok.id).expect(201);
    await newClip(me, tok.id).expect(409);
    await newClip(await makePerson(h), tok.id).expect(404);
  });

  it("discarding a clip, and a clip that fails processing, release the token", async () => {
    const tok = await giveToken(me);
    const c = await newClip(me, tok.id).expect(201);
    await h
      .http()
      .delete(`/api/v1/voice-clips/${c.body.clip.id}`)
      .set("Authorization", me.auth)
      .expect(204);
    expect((await tokenRow(tok.id)).status).toBe("AVAILABLE");
    // a 15 s file on a token whose clip is declared 15 s but the bytes are garbage fails processing
    const c2 = await newClip(me, tok.id).expect(201);
    const row = await h.prisma.voiceClip.findUniqueOrThrow({
      where: { id: c2.body.clip.id },
    });
    h.store.objects.set(
      row.rawKey,
      Buffer.alloc(fixture("long15.webm").length, 7),
    );
    await h
      .http()
      .post(`/api/v1/voice-clips/${row.id}/complete`)
      .set("Authorization", me.auth)
      .expect(202);
    await h.app.get(MediaJobs).idle();
    expect(
      (await h.prisma.voiceClip.findUniqueOrThrow({ where: { id: row.id } }))
        .status,
    ).toBe("FAILED");
    const t = await tokenRow(tok.id);
    expect(t.status).toBe("AVAILABLE");
    expect(t.usedOnClipId).toBeNull();
  });

  it("a published clip's token is USED and the stale sweep never gives it back", async () => {
    const tok = await giveToken(me);
    const id = await readyClip(me, tok.id);
    expect((await tokenRow(tok.id)).status).toBe("RESERVED");
    const q = await makeQuestion(h);
    await h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", me.auth)
      .set(idem())
      .send({ kind: "VOICE", clipId: id, extraVoiceTokenId: tok.id })
      .expect(201);
    expect((await tokenRow(tok.id)).status).toBe("USED");
    await h.app
      .get(TokensService)
      .releaseStale(new Date(Date.now() + 48 * 3600_000));
    expect((await tokenRow(tok.id)).status).toBe("USED");
  });

  it("a reply with a voice token also ends USED", async () => {
    const tok = await giveToken(me);
    const id = await readyClip(me, tok.id);
    await h.prisma.voiceClip.update({
      where: { id },
      data: { purpose: "REPLY" },
    });
    const q = await makeQuestion(h);
    const a = await h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", me.auth)
      .set(idem())
      .send({ kind: "TEXT", body: "root" })
      .expect(201);
    await h
      .http()
      .post(`/api/v1/answers/${a.body.answer.id}/replies`)
      .set("Authorization", me.auth)
      .set(idem())
      .send({ stance: "AGREE", kind: "VOICE", clipId: id })
      .expect(201);
    expect((await tokenRow(tok.id)).status).toBe("USED");
  });

  it("the question vanishing between charge and write is 404 NOT_FOUND, the charge is reversed", async () => {
    const p = await makePerson(h);
    const q = await makeQuestion(h);
    const svc = h.app.get(
      (await import("../../src/talk/posts.service.js")).PostsService,
    );
    // delete the question after the check: simulate by removing it inside the write via a hooked prisma call
    const orig = h.prisma.question.findUnique.bind(h.prisma.question);
    const spy = jest
      .spyOn(h.prisma.question, "findUnique")
      .mockImplementation(((args: never) => {
        const r = orig(args);
        return r.then(async (v: unknown) => {
          spy.mockRestore();
          await h.prisma.question.delete({ where: { id: q.id } });
          return v;
        });
      }) as never);
    const r = await h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", p.auth)
      .set(idem())
      .send({ kind: "TEXT", body: "gone" });
    expect(svc).toBeDefined();
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
    const charges = await h.prisma.charge.findMany({ where: { userId: p.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0].status).toBe("REVERSED");
    expect(
      (
        await h.prisma.freeAllowance.findUniqueOrThrow({
          where: { userId: p.id },
        })
      ).freePostsRemaining,
    ).toBe(10);
  });
});
