/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import type { HttpException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../src/common/prisma/prisma.service";
import {
  countChars,
  textCostMilli,
  tokensLabel,
} from "../../src/units/text-price";
import { lagosDay, nextLagosMidnight } from "../../src/units/units.ledger";
import { UNITS_PORT, type UnitsPortFull } from "../../src/units/units.port";
import {
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/** LCH-10: tokens, the text and voice prices, and the 20 messages a day (docs/launch/PRICING.md). */
describe("LCH-10 token prices and the daily limit", () => {
  describe("the character count and the text price (pure)", () => {
    it("counts one character the same way everywhere: Unicode code points, an emoji is one", () => {
      expect(countChars("")).toBe(0);
      expect(countChars("abc")).toBe(3);
      expect(countChars("😀")).toBe(1);
      expect(countChars("Ọjọ́ dára 🇳🇬")).toBe(12); // O + dot-below, o + dot + acute, spaces, flag = two regional indicators
      expect(countChars("é")).toBe(2);
      expect(countChars("😀".repeat(5000))).toBe(5000);
    });
    it("5 tokens per 150 characters in proportion, rounded to the hundredth of a token", () => {
      const cost = (n: number) => textCostMilli(n, 5000, 150);
      expect(cost(0)).toBe(0);
      expect(cost(1)).toBe(30); // 0.03
      expect(cost(149)).toBe(4970);
      expect(cost(150)).toBe(5000);
      expect(cost(151)).toBe(5030);
      expect(cost(300)).toBe(10000);
      expect(cost(500)).toBe(16670);
      expect(cost(1000)).toBe(33330);
      expect(cost(2000)).toBe(66670);
      expect(cost(3000)).toBe(100000);
      expect(cost(5000)).toBe(166670);
      expect(tokensLabel(16670)).toBe("16.67");
      expect(tokensLabel(5000)).toBe("5");
      expect(tokensLabel(78000)).toBe("78");
      expect(tokensLabel(3330)).toBe("3.33");
      expect(tokensLabel(1464000)).toBe("1,464");
    });
  });

  describe("charging through the real ledger", () => {
    let h: Harness;
    let prisma: PrismaService;
    let port: UnitsPortFull;
    beforeAll(async () => {
      h = await startHarness();
      prisma = h.prisma;
      port = h.app.get<UnitsPortFull>(UNITS_PORT);
    });
    afterAll(() => h.close());

    /** A person with no free posts left and some tokens. */
    const payer = (milli = 900_000) =>
      makePerson(h, { balanceMilli: milli, freePosts: 0 });
    const bal = async (p: Person) =>
      (await prisma.wallet.findUnique({ where: { userId: p.id } }))
        ?.balanceMilli ?? 0;
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
        return null;
      } catch (e) {
        const r = (e as HttpException).getResponse() as { code: string };
        return { status: (e as HttpException).getStatus(), code: r.code };
      }
    };
    const sumWalletEntries = async (p: Person) =>
      Number(
        (
          await prisma.$queryRaw<
            { s: bigint | null }[]
          >`SELECT SUM("deltaMilli") AS s FROM "LedgerEntry" WHERE "walletUserId" = ${p.id}`
        )[0].s ?? 0,
      );

    it("text: 149, 150, 151, 500 and 5,000 characters cost the proportional price; emoji count as one", async () => {
      const p = await payer();
      let before = await bal(p);
      for (const [chars, milli] of [
        [149, 4970],
        [150, 5000],
        [151, 5030],
        [500, 16670],
        [5000, 166670],
      ] as const) {
        const r = await port.charge(p.id, "POST_TEXT", randomUUID(), { chars });
        expect(r.costMilli).toBe(milli);
        expect(await bal(p)).toBe(before - milli);
        before -= milli;
      }
      const e = await port.charge(p.id, "POST_TEXT", randomUUID(), {
        chars: countChars("😀".repeat(150)),
      });
      expect(e.costMilli).toBe(5000);
      expect(await sumWalletEntries(p)).toBe((await bal(p)) - 900_000);
    });

    it("a free post covers up to 500 characters or 10 seconds; longer pays in full and keeps the free post", async () => {
      const p = await makePerson(h, { balanceMilli: 900_000 });
      const short = await port.charge(p.id, "POST_TEXT", randomUUID(), {
        chars: 500,
      });
      expect(short).toMatchObject({ costMilli: 0, usedFreePost: true });
      const long = await port.charge(p.id, "POST_TEXT", randomUUID(), {
        chars: 501,
      });
      expect(long.usedFreePost).toBe(false);
      expect(long.costMilli).toBe(16700);
      const v10 = await port.charge(p.id, "POST_VOICE", randomUUID(), {
        durationMs: 10_000,
      });
      expect(v10).toMatchObject({ costMilli: 0, usedFreePost: true });
      const v11 = await port.charge(p.id, "POST_VOICE", randomUUID(), {
        durationMs: 11_000,
      });
      expect(v11).toMatchObject({ costMilli: 78000, usedFreePost: false });
      const a = await prisma.freeAllowance.findUniqueOrThrow({
        where: { userId: p.id },
      });
      expect(a.freePostsRemaining).toBe(8);
    });

    it("voice: up to 30 seconds is 78 tokens, over 30 and up to 60 is 100, longer than 60 is refused", async () => {
      const p = await payer();
      expect(
        (
          await port.charge(p.id, "POST_VOICE", randomUUID(), {
            durationMs: 1200,
          })
        ).costMilli,
      ).toBe(78000);
      expect(
        (
          await port.charge(p.id, "POST_VOICE", randomUUID(), {
            durationMs: 30_000,
          })
        ).costMilli,
      ).toBe(78000);
      expect(
        (
          await port.charge(p.id, "POST_VOICE", randomUUID(), {
            durationMs: 30_001,
          })
        ).costMilli,
      ).toBe(100000);
      expect(
        (
          await port.charge(p.id, "POST_VOICE", randomUUID(), {
            durationMs: 60_000,
          })
        ).costMilli,
      ).toBe(100000);
      const before = await bal(p);
      expect(
        await code(
          port.charge(p.id, "POST_VOICE", randomUUID(), { durationMs: 61_000 }),
        ),
      ).toEqual({ status: 422, code: "VOICE_TOO_LONG" });
      expect(await bal(p)).toBe(before);
    });

    it("a voice paid for before the new prices (prepaid) is not charged again but still counts toward the day", async () => {
      const p = await payer();
      const r = await port.charge(p.id, "POST_VOICE", randomUUID(), {
        durationMs: 25_000,
        prepaid: true,
      });
      expect(r.costMilli).toBe(0);
      const used = await prisma.usageCounter.findFirstOrThrow({
        where: { userId: p.id, action: "POST_VOICE" },
      });
      expect(used.used).toBe(1);
    });

    it("not enough tokens: 402 and nothing is written (no charge, no daily place used)", async () => {
      const p = await payer(1000);
      expect(
        await code(port.charge(p.id, "POST_TEXT", "poor", { chars: 150 })),
      ).toEqual({ status: 402, code: "FREE_POSTS_EXHAUSTED" });
      expect(await prisma.charge.count({ where: { userId: p.id } })).toBe(0);
      expect(await prisma.usageCounter.count({ where: { userId: p.id } })).toBe(
        0,
      );
    });

    it("20 messages a day: the 20th goes, the 21st is DAILY_LIMIT_REACHED, a reversed one gives its place back", async () => {
      const p = await payer(1_000_000);
      for (let i = 0; i < 19; i++)
        await port.charge(p.id, i % 2 ? "POST_VOICE" : "POST_TEXT", `d${i}`, {
          chars: 10,
          durationMs: 2000,
        });
      const twentieth = await port.charge(p.id, "POST_TEXT", "d19", {
        chars: 10,
      });
      expect(
        await code(port.charge(p.id, "POST_TEXT", "d20", { chars: 10 })),
      ).toEqual({ status: 429, code: "DAILY_LIMIT_REACHED" });
      expect(
        await code(
          port.charge(p.id, "POST_VOICE", "d21", { durationMs: 2000 }),
        ),
      ).toEqual({ status: 429, code: "DAILY_LIMIT_REACHED" });
      const snap = await port.allowances(p.id);
      expect(snap.messagesLeftToday).toBe(0);
      // the same key replays, it is not a new message
      expect(
        (await port.charge(p.id, "POST_TEXT", "d19", { chars: 10 })).chargeId,
      ).toBe(twentieth.chargeId);
      await port.reverse(twentieth.chargeId, "send failed");
      expect((await port.allowances(p.id)).messagesLeftToday).toBe(1);
      expect(
        (await port.charge(p.id, "POST_TEXT", "d22", { chars: 10 })).costMilli,
      ).toBe(330);
      // reading, listening, likes, shares and reactions never count: a reaction still works at the limit
      expect((await port.charge(p.id, "REACTION", "re1")).usedFreeDaily).toBe(
        true,
      );
    });

    it("parallel posts at 19 used: exactly one gets the 20th place, the others get 429 and are never charged", async () => {
      const p = await payer(1_000_000);
      for (let i = 0; i < 19; i++)
        await port.charge(p.id, "POST_TEXT", `p${i}`, { chars: 150 });
      const before = await bal(p);
      const rs = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          port.charge(p.id, "POST_TEXT", `race-${i}`, { chars: 150 }),
        ),
      );
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of rs.filter(
        (x): x is PromiseRejectedResult => x.status === "rejected",
      ))
        expect((r.reason as HttpException).getStatus()).toBe(429);
      expect(await bal(p)).toBe(before - 5000);
      expect(await prisma.charge.count({ where: { userId: p.id } })).toBe(20);
    });

    it("double tap: ten parallel taps with one key are one message, one charge, one place", async () => {
      const p = await payer();
      const before = await bal(p);
      const rs = await Promise.all(
        Array.from({ length: 10 }, () =>
          port.charge(p.id, "POST_TEXT", "tap", { chars: 300 }),
        ),
      );
      expect(new Set(rs.map((r) => r.chargeId)).size).toBe(1);
      expect(await bal(p)).toBe(before - 10000);
      expect((await port.allowances(p.id)).messagesLeftToday).toBe(19);
    });

    it("the day ends at midnight Lagos time: 23:59:59.999 is one day, 00:00:00.000 the next", async () => {
      const lastMoment = new Date("2026-11-10T22:59:59.999Z"); // 23:59:59.999 in Lagos (UTC+1)
      const firstMoment = new Date("2026-11-10T23:00:00.000Z"); // 00:00:00.000 on 11 Nov in Lagos
      expect(lagosDay(lastMoment).toISOString()).toBe(
        "2026-11-10T00:00:00.000Z",
      );
      expect(lagosDay(firstMoment).toISOString()).toBe(
        "2026-11-11T00:00:00.000Z",
      );
      expect(nextLagosMidnight(lastMoment).toISOString()).toBe(
        "2026-11-10T23:00:00.000Z",
      );
      const p = await payer(1_000_000);
      jest.useFakeTimers({
        now: lastMoment,
        doNotFake: [
          "nextTick",
          "setImmediate",
          "clearImmediate",
          "setInterval",
          "clearInterval",
          "setTimeout",
          "clearTimeout",
          "queueMicrotask",
          "hrtime",
          "performance",
        ],
      });
      try {
        for (let i = 0; i < 20; i++)
          await port.charge(p.id, "POST_TEXT", `m${i}`, { chars: 10 });
        expect(
          await code(port.charge(p.id, "POST_TEXT", "late", { chars: 10 })),
        ).toEqual({ status: 429, code: "DAILY_LIMIT_REACHED" });
        jest.setSystemTime(firstMoment);
        expect((await port.allowances(p.id)).messagesLeftToday).toBe(20);
        expect(
          (await port.charge(p.id, "POST_TEXT", "next-day", { chars: 10 }))
            .costMilli,
        ).toBe(330);
      } finally {
        jest.useRealTimers();
      }
    });

    it("books balance after a mix of charges and refunds", async () => {
      const p = await payer(500_000);
      const a = await port.charge(p.id, "POST_TEXT", "b1", { chars: 3000 });
      const b = await port.charge(p.id, "POST_VOICE", "b2", {
        durationMs: 45_000,
      });
      await port.reverse(a.chargeId, "send failed");
      expect(await bal(p)).toBe(500_000 - b.costMilli);
      expect(await sumWalletEntries(p)).toBe(-b.costMilli);
      const z = await prisma.$queryRaw<
        { s: bigint | null }[]
      >`SELECT COALESCE(SUM("deltaMilli"),0) AS s FROM "LedgerEntry"`;
      expect(Number(z[0].s)).toBe(0);
    });
  });

  describe("posting over HTTP", () => {
    let h: Harness;
    let q: { id: string };
    beforeAll(async () => {
      h = await startHarness();
      q = await makeQuestion(h);
    });
    afterAll(() => h.close());
    const answer = (p: Person, body: string, key = idem()) =>
      h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", p.auth)
        .set(key)
        .send({ kind: "TEXT", body });
    const balance = async (p: Person) =>
      (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
        ?.balanceMilli ?? 0;

    it("a 5,000 character answer is accepted and priced by length; 5,001 is refused with nothing charged", async () => {
      const p = await makePerson(h, { balanceMilli: 900_000, freePosts: 0 });
      const ok = await answer(p, "a".repeat(5000)).expect(201);
      expect(ok.body.charge.costMilli).toBe(166670);
      expect(await balance(p)).toBe(900_000 - 166670);
      const long = await answer(p, "a".repeat(5001)).expect(422);
      expect(long.body.error.code).toBe("VALIDATION_FAILED");
      expect(await balance(p)).toBe(900_000 - 166670);
      // 5,000 emoji are 5,000 characters, the same as on the web
      await answer(p, "😀".repeat(5000)).expect(201);
      await answer(p, "😀".repeat(5001)).expect(422);
    });

    it("the 21st message of the day answers 429 DAILY_LIMIT_REACHED in the one error shape, with when it resets", async () => {
      const p = await makePerson(h, { balanceMilli: 900_000, freePosts: 0 });
      await h.prisma.usageCounter.create({
        data: { userId: p.id, day: lagosDay(), action: "POST_TEXT", used: 20 },
      });
      const r = await answer(p, "one more").expect(429);
      expect(r.body.error.code).toBe("DAILY_LIMIT_REACHED");
      expect(r.body.error.message).not.toMatch(/—/);
      expect(r.body.error.details.limit).toBe(20);
      expect(new Date(r.body.error.details.resetsAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
      expect(await balance(p)).toBe(900_000);
    });

    it("a send that fails after the charge is refunded: never charged, and the place is given back", async () => {
      const p = await makePerson(h, { balanceMilli: 900_000, freePosts: 0 });
      // the first transaction is the charge, the second is the answer being written: that one fails
      const orig = h.prisma.$transaction.bind(h.prisma) as unknown as (
        ...a: unknown[]
      ) => Promise<unknown>;
      let n = 0;
      const spy2 = jest
        .spyOn(h.prisma, "$transaction")
        .mockImplementation((...a: unknown[]) => {
          n++;
          if (n === 2) return Promise.reject(new Error("db down"));
          return orig(...a);
        });
      try {
        const r = await answer(p, "this will not save");
        expect(r.status).toBe(500);
      } finally {
        spy2.mockRestore();
      }
      expect(await balance(p)).toBe(900_000);
      const c = await h.prisma.charge.findFirstOrThrow({
        where: { userId: p.id },
      });
      expect(c.status).toBe("REVERSED");
      const used = await h.prisma.usageCounter.findFirst({
        where: { userId: p.id, action: "POST_TEXT" },
      });
      expect(used?.used ?? 0).toBe(0);
    });

    it("cancelled recordings are never charged: asking for an upload costs nothing", async () => {
      const p = await makePerson(h, { balanceMilli: 900_000, freePosts: 0 });
      await h
        .http()
        .post("/api/v1/voice-clips")
        .set("Authorization", p.auth)
        .send({
          purpose: "ANSWER",
          mime: "audio/webm",
          sizeBytes: 90_000,
          durationMs: 45_000,
        })
        .expect(201);
      expect(await balance(p)).toBe(900_000);
      expect(await h.prisma.charge.count({ where: { userId: p.id } })).toBe(0);
    });

    it("an edit cannot make a paid message longer", async () => {
      const p = await makePerson(h, { balanceMilli: 900_000, freePosts: 0 });
      const made = await answer(p, "a".repeat(150)).expect(201);
      const id = made.body.answer.id;
      await h
        .http()
        .patch(`/api/v1/answers/${id}`)
        .set("Authorization", p.auth)
        .send({ body: "a".repeat(151) })
        .expect(422);
      const long = await answer(p, "c".repeat(400)).expect(201);
      await h
        .http()
        .patch(`/api/v1/answers/${long.body.answer.id}`)
        .set("Authorization", p.auth)
        .send({ body: "c".repeat(401) })
        .expect(422);
      await h
        .http()
        .patch(`/api/v1/answers/${id}`)
        .set("Authorization", p.auth)
        .send({ body: "b".repeat(120) })
        .expect(200);
    });

    it("a payment for extra voice cannot be started any more", async () => {
      const p = await makePerson(h);
      const r = await h
        .http()
        .post("/api/v1/payments")
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind: "EXTRA_VOICE", tokenKind: "SECONDS_30" });
      expect(r.status).toBe(422);
    });
  });
});
