/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from "node:crypto";
import { bootAdmin, type Admin } from "./helpers";
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

/** V-ADMIN-MONEY: prices, plans and the VAT and payment charge settings: validated, effective at once, logged, put back. */
describe("admin money config (V-ADMIN-MONEY)", () => {
  let a: Admin;
  let n = 0;
  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("admin", ["ADMIN"]);
    await a.person("admin2", ["ADMIN"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("editor", ["EDITOR"]);
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

  const who = () => a.person(`mc${++n}`);
  type P = Awaited<ReturnType<typeof who>>;
  const bearer = (p: P) => ({ Authorization: `Bearer ${p.token}` });
  const put = (
    key: string,
    value: unknown,
    reason = "Owner asked",
    as = "admin",
  ) =>
    a.h
      .http()
      .put(`/api/v1/admin/config/${key}`)
      .set(a.auth(as))
      .send({ value, reason });
  const rollback = (id: string, reason = "Put back", as = "admin") =>
    a.h
      .http()
      .post(`/api/v1/admin/config/changes/${id}/rollback`)
      .set(a.auth(as))
      .send({ reason });
  const changes = (key: string) =>
    a.h
      .http()
      .get(`/api/v1/admin/config/changes?key=${key}`)
      .set(a.auth("admin"));
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
  const bal = async (id: string) =>
    (await a.prisma.wallet.findUnique({ where: { userId: id } }))
      ?.balanceMilli ?? 0;
  const plansValue = async () =>
    (
      await a.prisma.subscriptionPlan.findMany({
        orderBy: { sortOrder: "asc" },
      })
    ).map((p) => ({
      slug: p.slug,
      name: p.name,
      months: p.months,
      priceKobo: p.priceKobo,
      monthlyMilli: p.monthlyMilli,
      active: p.active,
    }));
  const tiersValue = async () =>
    (await a.prisma.unitTier.findMany({ orderBy: { sortOrder: "asc" } })).map(
      (t) => ({
        slug: t.slug,
        name: t.name,
        priceKobo: t.priceKobo,
        unitsMilli: t.unitsMilli,
        bonusMilli: t.bonusMilli,
      }),
    );

  it("a non-admin, a moderator and an editor cannot change, roll back or read the log of a money setting", async () => {
    for (const who of ["plain", "mod", "editor"]) {
      await put("charges.vat_rate_bps", 500, "x ok", who).expect(403);
      await put("units.plans", await plansValue(), "x ok", who).expect(403);
      await rollback(randomUUID(), "x ok", who).expect(403);
      await a.h.http().get("/api/v1/admin/config").set(a.auth(who)).expect(403);
      await a.h
        .http()
        .get("/api/v1/admin/config/changes")
        .set(a.auth(who))
        .expect(403);
    }
    await a.h
      .http()
      .put("/api/v1/admin/config/charges.vat_rate_bps")
      .send({ value: 1, reason: "abc" })
      .expect(401);
    expect(await a.prisma.configChange.count()).toBe(0);
    expect(
      (
        await a.prisma.configEntry.findUniqueOrThrow({
          where: { key: "charges.vat_rate_bps" },
        })
      ).valueJson,
    ).toBe(750);
  });

  it("the money keys are listed, and a value that is negative, fractional, too big or without a reason is refused", async () => {
    const list = (
      await a.h
        .http()
        .get("/api/v1/admin/config")
        .set(a.auth("admin"))
        .expect(200)
    ).body.items;
    const keys = list.map((i: any) => i.key);
    for (const k of [
      "units.tiers",
      "units.plans",
      "charges.vat_rate_bps",
      "charges.fee_rate_bps",
      "charges.fee_flat_kobo",
      "charges.fee_cap_kobo",
      "voice.extra30.price_kobo",
      "voice.extra60.price_kobo",
      "cost.text_post_milli",
      "allowance.free_posts",
      "allowance.messages_per_day",
      "units.min_purchase_kobo",
    ])
      expect(keys).toContain(k);
    const bad: [string, unknown][] = [
      ["charges.vat_rate_bps", -1],
      ["charges.vat_rate_bps", 2501],
      ["charges.vat_rate_bps", 7.5],
      ["charges.vat_rate_bps", "750"],
      ["charges.fee_rate_bps", 1001],
      ["charges.fee_rate_bps", 10000],
      ["charges.fee_flat_kobo", 100001],
      ["charges.fee_cap_kobo", -5],
      ["charges.fee_cap_kobo", 1_000_001],
      ["voice.extra30.price_kobo", -1],
      ["voice.extra30.price_kobo", 5_000_001],
      ["voice.extra60.price_kobo", 2_000_000_000],
      ["cost.text_post_milli", 1_000_001],
      ["text.price_chars", 0],
      ["units.min_purchase_kobo", 0],
      ["units.min_purchase_kobo", 2_000_000_000],
      ["allowance.free_posts", -1],
      ["allowance.free_posts", 1001],
      ["allowance.messages_per_day", 1001],
    ];
    for (const [k, v] of bad) {
      const r = await put(k, v).expect(422);
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
    }
    for (const reason of ["", "  ", "ab"])
      await put("charges.vat_rate_bps", 500, reason).expect(422);
    expect(await a.prisma.configChange.count()).toBe(0);
    await put("not.a.setting", 1).expect(404);
  });

  it("a charge change applies to the next checkout at once, is logged with who, before, after and reason, and Put back restores it", async () => {
    const p1 = await who();
    const t = await tier("entry");
    const before = await start(p1, { kind: "UNITS", tierId: t.id }).expect(201);
    expect(before.body.vatKobo).toBe(1373);

    const r = await put(
      "charges.vat_rate_bps",
      0,
      "VAT is not charged on tokens yet",
    ).expect(200);
    expect(r.body).toMatchObject({
      key: "charges.vat_rate_bps",
      value: 0,
      placeholder: false,
    });
    const p2 = await who();
    const after = await start(p2, { kind: "UNITS", tierId: t.id }).expect(201);
    expect(after.body.vatKobo).toBe(0);
    expect(after.body.totalKobo).toBe(
      computeQuote(18300, { ...R, vatRateBps: 0 }).totalKobo,
    );

    const log = (await changes("charges.vat_rate_bps").expect(200)).body.items;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      key: "charges.vat_rate_bps",
      oldValue: 750,
      newValue: 0,
      reason: "VAT is not charged on tokens yet",
      by: a.people.admin.handle,
      rollbackOfId: null,
    });
    expect(new Date(log[0].createdAt).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    const audit = await a.prisma.auditLog.findFirstOrThrow({
      where: { action: "config.update", targetId: "charges.vat_rate_bps" },
    });
    expect(audit).toMatchObject({
      actorId: a.people.admin.id,
      reason: "VAT is not charged on tokens yet",
    });

    // Put back
    const back = await rollback(log[0].id, "Owner changed his mind").expect(
      200,
    );
    expect(back.body.value).toBe(750);
    const p3 = await who();
    expect(
      (await start(p3, { kind: "UNITS", tierId: t.id }).expect(201)).body
        .vatKobo,
    ).toBe(1373);
    const log2 = (await changes("charges.vat_rate_bps").expect(200)).body.items;
    expect(log2).toHaveLength(2);
    expect(log2[0]).toMatchObject({
      oldValue: 0,
      newValue: 750,
      rollbackOfId: log[0].id,
      reason: "Owner changed his mind",
    });
    // the same change cannot be put back twice, and an older one cannot be put back over a newer one
    expect((await rollback(log[0].id).expect(409)).body.error.code).toBe(
      "CONFLICT",
    );
    await put("charges.vat_rate_bps", 200).expect(200);
    expect((await rollback(log2[0].id).expect(409)).body.error.code).toBe(
      "CONFLICT",
    );
  });

  it("pack prices: a change takes effect at once and Put back restores them; a price that is not whole naira is refused", async () => {
    const before = await tiersValue();
    const next = before.map((t) =>
      t.slug === "entry" ? { ...t, priceKobo: 20000, unitsMilli: 200000 } : t,
    );
    await put("units.tiers", next, "Entry pack N200").expect(200);
    expect((await tier("entry")).priceKobo).toBe(20000);
    const p = await who();
    const r = await start(p, {
      kind: "UNITS",
      tierId: (await tier("entry")).id,
    }).expect(201);
    expect(r.body.amountKobo).toBe(20000);
    await put(
      "units.tiers",
      before.map((t) => (t.slug === "entry" ? { ...t, priceKobo: 20050 } : t)),
    ).expect(422);
    await put(
      "units.tiers",
      before.map((t) => (t.slug === "entry" ? { ...t, priceKobo: 100 } : t)),
    ).expect(422); // under the smallest purchase
    const log = (await changes("units.tiers")).body.items;
    await rollback(log[0].id).expect(200);
    expect((await tier("entry")).priceKobo).toBe(18300);
  });

  it("plans: price, name and the on-sale switch change; months, tokens a month and removing a plan are refused; a new plan can be added; Put back restores", async () => {
    const before = await plansValue();
    const edit = (slug: string, patch: object) =>
      before.map((p) => (p.slug === slug ? { ...p, ...patch } : p));
    await put(
      "units.plans",
      edit("connect", { priceKobo: 249900 }),
      "CONNECT is N2,499 this month",
    ).expect(200);
    expect((await plan("connect")).priceKobo).toBe(249900);
    const p = await who();
    const r = await start(p, {
      kind: "SUBSCRIPTION",
      planId: (await plan("connect")).id,
    }).expect(201);
    expect(r.body.amountKobo).toBe(249900);

    for (const bad of [
      edit("connect", { months: 4 }),
      edit("connect", { monthlyMilli: 600000 }),
      edit("connect", { priceKobo: 249950 }),
      edit("connect", { priceKobo: 0 }),
      edit("connect", { priceKobo: -100 }),
      edit("connect", { active: "yes" }),
      before.filter((x) => x.slug !== "connect"),
      [],
      edit("connect", { extra: 1 }),
    ]) {
      const res = await put("units.plans", bad).expect(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    }
    expect((await plan("connect")).months).toBe(3);

    // switch a plan off: it can no longer be bought; the people on it keep it
    await put(
      "units.plans",
      edit("plus", { active: false }),
      "Hide PLUS for now",
    ).expect(200);
    const q = await who();
    await start(q, {
      kind: "SUBSCRIPTION",
      planId: (await plan("plus")).id,
    }).expect(404);
    // a new plan
    const withNew = [
      ...(await plansValue()),
      {
        slug: "year-two",
        name: "VOICES TWO",
        months: 24,
        priceKobo: 1500000,
        monthlyMilli: 800000,
        active: true,
      },
    ];
    await put("units.plans", withNew, "A two year plan").expect(200);
    expect((await plan("year-two")).months).toBe(24);

    // Put back, newest first: each restores what was there
    const log = (await changes("units.plans")).body.items;
    expect(log).toHaveLength(3);
    await rollback(log[0].id).expect(200); // the new plan is switched off, not deleted
    expect((await plan("year-two")).active).toBe(false);
    await rollback(log[1].id).expect(200);
    expect((await plan("plus")).active).toBe(true);
    await rollback(log[2].id).expect(200);
    expect((await plan("connect")).priceKobo).toBe(299900);
  });

  it("a change never alters a payment already started: the row keeps its price, VAT, charge, total and tokens, and verification uses the row", async () => {
    const A = await who();
    const B = await who();
    const E = await who();
    const rA = (
      await start(A, {
        kind: "UNITS",
        tierId: (await tier("entry")).id,
      }).expect(201)
    ).body;
    const rB = (
      await start(B, {
        kind: "UNITS",
        tierId: (await tier("standard")).id,
      }).expect(201)
    ).body;
    const rE = (
      await start(E, {
        kind: "SUBSCRIPTION",
        planId: (await plan("connect")).id,
      }).expect(201)
    ).body;
    const snap = async (id: string) => {
      const x = await a.prisma.payment.findUniqueOrThrow({ where: { id } });
      return [
        x.amountKobo,
        x.vatKobo,
        x.chargeKobo,
        x.totalKobo,
        x.unitsMilli,
        x.bonusMilli,
      ];
    };
    const was = [
      await snap(rA.paymentId),
      await snap(rB.paymentId),
      await snap(rE.paymentId),
    ];

    // change every price and every charge setting
    await put(
      "units.tiers",
      (await tiersValue()).map((t) => ({
        ...t,
        priceKobo: t.priceKobo * 2,
        unitsMilli: t.unitsMilli * 2,
      })),
      "Double",
    ).expect(200);
    await put(
      "units.plans",
      (await plansValue()).map((p) => ({
        ...p,
        priceKobo: p.priceKobo + 100000,
      })),
      "Dearer",
    ).expect(200);
    await put("charges.vat_rate_bps", 0).expect(200);
    await put("charges.fee_rate_bps", 500).expect(200);
    await put("charges.fee_flat_kobo", 5000).expect(200);
    await put("charges.fee_cap_kobo", 1000).expect(200);
    expect([
      await snap(rA.paymentId),
      await snap(rB.paymentId),
      await snap(rE.paymentId),
    ]).toEqual(was);

    // A pays the total it was shown: credited the units it was shown, not the doubled ones
    a.flw.pay(rA.txRef, rA.totalKobo / 100);
    await verify(A, rA.paymentId).expect(200);
    expect(await bal(A.id)).toBe(183_000);
    // B pays what the OLD price would cost under the NEW charge settings (less than the row's total): refused, nothing credited
    a.flw.pay(
      rB.txRef,
      computeQuote(73200, {
        vatRateBps: 0,
        feeRateBps: 500,
        feeFlatKobo: 5000,
        feeCapKobo: 1000,
      }).totalKobo / 100,
    );
    expect((await verify(B, rB.paymentId)).status).toBe(422);
    await a.h.app.get(ReconcileService).run();
    expect(await bal(B.id)).toBe(0);
    a.flw.pay(rB.txRef, rB.totalKobo / 100);
    await verify(B, rB.paymentId).expect(200);
    expect(await bal(B.id)).toBe(732_000);
    // E's plan: the subscription keeps the price it was bought at and the first month
    a.flw.pay(rE.txRef, rE.totalKobo / 100);
    await verify(E, rE.paymentId).expect(200);
    const sub = await a.prisma.subscription.findFirstOrThrow({
      where: { userId: E.id },
    });
    expect([sub.priceKobo, sub.months, sub.monthlyMilli]).toEqual([
      299900, 3, 500000,
    ]);
    expect(await bal(E.id)).toBe(500_000);
    expect(await snap(rA.paymentId)).toEqual(was[0]);
    expect(await snap(rE.paymentId)).toEqual(was[2]);
  });

  it("a config change racing checkout starts: every payment holds one whole quote, the old rates or the new, never a mix", async () => {
    const people = await Promise.all(Array.from({ length: 8 }, () => who()));
    const t = await tier("entry");
    const oldQ = computeQuote(18300, R);
    const newQ = computeQuote(18300, {
      ...R,
      vatRateBps: 1000,
      feeRateBps: 300,
    });
    const results = await Promise.all([
      ...people
        .slice(0, 4)
        .map((p) => start(p, { kind: "UNITS", tierId: t.id })),
      (async () => {
        await put("charges.vat_rate_bps", 1000);
        return put("charges.fee_rate_bps", 300);
      })(),
      ...people.slice(4).map((p) => start(p, { kind: "UNITS", tierId: t.id })),
    ]);
    const starts = results.filter((r) => r.body?.paymentId);
    expect(starts).toHaveLength(8);
    const midQ = computeQuote(18300, { ...R, vatRateBps: 1000 }); // between the two writes
    for (const r of starts) {
      expect(r.status).toBe(201);
      const row = await a.prisma.payment.findUniqueOrThrow({
        where: { id: r.body.paymentId },
      });
      expect(row.amountKobo + (row.vatKobo ?? 0) + (row.chargeKobo ?? 0)).toBe(
        row.totalKobo,
      );
      expect([oldQ, midQ, newQ].map((q) => q.totalKobo)).toContain(
        row.totalKobo,
      );
      // what was sent to the provider is that row's own total
      expect(a.flw.inits.find((i) => i.txRef === row.txRef)?.amountNaira).toBe(
        (row.totalKobo as number) / 100,
      );
    }
    expect(
      (
        await a.prisma.configEntry.findUniqueOrThrow({
          where: { key: "charges.vat_rate_bps" },
        })
      ).valueJson,
    ).toBe(1000);
    expect(
      await a.prisma.configChange.count({
        where: { key: { startsWith: "charges." } },
      }),
    ).toBe(2);
  });

  it("a plan price change racing a subscription start: the payment holds the old or the new price, with the plan's own tokens", async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => who()));
    const pl = await plan("connect");
    const next = (await plansValue()).map((p) =>
      p.slug === "connect" ? { ...p, priceKobo: 399900 } : p,
    );
    const results = await Promise.all([
      start(people[0], { kind: "SUBSCRIPTION", planId: pl.id }),
      start(people[1], { kind: "SUBSCRIPTION", planId: pl.id }),
      put("units.plans", next, "Dearer CONNECT"),
      start(people[2], { kind: "SUBSCRIPTION", planId: pl.id }),
      start(people[3], { kind: "SUBSCRIPTION", planId: pl.id }),
    ]);
    expect(results[2].status).toBe(200);
    for (const r of results.filter((x) => x.body?.paymentId)) {
      expect(r.status).toBe(201);
      const row = await a.prisma.payment.findUniqueOrThrow({
        where: { id: r.body.paymentId },
      });
      expect([299900, 399900]).toContain(row.amountKobo);
      expect(row.unitsMilli).toBe(3 * 500000);
      const q = computeQuote(row.amountKobo, R);
      expect([row.vatKobo, row.chargeKobo, row.totalKobo]).toEqual([
        q.vatKobo,
        q.chargeKobo,
        q.totalKobo,
      ]);
    }
  });

  it("two admins changing the same setting at once: both are logged in order and the last one wins", async () => {
    const [x, y] = await Promise.all([
      put("charges.fee_rate_bps", 200, "first", "admin"),
      put("charges.fee_rate_bps", 300, "second", "admin2"),
    ]);
    expect([x.status, y.status]).toEqual([200, 200]);
    const log = (await changes("charges.fee_rate_bps")).body.items;
    expect(log).toHaveLength(2);
    // each change's "before" is the other's "after" or the original: no value was lost or invented
    const newest = log[0];
    const oldest = log[1];
    expect(oldest.oldValue).toBe(140);
    expect(newest.oldValue).toBe(oldest.newValue);
    expect(
      (
        await a.prisma.configEntry.findUniqueOrThrow({
          where: { key: "charges.fee_rate_bps" },
        })
      ).valueJson,
    ).toBe(newest.newValue);
    expect(
      (
        await a.prisma.configEntry.findUniqueOrThrow({
          where: { key: "charges.fee_rate_bps" },
        })
      ).version,
    ).toBe(3);
  });

  const written = async () => ({
    changes: await a.prisma.configChange.count(),
    audits: await a.prisma.auditLog.count({
      where: { action: { startsWith: "config." } },
    }),
  });
  const said = (r: {
    body: { error: { details: { fields: { message: string }[] } } };
  }) => r.body.error.details.fields[0].message;

  it("round 1 item 3: a pack price is bounded by the smallest purchase and one million naira; a refusal names the bound and writes nothing", async () => {
    const before = await tiersValue();
    const with1 = (priceKobo: number) =>
      before.map((t) => (t.slug === "entry" ? { ...t, priceKobo } : t));
    const w0 = await written();
    const big = await put("units.tiers", with1(2_000_000_000)).expect(422);
    expect(said(big)).toContain("1,000,000 naira");
    const over = await put("units.tiers", with1(100_000_100)).expect(422);
    expect(said(over)).toContain("1,000,000 naira");
    const under = await put("units.tiers", with1(18_200)).expect(422);
    expect(said(under)).toContain("smallest purchase");
    expect(await written()).toEqual(w0);
    expect((await tier("entry")).priceKobo).toBe(18300);
    expect(
      (
        await a.prisma.configEntry.findUnique({
          where: { key: "units.tiers" },
        })
      )?.version ?? 1,
    ).toBe(1);
    // the edges are allowed
    await put("units.tiers", with1(100_000_000)).expect(200);
    await put("units.tiers", with1(18_300)).expect(200);
  });

  it("round 1 item 3: the smallest purchase may not be more than the cheapest pack, and is refused with nothing written", async () => {
    const w0 = await written();
    const r = await put("units.min_purchase_kobo", 1_000_000).expect(422);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
    expect(said(r)).toContain("cheapest pack");
    await put("units.min_purchase_kobo", 18_301).expect(422);
    expect(await written()).toEqual(w0);
    expect(
      (
        await a.prisma.configEntry.findUnique({
          where: { key: "units.min_purchase_kobo" },
        })
      )?.valueJson ?? 18300,
    ).toBe(18300);
    await put("units.min_purchase_kobo", 18_300).expect(200); // equal to the cheapest pack
    await put("units.min_purchase_kobo", 1_000).expect(200);
    // lowering the cheapest pack below the minimum is the other direction of the same rule
    const before = await tiersValue();
    await put("units.min_purchase_kobo", 18_300).expect(200);
    await put(
      "units.tiers",
      before.map((t) => (t.slug === "entry" ? { ...t, priceKobo: 10_000 } : t)),
    ).expect(422);
  });

  it("round 1 item 3: a checkout of a pack at the top price, with the top VAT and charges, answers 201 and never 500", async () => {
    const before = await tiersValue();
    await put(
      "units.tiers",
      before.map((t) =>
        t.slug === "entry" ? { ...t, priceKobo: 100_000_000 } : t,
      ),
    ).expect(200);
    await put("charges.vat_rate_bps", 2500).expect(200);
    await put("charges.fee_rate_bps", 1000).expect(200);
    await put("charges.fee_flat_kobo", 100_000).expect(200);
    await put("charges.fee_cap_kobo", 1_000_000).expect(200);
    const p = await who();
    const r = await start(p, {
      kind: "UNITS",
      tierId: (await tier("entry")).id,
    });
    expect(r.status).toBe(201);
    expect(r.body.amountKobo).toBe(100_000_000);
    expect(r.body.totalKobo).toBeGreaterThan(125_000_000);
    expect(r.body.totalKobo).toBeLessThan(2_000_000_000);
  });

  it("round 1 item 4: the four action costs are bounded from 0 to 1,000,000 milli, and change and Put back work", async () => {
    for (const key of [
      "cost.reaction_milli",
      "cost.vote_milli",
      "cost.proposal_milli",
      "cost.explain_milli",
    ]) {
      const w0 = await written();
      const r = await put(key, 1_000_001).expect(422);
      expect(said(r)).toContain("1000000");
      await put(key, -1).expect(422);
      await put(key, 2_000_000_000).expect(422);
      expect(await written()).toEqual(w0);
      await put(key, 1_000_000).expect(200);
      const log = (await changes(key)).body.items;
      expect(log).toHaveLength(1);
      expect(log[0].newValue).toBe(1_000_000);
      await rollback(log[0].id).expect(200);
      const row = await a.prisma.configEntry.findUniqueOrThrow({
        where: { key },
      });
      expect(row.valueJson).not.toBe(1_000_000);
    }
  });
});
