/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from "node:crypto";
import { bootAdmin, type Admin } from "./helpers";
import { UNITS_PORT, type UnitsPortFull } from "../../src/units/units.port";
import { UnitsConfig } from "../../src/units/units.config";
import { PaymentsService } from "../../src/units/units.payments";
import { ReconcileService } from "../../src/units/units.reconcile";
import { computeQuote, type ChargeRates } from "../../src/units/units.charges";
import { PLAN_DEFAULTS, TIER_DEFAULTS } from "../../src/units/units.defaults";

const R: ChargeRates = {
  vatRateBps: 750,
  feeRateBps: 140,
  feeFlatKobo: 0,
  feeCapKobo: 200000,
};

/** The packs and plans are tables the config writes into: put them back to the PRICING.md figures between specs. */
async function resetPrices(a: Admin): Promise<void> {
  for (const t of TIER_DEFAULTS)
    await a.prisma.unitTier.update({
      where: { slug: t.slug },
      data: {
        name: t.name,
        priceKobo: t.priceKobo,
        unitsMilli: t.unitsMilli,
        bonusMilli: t.bonusMilli,
        sortOrder: t.sortOrder,
        active: true,
      },
    });
  await a.prisma.subscriptionPlan.deleteMany({
    where: { slug: { notIn: PLAN_DEFAULTS.map((p) => p.slug) } },
  });
  for (const p of PLAN_DEFAULTS)
    await a.prisma.subscriptionPlan.update({
      where: { slug: p.slug },
      data: {
        name: p.name,
        priceKobo: p.priceKobo,
        months: p.months,
        monthlyMilli: p.monthlyMilli,
        sortOrder: p.sortOrder,
        active: true,
      },
    });
}

