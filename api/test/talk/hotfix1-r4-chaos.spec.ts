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

const MIN = 60_000;

/** V-HOTFIX-1 round 4: 500 mixed operations on 60 people, then the ledger is checked for every person. */
describe("hotfix 1 round 4: chaos run", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
    await h.prisma
      .$executeRaw`UPDATE "ChargeSweeperState" SET "startAt" = '2000-01-01' WHERE "id" = 1`;
  });
  afterAll(() => h.close());

  it("500 operations: ledger = wallet for everyone, 0 double reversals, no post without a charge, no orphan left", async () => {
    const q = await makeQuestion(h);
    const mod = await makePerson(h, { roles: ["MODERATOR"] });
    const sweeper = h.app.get(ChargeSweeperService);
    const START = 500_000;
    const people: { p: Person; free: number; keys: string[] }[] = [];
    for (let i = 0; i < 60; i++) {
      const free = i % 3 === 0 ? 2 : 0;
      people.push({
        p: await makePerson(h, { freePosts: free, balanceMilli: START }),
        free,
        keys: [],
      });
    }
    const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
    const url = `/api/v1/questions/${q.id}/answers`;
    const send = (p: Person, key: string, body: string) =>
      h
        .http()
        .post(url)
        .set("Authorization", p.auth)
        .set("Idempotency-Key", key)
        .send({ kind: "TEXT", body });
    const bodyOf = new Map<string, string>();
    const idOf = new Map<string, string>();
    const counts: Record<string, number> = {};
    const note = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

    const ops = Array.from({ length: 500 }, () =>
      pick([
        "send",
        "send",
        "send",
        "send",
        "replay",
        "replay",
        "crash",
        "crash",
        "delete",
        "remove",
        "sweep",
      ]),
    );
    for (let at = 0; at < ops.length; at += 15) {
      await Promise.all(
        ops.slice(at, at + 15).map(async (op) => {
          const who = pick(people);
          if (op === "send" || op === "crash") {
            const key = randomUUID();
            const text = `chaos ${key}`;
            const r = await send(who.p, key, text);
            note(`send:${r.status}`);
            if (r.status !== 201) return;
            who.keys.push(key);
            bodyOf.set(key, text);
            idOf.set(key, String(r.body.answer.id));
            if (op === "crash") {
              note("crash");
              await h.prisma.answer.deleteMany({
                where: { id: r.body.answer.id },
              });
              idOf.delete(key);
              const age = new Date(
                Date.now() - (31 + Math.random() * 60) * MIN,
              );
              await h.prisma.charge.updateMany({
                where: { userId: who.p.id, idempotencyKey: key },
                data: { refType: null, refId: null, createdAt: age },
              });
              await h.prisma
                .$executeRaw`UPDATE "IdempotencyRecord" SET "completedAt" = NULL, "responseBody" = NULL, "createdAt" = ${age}
                  WHERE "actorId" = ${who.p.id} AND "key" = ${key}`;
            }
          } else if (op === "replay") {
            const key = pick(who.keys);
            if (!key || !idOf.has(key)) return;
            const r = await send(who.p, key, bodyOf.get(key) as string);
            note(`replay:${r.status}`);
          } else if (op === "delete") {
            const key = pick(who.keys);
            const id = key && idOf.get(key);
            if (!id) return;
            const r = await h
              .http()
              .delete(`/api/v1/answers/${id}`)
              .set("Authorization", who.p.auth);
            note(`delete:${r.status}`);
          } else if (op === "remove") {
            const key = pick(who.keys);
            const id = key && idOf.get(key);
            if (!id) return;
            const itemKey = {
              targetType: "ANSWER" as const,
              targetId: id,
              queue: "REPORTED" as const,
            };
            const item =
              (await h.prisma.moderationItem.findFirst({ where: itemKey })) ??
              (await h.prisma.moderationItem
                .create({
                  data: {
                    ...itemKey,
                    reasons: ["THREAT_OR_VIOLENCE"],
                    reportCount: 1,
                  },
                })
                .catch(() =>
                  h.prisma.moderationItem.findFirstOrThrow({ where: itemKey }),
                ));
            const r = await h
              .http()
              .post(`/api/v1/admin/moderation/items/${item.id}/action`)
              .set("Authorization", mod.auth)
              .send({ action: "REMOVE", reason: "Checked by the team." });
            note(`remove:${r.status}`);
          } else {
            // beside running requests the clock moves at most 10 minutes (a request never lives 30); bigger jumps run between batches
            const jump = Math.floor(Math.random() * 10) * MIN;
            note("sweep");
            await sweeper.sweep(new Date(Date.now() + jump));
          }
        }),
      );
      if (Math.random() < 0.2) {
        note("bigsweep");
        await sweeper.sweep(
          new Date(Date.now() + (31 + Math.floor(Math.random() * 60)) * MIN),
        );
      }
    }
    // Everything still unfinished is long dead; two final passes at the end of the clock.
    const end = new Date(Date.now() + 120 * MIN);
    await sweeper.sweep(end);
    await sweeper.sweep(end);
    console.log("chaos operations", JSON.stringify(counts));

    let mismatches = 0;
    let doubleReversals = 0;
    let postsWithoutCharge = 0;
    for (const { p, free } of people) {
      const charges = await h.prisma.charge.findMany({
        where: { userId: p.id },
      });
      const committed = charges.filter((c) => c.status === "COMMITTED");
      const spent = committed.reduce((n, c) => n + c.costMilli, 0);
      const wallet =
        (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
          ?.balanceMilli ?? 0;
      const ledger = Number(
        (
          await h.prisma.ledgerEntry.aggregate({
            _sum: { deltaMilli: true },
            where: { account: "USER_WALLET", walletUserId: p.id },
          })
        )._sum.deltaMilli ?? 0,
      );
      if (wallet !== START - spent || ledger !== wallet - START) mismatches++;
      const left = (
        await h.prisma.freeAllowance.findUnique({ where: { userId: p.id } })
      )?.freePostsRemaining;
      if (
        left !== undefined &&
        left !== free - committed.filter((c) => c.usedFreePost).length
      )
        mismatches++;
      for (const c of charges) {
        const n = await h.prisma.ledgerTransaction.count({
          where: { kind: "REVERSAL", chargeId: c.id },
        });
        if (n > 1 || (c.status === "COMMITTED" && n > 0)) doubleReversals++;
        if (c.status === "REVERSED" && c.costMilli > 0 && n !== 1)
          doubleReversals++;
      }
      const answers = await h.prisma.answer.findMany({
        where: { authorId: p.id },
      });
      for (const a of answers)
        if (!committed.some((c) => c.refId === a.id)) postsWithoutCharge++;
      // no committed unlinked charge is left
      if (committed.some((c) => c.refId === null)) mismatches++;
    }
    // a record never holds the text of a deleted or removed post
    const gone = await h.prisma.answer.findMany({
      where: {
        authorId: { in: people.map((x) => x.p.id) },
        status: { in: ["REMOVED", "DELETED_BY_AUTHOR"] },
      },
      select: { body: true },
    });
    for (const g of gone) {
      const n = await h.prisma.$queryRaw<{ c: bigint }[]>`
        SELECT count(*)::bigint AS c FROM "IdempotencyRecord" WHERE "responseBody"::text LIKE ${"%" + g.body + "%"}`;
      if (Number(n[0].c) > 0) mismatches++;
    }
    expect({ mismatches, doubleReversals, postsWithoutCharge }).toEqual({
      mismatches: 0,
      doubleReversals: 0,
      postsWithoutCharge: 0,
    });
    expect(counts["send:201"]).toBeGreaterThan(100);
    expect(counts["send:404"] ?? 0).toBe(0);
  }, 600_000);
});
