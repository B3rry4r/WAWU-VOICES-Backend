/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";
import { ChargeSweeperService } from "../../src/talk/charge-sweeper.service";

/** V-HOTFIX-1 round 3: a charge from a request that died after charging, with no stored post, is given back once. */
describe("hotfix 1 round 3: the post-charge sweeper", () => {
  let h: Harness;
  let q: { id: string };
  let sweeper: ChargeSweeperService;
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    sweeper = h.app.get(ChargeSweeperService);
    // Round 4: the sweeper reads only charges made after the start time the migration stored. The specs back-date charges,
    // so the start time is set to long ago here (a deploy that happened long ago); the "before the start" cases set their own.
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01') ON CONFLICT ("id") DO UPDATE SET "startAt" = '2000-01-01'`;
  });
  afterAll(() => h.close());

  const clipFor = (p: Person, durationMs: number) =>
    h.prisma.voiceClip.create({
      data: {
        ownerId: p.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        playKey: `voice/${randomUUID()}.m4a`,
        playMime: "audio/mp4",
        maxDurationMs: 60000,
        durationMs,
      },
    });
  const send = (p: Person, key: string, body: object) =>
    h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(body);
  const balance = async (p: Person) =>
    (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
      ?.balanceMilli ?? 0;
  const ledgerSum = async (p: Person) =>
    Number(
      (
        await h.prisma.ledgerEntry.aggregate({
          _sum: { deltaMilli: true },
          where: { account: "USER_WALLET", walletUserId: p.id },
        })
      )._sum.deltaMilli ?? 0,
    );
  const age = (p: Person, minutes: number) =>
    h.prisma.charge.updateMany({
      where: { userId: p.id },
      data: { createdAt: new Date(Date.now() - minutes * 60_000) },
    });
  const charge = (p: Person) =>
    h.prisma.charge.findFirstOrThrow({ where: { userId: p.id } });
  /** Sweeps only what belongs to this spec's person: the shared database holds other specs' charges, which a sweep may also settle. */
  const sweep = () => sweeper.sweep();

  /** A request that charged and then died: the answer row, its retry record and the link are gone. */
  async function crashAfterCharge(p: Person, key: string, body: object) {
    const first = await send(p, key, body).expect(201);
    await h.prisma.answer.deleteMany({ where: { id: first.body.answer.id } });
    await h.prisma.idempotencyRecord.deleteMany({
      where: { actorId: p.id, key },
    });
    await h.prisma.charge.updateMany({
      where: { userId: p.id },
      data: { refType: "answer", refId: null },
    });
    return first;
  }

  it("crash after the charge, the retry fails: the sweep gives the money back, the ledger matches the wallet", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const clip = await clipFor(p, 25_000);
    const key = randomUUID();
    await crashAfterCharge(p, key, { kind: "VOICE", clipId: clip.id });
    // The clip now belongs to another post, so the retry's write fails.
    await h.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: p.id,
        kind: "VOICE",
        clipId: clip.id,
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    await send(p, key, { kind: "VOICE", clipId: clip.id }).expect(409);
    expect(await balance(p)).toBeLessThan(500_000);
    expect((await charge(p)).status).toBe("COMMITTED");
    await age(p, 31);
    await sweep();
    expect((await charge(p)).status).toBe("REVERSED");
    expect(await balance(p)).toBe(500_000);
    expect(await ledgerSum(p)).toBe(0);
    expect(
      await h.prisma.ledgerTransaction.count({
        where: { kind: "REVERSAL", chargeId: (await charge(p)).id },
      }),
    ).toBe(1);
    await sweep(); // a second pass changes nothing
    expect(await balance(p)).toBe(500_000);
  });

  it("a free post used by the dead request comes back", async () => {
    const p = await makePerson(h, { freePosts: 2 });
    await crashAfterCharge(p, randomUUID(), { kind: "TEXT", body: "lost" });
    const left = async () =>
      (
        await h.prisma.freeAllowance.findUniqueOrThrow({
          where: { userId: p.id },
        })
      ).freePostsRemaining;
    expect(await left()).toBe(1);
    await age(p, 31);
    await sweep();
    expect(await left()).toBe(2);
    await sweep();
    expect(await left()).toBe(2);
  });

  it("a charge with a stored post is left alone", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const clip = await clipFor(p, 25_000);
    await send(p, key, { kind: "VOICE", clipId: clip.id }).expect(201);
    const paid = await balance(p);
    await age(p, 31);
    await sweep();
    expect((await charge(p)).status).toBe("COMMITTED");
    expect(await balance(p)).toBe(paid);
  });

  it("a charge whose post was deleted by its author or removed by a moderator is left alone", async () => {
    const a = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const b = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const ra = await send(a, randomUUID(), {
      kind: "TEXT",
      body: "mine",
    }).expect(201);
    const rb = await send(b, randomUUID(), {
      kind: "TEXT",
      body: "theirs",
    }).expect(201);
    await h
      .http()
      .delete(`/api/v1/answers/${ra.body.answer.id}`)
      .set("Authorization", a.auth)
      .expect(204);
    await h.prisma.answer.update({
      where: { id: rb.body.answer.id },
      data: { status: "REMOVED" },
    });
    const [pa, pb] = [await balance(a), await balance(b)];
    await age(a, 31);
    await age(b, 31);
    await sweep();
    expect((await charge(a)).status).toBe("COMMITTED");
    expect((await charge(b)).status).toBe("COMMITTED");
    expect([await balance(a), await balance(b)]).toEqual([pa, pb]);
  });

  it("an unlinked charge made before the start time is never reversed, with or without a matching post", async () => {
    const withPost = await makePerson(h, {
      freePosts: 0,
      balanceMilli: 500_000,
    });
    const noPost = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    await send(withPost, randomUUID(), {
      kind: "TEXT",
      body: "old one",
    }).expect(201);
    await crashAfterCharge(noPost, randomUUID(), {
      kind: "TEXT",
      body: "lost",
    });
    await h.prisma.charge.updateMany({
      where: { userId: withPost.id },
      data: { refType: null, refId: null },
    });
    const [pa, pb] = [await balance(withPost), await balance(noPost)];
    // 5 hours old, any age: the start time is 1 hour ago, so both charges were made before it.
    await age(withPost, 300);
    await age(noPost, 300);
    await h.prisma
      .$executeRaw`UPDATE "ChargeSweeperState" SET "startAt" = now() AT TIME ZONE 'UTC' - interval '1 hour' WHERE "id" = 1`;
    try {
      await sweep();
      await sweeper.sweep(new Date(Date.now() + 40 * 86_400_000));
    } finally {
      await h.prisma
        .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01') ON CONFLICT ("id") DO UPDATE SET "startAt" = '2000-01-01'`;
    }
    expect((await charge(withPost)).status).toBe("COMMITTED");
    expect((await charge(noPost)).status).toBe("COMMITTED");
    expect([await balance(withPost), await balance(noPost)]).toEqual([pa, pb]);
  });

  it("a charge 29 minutes old, or with a request still in flight, is left alone", async () => {
    const young = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    await crashAfterCharge(young, randomUUID(), { kind: "TEXT", body: "y" });
    await age(young, 29);
    const busy = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    await crashAfterCharge(busy, key, { kind: "TEXT", body: "z" });
    await h.prisma.idempotencyRecord.create({
      data: {
        actorId: busy.id,
        key,
        method: "POST",
        path: "/x",
        requestHash: "h",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await age(busy, 31);
    await sweep();
    expect((await charge(young)).status).toBe("COMMITTED");
    expect((await charge(busy)).status).toBe("COMMITTED");
    // Two minutes more (31 minutes) and the first is swept.
    await sweeper.sweep(new Date(Date.now() + 2 * 60_000));
    expect((await charge(young)).status).toBe("REVERSED");
  });

  it("two sweeps at once reverse a charge once", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    await crashAfterCharge(p, randomUUID(), { kind: "TEXT", body: "twice" });
    await age(p, 31);
    await Promise.all([sweeper.sweep(), sweeper.sweep(), sweeper.sweep()]);
    expect(await balance(p)).toBe(500_000);
    expect(await ledgerSum(p)).toBe(0);
    expect(
      await h.prisma.ledgerTransaction.count({
        where: { kind: "REVERSAL", chargeId: (await charge(p)).id },
      }),
    ).toBe(1);
  });
});
