/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";
import { ChargeSweeperService } from "../../src/talk/charge-sweeper.service";
import { UnitsAccess } from "../../src/talk/shared/units-access";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/**
 * C22: the sweeper reverses only charges THIS code made. The post charge carries `refType` from the statement that
 * creates it (the old code never wrote it), so a rolled-back deploy cannot make the sweeper refund the old code's posts.
 */
describe("C22: the charge sweeper reads only charges with the mark", () => {
  let h: Harness;
  let q: { id: string };
  let sweeper: ChargeSweeperService;
  let units: UnitsAccess;
  const ago = (m: number) => new Date(Date.now() - m * MIN);
  const clearState = async () => {
    await h.prisma.$executeRaw`DELETE FROM "ChargeSweeperState"`;
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, NULL)`;
  };
  /**
   * sweep() is global: another spec may have left a marked, unlinked, committed post charge (several fixtures carry the
   * mark), and a sweep at +31 minutes or +2 hours would reverse it and break a count here. Before each test those
   * leftovers are settled the way the sweeper itself settles them (start time far back, a pass far in the future), so
   * the only candidates left are this test's own. Nobody's people or posts are deleted.
   */
  const retireOthers = async () => {
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01') ON CONFLICT ("id") DO UPDATE SET "startAt" = '2000-01-01'`;
    await sweeper.sweep(new Date(Date.now() + 400 * DAY));
  };
  const answerUrl = () => `/api/v1/questions/${q.id}/answers`;
  const send = (p: Person, key: string, body: string) =>
    h
      .http()
      .post(answerUrl())
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send({ kind: "TEXT", body });
  const chargeOf = (p: Person, key: string) =>
    h.prisma.charge.findUniqueOrThrow({
      where: { userId_idempotencyKey: { userId: p.id, idempotencyKey: key } },
    });
  const reversals = async (p: Person) =>
    h.prisma.ledgerTransaction.count({
      where: {
        kind: "REVERSAL",
        chargeId: {
          in: (
            await h.prisma.charge.findMany({
              where: { userId: p.id },
              select: { id: true },
            })
          ).map((c) => c.id),
        },
      },
    });
  const freeLeft = async (p: Person) =>
    (
      await h.prisma.freeAllowance.findUniqueOrThrow({
        where: { userId: p.id },
      })
    ).freePostsRemaining;
  const balance = async (p: Person) =>
    (await h.prisma.wallet.findUniqueOrThrow({ where: { userId: p.id } }))
      .balanceMilli;

  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: {
        status: "LIVE",
        startsAt: new Date(Date.now() - 60 * MIN),
        endsAt: new Date(Date.now() + 24 * 60 * MIN),
      },
    });
    sweeper = h.app.get(ChargeSweeperService);
    units = h.app.get(UnitsAccess);
  });
  afterAll(async () => {
    await h.prisma.$executeRaw`DELETE FROM "ChargeSweeperState"`;
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01')`;
    await h.prisma.answer
      .updateMany({
        where: { questionId: q.id },
        data: { status: "DELETED_BY_AUTHOR" },
      })
      .catch(() => undefined);
    await h.close();
  });

  it("deploy, rollback to the old code, deploy again: nothing the old code charged is reversed, at +31 minutes or +2 hours", async () => {
    await retireOthers();
    await clearState();
    // The first boot of this code stamps the start time (100 days back, so the 90-day-old charge is after it).
    await sweeper.stampStart(new Date(Date.now() - 100 * DAY));
    // The old code serves: it never writes refType or refId.
    const old = async (freePosts: number, withPost: boolean) => {
      const p = await makePerson(h, { freePosts, balanceMilli: 500_000 });
      const key = randomUUID();
      const r = await send(p, key, "old code " + key).expect(201);
      if (!withPost)
        await h.prisma.answer.deleteMany({ where: { id: r.body.answer.id } });
      await h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { refType: null, refId: null },
      });
      return { p, key };
    };
    const paidWithPost = await old(0, true);
    const paidNoPost = await old(0, false);
    const freeWithPost = await old(3, true);
    const aged = await old(0, false);
    await h.prisma.charge.updateMany({
      where: { userId: aged.p.id },
      data: { createdAt: new Date(Date.now() - 90 * DAY) },
    });
    expect(
      (await chargeOf(freeWithPost.p, freeWithPost.key)).usedFreePost,
    ).toBe(true);
    const all = [paidWithPost, paidNoPost, freeWithPost, aged];
    const before = await Promise.all(
      all.map(async (x) => [await balance(x.p), await freeLeft(x.p)]),
    );
    // The new code boots again: the start time does not move.
    await sweeper.onModuleInit();
    for (const later of [31 * MIN, 2 * 60 * MIN]) {
      expect(await sweeper.sweep(new Date(Date.now() + later))).toBe(0);
      for (const x of all) {
        expect((await chargeOf(x.p, x.key)).status).toBe("COMMITTED");
        expect(await reversals(x.p)).toBe(0);
      }
    }
    expect(
      await Promise.all(
        all.map(async (x) => [await balance(x.p), await freeLeft(x.p)]),
      ),
    ).toEqual(before);
  });

  it("a post made through the real route by this code: the charge carries the mark when it is made, is linked once the post is stored, and is never swept", async () => {
    await retireOthers();
    await clearState();
    await sweeper.stampStart(ago(120));
    const spy = jest.spyOn(units, "charge");
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const r = await send(p, key, "kept " + key).expect(201);
    expect(spy.mock.calls[0][3]).toMatchObject({ refType: "answer" });
    spy.mockRestore();
    const c = await chargeOf(p, key);
    expect(c.refType).toBe("answer");
    expect(c.refId).toBe(r.body.answer.id);
    await h.prisma.charge.updateMany({
      where: { userId: p.id },
      data: { createdAt: ago(300) },
    });
    expect(await sweeper.sweep(new Date(Date.now() + 2 * 60 * MIN))).toBe(0);
    expect((await chargeOf(p, key)).status).toBe("COMMITTED");
    expect(await reversals(p)).toBe(0);
  });

  it("an orphan made by this code (charged with the mark, no post stored): reversed once at +31 minutes, the free post comes back, the dead retry record goes, a second sweep changes nothing; the same key then gets 409 CONFLICT", async () => {
    await retireOthers();
    await clearState();
    await sweeper.stampStart(ago(120));
    // (a) charged through the ledger the way spendThen does, then nothing: the row a crash leaves.
    const free = await makePerson(h, { freePosts: 3, balanceMilli: 500_000 });
    const keyF = randomUUID();
    await units.charge(free.id, "POST_TEXT", keyF, {
      chars: 20,
      refType: "answer",
    });
    const made = await chargeOf(free, keyF);
    expect(made.refType).toBe("answer");
    expect(made.refId).toBeNull();
    expect(made.usedFreePost).toBe(true);
    expect(await freeLeft(free)).toBe(2);
    // (b) through the real route, then the request "dies": no post, the retry record unfinished and old.
    const paid = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const first = await send(paid, key, "lost " + key).expect(201);
    await h.prisma.answer.deleteMany({ where: { id: first.body.answer.id } });
    await h.prisma.charge.updateMany({
      where: { userId: paid.id },
      data: { refId: null, createdAt: ago(40) },
    });
    await h.prisma.charge.updateMany({
      where: { userId: free.id },
      data: { createdAt: ago(40) },
    });
    await h.prisma
      .$executeRaw`UPDATE "IdempotencyRecord" SET "completedAt" = NULL, "responseBody" = NULL, "createdAt" = ${ago(40)}
        WHERE "actorId" = ${paid.id} AND "key" = ${key}`;
    expect((await chargeOf(paid, key)).refType).toBe("answer");
    const cost = (await chargeOf(paid, key)).costMilli;
    expect(cost).toBeGreaterThan(0);
    expect(await balance(paid)).toBe(500_000 - cost);

    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(2);
    expect((await chargeOf(free, keyF)).status).toBe("REVERSED");
    expect((await chargeOf(paid, key)).status).toBe("REVERSED");
    expect(await reversals(free)).toBe(0); // a free post cost nothing: no ledger rows, the post comes back
    expect(await reversals(paid)).toBe(1);
    expect(await freeLeft(free)).toBe(3);
    expect(await balance(paid)).toBe(500_000);
    expect(
      await h.prisma.idempotencyRecord.count({
        where: { actorId: paid.id, key },
      }),
    ).toBe(0);

    // second sweep: nothing changes
    expect(await sweeper.sweep()).toBe(0);
    expect(await reversals(free)).toBe(0);
    expect(await reversals(paid)).toBe(1);
    expect(await freeLeft(free)).toBe(3);
    expect(await balance(paid)).toBe(500_000);

    // the same key after the sweep: 409 CONFLICT, start again with a new key
    const retry = await send(paid, key, "lost " + key);
    expect(retry.status).toBe(409);
    expect(retry.body.code ?? retry.body.error?.code).toBe("CONFLICT");
    expect(JSON.stringify(retry.body)).toMatch(/start again with a new key/i);
    expect(await balance(paid)).toBe(500_000);
    expect(await h.prisma.answer.count({ where: { authorId: paid.id } })).toBe(
      0,
    );
  });
});
