/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are untyped */
import request from "supertest";
import type { App } from "supertest/types";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { PaymentsService } from "../../src/units/units.payments";
import { ReconcileService } from "../../src/units/units.reconcile";
import { UnitsConfig } from "../../src/units/units.config";
import { Logger } from "@nestjs/common";
import { boot, resetDb, type Harness } from "./helpers";

describe("WF-1: payment reference (B-L2) and refused underpayments logged once (B-L6)", () => {
  let h: Harness;
  let prisma: PrismaService;
  let n = 0;
  let k = 0;

  beforeAll(async () => {
    h = await boot();
    prisma = h.app.get(PrismaService);
  });
  afterAll(async () => h.close());
  beforeEach(async () => {
    await resetDb(prisma);
    await h.app.get(UnitsConfig).seedDefaults();
    h.app.get(PaymentsService).resetLimits();
    h.flw.reset();
  });

  const http = () => request(h.app.getHttpServer() as App);
  const key = () => `key-${++k}-${Date.now()}`;

  async function mkUser() {
    n++;
    const u = await prisma.user.create({
      data: {
        wawuId: `w${n}`,
        handle: `person${n}`,
        referralCode: `REF${n}`,
        countryCode: "NG",
      },
    });
    return {
      ...u,
      token: h.jwks.sign({ sub: u.wawuId, email: `p${n}@example.com` }),
    };
  }
  type U = Awaited<ReturnType<typeof mkUser>>;
  const auth = (u: U) => ({ Authorization: `Bearer ${u.token}` });
  const tier = (slug: string) =>
    prisma.unitTier.findUniqueOrThrow({ where: { slug } });
  const balance = async (id: string) =>
    (await prisma.wallet.findUnique({ where: { userId: id } }))?.balanceMilli ??
    0;
  const startPayment = async (
    u: U,
    body: Record<string, unknown>,
    idem = key(),
  ) =>
    http()
      .post("/api/v1/payments")
      .set(auth(u))
      .set("Idempotency-Key", idem)
      .send(body);
  const buy = async (u: U, slug = "standard") => {
    const t = await tier(slug);
    const res = await startPayment(u, { kind: "UNITS", tierId: t.id });
    expect(res.status).toBe(201);
    return res.body as { paymentId: string; txRef: string };
  };
  const verify = (u: U, id: string, body: Record<string, unknown> = {}) =>
    http()
      .post(`/api/v1/payments/${id}/verify`)
      .set(auth(u))
      .set("Idempotency-Key", key())
      .send(body);

  it("B-L2: the same VT- reference is on the payment while it is waiting, after it fails, on the receipt and on the success", async () => {
    const u = await mkUser();
    const p = (await buy(u)) as {
      paymentId: string;
      txRef: string;
      reference?: string;
    };
    expect(p.reference).toMatch(/^VT-\d{6}-[0-9A-F]{8}$/);
    const waiting = (
      await http()
        .get(`/api/v1/payments/${p.paymentId}`)
        .set(auth(u))
        .expect(200)
    ).body;
    expect(waiting.reference).toBe(p.reference);
    expect(waiting.receiptNo).toBeNull();
    expect(p.reference).not.toContain("voices-");
    h.flw.pay(p.txRef, 732);
    const done = (await verify(u, p.paymentId)).body;
    expect(done.status).toBe("SUCCEEDED");
    expect(done.reference).toBe(p.reference);
    expect(done.receiptNo).toBe(p.reference);
    const receipt = (
      await http()
        .get(`/api/v1/payments/${p.paymentId}/receipt`)
        .set(auth(u))
        .expect(200)
    ).body;
    expect(receipt.reference).toBe(p.reference);
    expect(receipt.receiptNo).toBe(p.reference);
  });

  it("B-L6: a refused underpayment is logged once as a warning across reconcile ticks, never as an error", async () => {
    const u = await mkUser();
    const p = await buy(u);
    h.flw.pay(p.txRef, 732, { amount: 73 });
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const error = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    try {
      for (let tick = 0; tick < 4; tick++)
        await h.app.get(ReconcileService).run();
      const mismatch = (calls: unknown[][]) =>
        calls.filter((c) =>
          String(c[0]).includes("different amount or currency"),
        );
      expect(mismatch(warn.mock.calls)).toHaveLength(1);
      expect(mismatch(error.mock.calls)).toHaveLength(0);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
    expect(await balance(u.id)).toBe(0);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } }))
        .failureReason,
    ).toBe("amount_or_currency_mismatch");
    // and a late full payment on the same checkout is still credited once
    h.flw.pay(p.txRef, 732);
    expect((await verify(u, p.paymentId)).body.status).toBe("SUCCEEDED");
    expect(await balance(u.id)).toBe(732000);
  });

  it("G6: 20 parallel starts against a limit of 10 let exactly 10 through, and the same key in parallel still makes one payment", async () => {
    const u = await mkUser();
    const t = await tier("entry");
    const rs = await Promise.all(
      Array.from({ length: 20 }, () =>
        startPayment(u, { kind: "UNITS", tierId: t.id }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(10);
    expect(rs.filter((r) => r.status === 429)).toHaveLength(10);
    expect(await prisma.payment.count({ where: { userId: u.id } })).toBe(10);
    // a replay of an accepted key is never counted and never refused, even at the limit
    const first = rs.find((r) => r.status === 201)!;
    const again = await startPayment(
      u,
      { kind: "UNITS", tierId: t.id },
      (
        await prisma.payment.findUniqueOrThrow({
          where: { id: first.body.paymentId },
        })
      ).idempotencyKey,
    );
    expect(again.status).toBe(201);
    expect(again.body.paymentId).toBe(first.body.paymentId);
    const other = await mkUser();
    const same = key();
    const par = await Promise.all(
      Array.from({ length: 8 }, () =>
        startPayment(other, { kind: "UNITS", tierId: t.id }, same),
      ),
    );
    expect(par.every((r) => r.status === 201)).toBe(true);
    expect(await prisma.payment.count({ where: { userId: other.id } })).toBe(1);
  });
});
