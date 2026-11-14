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

/**
 * V-HOTFIX-1 round 4: the sweeper reads only unlinked committed post charges made after the stored start time, 30 minutes
 * old, with no unfinished retry record younger than 30 minutes; it deletes the dead record of the request it reverses;
 * a replay of a removed answer is 404 and stores nothing.
 */
describe("hotfix 1 round 4: charge sweeper and retry records", () => {
  let h: Harness;
  let q: { id: string };
  let mod: Person;
  let sweeper: ChargeSweeperService;
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    mod = await makePerson(h, { roles: ["MODERATOR"] });
    sweeper = h.app.get(ChargeSweeperService);
    await setStart("2000-01-01");
  });
  afterAll(async () => {
    // Leave no posts behind: global lists that other specs read must not see them.
    const ids = (
      await h.prisma.answer.findMany({
        where: { questionId: q.id },
        select: { id: true },
      })
    ).map((a) => a.id);
    await h.prisma.moderationAction
      .deleteMany({ where: { item: { targetId: { in: ids } } } })
      .catch(() => undefined);
    await h.prisma.moderationItem
      .deleteMany({ where: { targetId: { in: ids } } })
      .catch(() => undefined);
    await h.prisma.reply
      .deleteMany({ where: { answerId: { in: ids } } })
      .catch(() => undefined);
    await h.prisma.answer
      .deleteMany({ where: { questionId: q.id } })
      .catch(() => undefined);
    await h.prisma.question
      .delete({ where: { id: q.id } })
      .catch(() => undefined);
    await h.close();
  });

  const setStart = (iso: string) =>
    h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, ${new Date(iso)}) ON CONFLICT ("id") DO UPDATE SET "startAt" = ${new Date(iso)}`;
  const answerUrl = () => `/api/v1/questions/${q.id}/answers`;
  const send = (p: Person, key: string, body: string, url = answerUrl()) =>
    h
      .http()
      .post(url)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(
        url.endsWith("/replies")
          ? { kind: "TEXT", body, stance: "AGREE" }
          : { kind: "TEXT", body },
      );
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
  const chargeOf = (p: Person, key: string) =>
    h.prisma.charge.findUniqueOrThrow({
      where: { userId_idempotencyKey: { userId: p.id, idempotencyKey: key } },
    });
  const rec = (p: Person, key: string) =>
    h.prisma.idempotencyRecord.findUnique({
      where: { actorId_key: { actorId: p.id, key } },
    });
  const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);
  const reversals = (chargeId: string) =>
    h.prisma.ledgerTransaction.count({ where: { kind: "REVERSAL", chargeId } });

  /**
   * A request that charged and died: the post and its link are gone and its retry record stays unfinished.
   * `minutes` is how long ago the request started (charge and record).
   */
  async function crash(
    p: Person,
    key: string,
    body: string,
    minutes: number,
    url = answerUrl(),
  ) {
    const first = await send(p, key, body, url).expect(201);
    if (url.endsWith("/replies"))
      await h.prisma.reply.deleteMany({ where: { id: first.body.reply.id } });
    else
      await h.prisma.answer.deleteMany({ where: { id: first.body.answer.id } });
    await h.prisma.charge.updateMany({
      where: { userId: p.id, idempotencyKey: key },
      data: {
        refType: url.endsWith("/replies") ? "reply" : "answer",
        refId: null,
        createdAt: ago(minutes),
      },
    });
    await h.prisma
      .$executeRaw`UPDATE "IdempotencyRecord" SET "completedAt" = NULL, "responseBody" = NULL, "createdAt" = ${ago(minutes)}
      WHERE "actorId" = ${p.id} AND "key" = ${key}`;
  }

  it("MEDIUM 1: the same person posts again within 5 minutes: the dead charge is reversed once, the second keeps its own", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const k1 = randomUUID();
    const k2 = randomUUID();
    await crash(p, k1, "the dead one", 36);
    await send(p, k2, "the next one").expect(201); // within 5 minutes of the dead request
    await h.prisma.charge.updateMany({
      where: { userId: p.id, idempotencyKey: k2 },
      data: { createdAt: ago(31) },
    });
    await h.prisma
      .$executeRaw`UPDATE "IdempotencyRecord" SET "createdAt" = ${ago(31)} WHERE "actorId" = ${p.id} AND "key" = ${k2}`;
    const cost = (await chargeOf(p, k2)).costMilli;
    expect(cost).toBeGreaterThan(0);
    expect(await balance(p)).toBe(500_000 - 2 * cost);
    await sweeper.sweep();
    await sweeper.sweep();
    const dead = await chargeOf(p, k1);
    expect(dead.status).toBe("REVERSED");
    expect(await reversals(dead.id)).toBe(1);
    const second = await chargeOf(p, k2);
    expect(second.status).toBe("COMMITTED");
    expect(second.refId).not.toBeNull();
    expect(await balance(p)).toBe(500_000 - cost);
    expect(await ledgerSum(p)).toBe((await balance(p)) - 500_000);
  });

  it("a charge made before the start time is never reversed, any age, with or without a matching post", async () => {
    const withPost = await makePerson(h, {
      freePosts: 0,
      balanceMilli: 500_000,
    });
    const noPost = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const ka = randomUUID();
    const kb = randomUUID();
    await send(withPost, ka, "has a post").expect(201);
    await h.prisma.charge.updateMany({
      where: { userId: withPost.id },
      data: { refType: null, refId: null, createdAt: ago(300) },
    });
    await crash(noPost, kb, "no post", 300);
    const [pa, pb] = [await balance(withPost), await balance(noPost)];
    await setStart(ago(60).toISOString());
    try {
      await sweeper.sweep();
      await sweeper.sweep(new Date(Date.now() + 90 * 86_400_000));
    } finally {
      await setStart("2000-01-01");
    }
    expect((await chargeOf(withPost, ka)).status).toBe("COMMITTED");
    expect((await chargeOf(noPost, kb)).status).toBe("COMMITTED");
    expect([await balance(withPost), await balance(noPost)]).toEqual([pa, pb]);
    // and with no start-time row at all nothing is read
    await h.prisma.$executeRaw`DELETE FROM "ChargeSweeperState"`;
    try {
      await h.prisma.charge.updateMany({
        where: { userId: noPost.id },
        data: { createdAt: ago(60) },
      });
      expect(await sweeper.sweep()).toBe(0);
    } finally {
      await h.prisma
        .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01')`;
    }
    expect((await chargeOf(noPost, kb)).status).toBe("COMMITTED");
  });

  it.each([["answer"], ["reply"]] as const)(
    "MEDIUM 3 (%s): retry at 1 minute is in progress, after a sweep at 31 minutes it is 409 CONFLICT at once, then a new key posts once",
    async (kind) => {
      const w = await makePerson(h, { freePosts: 5 });
      const base = await send(w, randomUUID(), "base").expect(201);
      const url =
        kind === "answer"
          ? answerUrl()
          : `/api/v1/answers/${base.body.answer.id}/replies`;
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      await crash(p, key, "words " + kind, 1, url);
      const t0 = Date.now();
      const early = await send(p, key, "words " + kind, url);
      expect(early.status).toBe(409);
      expect(early.body.code ?? early.body.error?.code).toBe(
        "REQUEST_IN_PROGRESS",
      );
      expect(Date.now() - t0).toBeGreaterThan(10_000); // it waited the full time: nothing else touched the record
      expect((await rec(p, key))?.completedAt).toBeNull(); // younger than 30 minutes: not touched
      // 31 minutes later
      await h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { createdAt: ago(31) },
      });
      await h.prisma
        .$executeRaw`UPDATE "IdempotencyRecord" SET "createdAt" = ${ago(31)} WHERE "actorId" = ${p.id} AND "key" = ${key}`;
      await sweeper.sweep();
      expect(await rec(p, key)).toBeNull();
      const t1 = Date.now();
      const late = await send(p, key, "words " + kind, url);
      expect(Date.now() - t1).toBeLessThan(3_000);
      expect(late.status).toBe(409);
      expect(late.body.code ?? late.body.error?.code).toBe("CONFLICT");
      expect(await balance(p)).toBe(500_000);
      expect(await ledgerSum(p)).toBe(0);
      expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(
        0,
      );
      expect(await h.prisma.reply.count({ where: { authorId: p.id } })).toBe(0);
      const fresh = await send(p, randomUUID(), "words " + kind, url).expect(
        201,
      );
      expect(JSON.stringify(fresh.body)).toContain("words " + kind);
      const charges = await h.prisma.charge.findMany({
        where: { userId: p.id },
      });
      expect(charges.filter((c) => c.status === "COMMITTED")).toHaveLength(1);
      expect(charges.filter((c) => c.status === "REVERSED")).toHaveLength(1);
      expect(await ledgerSum(p)).toBe((await balance(p)) - 500_000);
    },
    60_000,
  );

  it("a dead record of a request that never charged is removed, the retry runs; a record under 30 minutes and other routes' records stay", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const mk = (key: string, minutes: number, path: string) =>
      h.prisma.idempotencyRecord.create({
        data: {
          actorId: p.id,
          key,
          method: "POST",
          path,
          requestHash: "x",
          createdAt: ago(minutes),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    const dead = randomUUID();
    const young = randomUUID();
    const other = randomUUID();
    await mk(dead, 31, answerUrl());
    await mk(young, 29, answerUrl());
    await mk(other, 400, "/api/v1/something/else");
    await sweeper.sweep();
    expect(await rec(p, dead)).toBeNull();
    expect(await rec(p, young)).not.toBeNull();
    expect(await rec(p, other)).not.toBeNull();
    await send(p, dead, "retry runs").expect(201);
    expect(await balance(p)).toBeLessThan(500_000);
  });

  it("a charge that reaches 30 minutes with a record under 30 minutes is not reversed; at 29 minutes nothing happens", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const k = randomUUID();
    await crash(p, k, "slow", 29);
    await sweeper.sweep();
    expect((await chargeOf(p, k)).status).toBe("COMMITTED");
    expect(await rec(p, k)).not.toBeNull();
    await sweeper.sweep(new Date(Date.now() + 2 * MIN));
    expect((await chargeOf(p, k)).status).toBe("REVERSED");
    expect(await rec(p, k)).toBeNull();
  });

  it("MEDIUM 4: a removed answer's replay is 404 inside the window and after expiry, stores nothing; after a restore the replay returns the post", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const first = await send(p, key, "text that was removed").expect(201);
    const item = await h.prisma.moderationItem.create({
      data: {
        targetType: "ANSWER",
        targetId: first.body.answer.id,
        queue: "REPORTED",
        reasons: ["THREAT_OR_VIOLENCE"],
        reportCount: 1,
      },
    });
    const act = (action: string) =>
      h
        .http()
        .post(`/api/v1/admin/moderation/items/${item.id}/action`)
        .set("Authorization", mod.auth)
        .send({ action, reason: "Checked by the team." });
    await act("REMOVE").expect(200);
    const state = async () => ({
      balance: await balance(p),
      charges: await h.prisma.charge.count({ where: { userId: p.id } }),
      answers: await h.prisma.answer.count({ where: { authorId: p.id } }),
    });
    const before = await state();
    const inside = await send(p, key, "text that was removed");
    expect(inside.status).toBe(404);
    expect(JSON.stringify(inside.body)).not.toContain("text that was");
    // the record expires
    await h.prisma.idempotencyRecord.updateMany({
      where: { actorId: p.id, key },
      data: { expiresAt: ago(1) },
    });
    for (let i = 0; i < 2; i++) {
      const after = await send(p, key, "text that was removed");
      expect(after.status).toBe(404);
      expect(JSON.stringify(after.body)).not.toContain("text that was");
      // nothing was stored: no record holds the text
      const r = await rec(p, key);
      expect(JSON.stringify(r?.responseBody ?? null)).not.toContain(
        "text that was",
      );
      expect(r).toBeNull();
    }
    expect(await state()).toEqual(before);
    // restored: the replay returns the post
    await act("RESTORE").expect(200);
    const back = await send(p, key, "text that was removed");
    expect(back.status).toBe(201);
    expect(back.body.answer.id).toBe(first.body.answer.id);
    expect(await state()).toEqual(before);
  });

  it("MEDIUM 4 (reply): a removed reply's replay never carries its text, in the window or after expiry", async () => {
    const w = await makePerson(h, { freePosts: 5 });
    const base = await send(w, randomUUID(), "base for reply").expect(201);
    const url = `/api/v1/answers/${base.body.answer.id}/replies`;
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const first = await send(p, key, "reply that was removed", url).expect(201);
    const item = await h.prisma.moderationItem.create({
      data: {
        targetType: "REPLY",
        targetId: first.body.reply.id,
        queue: "REPORTED",
        reasons: ["THREAT_OR_VIOLENCE"],
        reportCount: 1,
      },
    });
    await h
      .http()
      .post(`/api/v1/admin/moderation/items/${item.id}/action`)
      .set("Authorization", mod.auth)
      .send({ action: "REMOVE", reason: "Checked by the team." })
      .expect(200);
    const before = { b: await balance(p), r: await h.prisma.reply.count() };
    const inside = await send(p, key, "reply that was removed", url);
    expect(inside.status).toBe(404);
    expect(JSON.stringify(inside.body)).not.toContain("reply that was");
    await h.prisma.idempotencyRecord.updateMany({
      where: { actorId: p.id, key },
      data: { expiresAt: ago(1) },
    });
    const after = await send(p, key, "reply that was removed", url);
    expect(after.status).toBe(403);
    expect(after.body.code ?? after.body.error?.code).toBe("CONTENT_REMOVED");
    expect(JSON.stringify(after.body)).not.toContain("reply that was");
    expect(
      JSON.stringify((await rec(p, key))?.responseBody ?? null),
    ).not.toContain("reply that was");
    expect({
      b: await balance(p),
      r: await h.prisma.reply.count(),
    }).toEqual(before);
  });

  it("250 candidates whose reversal throws ahead of 10 good ones: the 10 are reversed, in this pass and again in the next", async () => {
    // A charge by a person that does not exist cannot be reversed (the wallet cannot be locked): it throws every time.
    const ghosts = Array.from({ length: 250 }, (_, i) => ({
      id: randomUUID(),
      userId: randomUUID(),
      action: "POST_TEXT" as const,
      costMilli: 400,
      refType: "answer",
      idempotencyKey: `ghost-${randomUUID()}`,
      createdAt: new Date(Date.now() - (600 + i) * MIN),
    }));
    await h.prisma.charge.createMany({ data: ghosts });
    const good: { p: Person; key: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      await crash(p, key, `good ${i}`, 60);
      good.push({ p, key });
    }
    // the 250 ghosts are older than the good ones, so they come first
    expect(await sweeper.sweep()).toBe(10);
    for (const g of good) {
      expect((await chargeOf(g.p, g.key)).status).toBe("REVERSED");
      expect(await balance(g.p)).toBe(500_000);
    }
    // next pass: a new good one still gets through
    const more = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const mk = randomUUID();
    await crash(more, mk, "later", 60);
    expect(await sweeper.sweep(new Date(Date.now() + 61 * MIN))).toBe(1);
    expect((await chargeOf(more, mk)).status).toBe("REVERSED");
    // and a fresh instance (no memory of the failures) does not get stuck on them either
    const fresh = new ChargeSweeperService(h.prisma, h.app.get(UnitsAccess));
    const more2 = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const mk2 = randomUUID();
    await crash(more2, mk2, "later still", 60);
    expect(await fresh.sweep()).toBe(1);
    await h.prisma.charge.deleteMany({
      where: { id: { in: ghosts.map((g) => g.id) } },
    });
  }, 60_000);

  it("an instance that dies inside the reversal changes nothing; the next pass finishes it", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    await crash(p, key, "half", 60);
    const seen: { record: boolean }[] = [];
    // dies after the guard deleted the record, before the reversal commits
    const dying = new ChargeSweeperService(h.prisma, {
      reverseGuarded: (id: string, why: string, guard: never) =>
        h.prisma.$transaction(async (tx) => {
          await (guard as (tx: unknown, c: unknown) => Promise<boolean>)(
            tx,
            await tx.charge.findUniqueOrThrow({ where: { id } }),
          );
          seen.push({
            record:
              (await tx.idempotencyRecord.count({
                where: { actorId: p.id, key },
              })) > 0,
          });
          throw new Error(`process died ${why}`);
        }),
    } as unknown as UnitsAccess);
    expect(await dying.sweep()).toBe(0);
    expect(seen).toEqual([{ record: false }]); // the guard did delete it inside the transaction
    const c = await chargeOf(p, key);
    expect(c.status).toBe("COMMITTED");
    expect(await reversals(c.id)).toBe(0);
    expect(await balance(p)).toBeLessThan(500_000);
  });

  it("when the reversal cannot be done, the dead record is still removed and the retry posts under the old charge once", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    await crash(p, key, "retry me", 60);
    const broken = new ChargeSweeperService(h.prisma, {
      reverseGuarded: () => Promise.reject(new Error("ledger down")),
    } as unknown as UnitsAccess);
    expect(await broken.sweep()).toBe(0);
    expect(await rec(p, key)).toBeNull(); // dead for more than 30 minutes: removed
    const paid = await balance(p);
    const retry = await send(p, key, "retry me").expect(201);
    expect(await balance(p)).toBe(paid); // not charged twice
    const c = await chargeOf(p, key);
    expect(c.status).toBe("COMMITTED");
    expect(c.refId).toBe(retry.body.answer.id);
    await sweeper.sweep(); // linked now: not an orphan (other specs' leftovers may be swept)
    expect((await chargeOf(p, key)).status).toBe("COMMITTED");
  });

  it("five instances sweeping 30 dead charges at once, one dying part-way: each reversed once, nobody wrong", async () => {
    const people: { p: Person; key: string; free: boolean }[] = [];
    for (let i = 0; i < 30; i++) {
      const free = i % 2 === 0;
      const p = await makePerson(
        h,
        free
          ? { freePosts: 2, balanceMilli: 500_000 }
          : { freePosts: 0, balanceMilli: 500_000 },
      );
      const key = randomUUID();
      await crash(p, key, `five ${i}`, 45 + i);
      people.push({ p, key, free });
    }
    const units = h.app.get(UnitsAccess);
    let n = 0;
    const flaky = {
      reverseGuarded: (id: string, why: string, guard: never) => {
        if (++n > 5) return Promise.reject(new Error("instance died"));
        return units.reverseGuarded(id, why, guard);
      },
    } as unknown as UnitsAccess;
    const instances = [
      new ChargeSweeperService(h.prisma, units),
      new ChargeSweeperService(h.prisma, units),
      new ChargeSweeperService(h.prisma, flaky),
      new ChargeSweeperService(h.prisma, units),
      new ChargeSweeperService(h.prisma, units),
    ];
    const counts = await Promise.all(instances.map((i) => i.sweep()));
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30);
    expect(await sweeper.sweep()).toBe(0);
    for (const { p, key, free } of people) {
      const c = await chargeOf(p, key);
      expect(c.status).toBe("REVERSED");
      expect(await reversals(c.id)).toBe(free ? 0 : 1);
      expect(await balance(p)).toBe(500_000);
      expect(await ledgerSum(p)).toBe(0);
      expect(await rec(p, key)).toBeNull();
      if (free)
        expect(
          (
            await h.prisma.freeAllowance.findUniqueOrThrow({
              where: { userId: p.id },
            })
          ).freePostsRemaining,
        ).toBe(2);
    }
  }, 60_000);

  it("the race: a slow request still open when two sweeps run, 200 of 200 keep post and charge", async () => {
    const units = h.app.get(UnitsAccess);
    const realCharge = units.charge.bind(units);
    const wrote: boolean[] = [];
    for (let i = 0; i < 200; i++) {
      const p = await makePerson(
        h,
        i % 2
          ? { freePosts: 0, balanceMilli: 500_000 }
          : { freePosts: 1, balanceMilli: 500_000 },
      );
      const key = randomUUID();
      const spy = jest
        .spyOn(units, "charge")
        .mockImplementation(async (...a: Parameters<typeof realCharge>) => {
          const r = await realCharge(...a);
          // paused between the charge and the write, the charge looks 29.5 minutes old, two sweeps run 2 minutes later
          await h.prisma.charge.updateMany({
            where: { userId: p.id },
            data: { createdAt: ago(29.5) },
          });
          const later = new Date(Date.now() + 2 * MIN);
          await Promise.all([sweeper.sweep(later), sweeper.sweep(later)]);
          return r;
        });
      const res = await send(p, key, `race ${i}`);
      spy.mockRestore();
      wrote.push(res.status === 201);
      const c = await chargeOf(p, key);
      if (res.status === 201) {
        expect(c.status).toBe("COMMITTED");
        expect(c.refId).not.toBeNull();
        expect(await h.prisma.answer.count({ where: { authorId: p.id } })).toBe(
          1,
        );
      }
    }
    expect(wrote.filter(Boolean)).toHaveLength(200);
  }, 300_000);
});
