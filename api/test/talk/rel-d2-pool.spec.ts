import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/**
 * V-REL-D2-FIX2 (M4): a paid edit holds ONE connection (the post lock and the charge share the edit's transaction). With a small
 * pool, many edits of different posts at once all answer 200 (or a clean 402 when the wallet is short): no 500, no 503.
 * The check's two runs: pool 4 with 8 edits, pool 3 with 10 edits.
 */
describe("M4: paid edits on a small database pool", () => {
  const saved = process.env.DATABASE_POOL_MAX;
  afterAll(() => {
    if (saved === undefined) delete process.env.DATABASE_POOL_MAX;
    else process.env.DATABASE_POOL_MAX = saved;
  });

  async function run(pool: number, edits: number) {
    process.env.DATABASE_POOL_MAX = String(pool);
    const h: Harness = await startHarness();
    let qid: string | undefined;
    try {
      qid = (await makeQuestion(h)).id;
      const people: Person[] = [];
      const posts: string[] = [];
      for (let i = 0; i < edits; i++) {
        // the last one has too little in the wallet: a clean 402, nothing else
        const poor = i === edits - 1;
        const p = await makePerson(h, { freePosts: 0 });
        const amount = poor ? 0 : 900_000;
        await h.prisma.wallet.upsert({
          where: { userId: p.id },
          create: { userId: p.id, balanceMilli: amount },
          update: { balanceMilli: amount },
        });
        if (amount)
          await h.prisma.ledgerTransaction.create({
            data: {
              kind: "ADJUSTMENT",
              idempotencyKey: `pool:${randomUUID()}`,
              reason: "test",
              entries: {
                create: [
                  {
                    account: "USER_WALLET",
                    walletUserId: p.id,
                    deltaMilli: amount,
                    balanceAfterMilli: amount,
                  },
                  { account: "ADJUSTMENT", deltaMilli: -amount },
                ],
              },
            },
          });
        const a = await h.prisma.answer.create({
          data: {
            questionId: qid,
            authorId: p.id,
            kind: "TEXT",
            body: "a",
            paidChars: 1,
          },
        });
        people.push(p);
        posts.push(a.id);
      }
      const t0 = Date.now();
      const res = await Promise.all(
        posts.map((id, i) =>
          h
            .http()
            .patch(`/api/v1/answers/${id}`)
            .set("Authorization", people[i].auth)
            .send({ body: "b".repeat(400) })
            .then((r) => r.status),
        ),
      );
      const took = Date.now() - t0;
      expect(took).toBeLessThan(30_000);
      expect(res.filter((s) => s >= 500)).toEqual([]);
      for (const s of res.slice(0, -1)) expect(s).toBe(200);
      expect(res[res.length - 1]).toBe(402);
      // the money agrees
      const bad = await h.prisma.$queryRaw<{ id: string }[]>`
        SELECT "txnId" AS id FROM "LedgerEntry" GROUP BY "txnId" HAVING sum("deltaMilli") <> 0`;
      expect(bad).toEqual([]);
      const wallets = await h.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT w."userId" AS id FROM "Wallet" w WHERE w."userId" = ANY($1::text[])
         AND w."balanceMilli" <> COALESCE((SELECT sum(e."deltaMilli") FROM "LedgerEntry" e WHERE e."walletUserId" = w."userId"), 0)`,
        people.map((p) => p.id),
      );
      expect(wallets).toEqual([]);
      const charges = await h.prisma.charge.count({
        where: { userId: { in: people.map((p) => p.id) }, action: "EDIT_TEXT" },
      });
      expect(charges).toBe(edits - 1);
    } finally {
      // leave no readable post behind: other suites page /feed/trending and /feed/new
      if (qid) {
        await h.prisma.question.update({
          where: { id: qid },
          data: { status: "DRAFT" },
        });
      }
      await h.close();
    }
  }

  it("pool 4, 8 edits of 8 different posts at once", () => run(4, 8), 60_000);
  it("pool 3, 10 edits at once", () => run(3, 10), 60_000);
});
