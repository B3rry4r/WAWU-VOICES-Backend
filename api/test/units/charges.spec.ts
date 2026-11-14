/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from "node:crypto";
import { bootAdmin, type Admin } from "../admin/helpers";
import {
  computeQuote,
  providerFee,
  type ChargeRates,
} from "../../src/units/units.charges";
import { PaymentsService } from "../../src/units/units.payments";
import { ReconcileService } from "../../src/units/units.reconcile";
import { UnitsConfig } from "../../src/units/units.config";

const R: ChargeRates = {
  vatRateBps: 750,
  feeRateBps: 140,
  feeFlatKobo: 0,
  feeCapKobo: 200000,
};
const net = (q: { totalKobo: number }) =>
  q.totalKobo - providerFee(q.totalKobo, R);

describe("the customer pays VAT and the payment charge (owner, 14 Nov 2026)", () => {
  describe("the quote", () => {
    it("N183: VAT 7.5% rounded up, the charge grossed up, WAWU nets price + VAT", () => {
      const q = computeQuote(18300, R);
      expect(q).toEqual({
        priceKobo: 18300,
        vatKobo: 1373, // 1372.5 rounded up
        chargeKobo: 280,
        totalKobo: 19953,
      });
      expect(providerFee(19953, R)).toBe(280);
      expect(net(q)).toBe(18300 + 1373);
    });
    it("N2,999: CONNECT keeps its price, the customer pays more", () => {
      const q = computeQuote(299900, R);
      expect(q.vatKobo).toBe(22493);
      expect(q.totalKobo).toBe(q.priceKobo + q.vatKobo + q.chargeKobo);
      expect(net(q)).toBeGreaterThanOrEqual(299900 + 22493);
      expect(net(q) - (299900 + 22493)).toBeLessThanOrEqual(1); // a kobo of rounding at most
      expect(q.totalKobo).toBe(326971);
    });
    it("N14,640: the largest pack", () => {
      const q = computeQuote(1464000, R);
      expect(q.vatKobo).toBe(109800);
      expect(net(q)).toBeGreaterThanOrEqual(1464000 + 109800);
      expect(net(q) - (1464000 + 109800)).toBeLessThanOrEqual(1);
      expect(q.chargeKobo).toBeLessThan(R.feeCapKobo);
    });
    it("the cap: a big price pays the cap, not more", () => {
      const q = computeQuote(20_000_000, R); // N200,000
      const base = 20_000_000 + 1_500_000;
      expect(q.chargeKobo).toBe(200000);
      expect(q.totalKobo).toBe(base + 200000);
      expect(providerFee(q.totalKobo, R)).toBe(200000);
      expect(net(q)).toBe(base);
    });
    it("a flat fee is part of the gross up; zero rates give total equal to price", () => {
      const f = computeQuote(100000, { ...R, feeFlatKobo: 5000 });
      expect(
        f.totalKobo - providerFee(f.totalKobo, { ...R, feeFlatKobo: 5000 }),
      ).toBeGreaterThanOrEqual(107500);
      const z = computeQuote(18300, {
        vatRateBps: 0,
        feeRateBps: 0,
        feeFlatKobo: 0,
        feeCapKobo: 0,
      });
      expect(z).toEqual({
        priceKobo: 18300,
        vatKobo: 0,
        chargeKobo: 0,
        totalKobo: 18300,
      });
    });
    it("WAWU nets at least price + VAT for every price on the list", () => {
      for (const p of [
        18300, 36600, 73200, 146400, 366000, 732000, 1464000, 299900, 539900,
        959900,
      ]) {
        const q = computeQuote(p, R);
        expect(net(q)).toBeGreaterThanOrEqual(p + q.vatKobo);
        expect(net(q) - (p + q.vatKobo)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("checkout and verification (Flutterwave stood in)", () => {
    let a: Admin;
    let n = 0;
    beforeAll(async () => {
      a = await bootAdmin();
    });
    afterAll(() => a.close());
    beforeEach(async () => {
      await a.prisma.$executeRawUnsafe(
        `TRUNCATE "Subscription","SubscriptionCredit","Payment","LedgerTransaction","Wallet","Notification","ConfigEntry" CASCADE`,
      );
      await a.h.app.get(UnitsConfig).seedDefaults();
      a.h.app.get(PaymentsService).resetLimits();
      a.flw.reset();
    });
    const who = () => a.person(`chg${++n}`);
    type P = Awaited<ReturnType<typeof who>>;
    const bearer = (p: P) => ({ Authorization: `Bearer ${p.token}` });
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
    const bal = async (id: string) =>
      (await a.prisma.wallet.findUnique({ where: { userId: id } }))
        ?.balanceMilli ?? 0;
    const tier = (slug: string) =>
      a.prisma.unitTier.findUniqueOrThrow({ where: { slug } });

    it("N183 pack: all four amounts stored, the TOTAL goes to Flutterwave, tokens stay 183", async () => {
      const p = await who();
      const t = await tier("entry");
      const r = await start(p, { kind: "UNITS", tierId: t.id }).expect(201);
      expect(r.body).toMatchObject({
        amountKobo: 18300,
        vatKobo: 1373,
        chargeKobo: 280,
        totalKobo: 19953,
      });
      expect(a.flw.inits.at(-1)?.amountNaira).toBe(199.53);
      const row = await a.prisma.payment.findUniqueOrThrow({
        where: { id: r.body.paymentId },
      });
      expect([
        row.amountKobo,
        row.vatKobo,
        row.chargeKobo,
        row.totalKobo,
      ]).toEqual([18300, 1373, 280, 19953]);
      a.flw.pay(r.body.txRef, 199.53);
      const v = await verify(p, r.body.paymentId).expect(200);
      expect(v.body.status).toBe("SUCCEEDED");
      expect(await bal(p.id)).toBe(183_000);
    });

    it("N2,999 CONNECT: price unchanged, first month 500 tokens, the customer pays the total", async () => {
      const p = await who();
      const pl = await a.prisma.subscriptionPlan.findUniqueOrThrow({
        where: { slug: "connect" },
      });
      const r = await start(p, { kind: "SUBSCRIPTION", planId: pl.id }).expect(
        201,
      );
      expect(r.body).toMatchObject({
        amountKobo: 299900,
        vatKobo: 22493,
        totalKobo: 326971,
      });
      a.flw.pay(r.body.txRef, 3269.71);
      await verify(p, r.body.paymentId).expect(200);
      expect(await bal(p.id)).toBe(500_000);
      const s = await a.prisma.subscription.findFirstOrThrow({
        where: { userId: p.id },
      });
      expect(s.priceKobo).toBe(299900);
    });

    it("N14,640 Ultimate: 14,640 tokens for the total", async () => {
      const p = await who();
      const t = await tier("ultimate");
      const r = await start(p, { kind: "UNITS", tierId: t.id }).expect(201);
      expect(r.body.amountKobo).toBe(1464000);
      expect(r.body.totalKobo).toBe(computeQuote(1464000, R).totalKobo);
      a.flw.pay(r.body.txRef, r.body.totalKobo / 100);
      await verify(p, r.body.paymentId).expect(200);
      expect(await bal(p.id)).toBe(14_640_000);
    });

    it("the rates come from config at request time, not from code", async () => {
      const p = await who();
      await a.prisma.configEntry.update({
        where: { key: "charges.vat_rate_bps" },
        data: { valueJson: 0 },
      });
      await a.prisma.configEntry.update({
        where: { key: "charges.fee_rate_bps" },
        data: { valueJson: 0 },
      });
      const t = await tier("entry");
      const r = await start(p, { kind: "UNITS", tierId: t.id }).expect(201);
      expect(r.body).toMatchObject({
        vatKobo: 0,
        chargeKobo: 0,
        totalKobo: 18300,
      });
      const tiers = await a.h.http().get("/api/v1/units/tiers").expect(200);
      expect(tiers.body.vatRateBps).toBe(0);
      expect(tiers.body.tiers[0].quote.totalKobo).toBe(
        tiers.body.tiers[0].priceKobo,
      );
    });

    it("the tiers and plans routes carry the quote and the VAT rate for the screens", async () => {
      const tiers = await a.h.http().get("/api/v1/units/tiers").expect(200);
      expect(tiers.body.vatRateBps).toBe(750);
      const entry = tiers.body.tiers.find((x: any) => x.slug === "entry");
      expect(entry.quote).toEqual({
        priceKobo: 18300,
        vatKobo: 1373,
        chargeKobo: 280,
        totalKobo: 19953,
      });
      const plans = await a.h
        .http()
        .get("/api/v1/subscription-plans")
        .expect(200);
      expect(plans.body.plans[0].quote.priceKobo).toBe(299900);
      expect(plans.body.plans[0].quote.totalKobo).toBe(326971);
    });

    it("a short payment (only the price) grants nothing, at return and at reconcile", async () => {
      const p = await who();
      const t = await tier("entry");
      const r = await start(p, { kind: "UNITS", tierId: t.id }).expect(201);
      a.flw.pay(r.body.txRef, 183);
      const v = await verify(p, r.body.paymentId);
      expect(v.status).toBe(422);
      await a.h.app.get(ReconcileService).run();
      expect(await bal(p.id)).toBe(0);
      expect(
        (
          await a.prisma.payment.findUniqueOrThrow({
            where: { id: r.body.paymentId },
          })
        ).status,
      ).not.toBe("SUCCEEDED");
      // paying the right total later (a retry on the same checkout) then credits
      a.flw.pay(r.body.txRef, 199.53);
      await verify(p, r.body.paymentId).expect(200);
      expect(await bal(p.id)).toBe(183_000);
    });

    it("an overpayment credits once and the extra over the TOTAL is recorded for a manual refund (V-23)", async () => {
      const p = await who();
      const t = await tier("entry");
      const r = await start(p, { kind: "UNITS", tierId: t.id }).expect(201);
      a.flw.pay(r.body.txRef, 250);
      await verify(p, r.body.paymentId).expect(200);
      expect(await bal(p.id)).toBe(183_000);
      const row = await a.prisma.payment.findUniqueOrThrow({
        where: { id: r.body.paymentId },
      });
      expect(row.overpaidKobo).toBe(25000 - 19953);
    });

    it("a wrong currency grants nothing", async () => {
      const p = await who();
      const t = await tier("entry");
      const r = await start(p, { kind: "UNITS", tierId: t.id }).expect(201);
      a.flw.pay(r.body.txRef, 199.53, { currency: "USD" });
      expect((await verify(p, r.body.paymentId)).status).toBe(422);
      expect(await bal(p.id)).toBe(0);
    });

    it("an old payment row with no total keeps the old rule: amount equals price still completes", async () => {
      const p = await who();
      const t = await tier("entry");
      const old = await a.prisma.payment.create({
        data: {
          userId: p.id,
          kind: "UNITS",
          tierId: t.id,
          amountKobo: 18300,
          unitsMilli: 183000,
          bonusMilli: 0,
          txRef: `voices-${randomUUID()}`,
          idempotencyKey: randomUUID(),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      expect(old.totalKobo).toBeNull();
      a.flw.pay(old.txRef, 183);
      const v = await verify(p, old.id).expect(200);
      expect(v.body.status).toBe("SUCCEEDED");
      expect(await bal(p.id)).toBe(183_000);
    });

    it("repeat confirmations (return, reconcile, repeat) grant once; the webhook route is not served", async () => {
      const p = await who();
      const t = await tier("entry");
      const r = await start(p, { kind: "UNITS", tierId: t.id }).expect(201);
      a.flw.pay(r.body.txRef, 199.53);
      await Promise.all([
        verify(p, r.body.paymentId),
        verify(p, r.body.paymentId),
        a.h.app.get(ReconcileService).run(),
      ]);
      await verify(p, r.body.paymentId).expect(200);
      await a.h
        .http()
        .post("/api/v1/webhooks/flutterwave")
        .set("verif-hash", "x")
        .send({
          event: "charge.completed",
          data: { tx_ref: r.body.txRef, status: "successful", amount: 199.53 },
        })
        .expect(404);
      expect(await bal(p.id)).toBe(183_000);
      expect(
        await a.prisma.ledgerTransaction.count({ where: { kind: "PURCHASE" } }),
      ).toBe(1);
    });
  });
});