/** V-ADMIN-MONEY: the overview, the payments list, the wallet answer and the subscriptions list. Flutterwave is the stand-in. */
describe("admin money screens (V-ADMIN-MONEY)", () => {
  let a: Admin;
  let n = 0;
  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("admin", ["ADMIN"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("editor", ["EDITOR"]);
    await a.person("ads", ["AD_MANAGER"]);
    await a.person("plain");
  });
  afterAll(async () => {
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Subscription","SubscriptionCredit","Payment","LedgerTransaction","Wallet","ConfigEntry","ConfigChange" CASCADE`,
    );
    await resetPrices(a);
    await a.close();
  });
  beforeEach(async () => {
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Subscription","SubscriptionCredit","Payment","LedgerTransaction","Wallet","Notification","ConfigEntry","ConfigChange","AuditLog" CASCADE`,
    );
    await a.h.app.get(UnitsConfig).seedDefaults();
    await resetPrices(a);
    a.h.app.get(PaymentsService).resetLimits();
    a.flw.reset();
  });

  const who = () => a.person(`ms${++n}`);
  type P = Awaited<ReturnType<typeof who>>;
  const bearer = (p: P) => ({ Authorization: `Bearer ${p.token}` });
  const get = (path: string, as = "admin") =>
    a.h.http().get(`/api/v1${path}`).set(a.auth(as));
  const start = (p: P, body: object) =>
    a.h
      .http()
      .post("/api/v1/payments")
      .set(bearer(p))
      .set("Idempotency-Key", randomUUID())
      .send(body);
  const verify = (p: P, id: string) =>
    a.h
      .http()
      .post(`/api/v1/payments/${id}/verify`)
      .set(bearer(p))
      .set("Idempotency-Key", randomUUID())
      .send({});
  const tier = (slug: string) =>
    a.prisma.unitTier.findUniqueOrThrow({ where: { slug } });
  const plan = (slug: string) =>
    a.prisma.subscriptionPlan.findUniqueOrThrow({ where: { slug } });

  it("every new route: anonymous 401; member, moderator, editor and ad manager 403; admin 200", async () => {
    const routes = [
      "/admin/money/overview",
      "/admin/subscriptions",
      "/admin/payments?kind=UNITS",
    ];
    for (const r of routes) {
      await a.h.http().get(`/api/v1${r}`).expect(401);
      for (const who of ["plain", "mod", "editor", "ads"])
        await get(r, who).expect(403);
      await get(r, "admin").expect(200);
    }
    await get("/admin/payments?kind=NOPE").expect(422);
    await get("/admin/subscriptions?status=NOPE").expect(422);
  });

  it("the overview matches the payment rows and the ledger after a mixed set: paid, over, short, failed, pending, a plan and an old row", async () => {
    const A = await who(); // Entry pack, exact
    const B = await who(); // Standard pack, paid N100 too much
    const C = await who(); // Starter pack, short: the price only
    const D = await who(); // a pack the provider says failed
    const E = await who(); // CONNECT plan, exact
    const F = await who(); // started and left
    const G = await who(); // an old row with no total (made before the customer paid charges)

    const rA = await start(A, {
      kind: "UNITS",
      tierId: (await tier("entry")).id,
    }).expect(201);
    a.flw.pay(rA.body.txRef, rA.body.totalKobo / 100);
    await verify(A, rA.body.paymentId).expect(200);

    const qB = computeQuote(73200, R);
    const rB = await start(B, {
      kind: "UNITS",
      tierId: (await tier("standard")).id,
    }).expect(201);
    expect(rB.body.totalKobo).toBe(qB.totalKobo);
    a.flw.pay(rB.body.txRef, (qB.totalKobo + 10000) / 100);
    await verify(B, rB.body.paymentId).expect(200);

    const rC = await start(C, {
      kind: "UNITS",
      tierId: (await tier("starter")).id,
    }).expect(201);
    a.flw.pay(rC.body.txRef, 366); // the price only
    expect((await verify(C, rC.body.paymentId)).status).toBe(422);

    const rD = await start(D, {
      kind: "UNITS",
      tierId: (await tier("plus")).id,
    }).expect(201);
    a.flw.record(rD.body.txRef, "flw-verify-failed.json");
    await verify(D, rD.body.paymentId);

    const rE = await start(E, {
      kind: "SUBSCRIPTION",
      planId: (await plan("connect")).id,
    }).expect(201);
    a.flw.pay(rE.body.txRef, rE.body.totalKobo / 100);
    await verify(E, rE.body.paymentId).expect(200);

    await start(F, { kind: "UNITS", tierId: (await tier("entry")).id }).expect(
      201,
    );

    const old = await a.prisma.payment.create({
      data: {
        userId: G.id,
        kind: "UNITS",
        amountKobo: 69000,
        unitsMilli: 55000,
        bonusMilli: 5000,
        txRef: "VU-261105-00001",
        idempotencyKey: "old-1",
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    a.flw.pay(old.txRef, 690);
    await a.h
      .http()
      .post(`/api/v1/admin/payments/${old.id}/reverify`)
      .set(a.auth("admin"))
      .set("Idempotency-Key", randomUUID())
      .expect(200);

    // spends, a reversal and two adjustments on A's wallet
    const port = a.h.app.get<UnitsPortFull>(UNITS_PORT);
    await port.charge(A.id, "TEXT_FIX", "fix-1");
    const second = await port.charge(A.id, "TEXT_FIX", "fix-2");
    await port.reverse(second.chargeId);
    for (const [delta, key] of [
      [2000, "adj-up"],
      [-1000, "adj-down"],
    ] as const)
      await a.h
        .http()
        .post(`/api/v1/admin/wallets/${A.id}/adjust`)
        .set(a.auth("admin"))
        .set("Idempotency-Key", key)
        .send({ deltaMilli: delta, reason: "check" })
        .expect(201);

    const o = (await get("/admin/money/overview").expect(200)).body;
    const w = o.windows;
    expect(Object.keys(w)).toEqual(["today", "last7", "last30"]);
    // the three windows hold the same rows here (everything happened just now)
    expect(w.last7.received).toEqual(w.today.received);
    expect(w.last30.received).toEqual(w.today.received);

    // paid money: packs A, B and the old row; the plan E
    const packs = w.today.received.packs;
    const subs = w.today.received.subscriptions;
    const qA = computeQuote(18300, R);
    const qE = computeQuote(299900, R);
    expect(packs).toEqual({
      count: 3,
      priceKobo: 18300 + 73200 + 69000,
      vatKobo: qA.vatKobo + qB.vatKobo,
      chargeKobo: qA.chargeKobo + qB.chargeKobo,
      totalKobo: qA.totalKobo + qB.totalKobo + 69000,
    });
    expect(subs).toEqual({
      count: 1,
      priceKobo: 299900,
      vatKobo: qE.vatKobo,
      chargeKobo: qE.chargeKobo,
      totalKobo: qE.totalKobo,
    });
    const tot = w.today.received.total;
    expect(tot.priceKobo).toBe(packs.priceKobo + subs.priceKobo);
    // price + VAT + charge is the total, for every group (VAT and charge stay apart from WAWU's price)
    for (const s of [packs, subs, tot])
      expect(s.priceKobo + s.vatKobo + s.chargeKobo).toBe(s.totalKobo);

    // the same figures, summed straight from the payment rows
    const rows = await a.prisma.payment.findMany({
      where: { status: "SUCCEEDED" },
    });
    expect(rows).toHaveLength(4);
    expect(rows.reduce((s, r) => s + r.amountKobo, 0)).toBe(tot.priceKobo);
    expect(rows.reduce((s, r) => s + (r.vatKobo ?? 0), 0)).toBe(tot.vatKobo);
    expect(rows.reduce((s, r) => s + (r.chargeKobo ?? 0), 0)).toBe(
      tot.chargeKobo,
    );
    expect(rows.reduce((s, r) => s + (r.totalKobo ?? r.amountKobo), 0)).toBe(
      tot.totalKobo,
    );
    expect(w.today.overpaidKobo).toBe(10000);
    expect(rows.reduce((s, r) => s + (r.overpaidKobo ?? 0), 0)).toBe(
      w.today.overpaidKobo,
    );

    // counts: the underpaid and the provider-failed payments are not paid; F waits
    const by = async (status: string) =>
      a.prisma.payment.count({ where: { status: status as never } });
    expect(w.today.payments).toEqual({
      paid: 4,
      failed: await by("FAILED"),
      pending: (await by("INITIATED")) + (await by("PENDING")),
      expired: await by("EXPIRED"),
      refunded: await by("REFUNDED"),
    });
    expect(w.today.payments.failed + w.today.payments.pending).toBe(3); // C, D, F
    expect(w.today.payments.failed).toBeGreaterThanOrEqual(1); // D
    // the short payment credited nothing
    expect(
      (await a.prisma.wallet.findUnique({ where: { userId: C.id } }))
        ?.balanceMilli ?? 0,
    ).toBe(0);
    expect(w.today.newPayers).toBe(4); // A, B, E, G

    // tokens: the ledger says the same as the payments
    const t = w.today.tokens;
    expect(t.soldMilli).toBe(183000 + 732000 + 55000);
    expect(t.fromPlansMilli).toBe(500000);
    expect(t.spentMilli).toBe(10000);
    expect(t.reversedMilli).toBe(5000);
    expect(t.netSpentMilli).toBe(5000);
    expect(t.adjustedInMilli).toBe(2000);
    expect(t.adjustedOutMilli).toBe(1000);
    expect(t.otherMilli).toBe(0);
    expect(t.walletChangeMilli).toBe(
      t.soldMilli + t.fromPlansMilli + 2000 - 1000 - t.netSpentMilli,
    );
    const ledgerSum = Number(
      (
        await a.prisma.ledgerEntry.aggregate({
          where: { account: "USER_WALLET" },
          _sum: { deltaMilli: true },
        })
      )._sum.deltaMilli,
    );
    expect(t.walletChangeMilli).toBe(ledgerSum);
    // credited by the payments table equals sold plus plans
    const credited = rows
      .filter((r) => r.kind === "UNITS")
      .reduce((s, r) => s + (r.unitsMilli ?? 0), 0);
    expect(credited).toBe(t.soldMilli);
    const held = Number(
      (await a.prisma.wallet.aggregate({ _sum: { balanceMilli: true } }))._sum
        .balanceMilli,
    );
    expect(o.tokensHeldMilli).toBe(held);
    expect(held).toBe(ledgerSum);
  });

  it("windows are Lagos days: a payment confirmed 3 days ago is in 7 and 30 but not today; 20 days ago only in 30; 40 days ago in none", async () => {
    const u = await who();
    const mk = (daysAgo: number, k: string) =>
      a.prisma.payment.create({
        data: {
          userId: u.id,
          kind: "UNITS",
          status: "SUCCEEDED",
          amountKobo: 10000,
          vatKobo: 750,
          chargeKobo: 150,
          totalKobo: 10900,
          unitsMilli: 100000,
          txRef: `voices-win-${k}`,
          idempotencyKey: `win-${k}`,
          expiresAt: new Date(Date.now() + 86400_000),
          createdAt: new Date(Date.now() - (daysAgo * 86400_000 + 3600_000)),
          verifiedAt: new Date(Date.now() - daysAgo * 86400_000 - 1800_000),
        },
      });
    await mk(3, "a");
    await mk(20, "b");
    await mk(40, "c");
    const w = (await get("/admin/money/overview").expect(200)).body.windows;
    expect(w.today.received.total.count).toBe(0);
    expect(w.last7.received.total).toEqual({
      count: 1,
      priceKobo: 10000,
      vatKobo: 750,
      chargeKobo: 150,
      totalKobo: 10900,
    });
    expect(w.last30.received.total.count).toBe(2);
    expect(w.last30.received.total.totalKobo).toBe(21800);
    // the same person's first payment ever was 40 days ago: not a new payer in any window
    expect(w.last30.newPayers).toBe(0);
    expect(w.last7.fromDay < w.today.fromDay).toBe(true);
    expect(w.last30.fromDay < w.last7.fromDay).toBe(true);
  });

  it("the payments list: filter by kind and status, cursor pages, each row with the person and its own price, VAT, charge and total", async () => {
    const people = [await who(), await who(), await who()];
    const rs = [];
    for (const [i, p] of people.entries()) {
      const r =
        i === 2
          ? await start(p, {
              kind: "SUBSCRIPTION",
              planId: (await plan("plus")).id,
            }).expect(201)
          : await start(p, {
              kind: "UNITS",
              tierId: (await tier("entry")).id,
            }).expect(201);
      rs.push(r.body);
    }
    a.flw.pay(rs[0].txRef, rs[0].totalKobo / 100);
    await verify(people[0], rs[0].paymentId).expect(200);

    const all = (await get("/admin/payments?limit=2").expect(200)).body;
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).toBeTruthy();
    const next = (
      await get(`/admin/payments?limit=2&cursor=${all.nextCursor}`).expect(200)
    ).body;
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    const seen = [...all.items, ...next.items].map((i: any) => i.id);
    expect(new Set(seen).size).toBe(3);

    const subs = (await get("/admin/payments?kind=SUBSCRIPTION").expect(200))
      .body.items;
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      kind: "SUBSCRIPTION",
      amountKobo: 539900,
      status: "INITIATED",
      user: { id: people[2].id, handle: people[2].handle },
    });
    const q = computeQuote(539900, R);
    expect([subs[0].vatKobo, subs[0].chargeKobo, subs[0].totalKobo]).toEqual([
      q.vatKobo,
      q.chargeKobo,
      q.totalKobo,
    ]);
    const paid = (
      await get("/admin/payments?status=SUCCEEDED&kind=UNITS").expect(200)
    ).body.items;
    expect(paid.map((i: any) => i.id)).toEqual([rs[0].paymentId]);
    expect(paid[0].txRef).toBe(rs[0].txRef);
    expect(
      (
        await get("/admin/payments?status=SUCCEEDED&kind=SUBSCRIPTION").expect(
          200,
        )
      ).body.items,
    ).toEqual([]);
  });

  it("an adjust answer carries the audit id and the ledger transaction id, and a replay returns the same ones", async () => {
    const u = await who();
    const send = (body: object, key: string, as = "admin") =>
      a.h
        .http()
        .post(`/api/v1/admin/wallets/${u.id}/adjust`)
        .set(a.auth(as))
        .set("Idempotency-Key", key)
        .send(body);
    const r1 = await send(
      { deltaMilli: 5000, reason: "Goodwill" },
      "aud-1",
    ).expect(201);
    const adj = r1.body.adjustment;
    expect(adj).toMatchObject({ deltaMilli: 5000, balanceMilli: 5000 });
    const audit = await a.prisma.auditLog.findUniqueOrThrow({
      where: { id: adj.auditId },
    });
    expect(audit).toMatchObject({
      action: "wallet.adjust",
      targetId: u.id,
      reason: "Goodwill",
    });
    expect((audit.after as any).txnId).toBe(adj.txnId);
    const txn = await a.prisma.ledgerTransaction.findUniqueOrThrow({
      where: { id: adj.txnId },
    });
    expect(txn.kind).toBe("ADJUSTMENT");
    const again = await send(
      { deltaMilli: 5000, reason: "Goodwill" },
      "aud-1",
    ).expect(201);
    expect(again.body.adjustment).toEqual(adj);
    // wallet payments carry the person and amounts too
    const w = (await get(`/admin/wallets/${u.id}`).expect(200)).body;
    expect(w.adjustment).toBeUndefined();
    expect(w.balanceMilli).toBe(5000);
  });

  it("an adjustment that would take the balance below zero is refused and changes nothing; a moderator cannot try", async () => {
    const u = await who();
    const send = (delta: number, key: string, as = "admin") =>
      a.h
        .http()
        .post(`/api/v1/admin/wallets/${u.id}/adjust`)
        .set(a.auth(as))
        .set("Idempotency-Key", key)
        .send({ deltaMilli: delta, reason: "x" });
    await send(1000, "z-up").expect(201);
    const bad = await send(-1001, "z-down").expect(422);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    await send(-1, "z-mod", "mod").expect(403);
    const bal = (
      await a.prisma.wallet.findUniqueOrThrow({ where: { userId: u.id } })
    ).balanceMilli;
    expect(bal).toBe(1000);
    expect(
      await a.prisma.auditLog.count({
        where: { action: "wallet.adjust", targetId: u.id },
      }),
    ).toBe(1);
  });

  it("round 1 item 5: the wallet answer carries the person's status, and an adjust on a suspended person is still allowed", async () => {
    const u = await who();
    expect((await get(`/admin/wallets/${u.id}`).expect(200)).body.status).toBe(
      "ACTIVE",
    );
    for (const status of ["SUSPENDED", "BANNED", "DELETION_PENDING"] as const) {
      await a.prisma.user.update({ where: { id: u.id }, data: { status } });
      expect(
        (await get(`/admin/wallets/${u.id}`).expect(200)).body.status,
      ).toBe(status);
    }
    const r = await a.h
      .http()
      .post(`/api/v1/admin/wallets/${u.id}/adjust`)
      .set(a.auth("admin"))
      .set("Idempotency-Key", "status-1")
      .send({ deltaMilli: 1000, reason: "Goodwill" })
      .expect(201);
    expect(r.body.status).toBe("DELETION_PENDING");
  });

  it("the subscriptions list: current and ended plans with the next credit day; filter by status", async () => {
    const p1 = await who();
    const p2 = await who();
    const r1 = await start(p1, {
      kind: "SUBSCRIPTION",
      planId: (await plan("connect")).id,
    }).expect(201);
    a.flw.pay(r1.body.txRef, r1.body.totalKobo / 100);
    await verify(p1, r1.body.paymentId).expect(200);
    const r2 = await start(p2, {
      kind: "SUBSCRIPTION",
      planId: (await plan("plus")).id,
    }).expect(201);
    a.flw.pay(r2.body.txRef, r2.body.totalKobo / 100);
    await verify(p2, r2.body.paymentId).expect(200);
    await a.prisma.subscription.updateMany({
      where: { userId: p2.id },
      data: { status: "ENDED", creditedMonths: 6 },
    });
    const all = (await get("/admin/subscriptions").expect(200)).body;
    expect(all.items).toHaveLength(2);
    expect(all.counts).toEqual({ ACTIVE: 1, ENDED: 1 });
    const live = all.items.find((i: any) => i.user.id === p1.id);
    expect(live).toMatchObject({
      plan: { slug: "connect", name: "VOICES CONNECT" },
      status: "ACTIVE",
      months: 3,
      creditedMonths: 1,
      monthlyMilli: 500000,
      priceKobo: 299900,
      paymentId: r1.body.paymentId,
      user: { handle: p1.handle },
    });
    expect(live.nextCreditDay > live.startDay).toBe(true);
    expect(live.endDay > live.nextCreditDay).toBe(true);
    const ended = all.items.find((i: any) => i.user.id === p2.id);
    expect(ended.nextCreditDay).toBeNull();
    const only = (await get("/admin/subscriptions?status=ENDED").expect(200))
      .body;
    expect(only.items.map((i: any) => i.user.id)).toEqual([p2.id]);
    expect(only.counts).toEqual({ ACTIVE: 1, ENDED: 1 });
    // reading changes nothing
    expect(await a.prisma.subscription.count()).toBe(2);
    void ReconcileService;
  });
});
