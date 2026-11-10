/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are untyped */
import { randomUUID } from "node:crypto";
import request from "supertest";
import type { App } from "supertest/types";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { PaymentsService } from "../../src/units/units.payments";
import { ReconcileService } from "../../src/units/units.reconcile";
import { UnitsConfig } from "../../src/units/units.config";
import { TokensService } from "../../src/units/units.tokens";
import { UNITS_PORT, type UnitsPortFull } from "../../src/units/units.port";
import { boot, resetDb, type Harness } from "./helpers";

describe("units routes: tiers, wallet, payments, tokens (Flutterwave answers are fixtures)", () => {
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
  /** A paid extra voice token from before the new prices (V-36): extra voice is no longer sold, so the payment row is made directly. */
  const startToken = async (u: U, tokenKind: "SECONDS_30" | "SECONDS_60") => {
    const amountKobo = tokenKind === "SECONDS_30" ? 15000 : 20000;
    const p = await prisma.payment.create({
      data: {
        userId: u.id,
        kind: "EXTRA_VOICE",
        tokenKind,
        amountKobo,
        txRef: `voices-${randomUUID()}`,
        idempotencyKey: key(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    return {
      status: 201,
      body: { paymentId: p.id, txRef: p.txRef, amountKobo, unitsMilli: null },
    };
  };
  const purchaseCount = () =>
    prisma.ledgerTransaction.count({ where: { kind: "PURCHASE" } });

  describe("GET /units/tiers", () => {
    it("is open to guests and prices come from the database and config", async () => {
      const res = await http().get("/api/v1/units/tiers").expect(200);
      expect(res.body.tiers.map((t: { slug: string }) => t.slug)).toEqual([
        "entry",
        "starter",
        "standard",
        "plus",
        "pro",
        "premium",
        "ultimate",
      ]);
      expect(res.body.tiers[2]).toMatchObject({
        name: "Standard",
        priceKobo: 73200,
        unitsMilli: 732000,
        bonusMilli: 0,
        effectiveKoboPerUnit: 100,
        baseKoboPerUnit: 100,
      });
      expect(res.body.minPackKobo).toBe(18300);
      expect(res.body.costs).toMatchObject({
        textPostMilli: 5000,
        voicePostMilli: 78000,
        extraVoice30Kobo: 7800,
        extraVoice60Kobo: 10000,
        textPriceChars: 150,
        messagesPerDay: 20,
        textFixMilli: 5000,
      });
      expect(res.body.extraVoice).toEqual([
        {
          kind: "SECONDS_30",
          maxSeconds: 30,
          priceKobo: 7800,
          label: "Up to 30 sec",
        },
        {
          kind: "SECONDS_60",
          maxSeconds: 60,
          priceKobo: 10000,
          label: "Up to 1 min",
        },
      ]);
      expect(res.body.walletOffer).toBeNull();
      await prisma.configEntry.update({
        where: { key: "voice.extra30.price_kobo" },
        data: { valueJson: 16000 },
      });
      expect(
        (await http().get("/api/v1/units/tiers").expect(200)).body.extraVoice[0]
          .priceKobo,
      ).toBe(16000);
    });
    it("a bad token is still 401", async () => {
      await http()
        .get("/api/v1/units/tiers")
        .set("Authorization", "Bearer nonsense")
        .expect(401);
    });
  });

  describe("POST /payments", () => {
    it("starts a payment: the server fixes the amount, the reference starts with voices-, nothing is credited", async () => {
      const u = await mkUser();
      const t = await tier("standard");
      const res = await startPayment(u, { kind: "UNITS", tierId: t.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        amountKobo: 73200,
        currency: "NGN",
        unitsMilli: 732000,
      });
      expect(res.body.txRef).toMatch(/^voices-[0-9a-f-]{36}$/);
      expect(res.body.checkoutUrl).toContain(res.body.txRef);
      const row = await prisma.payment.findUniqueOrThrow({
        where: { id: res.body.paymentId },
      });
      expect(row).toMatchObject({
        status: "INITIATED",
        amountKobo: 73200,
        unitsMilli: 732000,
        bonusMilli: 0,
        userId: u.id,
        kind: "UNITS",
      });
      expect(row.providerTxId).toBeNull();
      expect(h.flw.inits).toHaveLength(1);
      expect(h.flw.inits[0]).toMatchObject({
        amountNaira: 732,
        currency: "NGN",
        txRef: res.body.txRef,
      });
      expect(h.flw.inits[0].redirectUrl).toBe(
        `https://voices.test/units/done?paymentId=${res.body.paymentId}`,
      );
      expect(await balance(u.id)).toBe(0);
      expect(await purchaseCount()).toBe(0);
    });

    it("the browser cannot send an amount, units, status or user", async () => {
      const u = await mkUser();
      const t = await tier("entry");
      for (const extra of [
        { amountKobo: 1 },
        { unitsMilli: 99999999 },
        { status: "SUCCEEDED" },
        { userId: "x" },
      ]) {
        const res = await startPayment(u, {
          kind: "UNITS",
          tierId: t.id,
          ...extra,
        });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("VALIDATION_FAILED");
      }
      expect(await prisma.payment.count({ where: { userId: u.id } })).toBe(0);
    });

    it("same key and body returns the same payment; another body with that key is 409; no key is 400; guest 401; no profile 403", async () => {
      const u = await mkUser();
      const t = await tier("starter");
      const idem = key();
      const a = await startPayment(u, { kind: "UNITS", tierId: t.id }, idem);
      const b = await startPayment(u, { kind: "UNITS", tierId: t.id }, idem);
      expect(b.status).toBe(201);
      expect(b.body).toEqual(a.body);
      expect(await prisma.payment.count({ where: { userId: u.id } })).toBe(1);
      expect(h.flw.inits).toHaveLength(1);
      const c = await startPayment(
        u,
        { kind: "UNITS", tierId: (await tier("plus")).id },
        idem,
      );
      expect(c.status).toBe(409);
      expect(c.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      const d = await http()
        .post("/api/v1/payments")
        .set(auth(u))
        .send({ kind: "UNITS", tierId: t.id });
      expect(d.status).toBe(400);
      expect(d.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      await http()
        .post("/api/v1/payments")
        .set("Idempotency-Key", key())
        .send({ kind: "UNITS", tierId: t.id })
        .expect(401);
      const ghost = h.jwks.sign({ sub: "no-profile" });
      const e = await http()
        .post("/api/v1/payments")
        .set("Authorization", `Bearer ${ghost}`)
        .set("Idempotency-Key", key())
        .send({ kind: "UNITS", tierId: t.id });
      expect(e.status).toBe(403);
      expect(e.body.error.details.reason).toBe("PROFILE_REQUIRED");
    });

    it("another person using the same key value gets their own payment", async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const t = await tier("entry");
      const idem = key();
      const pa = await startPayment(a, { kind: "UNITS", tierId: t.id }, idem);
      const pb = await startPayment(b, { kind: "UNITS", tierId: t.id }, idem);
      expect(pa.body.paymentId).not.toBe(pb.body.paymentId);
    });

    it("rejects a wrong shape, an unknown pack, a hostile return path", async () => {
      const u = await mkUser();
      const t = await tier("entry");
      expect((await startPayment(u, { kind: "UNITS" })).status).toBe(422);
      expect(
        (
          await startPayment(u, {
            kind: "UNITS",
            tierId: t.id,
            tokenKind: "SECONDS_30",
          })
        ).status,
      ).toBe(422);
      expect((await startPayment(u, { kind: "EXTRA_VOICE" })).status).toBe(422);
      expect(
        (
          await startPayment(u, {
            kind: "EXTRA_VOICE",
            tokenKind: "SECONDS_30",
            tierId: t.id,
          })
        ).status,
      ).toBe(422);
      expect(
        (await startPayment(u, { kind: "UNITS", tierId: "not-a-uuid" })).status,
      ).toBe(422);
      expect(
        (
          await startPayment(u, {
            kind: "UNITS",
            tierId: "01a1ace1-e564-76ca-be6c-365fc42fe4cf",
          })
        ).status,
      ).toBe(404);
      for (const returnPath of [
        "//evil.example",
        "https://evil.example/x",
        "/ok\\evil",
        "javascript:alert(1)",
        "/a b",
      ]) {
        const r = await startPayment(u, {
          kind: "UNITS",
          tierId: t.id,
          returnPath,
        });
        expect(r.status).toBe(422);
      }
      await prisma.unitTier.update({
        where: { id: t.id },
        data: { active: false },
      });
      expect(
        (await startPayment(u, { kind: "UNITS", tierId: t.id })).status,
      ).toBe(404);
      const ok = await startPayment(u, {
        kind: "UNITS",
        tierId: (await tier("starter")).id,
        returnPath: "/record/preview?x=1",
        method: "ussd",
      });
      expect(ok.status).toBe(201);
      expect(h.flw.inits.at(-1)).toMatchObject({
        amountNaira: 366,
        paymentOptions: "ussd",
      });
      expect(h.flw.inits.at(-1)!.redirectUrl).toBe(
        `https://voices.test/record/preview?x=1&paymentId=${ok.body.paymentId}`,
      );
    });

    it("a suspended account cannot start a payment", async () => {
      const u = await mkUser();
      await prisma.user.update({
        where: { id: u.id },
        data: { status: "SUSPENDED" },
      });
      const r = await startPayment(u, {
        kind: "UNITS",
        tierId: (await tier("entry")).id,
      });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("ACCOUNT_SUSPENDED");
    });

    it("Flutterwave down: 503, the payment is FAILED and nothing is credited", async () => {
      const u = await mkUser();
      h.flw.failInit = true;
      const r = await startPayment(u, {
        kind: "UNITS",
        tierId: (await tier("entry")).id,
      });
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("UNAVAILABLE");
      expect((await prisma.payment.findFirstOrThrow()).status).toBe("FAILED");
    });

    it("rate limit: 10 starts per 10 minutes per account, then 429 in the error shape", async () => {
      const u = await mkUser();
      const other = await mkUser();
      const t = await tier("entry");
      for (let i = 0; i < 10; i++)
        expect(
          (await startPayment(u, { kind: "UNITS", tierId: t.id })).status,
        ).toBe(201);
      const r = await startPayment(u, { kind: "UNITS", tierId: t.id });
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe("RATE_LIMITED");
      expect(
        (await startPayment(other, { kind: "UNITS", tierId: t.id })).status,
      ).toBe(201);
    });

    it("every reference starts with voices- and never with a Hub prefix", async () => {
      const u = await mkUser();
      const t = await tier("entry");
      for (let i = 0; i < 3; i++)
        await startPayment(u, { kind: "UNITS", tierId: t.id });
      for (const p of await prisma.payment.findMany()) {
        expect(p.txRef.startsWith("voices-")).toBe(true);
        expect(/^(wawu-|wawu-join-|cac-|wallet:|mock-)/.test(p.txRef)).toBe(
          false,
        );
      }
    });
  });

  describe("POST /payments/{id}/verify", () => {
    it("credits units plus bonus once, writes a balanced ledger transaction, a receipt and a notification", async () => {
      const u = await mkUser();
      const p = await buy(u);
      const tx = h.flw.pay(p.txRef, 732);
      const res = await verify(u, p.paymentId, { providerTxId: String(tx.id) });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "SUCCEEDED",
        unitsMilli: 732000,
        bonusMilli: 0,
        amountKobo: 73200,
        balanceMilli: 732000,
        method: "card",
        cardLast4: "4412",
        title: "Standard pack",
      });
      expect(res.body.receiptNo).toMatch(/^VT-\d{6}-[0-9A-F]{8}$/);
      expect(await balance(u.id)).toBe(732000);
      const txn = await prisma.ledgerTransaction.findFirstOrThrow({
        where: { kind: "PURCHASE" },
        include: { entries: true },
      });
      expect(txn.idempotencyKey).toBe(`payment:${p.paymentId}`);
      expect(txn.entries.reduce((s, e) => s + e.deltaMilli, 0)).toBe(0);
      expect(
        txn.entries.find((e) => e.account === "USER_WALLET"),
      ).toMatchObject({ deltaMilli: 732000, balanceAfterMilli: 732000 });
      expect(txn.entries.find((e) => e.account === "BONUS")).toBeUndefined(); // no bonus tokens (PRICING.md)
      expect(
        txn.entries.find((e) => e.account === "PURCHASES")!.deltaMilli,
      ).toBe(-732000);
      const row = await prisma.payment.findUniqueOrThrow({
        where: { id: p.paymentId },
      });
      expect(row).toMatchObject({
        status: "SUCCEEDED",
        providerTxId: String(tx.id),
      });
      expect(row.verifiedAt).not.toBeNull();
      const note = await prisma.notification.findFirstOrThrow({
        where: { userId: u.id },
      });
      expect(note.type).toBe("UNITS_ADDED");
    });

    it("works with no providerTxId (verify by our reference)", async () => {
      const u = await mkUser();
      const p = await buy(u, "entry");
      h.flw.pay(p.txRef, 183);
      const res = await verify(u, p.paymentId);
      expect(res.body.status).toBe("SUCCEEDED");
      expect(await balance(u.id)).toBe(183000);
    });

    it("replayed verify: same answer, credited once; parallel verifies credit once", async () => {
      const u = await mkUser();
      const p = await buy(u);
      const tx = h.flw.pay(p.txRef, 732);
      const rs = await Promise.all(
        Array.from({ length: 6 }, () =>
          verify(u, p.paymentId, { providerTxId: String(tx.id) }),
        ),
      );
      for (const r of rs) {
        expect(r.status).toBe(200);
        expect(r.body.status).toBe("SUCCEEDED");
      }
      for (let i = 0; i < 3; i++)
        expect((await verify(u, p.paymentId)).status).toBe(200);
      expect(await balance(u.id)).toBe(732000);
      expect(await purchaseCount()).toBe(1);
      expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(
        1,
      );
    });

    it("not paid yet: 409 PAYMENT_NOT_VERIFIED and nothing changes; pending: 200 PENDING; failed: 200 FAILED, then a later success still credits", async () => {
      const u = await mkUser();
      const p = await buy(u);
      const r1 = await verify(u, p.paymentId);
      expect(r1.status).toBe(409);
      expect(r1.body.error.code).toBe("PAYMENT_NOT_VERIFIED");
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } }))
          .status,
      ).toBe("INITIATED");
      h.flw.record(p.txRef, "flw-verify-pending.json");
      const r2 = await verify(u, p.paymentId);
      expect(r2.status).toBe(200);
      expect(r2.body.status).toBe("PENDING");
      h.flw.record(p.txRef, "flw-verify-failed.json");
      const r3 = await verify(u, p.paymentId);
      expect(r3.body).toMatchObject({
        status: "FAILED",
        failureReason: "Declined by the bank",
      });
      expect(await balance(u.id)).toBe(0);
      h.flw.pay(p.txRef, 732);
      const r4 = await verify(u, p.paymentId);
      expect(r4.body.status).toBe("SUCCEEDED");
      expect(await balance(u.id)).toBe(732000);
    });

    it("an expired payment that was never paid is 409 PAYMENT_EXPIRED; a late real payment still credits", async () => {
      const u = await mkUser();
      const p = await buy(u);
      await prisma.payment.update({
        where: { id: p.paymentId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const r = await verify(u, p.paymentId);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("PAYMENT_EXPIRED");
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } }))
          .status,
      ).toBe("EXPIRED");
      h.flw.pay(p.txRef, 732);
      expect((await verify(u, p.paymentId)).body.status).toBe("SUCCEEDED");
      expect(await balance(u.id)).toBe(732000);
    });

    it("amount changed (less, more, fractional kobo) or currency changed: 422, nothing credited", async () => {
      const u = await mkUser();
      for (const over of [
        { amount: 69 },
        { amount: 689.999 },
        { amount: "69" },
        { currency: "USD" },
        { currency: "ngn" },
        { amount: -690 },
      ]) {
        const p = await buy(u);
        h.flw.pay(p.txRef, 732, over);
        const r = await verify(u, p.paymentId);
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe("PAYMENT_AMOUNT_MISMATCH");
        expect(await balance(u.id)).toBe(0);
        expect(
          (
            await prisma.payment.findUniqueOrThrow({
              where: { id: p.paymentId },
            })
          ).status,
        ).not.toBe("SUCCEEDED");
      }
      expect(await purchaseCount()).toBe(0);
    });

    it("a successful transaction with a different tx_ref is not accepted (forged reference or another person's payment)", async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const pa = await buy(a);
      const pb = await buy(b);
      const txA = h.flw.pay(pa.txRef, 732);
      // B points B's payment at A's real transaction id.
      const r = await verify(b, pb.paymentId, { providerTxId: String(txA.id) });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("PAYMENT_NOT_VERIFIED");
      expect(await balance(b.id)).toBe(0);
      // B asks about A's payment id: not found, not even a hint that it exists.
      const r2 = await verify(b, pa.paymentId, {
        providerTxId: String(txA.id),
      });
      expect(r2.status).toBe(404);
      expect(await balance(a.id)).toBe(0);
      // An id Flutterwave does not know at all.
      expect(
        (await verify(b, pb.paymentId, { providerTxId: "123456789" })).status,
      ).toBe(409);
      expect(await purchaseCount()).toBe(0);
      // A can still verify their own, once.
      expect(
        (await verify(a, pa.paymentId, { providerTxId: String(txA.id) })).body
          .status,
      ).toBe("SUCCEEDED");
      expect(await balance(a.id)).toBe(732000);
    });

    it("one provider transaction id cannot pay two payments", async () => {
      const u = await mkUser();
      const p1 = await buy(u, "entry");
      const p2 = await buy(u, "entry");
      const tx = h.flw.pay(p1.txRef, 183);
      expect((await verify(u, p1.paymentId)).body.status).toBe("SUCCEEDED");
      // The provider answers for the second reference with the same transaction id (a replay of one real payment).
      h.flw.byRef.set(p2.txRef, { ...tx, tx_ref: p2.txRef });
      const r = await verify(u, p2.paymentId);
      expect(r.status).toBe(409);
      expect(await balance(u.id)).toBe(183000);
      expect(await purchaseCount()).toBe(1);
    });

    it("a hint id that is not successful does not stop us finding the real payment by reference", async () => {
      const u = await mkUser();
      const p = await buy(u, "entry");
      const failed = h.flw.record(p.txRef, "flw-verify-failed.json", {
        amount: 138,
      });
      h.flw.pay(p.txRef, 183); // a later successful attempt on the same checkout (by reference now returns it)
      const r = await verify(u, p.paymentId, {
        providerTxId: String(failed.id),
      });
      expect(r.body.status).toBe("SUCCEEDED");
    });

    it("rejects a malformed providerTxId and an unknown body field; id that is not a uuid is 404; guest 401; no key 400", async () => {
      const u = await mkUser();
      const p = await buy(u, "entry");
      expect(
        (await verify(u, p.paymentId, { providerTxId: "abc; DROP TABLE" }))
          .status,
      ).toBe(422);
      expect((await verify(u, p.paymentId, { amountKobo: 1 })).status).toBe(
        422,
      );
      expect((await verify(u, "nope")).status).toBe(404);
      await http()
        .post(`/api/v1/payments/${p.paymentId}/verify`)
        .set("Idempotency-Key", key())
        .send({})
        .expect(401);
      expect(
        (
          await http()
            .post(`/api/v1/payments/${p.paymentId}/verify`)
            .set(auth(u))
            .send({})
        ).status,
      ).toBe(400);
    });

    it("rate limit: 11th verify in 10 minutes is 429", async () => {
      const u = await mkUser();
      const p = await buy(u, "entry");
      for (let i = 0; i < 10; i++)
        expect((await verify(u, p.paymentId)).status).toBe(409);
      const r = await verify(u, p.paymentId);
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe("RATE_LIMITED");
    });

    it("a refunded payment is never credited again", async () => {
      const u = await mkUser();
      const p = await buy(u, "entry");
      await prisma.payment.update({
        where: { id: p.paymentId },
        data: { status: "REFUNDED" },
      });
      h.flw.pay(p.txRef, 183);
      const r = await verify(u, p.paymentId);
      expect(r.status).toBe(409);
      expect(await balance(u.id)).toBe(0);
    });
  });

  describe("V-23 overpay and late payments", () => {
    it("overpaid: credits the purchased pack once, records the extra kobo for an admin refund, never more units, no automatic refund", async () => {
      const u = await mkUser();
      const p = await buy(u);
      h.flw.pay(p.txRef, 7320); // paid N6,900 for a N732 pack
      const r = await verify(u, p.paymentId);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        status: "SUCCEEDED",
        unitsMilli: 732000,
        amountKobo: 73200,
      });
      expect(await balance(u.id)).toBe(732000);
      const row = await prisma.payment.findUniqueOrThrow({
        where: { id: p.paymentId },
      });
      expect(row.status).toBe("SUCCEEDED");
      expect(row.overpaidKobo).toBe(658800);
      expect((row.rawVerify as { overpay?: unknown }).overpay).toEqual({
        extraKobo: 658800,
        refundNeeded: true,
      });
      for (let i = 0; i < 3; i++) await verify(u, p.paymentId);
      expect(await balance(u.id)).toBe(732000);
      expect(await purchaseCount()).toBe(1);
      expect(
        await prisma.payment.count({ where: { status: "REFUNDED" } }),
      ).toBe(0);
      expect(h.flw.calls.byId + h.flw.calls.byRef).toBeGreaterThan(0);
    });
    it("overpaid by a fraction of a kobo, or in another currency, is still refused; exact payment records no overpay", async () => {
      const u = await mkUser();
      const p1 = await buy(u, "entry");
      h.flw.pay(p1.txRef, 183.001);
      expect((await verify(u, p1.paymentId)).status).toBe(422);
      const p2 = await buy(u, "entry");
      h.flw.pay(p2.txRef, 200, { currency: "USD" });
      expect((await verify(u, p2.paymentId)).status).toBe(422);
      const p3 = await buy(u, "entry");
      h.flw.pay(p3.txRef, 183);
      await verify(u, p3.paymentId);
      expect(
        (
          await prisma.payment.findUniqueOrThrow({
            where: { id: p3.paymentId },
          })
        ).rawVerify,
      ).not.toHaveProperty("overpay");
      expect(await balance(u.id)).toBe(183000);
    });
    it("reconcile credits an overpaid payment too, and its window is 72 hours (config)", async () => {
      const u = await mkUser();
      const p = await buy(u, "entry");
      const late = await buy(u, "entry");
      const gone = await buy(u, "entry");
      h.flw.pay(p.txRef, 1000);
      h.flw.pay(late.txRef, 183);
      h.flw.pay(gone.txRef, 183);
      await prisma.payment.update({
        where: { id: late.paymentId },
        data: { createdAt: new Date(Date.now() - 71 * 3600_000) },
      });
      await prisma.payment.update({
        where: { id: gone.paymentId },
        data: { createdAt: new Date(Date.now() - 73 * 3600_000) },
      });
      const out = await h.app.get(ReconcileService).run();
      expect(out).toMatchObject({ checked: 2, credited: 2 });
      expect(
        (
          await prisma.payment.findUniqueOrThrow({
            where: { id: gone.paymentId },
          })
        ).status,
      ).toBe("INITIATED");
      expect(await balance(u.id)).toBe(366000);
      await prisma.configEntry.update({
        where: { key: "payment.reconcile_window_hours" },
        data: { valueJson: 100 },
      });
      expect((await h.app.get(ReconcileService).run()).credited).toBe(1);
      expect(await balance(u.id)).toBe(549000);
    });
  });

  describe("abandoned token reservations", () => {
    it("reconcile puts a RESERVED token older than the configured time back to AVAILABLE, once", async () => {
      const u = await mkUser();
      const res = await startToken(u, "SECONDS_30");
      h.flw.pay(res.body.txRef, 150);
      await verify(u, res.body.paymentId);
      const tok = await prisma.extraVoiceToken.findFirstOrThrow();
      const port = h.app.get<UnitsPortFull>(UNITS_PORT);
      await port.reserveToken(u.id, tok.id, "clip-1");
      const rec = h.app.get(ReconcileService);
      await rec.run();
      expect(
        (
          await prisma.extraVoiceToken.findUniqueOrThrow({
            where: { id: tok.id },
          })
        ).status,
      ).toBe("RESERVED");
      await prisma.extraVoiceToken.update({
        where: { id: tok.id },
        data: { reservedAt: new Date(Date.now() - 61 * 60_000) },
      });
      expect(await h.app.get(TokensService).releaseStale()).toBe(1);
      expect(await h.app.get(TokensService).releaseStale()).toBe(0);
      const back = await prisma.extraVoiceToken.findUniqueOrThrow({
        where: { id: tok.id },
      });
      expect(back).toMatchObject({
        status: "AVAILABLE",
        usedOnClipId: null,
        reservedAt: null,
        usedAt: null,
      });
      await port.reserveToken(u.id, tok.id, "clip-2");
      await port.consumeToken(u.id, tok.id, "clip-2");
      await prisma.extraVoiceToken.update({
        where: { id: tok.id },
        data: {
          reservedAt: new Date(Date.now() - 5 * 3600_000),
          usedAt: new Date(Date.now() - 5 * 3600_000),
        },
      });
      await rec.run();
      expect(
        (
          await prisma.extraVoiceToken.findUniqueOrThrow({
            where: { id: tok.id },
          })
        ).status,
      ).toBe("USED");
    });
    it("the time comes from config, and the run path of reconcile does the release", async () => {
      const u = await mkUser();
      const res = await startToken(u, "SECONDS_60");
      h.flw.pay(res.body.txRef, 200);
      await verify(u, res.body.paymentId);
      const tok = await prisma.extraVoiceToken.findFirstOrThrow();
      await h.app
        .get<UnitsPortFull>(UNITS_PORT)
        .reserveToken(u.id, tok.id, "c");
      await prisma.extraVoiceToken.update({
        where: { id: tok.id },
        data: { reservedAt: new Date(Date.now() - 20 * 60_000) },
      });
      await h.app.get(ReconcileService).run();
      expect(
        (
          await prisma.extraVoiceToken.findUniqueOrThrow({
            where: { id: tok.id },
          })
        ).status,
      ).toBe("RESERVED");
      await prisma.configEntry.update({
        where: { key: "voice.token_reserve_expiry_minutes" },
        data: { valueJson: 10 },
      });
      await h.app.get(ReconcileService).run();
      expect(
        (
          await prisma.extraVoiceToken.findUniqueOrThrow({
            where: { id: tok.id },
          })
        ).status,
      ).toBe("AVAILABLE");
    });
  });

  describe("extra voice tokens", () => {
    it("extra voice is not sold any more (V-36): starting one is refused and nothing is made", async () => {
      const u = await mkUser();
      const res = await startPayment(u, {
        kind: "EXTRA_VOICE",
        tokenKind: "SECONDS_30",
      });
      expect(res.status).toBe(422);
      expect(await prisma.payment.count({ where: { userId: u.id } })).toBe(0);
      expect(h.flw.inits).toHaveLength(0);
    });

    it("a token paid for before the new prices still works (naira, not tokens), listed and in the balance", async () => {
      const u = await mkUser();
      const res = await startToken(u, "SECONDS_30");
      expect(res.body).toMatchObject({ amountKobo: 15000, unitsMilli: null });
      h.flw.pay(res.body.txRef, 150);
      const v = await verify(u, res.body.paymentId);
      expect(v.body).toMatchObject({
        status: "SUCCEEDED",
        kind: "EXTRA_VOICE",
        title: "Extra voice, 30 seconds",
        unitsMilli: null,
      });
      expect(v.body.token).toMatchObject({
        kind: "SECONDS_30",
        maxSeconds: 30,
        status: "AVAILABLE",
      });
      expect(await balance(u.id)).toBe(0);
      expect(
        await prisma.ledgerTransaction.count({
          where: { entries: { some: { walletUserId: u.id } } },
        }),
      ).toBe(0);
      expect(
        await prisma.extraVoiceToken.count({ where: { userId: u.id } }),
      ).toBe(1);
      const list = await http()
        .get("/api/v1/extra-voice-tokens")
        .set(auth(u))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      const w = await http().get("/api/v1/wallet").set(auth(u)).expect(200);
      expect(w.body.tokens).toHaveLength(1);
      expect(w.body.allowances.maxVoiceSeconds).toBe(60);
      expect((await verify(u, res.body.paymentId)).status).toBe(200);
      expect(
        await prisma.extraVoiceToken.count({ where: { userId: u.id } }),
      ).toBe(1);
      const e = await prisma.notification.findFirstOrThrow({
        where: { userId: u.id },
      });
      expect(e.type).toBe("EXTRA_VOICE_ADDED");
    });

    it("a token is used once: parallel reserve has one winner, a used token cannot be reserved again, nobody else can touch it", async () => {
      const [u, o] = [await mkUser(), await mkUser()];
      const res = await startToken(u, "SECONDS_60");
      h.flw.pay(res.body.txRef, 200);
      await verify(u, res.body.paymentId);
      const tok = await prisma.extraVoiceToken.findFirstOrThrow();
      expect(tok.maxSeconds).toBe(60);
      const port = h.app.get<UnitsPortFull>(UNITS_PORT);
      const rs = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          port.reserveToken(u.id, tok.id, `clip-${i}`),
        ),
      );
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const winner = (
        await prisma.extraVoiceToken.findUniqueOrThrow({
          where: { id: tok.id },
        })
      ).usedOnClipId!;
      await expect(port.reserveToken(o.id, tok.id, "x")).rejects.toThrow();
      await expect(
        port.consumeToken(u.id, tok.id, "wrong-clip"),
      ).rejects.toThrow();
      await expect(port.consumeToken(o.id, tok.id, winner)).rejects.toThrow();
      await port.releaseToken(u.id, tok.id, winner);
      await port.releaseToken(u.id, tok.id, winner);
      expect(
        (
          await prisma.extraVoiceToken.findUniqueOrThrow({
            where: { id: tok.id },
          })
        ).status,
      ).toBe("AVAILABLE");
      await port.reserveToken(u.id, tok.id, "clip-final");
      await port.consumeToken(u.id, tok.id, "clip-final");
      await expect(
        port.consumeToken(u.id, tok.id, "clip-final"),
      ).rejects.toThrow();
      await expect(
        port.reserveToken(u.id, tok.id, "clip-again"),
      ).rejects.toThrow();
      expect(
        (
          await prisma.extraVoiceToken.findUniqueOrThrow({
            where: { id: tok.id },
          })
        ).status,
      ).toBe("USED");
      expect(
        (
          await http()
            .get("/api/v1/extra-voice-tokens")
            .set(auth(u))
            .expect(200)
        ).body.items,
      ).toHaveLength(0);
    });
  });

  describe("reading", () => {
    it("GET /payments/{id} and the receipt belong to the buyer only; no receipt until verified", async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const p = await buy(a);
      expect(
        (
          await http()
            .get(`/api/v1/payments/${p.paymentId}`)
            .set(auth(a))
            .expect(200)
        ).body,
      ).toMatchObject({
        status: "INITIATED",
        balanceMilli: null,
        receiptNo: null,
      });
      await http()
        .get(`/api/v1/payments/${p.paymentId}`)
        .set(auth(b))
        .expect(404);
      await http().get(`/api/v1/payments/${p.paymentId}`).expect(401);
      expect(
        (
          await http()
            .get(`/api/v1/payments/${p.paymentId}/receipt`)
            .set(auth(a))
        ).body.error.code,
      ).toBe("PAYMENT_NOT_VERIFIED");
      h.flw.pay(p.txRef, 732);
      await verify(a, p.paymentId);
      const r = await http()
        .get(`/api/v1/payments/${p.paymentId}/receipt`)
        .set(auth(a))
        .expect(200);
      expect(r.body).toMatchObject({
        title: "Standard pack",
        amountKobo: 73200,
        unitsMilli: 732000,
        buyerHandle: a.handle,
        cardLast4: "4412",
        method: "card",
        txRef: p.txRef,
      });
      await http()
        .get(`/api/v1/payments/${p.paymentId}/receipt`)
        .set(auth(b))
        .expect(404);
      await http().get(`/api/v1/payments/not-a-uuid`).set(auth(a)).expect(404);
    });

    it("wallet: balance from the ledger, free posts, costs; guest is 401", async () => {
      const u = await mkUser();
      await http().get("/api/v1/wallet").expect(401);
      const w0 = await http().get("/api/v1/wallet").set(auth(u)).expect(200);
      expect(w0.body).toMatchObject({
        balanceMilli: 0,
        freePostsRemaining: 10,
        freePostsUsed: 0,
        tokens: [],
      });
      expect(w0.body.allowances).toMatchObject({
        freeReactionsLeftToday: 20,
        freeVotesLeftToday: 3,
        maxVoiceSeconds: 60,
      });
      const port = h.app.get<UnitsPortFull>(UNITS_PORT);
      await port.charge(u.id, "POST_TEXT", "a");
      await port.charge(u.id, "REACTION", "b");
      const w1 = await http().get("/api/v1/wallet").set(auth(u)).expect(200);
      expect(w1.body).toMatchObject({
        freePostsRemaining: 9,
        freePostsUsed: 1,
      });
      expect(w1.body.allowances.freeReactionsLeftToday).toBe(19);
    });

    it("history: purchases, spends, free posts and token buys, newest first, paged with no repeats, own rows only", async () => {
      const [u, o] = [await mkUser(), await mkUser()];
      const port = h.app.get<UnitsPortFull>(UNITS_PORT);
      await port.charge(u.id, "POST_TEXT", "free-1");
      const p = await buy(u, "starter");
      h.flw.pay(p.txRef, 366);
      await verify(u, p.paymentId);
      const t = await startToken(u, "SECONDS_60");
      h.flw.pay(t.body.txRef, 200);
      await verify(u, t.body.paymentId);
      for (let i = 0; i < 20; i++) await port.charge(u.id, "REACTION", `r${i}`);
      await port.charge(u.id, "REACTION", "paid-r");
      await port.adjustBalance("admin", o.id, 5000, "gift", "o1");
      const all: {
        id: string;
        title: string;
        deltaMilli: number;
        free: boolean;
        freePostsLeft: number | null;
        hasReceipt: boolean;
        amountKobo: number | null;
      }[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const q = cursor ? `?limit=2&cursor=${cursor}` : "?limit=2";
        const page = await http()
          .get(`/api/v1/wallet/history${q}`)
          .set(auth(u))
          .expect(200);
        all.push(...page.body.items);
        cursor = page.body.nextCursor ?? undefined;
        if (!cursor) break;
      }
      expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
      expect(all.map((x) => x.title)).toEqual([
        "Reaction, after free ones",
        "Extra voice, 1 minute",
        "Starter pack",
        "Text answer",
      ]);
      expect(all[0].deltaMilli).toBe(-100);
      expect(all[1]).toMatchObject({
        deltaMilli: 0,
        amountKobo: 20000,
        hasReceipt: true,
      });
      expect(all[2]).toMatchObject({
        deltaMilli: 366000,
        hasReceipt: true,
        amountKobo: 36600,
      });
      expect(all[3]).toMatchObject({
        free: true,
        freePostsLeft: 9,
        deltaMilli: 0,
      });
      const bad = await http()
        .get("/api/v1/wallet/history?limit=0")
        .set(auth(u));
      expect(bad.status).toBe(422);
      expect(
        (await http().get("/api/v1/wallet/history?cursor=zzz").set(auth(u)))
          .status,
      ).toBe(400);
      await http().get("/api/v1/wallet/history").expect(401);
    });

    it("the statement is a CSV of the same history", async () => {
      const u = await mkUser();
      const p = await buy(u, "entry");
      h.flw.pay(p.txRef, 183);
      await verify(u, p.paymentId);
      const res = await http()
        .get("/api/v1/wallet/history/export")
        .set(auth(u))
        .expect(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.text.split("\r\n")[0]).toBe(
        "When (Lagos),What,Tokens,Balance after,Naira,Reference",
      );
      expect(res.text).toContain('"Entry pack","183","183","183"');
      await http().get("/api/v1/wallet/history/export").expect(401);
    });
  });

  describe("webhook: not served (V-21)", () => {
    it("POST /webhooks/flutterwave answers 404 and changes nothing, signed or not", async () => {
      const u = await mkUser();
      const p = await buy(u);
      const tx = h.flw.pay(p.txRef, 732);
      for (const headers of [{}, { "verif-hash": "anything" }]) {
        const r = await http()
          .post("/api/v1/webhooks/flutterwave")
          .set(headers)
          .send({
            event: "charge.completed",
            data: {
              id: tx.id,
              tx_ref: p.txRef,
              status: "successful",
              amount: 690,
              currency: "NGN",
            },
          });
        expect(r.status).toBe(404);
        expect(r.body.error.code).toBe("NOT_FOUND");
      }
      expect(
        (await http().post("/api/webhooks/flutterwave").send({})).status,
      ).toBe(404);
      expect(await balance(u.id)).toBe(0);
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } }))
          .status,
      ).toBe("INITIATED");
    });
  });

  describe("reconcile job", () => {
    it("credits a payment the browser never confirmed, once, however often it runs; ledger equals payments", async () => {
      const u = await mkUser();
      const p = await buy(u);
      const rec = h.app.get(ReconcileService);
      expect(await rec.run()).toMatchObject({ checked: 1, credited: 0 });
      h.flw.pay(p.txRef, 732);
      expect(await rec.run()).toMatchObject({ checked: 1, credited: 1 });
      expect(await rec.run()).toMatchObject({ checked: 0 });
      expect(await balance(u.id)).toBe(732000);
      expect(await purchaseCount()).toBe(1);
      expect(await rec.ledgerCheck()).toEqual({
        paymentsMilli: 732000,
        ledgerMilli: 732000,
        ok: true,
      });
    });

    it("marks an unpaid payment EXPIRED after its time, skips ones older than 72 hours, and never credits a wrong amount", async () => {
      const u = await mkUser();
      const a = await buy(u, "entry");
      const old = await buy(u, "entry");
      const wrong = await buy(u, "entry");
      await prisma.payment.update({
        where: { id: a.paymentId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await prisma.payment.update({
        where: { id: old.paymentId },
        data: { createdAt: new Date(Date.now() - 73 * 3600_000) },
      });
      h.flw.pay(old.txRef, 183);
      h.flw.pay(wrong.txRef, 1);
      const rec = h.app.get(ReconcileService);
      const out = await rec.run();
      expect(out).toMatchObject({ checked: 2, credited: 0 });
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: a.paymentId } }))
          .status,
      ).toBe("EXPIRED");
      expect(
        (
          await prisma.payment.findUniqueOrThrow({
            where: { id: old.paymentId },
          })
        ).status,
      ).toBe("INITIATED");
      expect(await balance(u.id)).toBe(0);
      expect(
        (
          await prisma.payment.findUniqueOrThrow({
            where: { id: wrong.paymentId },
          })
        ).failureReason,
      ).toBe("amount_or_currency_mismatch");
    });

    it("a provider outage on one payment does not stop the pass", async () => {
      const u = await mkUser();
      const a = await buy(u, "entry");
      const b = await buy(u, "entry");
      h.flw.pay(b.txRef, 183);
      const orig = h.flw.verifyByReference.bind(h.flw);
      h.flw.verifyByReference = (ref: string) =>
        ref === a.txRef ? Promise.reject(new Error("boom")) : orig(ref);
      const out = await h.app.get(ReconcileService).run();
      h.flw.verifyByReference = orig;
      expect(out).toMatchObject({ checked: 2, credited: 1, errors: 1 });
    });
  });
});
