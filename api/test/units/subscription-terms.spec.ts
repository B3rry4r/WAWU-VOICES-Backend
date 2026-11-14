/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from "node:crypto";
import { bootAdmin, type Admin } from "../admin/helpers";
import { UnitsConfig } from "../../src/units/units.config";
import { PaymentsService } from "../../src/units/units.payments";
import {
  SubscriptionsService,
  addMonthsClamped,
  lagosDayString,
} from "../../src/units/units.subscriptions";

/** V-45b: a plan's terms are the ones quoted at checkout start, not the plan row as it is when the payment is confirmed. */
describe("subscription terms are fixed at checkout start (V-45b)", () => {
  let a: Admin;
  let subs: SubscriptionsService;
  let n = 0;
  const ids: Record<string, string> = {};
  const at = (day: string) => new Date(`${day}T12:00:00+01:00`);

  beforeAll(async () => {
    a = await bootAdmin();
    subs = a.h.app.get(SubscriptionsService);
    for (const pl of await a.prisma.subscriptionPlan.findMany())
      ids[pl.slug] = pl.id;
  });
  afterAll(() => a.close());
  beforeEach(async () => {
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Subscription","SubscriptionCredit","Payment","LedgerTransaction","Wallet","Notification","ConfigEntry","UnitTier" CASCADE`,
    );
    await a.h.app.get(UnitsConfig).seedDefaults();
    a.h.app.get(PaymentsService).resetLimits();
    a.flw.reset();
  });
  afterEach(async () => {
    // put the seeded plans back whatever a test did to them
    await a.prisma.subscriptionPlan.update({
      where: { slug: "connect" },
      data: { months: 3, monthlyMilli: 500_000, active: true },
    });
    await a.prisma.subscriptionPlan.update({
      where: { slug: "plus" },
      data: { months: 6, monthlyMilli: 600_000, active: true },
    });
  });

  const who = () => a.person(`terms${++n}`);
  type P = Awaited<ReturnType<typeof who>>;
  const bearer = (p: P) => ({ Authorization: `Bearer ${p.token}` });
  const start = (p: P, slug: string) =>
    a.h
      .http()
      .post("/api/v1/payments")
      .set(bearer(p))
      .set("Idempotency-Key", randomUUID())
      .send({ kind: "SUBSCRIPTION", planId: ids[slug] });
  const settle = async (p: P, init: any) => {
    a.flw.pay(init.txRef, init.totalKobo / 100);
    return a.h
      .http()
      .post(`/api/v1/payments/${init.paymentId}/verify`)
      .set(bearer(p))
      .set("Idempotency-Key", randomUUID())
      .send({});
  };
  const bal = async (id: string) =>
    (await a.prisma.wallet.findUnique({ where: { userId: id } }))
      ?.balanceMilli ?? 0;
  const edit = (slug: string, data: object) =>
    a.prisma.subscriptionPlan.update({ where: { slug }, data });

  it("checkout start stores the quoted plan key, months and tokens a month on the payment row", async () => {
    const p = await who();
    const r = await start(p, "connect").expect(201);
    const row = await a.prisma.payment.findUniqueOrThrow({
      where: { id: r.body.paymentId },
    });
    expect([row.planSlug, row.planMonths, row.planMonthlyMilli]).toEqual([
      "connect",
      3,
      500_000,
    ]);
  });

  it("the plan changes (months, tokens, switched off) between start and payment: the buyer gets the quoted terms", async () => {
    const p = await who();
    const init = (await start(p, "connect").expect(201)).body;
    await edit("connect", { months: 12, monthlyMilli: 900_000, active: false });
    const v = await settle(p, init);
    expect(v.status).toBe(200);
    expect(v.body.plan).toMatchObject({ months: 3, monthlyMilli: 500_000 });
    const s = await a.prisma.subscription.findFirstOrThrow({
      where: { userId: p.id },
    });
    expect(s).toMatchObject({ months: 3, monthlyMilli: 500_000 });
    expect(s.endDay).toBe(addMonthsClamped(lagosDayString(), 3));
    expect(await bal(p.id)).toBe(500_000);
  });

  it("an old payment row with no stored terms still completes, from the plan row as before", async () => {
    const p = await who();
    const init = (await start(p, "connect").expect(201)).body;
    await a.prisma.payment.update({
      where: { id: init.paymentId },
      data: { planSlug: null, planMonths: null, planMonthlyMilli: null },
    });
    await edit("connect", { months: 4, monthlyMilli: 550_000 });
    const v = await settle(p, init);
    expect(v.status).toBe(200);
    expect(v.body.plan).toMatchObject({ months: 4, monthlyMilli: 550_000 });
    const s = await a.prisma.subscription.findFirstOrThrow({
      where: { userId: p.id },
    });
    expect(s).toMatchObject({ months: 4, monthlyMilli: 550_000 });
    expect(await bal(p.id)).toBe(550_000);
  });

  it("the monthly job credits the subscription's own figure after the plan row changes", async () => {
    const p = await who();
    await settle(p, (await start(p, "connect").expect(201)).body);
    const s = await a.prisma.subscription.findFirstOrThrow({
      where: { userId: p.id },
    });
    await edit("connect", { months: 1, monthlyMilli: 999_000, active: false });
    const r = await subs.runDue(at(addMonthsClamped(s.startDay, 2)));
    expect(r.credited).toBe(2); // months 2 and 3, not cut to the plan row's 1 month
    expect(await bal(p.id)).toBe(1_500_000);
    const credits = await a.prisma.subscriptionCredit.findMany({
      where: { subscriptionId: s.id },
    });
    expect(credits.map((c) => c.amountMilli)).toEqual([
      500_000, 500_000, 500_000,
    ]);
  });

  it("two plans queued keep their own quoted terms", async () => {
    const p = await who();
    const first = (await start(p, "connect").expect(201)).body;
    const second = (await start(p, "plus").expect(201)).body;
    await edit("connect", { months: 2, monthlyMilli: 111_000 });
    await edit("plus", { months: 2, monthlyMilli: 222_000 });
    await settle(p, first).then((r) => expect(r.status).toBe(200));
    await settle(p, second).then((r) => expect(r.status).toBe(200));
    const rows = await a.prisma.subscription.findMany({
      where: { userId: p.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => [r.status, r.months, r.monthlyMilli])).toEqual([
      ["ACTIVE", 3, 500_000],
      ["QUEUED", 6, 600_000],
    ]);
    expect(rows[1].startDay).toBe(rows[0].endDay);
    await edit("plus", { monthlyMilli: 333_000 });
    await subs.runDue(at(rows[1].startDay));
    const q = await a.prisma.subscription.findUniqueOrThrow({
      where: { id: rows[1].id },
    });
    expect(q).toMatchObject({ status: "ACTIVE", creditedMonths: 1 });
    expect(await bal(p.id)).toBe(500_000 + 1_000_000 + 600_000); // plan 1 months 1 to 3 and plan 2 month 1
  });
});
