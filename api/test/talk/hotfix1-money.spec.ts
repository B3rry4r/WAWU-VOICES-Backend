/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/** V-HOTFIX-1, fault 3: the same key after its record expired never reverses a charge that belongs to a stored post. */
describe("hotfix 1: expired Idempotency-Key and money", () => {
  let h: Harness;
  let q: { id: string };
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
  });
  afterAll(() => h.close());

  const clipFor = (p: Person, durationMs: number, purpose = "ANSWER") =>
    h.prisma.voiceClip.create({
      data: {
        ownerId: p.id,
        purpose: purpose as "ANSWER",
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        playKey: `voice/${randomUUID()}.m4a`,
        playMime: "audio/mp4",
        maxDurationMs: 60000,
        durationMs,
      },
    });
  const send = (p: Person, key: string, body: object, qid = q.id) =>
    h
      .http()
      .post(`/api/v1/questions/${qid}/answers`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(body);
  const balance = async (p: Person) =>
    (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
      ?.balanceMilli ?? 0;
  const free = async (p: Person) =>
    (
      await h.prisma.freeAllowance.findUniqueOrThrow({
        where: { userId: p.id },
      })
    ).freePostsRemaining;
  const expire = (p: Person, key: string) =>
    h.prisma.idempotencyRecord.updateMany({
      where: { actorId: p.id, key },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  /** Reversed charges plus REVERSAL ledger rows for the person: both must stay zero when nothing is undone. */
  const reversals = async (p: Person) => {
    const charges = await h.prisma.charge.findMany({
      where: { userId: p.id },
      select: { id: true, status: true },
    });
    const rows = await h.prisma.ledgerTransaction.count({
      where: { kind: "REVERSAL", chargeId: { in: charges.map((c) => c.id) } },
    });
    return rows + charges.filter((c) => c.status === "REVERSED").length;
  };

  it("a paid voice answer: the replay after expiry returns the stored answer, balance and ledger unchanged", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const clip = await clipFor(p, 25_000);
    const key = randomUUID();
    const first = await send(p, key, { kind: "VOICE", clipId: clip.id }).expect(
      201,
    );
    const paid = await balance(p);
    expect(paid).toBeLessThan(500_000);
    await expire(p, key);
    for (let i = 0; i < 3; i++) {
      const again = await send(p, key, {
        kind: "VOICE",
        clipId: clip.id,
      }).expect(201);
      expect(again.body.answer.id).toBe(first.body.answer.id);
      expect(await balance(p)).toBe(paid);
      await expire(p, key);
    }
    expect(await reversals(p)).toBe(0);
    expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(1);
    const c = await h.prisma.charge.findMany({ where: { userId: p.id } });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      status: "COMMITTED",
      refType: "answer",
      refId: first.body.answer.id,
    });
    expect(
      (
        await h.prisma.answer.findUniqueOrThrow({
          where: { id: first.body.answer.id },
        })
      ).status,
    ).toBe("PUBLISHED");
  });

  it("a free post: the replay after expiry does not give the free post back", async () => {
    const p = await makePerson(h, { freePosts: 2 });
    const key = randomUUID();
    const first = await send(p, key, { kind: "TEXT", body: "free one" }).expect(
      201,
    );
    expect(await free(p)).toBe(1);
    await expire(p, key);
    const again = await send(p, key, { kind: "TEXT", body: "free one" }).expect(
      201,
    );
    expect(again.body.answer.id).toBe(first.body.answer.id);
    expect(await free(p)).toBe(1);
    expect(await reversals(p)).toBe(0);
    expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(1);
    expect(again.body.allowances.freePostsRemaining).toBe(1);
  });

  it("a free post made before the link existed (no refType on the charge) is still found by its content", async () => {
    const p = await makePerson(h, { freePosts: 2 });
    const key = randomUUID();
    const first = await send(p, key, { kind: "TEXT", body: "old one" }).expect(
      201,
    );
    await h.prisma.charge.updateMany({
      where: { userId: p.id },
      data: { refType: null, refId: null },
    });
    await expire(p, key);
    const again = await send(p, key, { kind: "TEXT", body: "old one" }).expect(
      201,
    );
    expect(again.body.answer.id).toBe(first.body.answer.id);
    expect(await free(p)).toBe(1);
    expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(1);
  });

  it("an expired key with a different body or clip is refused and writes nothing", async () => {
    const p = await makePerson(h, { freePosts: 3 });
    const key = randomUUID();
    await send(p, key, { kind: "TEXT", body: "first" }).expect(201);
    await expire(p, key);
    const r = await send(p, key, { kind: "TEXT", body: "second" }).expect(409);
    expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await free(p)).toBe(2);
    expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(1);
  });

  it("the honest reversal still works: a fresh charge whose store fails is reversed once", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const clip = await clipFor(p, 25_000);
    await h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: p.id,
        kind: "VOICE",
        clipId: clip.id,
      },
    });
    const key = randomUUID();
    await send(p, key, { kind: "VOICE", clipId: clip.id }).expect(409);
    expect(await balance(p)).toBe(500_000);
    expect(await reversals(p)).toBe(2); // one REVERSAL row and the charge marked REVERSED
    // the same key again hits the reversed charge: still one reversal, still no new spend
    await send(p, key, { kind: "VOICE", clipId: clip.id }).expect(409);
    expect(await reversals(p)).toBe(2);
    expect(await balance(p)).toBe(500_000);
  });

  it("six sends at once with one key: one answer, one charge", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const clip = await clipFor(p, 25_000);
    const key = randomUUID();
    const rs = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(() =>
        send(p, key, { kind: "VOICE", clipId: clip.id }),
      ),
    );
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(new Set(rs.map((r) => r.body.answer.id)).size).toBe(1);
    expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(1);
    expect(await h.prisma.charge.count({ where: { userId: p.id } })).toBe(1);
    expect(await reversals(p)).toBe(0);
    expect(await balance(p)).toBeLessThan(500_000);
  });

  it("the same key with a different clip is refused", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const a = await clipFor(p, 25_000);
    const b = await clipFor(p, 25_000);
    const key = randomUUID();
    await send(p, key, { kind: "VOICE", clipId: a.id }).expect(201);
    const r = await send(p, key, { kind: "VOICE", clipId: b.id }).expect(409);
    expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    await expire(p, key);
    const r2 = await send(p, key, { kind: "VOICE", clipId: b.id }).expect(409);
    expect(r2.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(1);
    expect(await reversals(p)).toBe(0);
  });

  it("answers and replies keep their key for 8 days, from config; other routes keep 24 hours", async () => {
    const p = await makePerson(h, { freePosts: 5 });
    const key = randomUUID();
    const a = await send(p, key, { kind: "TEXT", body: "keep" }).expect(201);
    const rec = await h.prisma.idempotencyRecord.findFirstOrThrow({
      where: { actorId: p.id, key },
    });
    const days = (rec.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(7.9);
    expect(days).toBeLessThan(8.1);
    const rk = randomUUID();
    await h
      .http()
      .post(`/api/v1/answers/${a.body.answer.id}/replies`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", rk)
      .send({ kind: "TEXT", body: "r", stance: "AGREE" })
      .expect(201);
    const rr = await h.prisma.idempotencyRecord.findFirstOrThrow({
      where: { actorId: p.id, key: rk },
    });
    expect((rr.expiresAt.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(
      7.9,
    );
    // config overrides the default
    await h.prisma.configEntry.upsert({
      where: { key: "idempotency.post_keep_days" },
      create: { key: "idempotency.post_keep_days", valueJson: 3 },
      update: { valueJson: 3 },
    });
    h.app
      .get(
        (await import("../../src/talk/shared/config-reader.js")).ConfigReader,
      )
      .invalidate();
    const k3 = randomUUID();
    await send(p, k3, { kind: "TEXT", body: "three" }).expect(201);
    const r3 = await h.prisma.idempotencyRecord.findFirstOrThrow({
      where: { actorId: p.id, key: k3 },
    });
    expect((r3.expiresAt.getTime() - Date.now()) / 86_400_000).toBeLessThan(
      3.1,
    );
    await h.prisma.configEntry.delete({
      where: { key: "idempotency.post_keep_days" },
    });
  });

  it("a reply replayed after expiry returns the stored reply and moves nothing", async () => {
    const w = await makePerson(h, { freePosts: 3 });
    const v = await makePerson(h, { freePosts: 3 });
    const a = await send(w, randomUUID(), {
      kind: "TEXT",
      body: "to answer",
    }).expect(201);
    const key = randomUUID();
    const reply = () =>
      h
        .http()
        .post(`/api/v1/answers/${a.body.answer.id}/replies`)
        .set("Authorization", v.auth)
        .set("Idempotency-Key", key)
        .send({ kind: "TEXT", body: "a reply", stance: "AGREE" });
    const r1 = await reply().expect(201);
    expect(await free(v)).toBe(2);
    await expire(v, key);
    const r2 = await reply().expect(201);
    expect(r2.body.reply.id).toBe(r1.body.reply.id);
    expect(await free(v)).toBe(2);
    expect(await h.prisma.reply.count({ where: { authorId: v.id } })).toBe(1);
    expect(
      (
        await h.prisma.answer.findUniqueOrThrow({
          where: { id: a.body.answer.id },
        })
      ).replyCount,
    ).toBe(1);
    expect(
      await h.prisma.notification.count({
        where: { userId: w.id, type: "REPLY" },
      }),
    ).toBe(1);
  });
});
