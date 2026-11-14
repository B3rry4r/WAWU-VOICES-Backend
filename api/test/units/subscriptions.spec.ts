/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TEST_DATABASE_URL } from "../test-env";
import { bootAdmin, type Admin } from "../admin/helpers";
import { UnitsConfig } from "../../src/units/units.config";
import { LedgerService } from "../../src/units/units.ledger";
import { PaymentsService } from "../../src/units/units.payments";
import { ReconcileService } from "../../src/units/units.reconcile";
import {
  SubscriptionsService,
  addMonthsClamped,
  lagosDayString,
  monthsDue,
} from "../../src/units/units.subscriptions";
import { DeletionService } from "../../src/me/deletion.service";

/** V-45: subscriptions. Flutterwave is the in-memory stand-in (FakeFlutterwave); no spec calls a live service. */
describe("subscriptions (V-45)", () => {
  let a: Admin;
  let subs: SubscriptionsService;
  let ledger: LedgerService;
  let n = 0;
  const prisma = () => a.prisma;
  const MILLI = 1000;

  beforeAll(async () => {
    a = await bootAdmin();
    subs = a.h.app.get(SubscriptionsService);
    ledger = a.h.app.get(LedgerService);
    await a.person("admin", ["ADMIN"]);
    for (const pl of await a.prisma.subscriptionPlan.findMany())
      planIds[pl.slug] = pl.id;
  });
  afterAll(() => a.close());
  beforeEach(async () => {
    await prisma().$executeRawUnsafe(
      `TRUNCATE "Subscription","SubscriptionCredit","Payment","LedgerTransaction","Wallet","Notification","ConfigEntry","UnitTier" CASCADE`,
    );
    await a.h.app.get(UnitsConfig).seedDefaults();
    a.h.app.get(PaymentsService).resetLimits();
    a.flw.reset();
    jest.restoreAllMocks();
  });

  const person = async () => a.person(`sub${++n}`);
  type P = Awaited<ReturnType<typeof person>>;
  const http = () => a.h.http();
  const bearer = (p: P) => ({ Authorization: `Bearer ${p.token}` });
  const plan = (slug: string) =>
    prisma().subscriptionPlan.findUniqueOrThrow({ where: { slug } });
  const balance = async (id: string) =>
    (await prisma().wallet.findUnique({ where: { userId: id } }))
      ?.balanceMilli ?? 0;
  const at = (day: string) => new Date(`${day}T12:00:00+01:00`);
  const startOf = async (id: string) =>
    prisma().subscription.findFirstOrThrow({
      where: { userId: id },
      orderBy: { createdAt: "asc" },
    });

  const planIds: Record<string, string> = {};
  function begin(p: P, slug: string, key = randomUUID()) {
    return http()
      .post("/api/v1/payments")
      .set(bearer(p))
      .set("Idempotency-Key", key)
      .send({ kind: "SUBSCRIPTION", planId: planIds[slug] });
  }
  /** Start, pay at the stand-in provider, and come back (verify on return). */
  async function buy(p: P, slug: string, naira?: number) {
    const init = await begin(p, slug).expect(201);
    a.flw.pay(init.body.txRef, naira ?? init.body.totalKobo / 100);
    const res = await http()
      .post(`/api/v1/payments/${init.body.paymentId}/verify`)
      .set(bearer(p))
      .set("Idempotency-Key", randomUUID())
      .send({});
    return { init: init.body, res };
  }

  describe("plans and prices (config, seeded from PRICING.md)", () => {
    it("GET /subscription-plans lists the three plans for a guest, amounts as PRICING.md says", async () => {
      const r = await http().get("/api/v1/subscription-plans").expect(200);
      expect(
        r.body.plans.map((p: any) => [
          p.slug,
          p.name,
          p.months,
          p.priceKobo,
          p.monthlyMilli,
          p.totalMilli,
        ]),
      ).toEqual([
        ["connect", "VOICES CONNECT", 3, 299900, 500_000, 1_500_000],
        ["plus", "VOICES PLUS", 6, 539900, 600_000, 3_600_000],
        ["infinity", "VOICES INFINITY", 12, 959900, 750_000, 9_000_000],
      ]);
    });
    it("GET /subscriptions/me needs a sign-in", async () => {
      await http().get("/api/v1/subscriptions/me").expect(401);
    });
  });

  describe("day arithmetic (Lagos calendar days)", () => {
    it("the same day of the month, clamped in short months, counted from the start day", () => {
      expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
      expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
      expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
      expect(addMonthsClamped("2026-11-14", 3)).toBe("2027-02-14");
      expect(addMonthsClamped("2026-11-14", 12)).toBe("2027-11-14");
      expect(addMonthsClamped("2026-12-15", 1)).toBe("2027-01-15");
    });
    it("monthsDue never passes the plan's months", () => {
      expect(monthsDue("2026-11-14", 3, "2026-11-13")).toBe(0);
      expect(monthsDue("2026-11-14", 3, "2026-11-14")).toBe(1);
      expect(monthsDue("2026-11-14", 3, "2026-12-13")).toBe(1);
      expect(monthsDue("2026-11-14", 3, "2026-12-14")).toBe(2);
      expect(monthsDue("2026-11-14", 3, "2030-01-01")).toBe(3);
    });
    it("Lagos time decides the day, not UTC", () => {
      // 23:30 UTC on the 14th is 00:30 on the 15th in Lagos (UTC+1)
      expect(lagosDayString(new Date("2026-11-14T23:30:00Z"))).toBe(
        "2026-11-15",
      );
    });
  });

  describe("a payment is credited exactly once", () => {
    it("start: the price comes from the plan row, a browser amount is ignored, Flutterwave is asked for that price", async () => {
      const p = await person();
      const pl = await plan("plus");
      const r = await http()
        .post("/api/v1/payments")
        .set(bearer(p))
        .set("Idempotency-Key", randomUUID())
        .send({ kind: "SUBSCRIPTION", planId: pl.id, amountKobo: 1 })
        .expect((x) => expect([201, 400, 422]).toContain(x.status));
      if (r.status === 201) {
        expect(r.body.amountKobo).toBe(539900);
        expect(a.flw.inits.at(-1)?.amountNaira).toBe(r.body.totalKobo / 100);
        expect(a.flw.inits.at(-1)?.txRef).toMatch(/^voices-/);
      }
      // nothing credited and no subscription before the payment is confirmed
      expect(await balance(p.id)).toBe(0);
      expect(await prisma().subscription.count()).toBe(0);
    });

    it("verify on return credits the plan's FIRST month only, makes one subscription, one ledger row", async () => {
      const p = await person();
      const { res } = await buy(p, "connect");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUCCEEDED");
      expect(res.body.plan).toMatchObject({ slug: "connect", months: 3 });
      expect(await balance(p.id)).toBe(500 * MILLI);
      const s = await startOf(p.id);
      expect(s).toMatchObject({
        status: "ACTIVE",
        months: 3,
        monthlyMilli: 500_000,
        priceKobo: 299900,
        creditedMonths: 1,
        startDay: lagosDayString(),
        endDay: addMonthsClamped(lagosDayString(), 3),
      });
      expect(
        await prisma().ledgerTransaction.count({
          where: { kind: "SUBSCRIPTION_CREDIT" },
        }),
      ).toBe(1);
      expect(await subs.ledgerCheck()).toMatchObject({ ok: true });
    });

    it("return, repeat, reconcile and a parallel storm: still one credit", async () => {
      const p = await person();
      const init = await begin(p, "plus").expect(201);
      a.flw.pay(init.body.txRef, init.body.totalKobo / 100);
      const verify = () =>
        http()
          .post(`/api/v1/payments/${init.body.paymentId}/verify`)
          .set(bearer(p))
          .set("Idempotency-Key", randomUUID())
          .send({});
      const all = await Promise.all([
        verify(),
        verify(),
        verify(),
        verify(),
        a.h.app.get(ReconcileService).run(),
        a.h.app.get(PaymentsService).verifySystem(init.body.paymentId),
      ]);
      expect(
        all.slice(0, 4).every((r) => (r as { status: number }).status === 200),
      ).toBe(true);
      await verify().expect(200);
      await a.h.app.get(ReconcileService).run();
      expect(await balance(p.id)).toBe(600 * MILLI);
      expect(await prisma().subscription.count()).toBe(1);
      expect(await prisma().subscriptionCredit.count()).toBe(1);
      expect(
        await prisma().ledgerTransaction.count({
          where: { kind: "SUBSCRIPTION_CREDIT" },
        }),
      ).toBe(1);
    });

    it("reconcile alone confirms a payment whose browser never returned, once", async () => {
      const p = await person();
      const init = await begin(p, "connect").expect(201);
      a.flw.pay(init.body.txRef, init.body.totalKobo / 100);
      await a.h.app.get(ReconcileService).run();
      await a.h.app.get(ReconcileService).run();
      expect(await balance(p.id)).toBe(500 * MILLI);
      expect(await prisma().subscription.count()).toBe(1);
    });

    it("an underpayment is refused: nothing credited, no subscription", async () => {
      const p = await person();
      const { res } = await buy(p, "connect", 2999);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PAYMENT_AMOUNT_MISMATCH");
      expect(await balance(p.id)).toBe(0);
      expect(await prisma().subscription.count()).toBe(0);
      const { res: r2 } = await buy(await person(), "infinity", 1);
      expect(r2.status).toBe(422);
    });

    it("an overpayment (V-23) credits the plan once and records the extra for a manual refund", async () => {
      const p = await person();
      const { init, res } = await buy(p, "connect", 3500);
      expect(res.status).toBe(200);
      expect(await balance(p.id)).toBe(500 * MILLI);
      expect(await prisma().subscription.count()).toBe(1);
      const row = await prisma().payment.findUniqueOrThrow({
        where: { id: init.paymentId },
      });
      expect(row.overpaidKobo).toBe(350000 - init.totalKobo);
      expect((row.rawVerify as any).overpay).toMatchObject({
        extraKobo: 350000 - init.totalKobo,
        refundNeeded: true,
      });
      // the same payment confirmed again changes nothing
      await http()
        .post(`/api/v1/payments/${init.paymentId}/verify`)
        .set(bearer(p))
        .set("Idempotency-Key", randomUUID())
        .send({})
        .expect(200);
      expect(await balance(p.id)).toBe(500 * MILLI);
    });

    it("a payment of another person is not theirs to verify, and a forged reference credits nothing", async () => {
      const p = await person();
      const other = await person();
      const init = await begin(p, "connect").expect(201);
      a.flw.pay("voices-someone-else", 2999);
      await http()
        .post(`/api/v1/payments/${init.body.paymentId}/verify`)
        .set(bearer(other))
        .set("Idempotency-Key", randomUUID())
        .send({})
        .expect(404);
      await http()
        .post(`/api/v1/payments/${init.body.paymentId}/verify`)
        .set(bearer(p))
        .set("Idempotency-Key", randomUUID())
        .send({ providerTxId: "900000" })
        .expect(409);
      expect(await balance(p.id)).toBe(0);
      expect(await prisma().subscription.count()).toBe(0);
    });

    it("the same Idempotency-Key replays the same checkout, one payment row", async () => {
      const p = await person();
      const key = randomUUID();
      const x = await begin(p, "connect", key).expect(201);
      const y = await begin(p, "connect", key).expect(201);
      expect(y.body.paymentId).toBe(x.body.paymentId);
      expect(await prisma().payment.count()).toBe(1);
      // a different plan under the same key is refused
      await begin(p, "plus", key).expect(409);
    });

    it("the database refuses a second subscription for one payment", async () => {
      const p = await person();
      const { init } = await buy(p, "connect");
      const s = await startOf(p.id);
      await expect(
        prisma().subscription.create({
          data: {
            userId: p.id,
            planId: s.planId,
            paymentId: init.paymentId,
            months: 3,
            monthlyMilli: 500_000,
            priceKobo: 299900,
            startDay: "2026-11-14",
            endDay: "2027-02-14",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("each month is credited exactly once", () => {
    it("month 2 on the same day of month 2, not before; carry-over adds up", async () => {
      const p = await person();
      await buy(p, "connect");
      const s = await startOf(p.id);
      const day2 = addMonthsClamped(s.startDay, 1);
      const before = await subs.runDue(at(s.startDay));
      expect(before.credited).toBe(0);
      const dayBefore2 = addMonthsClamped(day2, 0).replace(/-\d\d$/, "-01");
      expect((await subs.runDue(at(dayBefore2))).credited).toBe(0);
      expect((await subs.runDue(at(day2))).credited).toBe(1);
      expect(await balance(p.id)).toBe(1000 * MILLI); // unused month 1 carried over
      expect((await subs.runDue(at(day2))).credited).toBe(0);
    });

    it("two jobs at once: one credit; the ledger row has its own amount and a unique key", async () => {
      const p = await person();
      await buy(p, "plus");
      const s = await startOf(p.id);
      const day2 = at(addMonthsClamped(s.startDay, 1));
      const runs = await Promise.all([
        subs.runDue(day2),
        subs.runDue(day2),
        subs.runDue(day2),
        subs.runDue(day2),
      ]);
      expect(runs.reduce((t, r) => t + r.credited, 0)).toBe(1);
      expect(await balance(p.id)).toBe(1200 * MILLI);
      const credit = await prisma().subscriptionCredit.findUniqueOrThrow({
        where: { subscriptionId_monthNo: { subscriptionId: s.id, monthNo: 2 } },
      });
      expect(credit.amountMilli).toBe(600_000);
      const txn = await prisma().ledgerTransaction.findUniqueOrThrow({
        where: { idempotencyKey: `subcredit:${s.id}:2` },
        include: { entries: true },
      });
      expect(txn.id).toBe(credit.ledgerTxnId);
      expect(txn.entries.map((e) => e.deltaMilli).sort()).toEqual([
        -600_000, 600_000,
      ]);
      // the unique keys hold even against a direct write
      await expect(
        prisma().subscriptionCredit.create({
          data: {
            subscriptionId: s.id,
            monthNo: 2,
            amountMilli: 600_000,
            ledgerTxnId: txn.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      await expect(
        prisma().ledgerTransaction.create({
          data: {
            kind: "SUBSCRIPTION_CREDIT",
            idempotencyKey: `subcredit:${s.id}:2`,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      expect(await subs.ledgerCheck()).toMatchObject({ ok: true });
    });

    it("creditMonth called twice at once for the same month: one wins", async () => {
      const p = await person();
      await buy(p, "plus");
      const s = await startOf(p.id);
      const freePosts = await ledger.freePostsConfig();
      const go = () =>
        ledger.inTx((db) => subs.creditMonth(db, s.id, p.id, 2, freePosts));
      const r = await Promise.all([go(), go(), go()]);
      expect(r.filter(Boolean)).toHaveLength(1);
      expect(await balance(p.id)).toBe(1200 * MILLI);
    });

    it("a crash in the middle of a credit leaves nothing half done; the next run credits it", async () => {
      const p = await person();
      await buy(p, "connect");
      const s = await startOf(p.id);
      const day2 = at(addMonthsClamped(s.startDay, 1));
      jest
        .spyOn(ledger, "setBalance")
        .mockRejectedValueOnce(new Error("power cut"));
      const bad = await subs.runDue(day2);
      expect(bad).toMatchObject({ credited: 0, errors: 1 });
      expect(await balance(p.id)).toBe(500 * MILLI);
      expect((await startOf(p.id)).creditedMonths).toBe(1);
      expect(await prisma().subscriptionCredit.count()).toBe(1);
      expect(
        await prisma().ledgerTransaction.count({
          where: { kind: "SUBSCRIPTION_CREDIT" },
        }),
      ).toBe(1);
      const good = await subs.runDue(day2);
      expect(good).toMatchObject({ credited: 1, errors: 0 });
      expect(await balance(p.id)).toBe(1000 * MILLI);
    });

    it("the server was down on the day: it catches up the missed months, never more than the plan's months", async () => {
      const p = await person();
      await buy(p, "connect");
      const s = await startOf(p.id);
      const late = at(addMonthsClamped(s.startDay, 7)); // far past the end
      const r = await subs.runDue(late);
      expect(r.credited).toBe(2); // months 2 and 3
      expect(await balance(p.id)).toBe(1500 * MILLI);
      expect((await subs.runDue(late)).credited).toBe(0);
      expect((await subs.runDue(at("2035-01-01"))).credited).toBe(0);
      const done = await startOf(p.id);
      expect(done.creditedMonths).toBe(3);
      expect(done.status).toBe("ENDED");
      expect(await prisma().subscriptionCredit.count()).toBe(3);
      expect(await balance(p.id)).toBe(1500 * MILLI);
    });

    it("INFINITY runs the full 12 months to 9,000 tokens, one credit a month, and ends", async () => {
      const p = await person();
      await buy(p, "infinity");
      const s = await startOf(p.id);
      for (let k = 1; k < 12; k++) {
        const r = await subs.runDue(at(addMonthsClamped(s.startDay, k)));
        expect(r.credited).toBe(1);
      }
      expect(await balance(p.id)).toBe(9000 * MILLI);
      const final = await subs.runDue(at(s.endDay));
      expect(final.ended).toBe(1);
      expect((await startOf(p.id)).status).toBe("ENDED");
      expect(await subs.ledgerCheck()).toMatchObject({ ok: true });
    });

    it("a plan that began on the 31st is credited on the last day of a short month, then the 31st again", async () => {
      const p = await person();
      const pl = await plan("connect");
      const pay = await prisma().payment.create({
        data: {
          userId: p.id,
          kind: "SUBSCRIPTION",
          status: "SUCCEEDED",
          planId: pl.id,
          amountKobo: pl.priceKobo,
          txRef: `voices-${randomUUID()}`,
          idempotencyKey: randomUUID(),
          expiresAt: new Date(),
        },
      });
      const s = await prisma().subscription.create({
        data: {
          userId: p.id,
          planId: pl.id,
          paymentId: pay.id,
          months: 3,
          monthlyMilli: 500_000,
          priceKobo: pl.priceKobo,
          startDay: "2027-01-31",
          endDay: "2027-04-30",
          creditedMonths: 0,
        },
      });
      expect((await subs.runDue(at("2027-01-31"))).credited).toBe(1);
      expect((await subs.runDue(at("2027-02-27"))).credited).toBe(0);
      expect((await subs.runDue(at("2027-02-28"))).credited).toBe(1);
      expect((await subs.runDue(at("2027-03-30"))).credited).toBe(0);
      expect((await subs.runDue(at("2027-03-31"))).credited).toBe(1);
      expect(
        (await prisma().subscription.findUniqueOrThrow({ where: { id: s.id } }))
          .creditedMonths,
      ).toBe(3);
    });

    it("subscribers still buy token packs, balances add up, and the daily limit is unchanged", async () => {
      const p = await person();
      await buy(p, "connect");
      const tier = await prisma().unitTier.findUniqueOrThrow({
        where: { slug: "entry" },
      });
      const init = await http()
        .post("/api/v1/payments")
        .set(bearer(p))
        .set("Idempotency-Key", randomUUID())
        .send({ kind: "UNITS", tierId: tier.id })
        .expect(201);
      a.flw.pay(init.body.txRef, init.body.totalKobo / 100);
      await http()
        .post(`/api/v1/payments/${init.body.paymentId}/verify`)
        .set(bearer(p))
        .set("Idempotency-Key", randomUUID())
        .send({})
        .expect(200);
      expect(await balance(p.id)).toBe((500 + 183) * MILLI);
      const w = await http().get("/api/v1/wallet").set(bearer(p)).expect(200);
      expect(w.body.allowances.messagesLeftToday).toBe(20);
      expect(w.body.costs.messagesPerDay).toBe(20);
      // the pack purchase and the plan are separate payments, and the pack reconciles on its own
      expect(await a.h.app.get(ReconcileService).ledgerCheck()).toMatchObject({
        ok: true,
      });
    });

    it("history says what a plan credit is, and my subscription view shows months, next credit and end", async () => {
      const p = await person();
      await buy(p, "connect");
      const s = await startOf(p.id);
      const h = await http()
        .get("/api/v1/wallet/history")
        .set(bearer(p))
        .expect(200);
      const titles = h.body.items.map((i: any) => i.title);
      expect(titles).toContain("Monthly plan tokens");
      expect(titles).toContain("VOICES CONNECT");
      const m = await http()
        .get("/api/v1/subscriptions/me")
        .set(bearer(p))
        .query({ userId: "someone-else" })
        .expect(200);
      expect(m.body.current).toMatchObject({
        planName: "VOICES CONNECT",
        months: 3,
        creditedMonths: 1,
        monthlyMilli: 500_000,
        totalMilli: 1_500_000,
        startDay: s.startDay,
        endDay: s.endDay,
        nextCreditDay: addMonthsClamped(s.startDay, 1),
      });
      expect(m.body.canBuy).toBe(false);
      const other = await person();
      const o = await http()
        .get("/api/v1/subscriptions/me")
        .set(bearer(other))
        .expect(200);
      expect(o.body).toMatchObject({
        current: null,
        queued: null,
        canBuy: true,
      });
    });
  });

  describe("the second-plan rule: refuse while one runs or waits; a double checkout queues, never overlaps", () => {
    it("a second plan is refused at checkout with a plain message while one is active", async () => {
      const p = await person();
      await buy(p, "connect");
      const r = await begin(p, "infinity").expect(409);
      expect(r.body.error.code).toBe("SUBSCRIPTION_ACTIVE");
      expect(r.body.error.message).toMatch(/already have VOICES CONNECT until/);
      expect(r.body.error.message).not.toMatch(/[–—]/);
      expect(a.flw.inits).toHaveLength(1); // the second never reached Flutterwave
      expect(await prisma().payment.count()).toBe(1);
    });

    it("after the plan ends a new one can be bought", async () => {
      const p = await person();
      await buy(p, "connect");
      const s = await startOf(p.id);
      await subs.runDue(at(s.endDay));
      await expect(
        subs.assertCanBuy(p.id, at(s.endDay)),
      ).resolves.toBeUndefined();
    });

    it("two checkouts opened before either was paid: the later payment queues to start when the first ends", async () => {
      const p = await person();
      const first = await begin(p, "connect").expect(201);
      const second = await begin(p, "plus").expect(201); // allowed: nothing is active yet
      a.flw.pay(first.body.txRef, first.body.totalKobo / 100);
      a.flw.pay(second.body.txRef, second.body.totalKobo / 100);
      const v = (id: string) =>
        http()
          .post(`/api/v1/payments/${id}/verify`)
          .set(bearer(p))
          .set("Idempotency-Key", randomUUID())
          .send({});
      await v(first.body.paymentId).expect(200);
      await v(second.body.paymentId).expect(200);
      const rows = await prisma().subscription.findMany({
        where: { userId: p.id },
        orderBy: { createdAt: "asc" },
      });
      expect(rows.map((r) => r.status)).toEqual(["ACTIVE", "QUEUED"]);
      expect(rows[1].startDay).toBe(rows[0].endDay);
      expect(rows[1].creditedMonths).toBe(0);
      // only the first plan's month 1 is in the balance; the queued plan credits nothing yet
      expect(await balance(p.id)).toBe(500 * MILLI);
      const view = await http()
        .get("/api/v1/subscriptions/me")
        .set(bearer(p))
        .expect(200);
      expect(view.body.queued).toMatchObject({ planName: "VOICES PLUS" });
      expect(view.body.canBuy).toBe(false);
      // running the job on the day before it starts credits nothing for the queued plan
      await subs.runDue(at(addMonthsClamped(rows[0].startDay, 2)));
      expect(
        (
          await prisma().subscription.findUniqueOrThrow({
            where: { id: rows[1].id },
          })
        ).creditedMonths,
      ).toBe(0);
      // on its start day it becomes active and credits month 1
      const r = await subs.runDue(at(rows[1].startDay));
      expect(r.credited).toBeGreaterThanOrEqual(1);
      const now = await prisma().subscription.findMany({
        where: { userId: p.id },
        orderBy: { createdAt: "asc" },
      });
      expect(now[1]).toMatchObject({ status: "ACTIVE", creditedMonths: 1 });
      expect(now[0].creditedMonths).toBe(3);
      expect(await balance(p.id)).toBe((1500 + 600) * MILLI);
      // never two credits for one calendar month from two plans: months credited per plan never exceed its months
      expect(await prisma().subscriptionCredit.count()).toBe(4);
    });
  });

  describe("account deletion", () => {
    async function purge(p: P) {
      await prisma().user.update({
        where: { id: p.id },
        data: { status: "DELETION_PENDING", deletionRequestedAt: new Date() },
      });
      await a.h.app.get(DeletionService).purge(p.id, new Date());
    }

    it("the purge ends the plan: no credits afterwards, the money records stay, the unspent balance is forfeited as before", async () => {
      const p = await person();
      const { init } = await buy(p, "plus");
      const s = await startOf(p.id);
      await purge(p);
      const after = await prisma().subscription.findUniqueOrThrow({
        where: { id: s.id },
      });
      expect(after.status).toBe("CANCELLED_DELETED");
      expect(after.cancelledAt).not.toBeNull();
      expect(await balance(p.id)).toBe(0);
      const r = await subs.runDue(at(addMonthsClamped(s.startDay, 5)));
      expect(r.credited).toBe(0);
      expect(await balance(p.id)).toBe(0);
      // kept: the payment (with its receipt), the credit row, the ledger row
      expect(
        (
          await prisma().payment.findUniqueOrThrow({
            where: { id: init.paymentId },
          })
        ).status,
      ).toBe("SUCCEEDED");
      expect(await prisma().subscriptionCredit.count()).toBe(1);
      expect(
        await prisma().ledgerTransaction.count({
          where: { kind: "SUBSCRIPTION_CREDIT" },
        }),
      ).toBe(1);
    });

    it("during the 14 day grace period nothing is credited; if the person stays, the missed months are caught up", async () => {
      const p = await person();
      await buy(p, "connect");
      const s = await startOf(p.id);
      await prisma().user.update({
        where: { id: p.id },
        data: { status: "DELETION_PENDING", deletionRequestedAt: new Date() },
      });
      const day2 = at(addMonthsClamped(s.startDay, 1));
      expect((await subs.runDue(day2)).credited).toBe(0);
      await prisma().user.update({
        where: { id: p.id },
        data: { status: "ACTIVE", deletionRequestedAt: null },
      });
      expect((await subs.runDue(day2)).credited).toBe(1);
    });

    it("a payment confirmed after the purge keeps the money record but makes a cancelled plan that credits nothing", async () => {
      const p = await person();
      const init = await begin(p, "connect").expect(201);
      await purge(p);
      a.flw.pay(init.body.txRef, init.body.totalKobo / 100);
      await a.h.app.get(PaymentsService).verifySystem(init.body.paymentId);
      const s = await startOf(p.id);
      expect(s.status).toBe("CANCELLED_DELETED");
      expect(s.creditedMonths).toBe(0);
      expect(await balance(p.id)).toBe(0);
      expect((await subs.runDue(at("2027-06-01"))).credited).toBe(0);
      // the customer's money is flagged for a manual refund, the same flag an overpayment sets
      const row = await prisma().payment.findUniqueOrThrow({
        where: { id: init.body.paymentId },
      });
      expect(row.status).toBe("SUCCEEDED");
      expect(row.overpaidKobo).toBe(init.body.totalKobo);
      expect((row.rawVerify as any).overpay).toMatchObject({
        extraKobo: init.body.totalKobo,
        refundNeeded: true,
      });
      const list = await http()
        .get("/api/v1/admin/payments")
        .set(a.auth("admin"))
        .expect(200);
      const seen = list.body.items.find(
        (x: any) => x.id === init.body.paymentId,
      );
      expect(seen).toMatchObject({
        refundNeeded: true,
        overpaidKobo: init.body.totalKobo,
      });
    });

    it("a purge racing a monthly credit never deadlocks and never credits after it", async () => {
      const p = await person();
      await buy(p, "connect");
      const s = await startOf(p.id);
      const day2 = at(addMonthsClamped(s.startDay, 1));
      await prisma().user.update({
        where: { id: p.id },
        data: { status: "DELETION_PENDING", deletionRequestedAt: new Date() },
      });
      await Promise.all([
        a.h.app.get(DeletionService).purge(p.id, new Date()),
        subs.runDue(day2),
      ]);
      expect(await balance(p.id)).toBe(0);
      expect(
        (await prisma().subscription.findUniqueOrThrow({ where: { id: s.id } }))
          .status,
      ).toBe("CANCELLED_DELETED");
      expect((await subs.runDue(day2)).credited).toBe(0);
    });
  });

  describe("an admin can never change their own balance (V-28)", () => {
    it("the adjust route still refuses an admin's own wallet, with or without a plan credit", async () => {
      const adm = a.people.admin;
      await buy(adm, "connect");
      const before = await balance(adm.id);
      const r = await http()
        .post(`/api/v1/admin/wallets/${adm.id}/adjust`)
        .set(a.auth("admin"))
        .set("Idempotency-Key", randomUUID())
        .send({ deltaMilli: 100, reason: "self" })
        .expect(403);
      expect(r.body.error.message).toMatch(/own balance/);
      expect(await balance(adm.id)).toBe(before);
    });

    it("nothing under src/admin touches subscriptions, and no subscription route takes a person id", () => {
      const walk = (d: string): string[] =>
        readdirSync(d).flatMap((f) => {
          const full = join(d, f);
          return statSync(full).isDirectory() ? walk(full) : [full];
        });
      for (const f of walk(join(__dirname, "../../src/admin")))
        expect(readFileSync(f, "utf8")).not.toMatch(
          /SubscriptionsService|subscriptionCredit|creditMonth/,
        );
      const ctl = readFileSync(
        join(__dirname, "../../src/units/units.controller.ts"),
        "utf8",
      );
      const block = ctl.slice(
        ctl.indexOf('@Get("subscription-plans")'),
        ctl.indexOf('@Get("wallet")'),
      );
      expect(block).not.toMatch(/@Param|@Body|@Query/);
    });
  });

  describe("the migration's rollback refuses while any subscription exists", () => {
    it("rollback.down.sql raises and changes nothing", async () => {
      const p = await person();
      await buy(p, "connect");
      const sql = readFileSync(
        join(
          __dirname,
          "../../prisma/migrations/20261114120000_subscriptions/rollback.down.sql",
        ),
        "utf8",
      );
      const { Client } = await import("pg");
      const c = new Client({ connectionString: TEST_DATABASE_URL });
      await c.connect();
      try {
        await expect(c.query(sql)).rejects.toThrow(/rollback refused/);
        await c.query("ROLLBACK").catch(() => undefined);
        const t = await c.query(
          `SELECT to_regclass('"Subscription"') AS t, (SELECT count(*) FROM "Subscription")::int AS n`,
        );
        expect(t.rows[0].n).toBe(1);
      } finally {
        await c.end();
      }
    });
  });
});
