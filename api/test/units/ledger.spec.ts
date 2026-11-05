import { HttpException } from "@nestjs/common";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { UnitsConfig } from "../../src/units/units.config";
import { UNITS_PORT, type UnitsPortFull } from "../../src/units/units.port";
import { boot, resetDb, type Harness } from "./helpers";

describe("units ledger (UNITS_PORT) against real Postgres", () => {
  let h: Harness;
  let prisma: PrismaService;
  let port: UnitsPortFull;
  let n = 0;

  beforeAll(async () => {
    h = await boot();
    prisma = h.app.get(PrismaService);
    port = h.app.get<UnitsPortFull>(UNITS_PORT);
  });
  afterAll(async () => h.close());
  beforeEach(async () => {
    await resetDb(prisma);
    await h.app.get(UnitsConfig).seedDefaults();
  });

  async function mkUser(status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
    n++;
    return prisma.user.create({
      data: {
        wawuId: `w${n}`,
        handle: `person${n}`,
        referralCode: `REF${n}`,
        status,
      },
    });
  }
  const code = async (
    p: Promise<unknown>,
  ): Promise<{ status: number; code: string }> => {
    try {
      await p;
    } catch (e) {
      const he = e as HttpException;
      return {
        status: he.getStatus(),
        code: (he.getResponse() as { code: string }).code,
      };
    }
    throw new Error("expected an error");
  };
  const credit = (
    adminId: string,
    userId: string,
    milli: number,
    key: string,
  ) => port.adjustBalance(adminId, userId, milli, "test", key);
  const balance = async (id: string) =>
    (await prisma.wallet.findUnique({ where: { userId: id } }))?.balanceMilli ??
    0;
  /** The ledger's own sum for the wallet, read from the database. */
  const ledgerSum = async (id: string) => {
    const r = await prisma.$queryRaw<
      { s: bigint | null }[]
    >`SELECT SUM("deltaMilli") AS s FROM "LedgerEntry" WHERE "walletUserId" = ${id} AND account = 'USER_WALLET'`;
    return Number(r[0].s ?? 0);
  };
  const allZero = async () => {
    const r = await prisma.$queryRaw<
      { s: bigint | null }[]
    >`SELECT COALESCE(SUM("deltaMilli"),0) AS s FROM "LedgerEntry"`;
    return Number(r[0].s);
  };
  const useUpFreePosts = async (id: string) => {
    await prisma.$executeRaw`INSERT INTO "Wallet" ("userId","balanceMilli","updatedAt") VALUES (${id},0,now()) ON CONFLICT DO NOTHING`;
    await prisma.$executeRaw`INSERT INTO "FreeAllowance" ("userId","freePostsRemaining","freePostsUsed","updatedAt") VALUES (${id},0,10,now()) ON CONFLICT ("userId") DO UPDATE SET "freePostsRemaining" = 0, "freePostsUsed" = 10`;
  };

  it("gives 10 free posts, then refuses with FREE_POSTS_EXHAUSTED and the cost details, and leaves no trace", async () => {
    const u = await mkUser();
    for (let i = 0; i < 10; i++) {
      const r = await port.charge(
        u.id,
        i % 2 ? "POST_VOICE" : "POST_TEXT",
        `k${i}`,
      );
      expect(r).toMatchObject({ costMilli: 0, usedFreePost: true });
    }
    const a = await prisma.freeAllowance.findUniqueOrThrow({
      where: { userId: u.id },
    });
    expect(a).toMatchObject({ freePostsRemaining: 0, freePostsUsed: 10 });
    const err = await code(port.charge(u.id, "POST_TEXT", "k10"));
    expect(err).toEqual({ status: 402, code: "FREE_POSTS_EXHAUSTED" });
    try {
      await port.charge(u.id, "POST_TEXT", "k10");
    } catch (e) {
      expect((e as HttpException).getResponse()).toMatchObject({
        details: { costMilli: 500, balanceMilli: 0, minPackKobo: 13800 },
      });
    }
    expect(await prisma.charge.count({ where: { userId: u.id } })).toBe(10);
    expect(await prisma.ledgerTransaction.count()).toBe(0);
  });

  it("charges the config cost after the free posts and the balance equals the ledger sum", async () => {
    const u = await mkUser();
    await useUpFreePosts(u.id);
    await credit("admin", u.id, 2500, "c1");
    const t = await port.charge(u.id, "POST_TEXT", "t1");
    const v = await port.charge(u.id, "POST_VOICE", "v1");
    expect(t.costMilli).toBe(500);
    expect(v.costMilli).toBe(1000);
    expect(await balance(u.id)).toBe(1000);
    expect(await ledgerSum(u.id)).toBe(1000);
    expect(await allZero()).toBe(0);
    const e = await prisma.ledgerEntry.findMany({
      where: { walletUserId: u.id },
      orderBy: { createdAt: "asc" },
    });
    expect(e.map((x) => x.balanceAfterMilli)).toEqual([2500, 2000, 1000]);
  });

  it("same key twice: one charge, one debit, same result", async () => {
    const u = await mkUser();
    await useUpFreePosts(u.id);
    await credit("admin", u.id, 5000, "c1");
    const a = await port.charge(u.id, "POST_TEXT", "same");
    const b = await port.charge(u.id, "POST_TEXT", "same");
    expect(b).toEqual(a);
    expect(await balance(u.id)).toBe(4500);
    expect(await prisma.charge.count({ where: { userId: u.id } })).toBe(1);
    expect(await code(port.charge(u.id, "POST_VOICE", "same"))).toEqual({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(await balance(u.id)).toBe(4500);
  });

  it("10 parallel requests with one key charge once", async () => {
    const u = await mkUser();
    await useUpFreePosts(u.id);
    await credit("admin", u.id, 5000, "c1");
    const rs = await Promise.all(
      Array.from({ length: 10 }, () =>
        port.charge(u.id, "POST_VOICE", "one-key"),
      ),
    );
    expect(new Set(rs.map((r) => r.chargeId)).size).toBe(1);
    expect(await balance(u.id)).toBe(4000);
    expect(await prisma.charge.count({ where: { userId: u.id } })).toBe(1);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: "SPEND_POST" } }),
    ).toBe(1);
  });

  it("parallel requests with different keys at the last unit: exactly one wins, balance never negative", async () => {
    const u = await mkUser();
    await useUpFreePosts(u.id);
    await credit("admin", u.id, 1000, "c1"); // exactly one voice post
    const rs = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        port.charge(u.id, "POST_VOICE", `race-${i}`),
      ),
    );
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = rs.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(failed).toHaveLength(7);
    for (const f of failed)
      expect((f.reason as HttpException).getStatus()).toBe(402);
    expect(await balance(u.id)).toBe(0);
    expect(await ledgerSum(u.id)).toBe(0);
    expect(await prisma.charge.count({ where: { userId: u.id } })).toBe(1);
  });

  it("parallel free posts at the last free one: one is free, the others cost or fail", async () => {
    const u = await mkUser();
    await prisma.$executeRaw`INSERT INTO "Wallet" ("userId","balanceMilli","updatedAt") VALUES (${u.id},0,now())`;
    await prisma.$executeRaw`INSERT INTO "FreeAllowance" ("userId","freePostsRemaining","freePostsUsed","updatedAt") VALUES (${u.id},1,9,now())`;
    const rs = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        port.charge(u.id, "POST_TEXT", `fp-${i}`),
      ),
    );
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await prisma.freeAllowance.findUniqueOrThrow({
          where: { userId: u.id },
        })
      ).freePostsRemaining,
    ).toBe(0);
  });

  it("reactions: 20 free a day then 0.1 unit; votes: 3 free then 0.2 unit; counters read from the database", async () => {
    const u = await mkUser();
    await credit("admin", u.id, 10000, "c1");
    for (let i = 0; i < 20; i++)
      expect((await port.charge(u.id, "REACTION", `r${i}`)).usedFreeDaily).toBe(
        true,
      );
    expect(await balance(u.id)).toBe(10000);
    const r21 = await port.charge(u.id, "REACTION", "r20");
    expect(r21).toMatchObject({ costMilli: 100, usedFreeDaily: false });
    for (let i = 0; i < 3; i++) await port.charge(u.id, "VOTE", `v${i}`);
    expect((await port.charge(u.id, "VOTE", "v3")).costMilli).toBe(200);
    expect(await balance(u.id)).toBe(10000 - 100 - 200);
    const rows = await prisma.usageCounter.findMany({
      where: { userId: u.id },
    });
    expect(Object.fromEntries(rows.map((r) => [r.action, r.used]))).toEqual({
      REACTION: 21,
      VOTE: 4,
    });
    expect(await port.freeLeft(u.id, "REACTION")).toEqual({
      freeLeft: 0,
      balanceMilli: 9700,
    });
    expect(await port.freeLeft(u.id, "POST_TEXT")).toMatchObject({
      freeLeft: 10,
    });
  });

  it("a reaction with no units after the free 20 is INSUFFICIENT_UNITS and does not use up the counter", async () => {
    const u = await mkUser();
    for (let i = 0; i < 20; i++) await port.charge(u.id, "REACTION", `r${i}`);
    expect(await code(port.charge(u.id, "REACTION", "x"))).toEqual({
      status: 402,
      code: "INSUFFICIENT_UNITS",
    });
    expect(
      (await prisma.usageCounter.findFirstOrThrow({ where: { userId: u.id } }))
        .used,
    ).toBe(20);
  });

  it("reverse restores units, a free post and a daily free use, once; a reversed key is not reusable", async () => {
    const u = await mkUser();
    await credit("admin", u.id, 3000, "c1");
    await port.charge(u.id, "POST_TEXT", "free1"); // free post
    expect(
      (
        await prisma.freeAllowance.findUniqueOrThrow({
          where: { userId: u.id },
        })
      ).freePostsRemaining,
    ).toBe(9);
    expect(await port.reverseByKey(u.id, "free1")).toEqual({ reversed: true });
    expect(
      (
        await prisma.freeAllowance.findUniqueOrThrow({
          where: { userId: u.id },
        })
      ).freePostsRemaining,
    ).toBe(10);
    await useUpFreePosts(u.id);
    await port.charge(u.id, "POST_VOICE", "paid1");
    expect(await balance(u.id)).toBe(2000);
    await Promise.all([
      port.reverseByKey(u.id, "paid1"),
      port.reverseByKey(u.id, "paid1"),
    ]);
    expect(await balance(u.id)).toBe(3000);
    expect(
      await prisma.ledgerTransaction.count({ where: { kind: "REVERSAL" } }),
    ).toBe(1);
    expect(await ledgerSum(u.id)).toBe(3000);
    expect(await code(port.charge(u.id, "POST_VOICE", "paid1"))).toEqual({
      status: 409,
      code: "CONFLICT",
    });
    await port.charge(u.id, "REACTION", "re1");
    await port.reverseByKey(u.id, "re1");
    expect(
      (await prisma.usageCounter.findFirstOrThrow({ where: { userId: u.id } }))
        .used,
    ).toBe(0);
    expect(await allZero()).toBe(0);
  });

  it("reverse(chargeId, reason): one balanced REVERSAL, idempotent by chargeId, parallel calls too, unknown id 404", async () => {
    const u = await mkUser();
    await useUpFreePosts(u.id);
    await credit("admin", u.id, 3000, "c1");
    const c = await port.charge(u.id, "POST_VOICE", "rv1");
    expect(await balance(u.id)).toBe(2000);
    const rs = await Promise.all([
      port.reverse(c.chargeId, "voice processing failed"),
      port.reverse(c.chargeId, "voice processing failed"),
      port.reverse(c.chargeId, "again"),
    ]);
    expect(rs.filter((r) => r.reversed)).toHaveLength(1);
    expect(await port.reverse(c.chargeId, "third time")).toEqual({
      reversed: false,
    });
    expect(await balance(u.id)).toBe(3000);
    const txns = await prisma.ledgerTransaction.findMany({
      where: { kind: "REVERSAL" },
      include: { entries: true },
    });
    expect(txns).toHaveLength(1);
    expect(txns[0].chargeId).toBe(c.chargeId);
    expect(txns[0].reason).toBe("voice processing failed");
    expect(txns[0].entries.reduce((s, e) => s + e.deltaMilli, 0)).toBe(0);
    expect(await ledgerSum(u.id)).toBe(3000);
    expect(
      (await prisma.charge.findUniqueOrThrow({ where: { id: c.chargeId } }))
        .status,
    ).toBe("REVERSED");
    expect(
      (await code(port.reverse("01a1ace1-e564-76ca-be6c-365fc42fe4cf", "x")))
        .status,
    ).toBe(404);
    expect(await allZero()).toBe(0);
  });

  it("costs come from config at once; a bad config value (fraction, negative) fails closed with nothing written", async () => {
    const u = await mkUser();
    await useUpFreePosts(u.id);
    await credit("admin", u.id, 5000, "c1");
    await prisma.configEntry.update({
      where: { key: "cost.text_post_milli" },
      data: { valueJson: 700 },
    });
    expect((await port.charge(u.id, "POST_TEXT", "a")).costMilli).toBe(700);
    for (const bad of [0.5, -5, "500", 3_000_000_000]) {
      await prisma.configEntry.update({
        where: { key: "cost.text_post_milli" },
        data: { valueJson: bad },
      });
      await expect(
        port.charge(u.id, "POST_TEXT", `bad-${String(bad)}`),
      ).rejects.toThrow();
    }
    expect(await balance(u.id)).toBe(4300);
    expect(await prisma.charge.count({ where: { userId: u.id } })).toBe(1);
  });

  it("admin adjust: whole numbers only, at most 1,000 units, never below zero, once per key", async () => {
    const u = await mkUser();
    for (const bad of [
      0.5,
      1.5,
      -0.1,
      0,
      NaN,
      Infinity,
      1_000_001,
      -1_000_001,
    ]) {
      expect(
        (
          await code(
            port.adjustBalance("admin", u.id, bad, "x", `k${String(bad)}`),
          )
        ).status,
      ).toBe(422);
    }
    expect(
      (await code(port.adjustBalance("admin", u.id, -1, "x", "neg"))).status,
    ).toBe(422); // would go below zero
    expect(
      (await code(port.adjustBalance("admin", u.id, 1000, "   ", "noreason")))
        .status,
    ).toBe(422);
    const a = await port.adjustBalance("admin", u.id, 1_000_000, "gift", "ok1");
    const b = await port.adjustBalance("admin", u.id, 1_000_000, "gift", "ok1");
    expect(b.txnId).toBe(a.txnId);
    expect(await balance(u.id)).toBe(1_000_000);
    expect(
      await code(port.adjustBalance("admin", u.id, 5, "gift", "ok1")),
    ).toEqual({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    await port.adjustBalance("admin", u.id, 1_000_000, "gift", "ok2");
    expect(await balance(u.id)).toBe(2_000_000);
  });

  it("a balance can never pass 2,000,000,000 milli", async () => {
    const u = await mkUser();
    await prisma.$executeRaw`INSERT INTO "Wallet" ("userId","balanceMilli","updatedAt") VALUES (${u.id},1999999999,now())`;
    expect(
      (await code(port.adjustBalance("admin", u.id, 2, "x", "k"))).status,
    ).toBe(422);
    expect(await balance(u.id)).toBe(1999999999);
  });

  it("refuses a suspended account and a person with no profile; a missing key", async () => {
    const s = await mkUser("SUSPENDED");
    expect(await code(port.charge(s.id, "POST_TEXT", "k"))).toEqual({
      status: 403,
      code: "ACCOUNT_SUSPENDED",
    });
    expect(await code(port.charge("no-such-user", "POST_TEXT", "k"))).toEqual({
      status: 403,
      code: "FORBIDDEN",
    });
    const u = await mkUser();
    expect((await code(port.charge(u.id, "POST_TEXT", ""))).code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED",
    );
    expect(
      (await code(port.charge(u.id, "NOT_AN_ACTION" as never, "k"))).status,
    ).toBe(422);
    expect(await prisma.charge.count()).toBe(0);
  });

  it("the database refuses what the code must never do: negative balance, unbalanced transaction, editing the ledger", async () => {
    const u = await mkUser();
    await credit("admin", u.id, 1000, "c1");
    await expect(
      prisma.$executeRaw`UPDATE "Wallet" SET "balanceMilli" = -1 WHERE "userId" = ${u.id}`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE "LedgerEntry" SET "deltaMilli" = 5`,
    ).rejects.toThrow();
    await expect(
      prisma.ledgerTransaction.create({
        data: {
          kind: "ADJUSTMENT",
          idempotencyKey: "bad",
          entries: { create: [{ account: "ADJUSTMENT", deltaMilli: 5 }] },
        },
      }),
    ).rejects.toThrow();
  });

  it("freeLeft reads without creating rows", async () => {
    const u = await mkUser();
    expect(await port.freeLeft(u.id, "POST_TEXT")).toEqual({
      freeLeft: 10,
      balanceMilli: 0,
    });
    expect(await prisma.wallet.count()).toBe(0);
  });
});
