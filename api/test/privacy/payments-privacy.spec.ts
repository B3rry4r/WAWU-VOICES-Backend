/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import request from "supertest";
import type { App } from "supertest/types";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import { UnitsConfig } from "../../src/units/units.config";
import { whitelistVerify } from "../../src/units/verify-whitelist";
import { boot, resetDb, type Harness } from "../units/helpers";

const PII = {
  ip: "197.210.64.96",
  device_fingerprint: "62wd23423rq324323qew1",
  narration: "Ada Obi order",
  customer: {
    id: 215604089,
    name: "Ada Obi",
    phone_number: "08012345678",
    email: "ada.private@example.com",
  },
  card: {
    first_6digits: "553188",
    last_4digits: "2950",
    issuer: "MASTERCARD GUARANTY TRUST BANK Mastercard Naira Debit Card",
    country: "NG",
    type: "MASTERCARD",
    expiry: "09/32",
  },
};

describe("privacy fix P1: a stored Flutterwave verify response keeps the whitelist only", () => {
  let h: Harness;
  let prisma: PrismaService;
  beforeAll(async () => {
    h = await boot();
    prisma = h.app.get(PrismaService);
  });
  afterAll(async () => h.close());
  beforeEach(async () => {
    await resetDb(prisma);
    await h.app.get(UnitsConfig).seedDefaults();
    h.flw.reset();
  });
  const http = () => request(h.app.getHttpServer() as App);

  it("verify keeps status, amount, currency, tx_ref, id, charged_amount, created_at, card brand and last 4; nothing personal; the credit is unchanged", async () => {
    const u = await prisma.user.create({
      data: {
        wawuId: "wp1",
        handle: "privacy.one",
        referralCode: "REFP1",
        countryCode: "NG",
      },
    });
    const token = h.jwks.sign({ sub: "wp1", email: "ada.private@example.com" });
    const tier = await prisma.unitTier.findUniqueOrThrow({
      where: { slug: "buzz" },
    });
    const init = await http()
      .post("/api/v1/payments")
      .set({ Authorization: `Bearer ${token}` })
      .set("Idempotency-Key", "p1-init")
      .send({ kind: "UNITS", tierId: tier.id })
      .expect(201);
    // Flutterwave still gets the customer email at checkout.
    expect(h.flw.inits.at(-1)?.customerEmail).toBe("ada.private@example.com");
    const tx = h.flw.pay(init.body.txRef, 690, PII);
    // BEFORE: what the provider returns carries the personal fields.
    expect(JSON.stringify(tx)).toContain("ada.private@example.com");
    await http()
      .post(`/api/v1/payments/${init.body.paymentId}/verify`)
      .set({ Authorization: `Bearer ${token}` })
      .set("Idempotency-Key", "p1-verify")
      .send({})
      .expect(200);
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: init.body.paymentId },
    });
    // AFTER: the stored row.
    expect(row.rawVerify).toEqual({
      init: { checkoutUrl: expect.any(String) },
      verify: {
        status: tx.status,
        amount: 690,
        currency: "NGN",
        tx_ref: init.body.txRef,
        id: tx.id,
        charged_amount: 690,
        created_at: tx.created_at,
        card: { type: "MASTERCARD", last_4digits: "2950" },
      },
    });
    const stored = JSON.stringify(row.rawVerify);
    for (const secret of [
      "ada.private",
      "Ada Obi",
      "197.210.64.96",
      "62wd23423",
      "553188",
      "09/32",
      "MASTERCARD GUARANTY",
      "08012345678",
    ])
      expect(stored).not.toContain(secret);
    expect(row.cardLast4).toBe("2950");
    expect(row.status).toBe("SUCCEEDED");
    const w = await prisma.wallet.findUnique({ where: { userId: u.id } });
    expect(w?.balanceMilli).toBe(55000);
  });

  it("whitelistVerify takes the whole body or just data, drops unknown keys and a card number that is not 4 digits", () => {
    expect(
      whitelistVerify({
        status: "success",
        message: "x",
        data: {
          id: 1,
          status: "successful",
          amount: 5,
          customer: { email: "a@b.c" },
          card: { last_4digits: "12345678", type: "VISA", first_6digits: "1" },
        },
      }),
    ).toEqual({
      id: 1,
      status: "successful",
      amount: 5,
      card: { type: "VISA" },
    });
    expect(whitelistVerify(null)).toEqual({});
    expect(whitelistVerify({ id: "9", ip: "1.1.1.1" })).toEqual({ id: "9" });
  });
});
