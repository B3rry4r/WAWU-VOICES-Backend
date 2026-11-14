/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import { bootAdmin, type Admin } from "./helpers";

describe("admin: wallets and payments (money)", () => {
  let a: Admin;
  let n = 0;
  const NIL = "0190a000-0000-7000-8000-000000000abc";
  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("admin", ["ADMIN"]);
    await a.person("admin2", ["ADMIN"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("u1");
    await a.person("u2");
    await a.person("u3");
    await a.person("u4");
  });
  afterAll(() => a.close());

  const adjust = (who: string, userId: string, body: object, key?: string) => {
    const r = a.h
      .http()
      .post(`/api/v1/admin/wallets/${userId}/adjust`)
      .set(a.auth(who));
    if (key !== undefined) r.set("Idempotency-Key", key);
    return r.send(body);
  };
  const bal = async (userId: string) =>
    (await a.prisma.wallet.findUnique({ where: { userId } }))?.balanceMilli ??
    0;
  const entriesSum = async (userId: string) =>
    Number(
      (
        await a.prisma.ledgerEntry.aggregate({
          where: { walletUserId: userId, account: "USER_WALLET" },
          _sum: { deltaMilli: true },
        })
      )._sum.deltaMilli ?? 0,
    );
  const mkPayment = (userId: string) => {
    n++;
    return a.prisma.payment.create({
      data: {
        userId,
        kind: "UNITS",
        amountKobo: 69000,
        unitsMilli: 55000,
        bonusMilli: 5000,
        txRef: `VU-261105-0000${n}`,
        idempotencyKey: `k${n}`,
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
  };

  it("ADMIN only: 401, member 403, moderator 403", async () => {
    const u = a.people.u1.id;
    await a.h.http().get(`/api/v1/admin/wallets/${u}`).expect(401);
    for (const who of ["u1", "mod"]) {
      await a.h
        .http()
        .get(`/api/v1/admin/wallets/${u}`)
        .set(a.auth(who))
        .expect(403);
      await adjust(who, u, { deltaMilli: 100, reason: "x" }, "k").expect(403);
      await a.h
        .http()
        .get("/api/v1/admin/payments")
        .set(a.auth(who))
        .expect(403);
      await a.h
        .http()
        .post(`/api/v1/admin/payments/${NIL}/reverify`)
        .set(a.auth(who))
        .set("Idempotency-Key", "k")
        .expect(403);
    }
  });

  it("adjust: ledger, balance and audit agree in the database; replay returns the first answer; a reason and a key are required; the limit is 1,000 units", async () => {
    const u = a.people.u1.id;
    const w0 = await a.h
      .http()
      .get(`/api/v1/admin/wallets/${u}`)
      .set(a.auth("admin"))
      .expect(200);
    expect(w0.body).toMatchObject({ balanceMilli: 0, freePostsRemaining: 5 });
    expect(w0.body.user.handle).toBe("a7b.u1");
    await adjust("admin", u, { deltaMilli: 500, reason: "x" })
      .expect(400)
      .then((r) => expect(r.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED"));
    for (const body of [
      { deltaMilli: 500 },
      { deltaMilli: 500, reason: "   " },
      { deltaMilli: 1_000_001, reason: "x" },
      { deltaMilli: -1_000_001, reason: "x" },
      { deltaMilli: 1.5, reason: "x" },
      { deltaMilli: "5", reason: "x" },
      { reason: "x" },
    ]) {
      const r = await adjust("admin", u, body, `bad-${Math.random()}`).expect(
        422,
      );
      expect(r.body.error.code).toBe("VALIDATION_FAILED");
    }
    const zero = await adjust(
      "admin",
      u,
      { deltaMilli: 0, reason: "x" },
      "zero",
    ).expect(422);
    expect(zero.body.error.code).toBe("VALIDATION_FAILED");
    expect(await bal(u)).toBe(0);
    const ok = await adjust(
      "admin",
      u,
      { deltaMilli: 1_000_000, reason: "Goodwill after the outage." },
      "adj-1",
    ).expect(201);
    expect(ok.body.balanceMilli).toBe(1_000_000);
    expect(ok.body.ledger[0]).toMatchObject({
      kind: "ADJUSTMENT",
      deltaMilli: 1_000_000,
      balanceAfterMilli: 1_000_000,
      note: "Goodwill after the outage.",
    });
    expect(await bal(u)).toBe(1_000_000);
    expect(await entriesSum(u)).toBe(1_000_000);
    const txn = await a.prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: "ADJUSTMENT", createdById: a.people.admin.id },
      include: { entries: true },
    });
    expect(txn.reason).toBe("Goodwill after the outage.");
    expect(txn.entries.reduce((s, e) => s + e.deltaMilli, 0)).toBe(0);
    const audit = await a.prisma.auditLog.findMany({
      where: { action: "wallet.adjust", targetId: u },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: a.people.admin.id,
      reason: "Goodwill after the outage.",
    });
    const replay = await adjust(
      "admin",
      u,
      { deltaMilli: 1_000_000, reason: "Goodwill after the outage." },
      "adj-1",
    ).expect(201);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(replay.body).toEqual(ok.body);
    expect(await bal(u)).toBe(1_000_000);
    const reused = await adjust(
      "admin",
      u,
      { deltaMilli: 5, reason: "other" },
      "adj-1",
    ).expect(409);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(
      await a.prisma.ledgerTransaction.count({ where: { kind: "ADJUSTMENT" } }),
    ).toBe(1);
  });

  it("an admin can never adjust their own balance (403), and nothing is written", async () => {
    const me = a.people.admin.id;
    const r = await adjust(
      "admin",
      me,
      { deltaMilli: 100, reason: "self" },
      "self-1",
    ).expect(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
    expect(await bal(me)).toBe(0);
    expect(await entriesSum(me)).toBe(0);
  });

  it("cannot take a balance below zero; unknown person is 404", async () => {
    const u = a.people.u2.id;
    await adjust("admin", u, { deltaMilli: 300, reason: "start" }, "z1").expect(
      201,
    );
    const r = await adjust(
      "admin",
      u,
      { deltaMilli: -301, reason: "too much" },
      "z2",
    ).expect(422);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
    expect(await bal(u)).toBe(300);
    await adjust("admin", NIL, { deltaMilli: 5, reason: "x" }, "z3").expect(
      404,
    );
    await a.h
      .http()
      .get(`/api/v1/admin/wallets/${NIL}`)
      .set(a.auth("admin"))
      .expect(404);
    expect(
      await adjust("admin", u, { deltaMilli: -300, reason: "to zero" }, "z4")
        .expect(201)
        .then((x) => x.body.balanceMilli),
    ).toBe(0);
  });

  it("a second admin racing an adjust: both land, balance equals the ledger; racing debits cannot overdraw", async () => {
    const u = a.people.u3.id;
    const r = await Promise.all([
      adjust("admin", u, { deltaMilli: 600, reason: "one" }, "race-a"),
      adjust("admin2", u, { deltaMilli: 600, reason: "two" }, "race-b"),
    ]);
    expect(r.map((x) => x.status)).toEqual([201, 201]);
    expect(await bal(u)).toBe(1200);
    expect(await entriesSum(u)).toBe(1200);
    const d = await Promise.all([
      adjust("admin", u, { deltaMilli: -1000, reason: "d1" }, "race-c"),
      adjust("admin2", u, { deltaMilli: -1000, reason: "d2" }, "race-d"),
    ]);
    expect(d.map((x) => x.status).sort()).toEqual([201, 422]);
    expect(await bal(u)).toBe(200);
    expect(await entriesSum(u)).toBe(200);
    // the same key from two admins at once: one transaction only
    const same = await Promise.all([
      adjust("admin", u, { deltaMilli: 50, reason: "same" }, "race-e"),
      adjust("admin", u, { deltaMilli: 50, reason: "same" }, "race-e"),
    ]);
    expect(same.every((x) => [201, 409].includes(x.status))).toBe(true);
    expect(await bal(u)).toBe(250);
  });

  it("30 parallel adjusts on one wallet keep balance equal to the ledger", async () => {
    const u = a.people.u4.id;
    const rs = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        adjust(
          i % 2 ? "admin" : "admin2",
          u,
          { deltaMilli: 100, reason: `p${i}` },
          `bulk-${i}`,
        ),
      ),
    );
    expect(rs.every((x) => x.status === 201)).toBe(true);
    expect(await bal(u)).toBe(3000);
    expect(await entriesSum(u)).toBe(3000);
  });

  it("payments: list with status filter; an overpay is shown for a hand refund (V-23); reverify credits once, replays, and races the reconcile job", async () => {
    const u = a.people.u1.id;
    const before = await bal(u);
    const p = await mkPayment(u);
    a.flw.pay(p.txRef, 6900); // paid N6,900 on a N690 pack
    const reverify = (id: string, key?: string, who = "admin") => {
      const r = a.h
        .http()
        .post(`/api/v1/admin/payments/${id}/reverify`)
        .set(a.auth(who));
      if (key !== undefined) r.set("Idempotency-Key", key);
      return r;
    };
    await reverify(p.id).expect(400);
    await reverify(NIL, "rv-0").expect(404);
    const ok = await reverify(p.id, "rv-1").expect(200);
    expect(ok.body).toMatchObject({
      status: "SUCCEEDED",
      unitsMilli: 55000,
      amountKobo: 69000,
      balanceMilli: before + 55000,
    });
    expect(await bal(u)).toBe(before + 55000);
    expect(await entriesSum(u)).toBe(await bal(u));
    const list = await a.h
      .http()
      .get("/api/v1/admin/payments?status=SUCCEEDED")
      .set(a.auth("admin"))
      .expect(200);
    const row = list.body.items.find((i: any) => i.id === p.id);
    expect(row).toMatchObject({
      overpaidKobo: 621000,
      refundNeeded: true,
      status: "SUCCEEDED",
    });
    const again = await reverify(p.id, "rv-2").expect(200);
    expect(again.body.status).toBe("SUCCEEDED");
    const replay = await reverify(p.id, "rv-1").expect(200);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(await bal(u)).toBe(before + 55000);
    expect(
      await a.prisma.ledgerTransaction.count({ where: { paymentId: p.id } }),
    ).toBe(1);
    expect(
      await a.prisma.auditLog.count({
        where: { action: "payment.reverify", targetId: p.id },
      }),
    ).toBe(2);
    await a.h
      .http()
      .get("/api/v1/admin/payments?status=NOPE")
      .set(a.auth("admin"))
      .expect(422);
    const exact = await mkPayment(a.people.u2.id);
    a.flw.pay(exact.txRef, 690);
    await reverify(exact.id, "rv-3").expect(200);
    const l2 = await a.h
      .http()
      .get("/api/v1/admin/payments")
      .set(a.auth("admin2"))
      .expect(200);
    expect(l2.body.items.find((i: any) => i.id === exact.id)).toMatchObject({
      overpaidKobo: 0,
      refundNeeded: false,
    });
  });

  it("a reverify racing the reconcile job (and a second reverify) credits one purchase only", async () => {
    const u = a.people.u3.id;
    const before = await bal(u);
    const p = await mkPayment(u);
    a.flw.pay(p.txRef, 690);
    const { ReconcileService } =
      await import("../../src/units/units.reconcile.js");
    const recon = a.h.app.get(ReconcileService);
    const rv = (k: string, who: string) =>
      a.h
        .http()
        .post(`/api/v1/admin/payments/${p.id}/reverify`)
        .set(a.auth(who))
        .set("Idempotency-Key", k);
    const res = await Promise.all([
      rv("race-1", "admin"),
      rv("race-2", "admin2"),
      recon.run(),
      recon.run(),
    ]);
    expect((res[0] as { status: number }).status).toBe(200);
    expect((res[1] as { status: number }).status).toBe(200);
    expect(
      await a.prisma.ledgerTransaction.count({ where: { paymentId: p.id } }),
    ).toBe(1);
    expect(await bal(u)).toBe(before + 55000);
    expect(await entriesSum(u)).toBe(await bal(u));
    expect(
      (await a.prisma.payment.findUniqueOrThrow({ where: { id: p.id } }))
        .status,
    ).toBe("SUCCEEDED");
  });

  it("a payment the provider does not know stays unpaid and credits nothing", async () => {
    const u = a.people.u4.id;
    const before = await bal(u);
    const p = await mkPayment(u);
    const r = await a.h
      .http()
      .post(`/api/v1/admin/payments/${p.id}/reverify`)
      .set(a.auth("admin"))
      .set("Idempotency-Key", "np-1")
      .expect(200);
    expect(r.body.status).not.toBe("SUCCEEDED");
    expect(await bal(u)).toBe(before);
  });
});
