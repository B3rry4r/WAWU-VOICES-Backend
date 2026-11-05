/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { readFileSync, readdirSync } from "node:fs";
import { get as httpGet } from "node:http";
import { join } from "node:path";
import {
  Global,
  HttpException,
  INestApplication,
  Module,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { randomUUID } from "node:crypto";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import { UNITS_PORT } from "../../src/units/units.port";
import type { ChargeAction, UnitsPort } from "../../src/units/units.port";
import type { PrismaService } from "../../src/common/prisma/prisma.service";

/**
 * A stand-in for the units module (task A5) that writes the real Charge, UsageCounter and Wallet tables, so the
 * vote tests read money back from the database. It lives only in this test.
 */
function makeUnits(prisma: () => PrismaService): UnitsPort & {
  reverse: (id: string, reason: string) => Promise<{ reversed: boolean }>;
} {
  const day = (): Date => new Date(new Date().toISOString().slice(0, 10));
  return {
    async charge(userId: string, action: ChargeAction, key: string) {
      const p = prisma();
      const had = await p.charge.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      });
      if (had)
        return {
          chargeId: had.id,
          costMilli: had.costMilli,
          usedFreePost: had.usedFreePost,
          usedFreeDaily: had.usedFreeDaily,
        };
      return p.$transaction(async (tx) => {
        const c = await tx.usageCounter.upsert({
          where: { userId_day_action: { userId, day: day(), action } },
          create: { userId, day: day(), action, used: 0 },
          update: {},
        });
        const free = c.used < 3;
        let cost = 0;
        if (free) {
          await tx.usageCounter.update({
            where: { userId_day_action: { userId, day: day(), action } },
            data: { used: { increment: 1 } },
          });
        } else {
          cost = 200;
          const w = await tx.wallet.findUnique({ where: { userId } });
          if ((w?.balanceMilli ?? 0) < cost)
            throw new HttpException(
              {
                code: "INSUFFICIENT_UNITS",
                message: "You need 0.2 unit to vote.",
              },
              402,
            );
          await tx.wallet.update({
            where: { userId },
            data: { balanceMilli: { decrement: cost } },
          });
        }
        const row = await tx.charge.create({
          data: {
            userId,
            action,
            costMilli: cost,
            usedFreeDaily: free,
            idempotencyKey: key,
          },
        });
        return {
          chargeId: row.id,
          costMilli: cost,
          usedFreePost: false,
          usedFreeDaily: free,
        };
      });
    },
    /** Same contract as the units module: undo a committed charge once, safe twice. */
    async reverse(chargeId: string) {
      const p = prisma();
      return p.$transaction(async (tx) => {
        const c = await tx.charge.findUnique({ where: { id: chargeId } });
        if (!c || c.status === "REVERSED") return { reversed: false };
        await tx.charge.update({
          where: { id: chargeId },
          data: { status: "REVERSED", reversedAt: new Date() },
        });
        if (c.costMilli > 0)
          await tx.wallet.update({
            where: { userId: c.userId },
            data: { balanceMilli: { increment: c.costMilli } },
          });
        if (c.usedFreeDaily)
          await tx.usageCounter.update({
            where: {
              userId_day_action: {
                userId: c.userId,
                day: day(),
                action: c.action,
              },
            },
            data: { used: { decrement: 1 } },
          });
        return { reversed: true };
      });
    },
    async freeLeft(userId: string, action: ChargeAction) {
      const p = prisma();
      const c = await p.usageCounter.findUnique({
        where: { userId_day_action: { userId, day: day(), action } },
      });
      const w = await p.wallet.findUnique({ where: { userId } });
      return {
        freeLeft: Math.max(0, 3 - (c?.used ?? 0)),
        balanceMilli: w?.balanceMilli ?? 0,
      };
    },
  };
}

describe("A4 VOTE", () => {
  const jwks = new TestJwks();
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: { getJson: (k: string) => Promise<unknown> };
  const http = () => request(app.getHttpServer() as App);
  const seq = { n: 0 };

  beforeAll(async () => {
    await jwks.start();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
    process.env.WAWU_ID_JWKS_URL = jwks.url;
    process.env.REDIS_URL =
      process.env.REDIS_URL ?? "redis://127.0.0.1:14002/4";
    process.env.THROTTLE_LIMIT = "100000";
    const { AppModule } = await import("../../src/app.module.js");
    const { configureApp } = await import("../../src/app-config.js");
    const { PrismaService: P } =
      await import("../../src/common/prisma/prisma.service.js");
    const { RedisCache } = await import("../../src/vote/redis-cache.js");

    @Global()
    @Module({
      providers: [
        { provide: UNITS_PORT, useFactory: () => makeUnits(() => prisma) },
      ],
      exports: [UNITS_PORT],
    })
    class FakeUnitsModule {}

    const mod = await Test.createTestingModule({
      imports: [AppModule, FakeUnitsModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(P);
    redis = app.get(RedisCache, { strict: false });
    await prisma.$executeRawUnsafe(
      `TRUNCATE "User","Topic","Question","Poll","Proposal","IdempotencyRecord","Charge","UsageCounter","Wallet" CASCADE`,
    );
  });

  afterAll(async () => {
    await app?.close();
    await jwks.stop();
  });

  const bearer = (sub: string): string =>
    `Bearer ${jwks.sign({ sub, email: `${sub}@x.test` })}`;

  async function newUser(
    over: { balanceMilli?: number; status?: "SUSPENDED" } = {},
  ) {
    const n = ++seq.n;
    const wawuId = `wawu-${randomUUID()}`;
    const user = await prisma.user.create({
      data: {
        wawuId,
        phoneHash: `phone-${randomUUID()}`,
        handle: `u${n}${Date.now().toString(36)}`.slice(0, 20),
        referralCode: randomUUID().slice(0, 8),
        ...(over.status ? { status: over.status } : {}),
      },
    });
    if (over.balanceMilli !== undefined)
      await prisma.wallet.create({
        data: { userId: user.id, balanceMilli: over.balanceMilli },
      });
    return { user, auth: bearer(wawuId), wawuId };
  }

  let weekNo = 100;
  async function newWeek() {
    weekNo += 1;
    const topic = await prisma.topic.create({
      data: {
        weekNumber: weekNo,
        title: `Week ${weekNo}`,
        startsOn: new Date("2026-11-16"),
        endsOn: new Date("2026-11-22"),
        status: "LIVE",
        whatNextPrompt: "What next?",
      },
    });
    const question = await prisma.question.create({
      data: {
        topicId: topic.id,
        text: `Question ${weekNo}`,
        status: "LIVE",
        slotIndex: 1,
      },
    });
    return { topic, question };
  }

  async function newPoll(
    topicId: string,
    over: Record<string, unknown> = {},
    opts = 4,
  ) {
    const poll = await prisma.poll.create({
      data: {
        topicId,
        kind: "WEEKLY",
        title: "Which is it?",
        status: "OPEN",
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
        ...over,
        options: {
          create: Array.from({ length: opts }, (_, i) => ({
            label: `Option ${i + 1}`,
            sortOrder: i,
          })),
        },
      } as never,
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    return poll;
  }

  const castVote = (
    pollId: string,
    auth: string,
    optionIds: string[],
    key = randomUUID(),
  ) =>
    http()
      .post(`/api/v1/polls/${pollId}/votes`)
      .set("Authorization", auth)
      .set("Idempotency-Key", key)
      .send({ optionIds });

  describe("polls, reads", () => {
    it("serves a poll to a guest with the label Open poll and no myVote", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const res = await http().get(`/api/v1/polls/${poll.id}`).expect(200);
      expect(res.body).toMatchObject({
        id: poll.id,
        label: "Open poll",
        status: "OPEN",
        myVote: null,
        costToVoteMilli: 200,
      });
      expect(res.body.options).toHaveLength(4);
    });

    it("404 for an unknown poll and for an id that is not a uuid", async () => {
      await http().get(`/api/v1/polls/${randomUUID()}`).expect(404);
      const res = await http().get(`/api/v1/polls/nope`).expect(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("a bad token is 401 even on a guest route", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      await http()
        .get(`/api/v1/polls/${poll.id}`)
        .set("Authorization", "Bearer junk")
        .expect(401);
    });

    it("lists flash polls and the current one", async () => {
      const { topic } = await newWeek();
      const flash = await newPoll(
        topic.id,
        { kind: "FLASH", title: "Flash" },
        2,
      );
      const list = await http().get("/api/v1/polls/flash").expect(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).toContain(
        flash.id,
      );
      const cur = await http().get("/api/v1/polls/current").expect(200);
      expect(cur.body.kind).toBe("FLASH");
    });
  });

  describe("castVote", () => {
    it("401 as a guest, 403 PROFILE_REQUIRED with no profile, 403 ACCOUNT_SUSPENDED", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const opt = poll.options[0].id;
      await http()
        .post(`/api/v1/polls/${poll.id}/votes`)
        .set("Idempotency-Key", randomUUID())
        .send({ optionIds: [opt] })
        .expect(401);
      const ghost = await castVote(poll.id, bearer("no-profile"), [opt]).expect(
        403,
      );
      expect(ghost.body.error.code).toBe("FORBIDDEN");
      expect(ghost.body.error.details.reason).toBe("PROFILE_REQUIRED");
      const sus = await newUser({ status: "SUSPENDED" });
      const r = await castVote(poll.id, sus.auth, [opt]).expect(403);
      expect(r.body.error.code).toBe("ACCOUNT_SUSPENDED");
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0);
    });

    it("records one vote, moves the stored counters and charges a free vote", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const u = await newUser();
      const res = await castVote(poll.id, u.auth, [poll.options[1].id]).expect(
        201,
      );
      expect(res.body.vote.optionIds).toEqual([poll.options[1].id]);
      expect(res.body.charge).toMatchObject({
        costMilli: 0,
        usedFreeDaily: true,
        balanceMilli: 0,
      });
      expect(res.body.results.totalVotes).toBe(1);
      expect(res.body.results.leadingOptionId).toBe(poll.options[1].id);
      // read back from the database, not from the response
      const votes = await prisma.vote.findMany({
        where: { pollId: poll.id },
        include: { choices: true },
      });
      expect(votes).toHaveLength(1);
      expect(votes[0].choices.map((c) => c.optionId)).toEqual([
        poll.options[1].id,
      ]);
      expect(votes[0].chargeId).toBeTruthy();
      const opts = await prisma.pollOption.findMany({
        where: { pollId: poll.id },
        orderBy: { sortOrder: "asc" },
      });
      expect(opts.map((o) => o.voteCount)).toEqual([0, 1, 0, 0]);
      expect(
        (await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } }))
          .totalVotes,
      ).toBe(1);
      const mine = await http()
        .get(`/api/v1/polls/${poll.id}`)
        .set("Authorization", u.auth)
        .expect(200);
      expect(mine.body.myVote).toEqual([poll.options[1].id]);
    });

    it("needs an Idempotency-Key; replays the first answer; refuses the key with another body", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const u = await newUser();
      const noKey = await http()
        .post(`/api/v1/polls/${poll.id}/votes`)
        .set("Authorization", u.auth)
        .send({ optionIds: [poll.options[0].id] })
        .expect(400);
      expect(noKey.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      const key = randomUUID();
      const a = await castVote(
        poll.id,
        u.auth,
        [poll.options[0].id],
        key,
      ).expect(201);
      const b = await castVote(
        poll.id,
        u.auth,
        [poll.options[0].id],
        key,
      ).expect(201);
      expect(b.headers["idempotent-replay"]).toBe("true");
      expect(b.body.vote.id).toBe(a.body.vote.id);
      const c = await castVote(
        poll.id,
        u.auth,
        [poll.options[2].id],
        key,
      ).expect(409);
      expect(c.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1);
      expect(await prisma.charge.count({ where: { userId: u.user.id } })).toBe(
        1,
      );
    });

    it("ATTACK: ten parallel votes by one account leave exactly one vote and one charge", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const u = await newUser();
      const res = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          castVote(poll.id, u.auth, [poll.options[i % 4].id]),
        ),
      );
      const codes = res.map((r) => r.status).sort();
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(9);
      for (const r of res.filter((r) => r.status === 409))
        expect(r.body.error.code).toBe("ALREADY_VOTED");
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1);
      expect(
        await prisma.voteChoice.count({ where: { vote: { pollId: poll.id } } }),
      ).toBe(1);
      expect(await prisma.charge.count({ where: { userId: u.user.id } })).toBe(
        1,
      );
      const opts = await prisma.pollOption.findMany({
        where: { pollId: poll.id },
      });
      expect(opts.reduce((n, o) => n + o.voteCount, 0)).toBe(1);
      expect(
        (await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } }))
          .totalVotes,
      ).toBe(1);
    });

    it("ATTACK: parallel votes with the same key make one vote", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const u = await newUser();
      const key = randomUUID();
      const res = await Promise.all(
        Array.from({ length: 6 }, () =>
          castVote(poll.id, u.auth, [poll.options[0].id], key),
        ),
      );
      for (const r of res) expect([201, 409]).toContain(r.status);
      expect(res.some((r) => r.status === 201)).toBe(true);
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1);
      expect(await prisma.charge.count({ where: { userId: u.user.id } })).toBe(
        1,
      );
    });

    it("ATTACK: a second account holding the same phone hash cannot vote again", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const a = await newUser();
      const c = await newUser();
      await castVote(poll.id, a.auth, [poll.options[0].id]).expect(201);
      const aVote = await prisma.vote.findFirstOrThrow({
        where: { pollId: poll.id, userId: a.user.id },
      });
      await prisma.user.update({
        where: { id: a.user.id },
        data: { phoneHash: `moved-${randomUUID()}` },
      });
      await prisma.user.update({
        where: { id: c.user.id },
        data: { phoneHash: aVote.phoneHash },
      });
      const vc = await castVote(poll.id, c.auth, [poll.options[0].id]).expect(
        409,
      );
      expect(vc.body.error.code).toBe("ALREADY_VOTED");
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(1);
      expect(await prisma.charge.count({ where: { userId: c.user.id } })).toBe(
        0,
      );
    });

    it("ATTACK: vote after close, before open, and on another week's poll", async () => {
      const w1 = await newWeek();
      const w2 = await newWeek();
      const w3 = await newWeek();
      const current = await newPoll(w2.topic.id);
      const past = await newPoll(w1.topic.id, {
        status: "CLOSED",
        startsAt: new Date(Date.now() - 7 * 86_400_000),
        endsAt: new Date(Date.now() - 3_600_000),
      });
      const lapsed = await newPoll(w1.topic.id, {
        endsAt: new Date(Date.now() - 1000),
      });
      const future = await newPoll(w3.topic.id, {
        status: "SCHEDULED",
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 8 * 86_400_000),
      });
      const u = await newUser();
      const r1 = await castVote(past.id, u.auth, [past.options[0].id]).expect(
        409,
      );
      expect(r1.body.error.code).toBe("POLL_CLOSED");
      const r2 = await castVote(lapsed.id, u.auth, [
        lapsed.options[0].id,
      ]).expect(409);
      expect(r2.body.error.code).toBe("POLL_CLOSED");
      const r3 = await castVote(future.id, u.auth, [
        future.options[0].id,
      ]).expect(409);
      expect(r3.body.error.code).toBe("POLL_NOT_STARTED");
      // an option of another week's poll is not an option of this one
      const r4 = await castVote(current.id, u.auth, [
        past.options[0].id,
      ]).expect(422);
      expect(r4.body.error.code).toBe("VALIDATION_FAILED");
      expect(await prisma.vote.count({ where: { userId: u.user.id } })).toBe(0);
      expect(await prisma.charge.count({ where: { userId: u.user.id } })).toBe(
        0,
      );
      const po = await prisma.pollOption.findMany({
        where: { pollId: { in: [past.id, lapsed.id, future.id, current.id] } },
      });
      expect(po.every((o) => o.voteCount === 0)).toBe(true);
    });

    it("checks the choice mode and the options", async () => {
      const { topic } = await newWeek();
      const single = await newPoll(topic.id);
      const multi = await newPoll(topic.id, { choiceMode: "MULTIPLE" });
      const u = await newUser();
      const two = await castVote(single.id, u.auth, [
        single.options[0].id,
        single.options[1].id,
      ]).expect(422);
      expect(two.body.error.details.fields[0].path).toBe("optionIds");
      await castVote(single.id, u.auth, []).expect(422);
      await castVote(single.id, u.auth, ["not-a-uuid"]).expect(422);
      await castVote(single.id, u.auth, [randomUUID()]).expect(422);
      const ok = await castVote(multi.id, u.auth, [
        multi.options[0].id,
        multi.options[3].id,
      ]).expect(201);
      expect(ok.body.vote.optionIds).toHaveLength(2);
      const opts = await prisma.pollOption.findMany({
        where: { pollId: multi.id },
        orderBy: { sortOrder: "asc" },
      });
      expect(opts.map((o) => o.voteCount)).toEqual([1, 0, 0, 1]);
      expect(
        (await prisma.poll.findUniqueOrThrow({ where: { id: multi.id } }))
          .totalVotes,
      ).toBe(1);
      await http()
        .post(`/api/v1/polls/${randomUUID()}/votes`)
        .set("Authorization", u.auth)
        .set("Idempotency-Key", randomUUID())
        .send({ optionIds: [randomUUID()] })
        .expect(404);
    });

    it("3 free votes a day, then 0.2 unit from the wallet, 402 when it is empty; public-interest is free", async () => {
      const u = await newUser({ balanceMilli: 200 });
      const paid: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { topic } = await newWeek();
        const p = await newPoll(topic.id);
        paid.push(p.id);
        const r = await castVote(p.id, u.auth, [p.options[0].id]).expect(201);
        expect(r.body.charge.costMilli).toBe(0);
      }
      const { topic } = await newWeek();
      const fourth = await newPoll(topic.id);
      const r4 = await castVote(fourth.id, u.auth, [
        fourth.options[0].id,
      ]).expect(201);
      expect(r4.body.charge).toMatchObject({
        costMilli: 200,
        usedFreeDaily: false,
        balanceMilli: 0,
      });
      expect(
        (
          await prisma.wallet.findUniqueOrThrow({
            where: { userId: u.user.id },
          })
        ).balanceMilli,
      ).toBe(0);
      const fifth = await newPoll(topic.id);
      const r5 = await castVote(fifth.id, u.auth, [fifth.options[0].id]).expect(
        402,
      );
      expect(r5.body.error.code).toBe("INSUFFICIENT_UNITS");
      expect(await prisma.vote.count({ where: { pollId: fifth.id } })).toBe(0);
      const pi = await newPoll(topic.id, { publicInterest: true });
      const rp = await castVote(pi.id, u.auth, [pi.options[0].id]).expect(201);
      expect(rp.body.charge.costMilli).toBe(0);
      expect(
        (await prisma.vote.findFirstOrThrow({ where: { pollId: pi.id } }))
          .chargeId,
      ).toBeNull();
      const shown = await http().get(`/api/v1/polls/${pi.id}`).expect(200);
      expect(shown.body.costToVoteMilli).toBe(0);
    });

    it("REFUND: a failure after the charge restores the balance and leaves one reversal", async () => {
      const u = await newUser({ balanceMilli: 200 });
      await prisma.usageCounter.create({
        data: {
          userId: u.user.id,
          day: new Date(new Date().toISOString().slice(0, 10)),
          action: "VOTE",
          used: 3,
        },
      });
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const original = prisma.$transaction.bind(prisma);
      const spy = jest
        .spyOn(prisma, "$transaction")
        .mockImplementation(((fn: unknown, opts?: unknown) =>
          String(fn).includes("pg_advisory_xact_lock")
            ? Promise.reject(new Error("forced failure after charge"))
            : (original as (a: unknown, b?: unknown) => unknown)(
                fn,
                opts,
              )) as never);
      let res;
      try {
        res = await castVote(poll.id, u.auth, [poll.options[0].id]);
      } finally {
        spy.mockRestore();
      }
      expect(res.status).toBe(500);
      expect(await prisma.vote.count({ where: { pollId: poll.id } })).toBe(0);
      const charges = await prisma.charge.findMany({
        where: { userId: u.user.id },
      });
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({ costMilli: 200, status: "REVERSED" });
      expect(
        (
          await prisma.wallet.findUniqueOrThrow({
            where: { userId: u.user.id },
          })
        ).balanceMilli,
      ).toBe(200);
      // a free vote that fails restores the daily free use
      const f = await newUser();
      const p2 = await newPoll(topic.id);
      const spy2 = jest
        .spyOn(prisma, "$transaction")
        .mockImplementation(((fn: unknown, opts?: unknown) =>
          String(fn).includes("pg_advisory_xact_lock")
            ? Promise.reject(new Error("forced failure after charge"))
            : (original as (a: unknown, b?: unknown) => unknown)(
                fn,
                opts,
              )) as never);
      try {
        await castVote(p2.id, f.auth, [p2.options[0].id]).expect(500);
      } finally {
        spy2.mockRestore();
      }
      const uc = await prisma.usageCounter.findFirst({
        where: { userId: f.user.id, action: "VOTE" },
      });
      expect(uc?.used ?? 0).toBe(0);
      expect(
        await prisma.charge.count({
          where: { userId: f.user.id, status: "REVERSED" },
        }),
      ).toBe(1);
      // the person can still vote afterwards
      await castVote(p2.id, f.auth, [p2.options[0].id]).expect(201);
    });

    it("LOAD: 30 people vote at once on a paid poll: no 500s, every charge has a vote", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const today = new Date(new Date().toISOString().slice(0, 10));
      const users = await Promise.all(
        Array.from({ length: 30 }, () => newUser({ balanceMilli: 1000 })),
      );
      await prisma.usageCounter.createMany({
        data: users.map((u) => ({
          userId: u.user.id,
          day: today,
          action: "VOTE" as const,
          used: 3,
        })),
      });
      const res = await Promise.all(
        users.map((u, i) =>
          castVote(poll.id, u.auth, [poll.options[i % 4].id]),
        ),
      );
      expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(res.map((r) => r.status)).toEqual(Array(30).fill(201));
      const ids = users.map((u) => u.user.id);
      const votes = await prisma.vote.count({ where: { pollId: poll.id } });
      const charges = await prisma.charge.count({
        where: { userId: { in: ids }, status: "COMMITTED" },
      });
      const reversed = await prisma.charge.count({
        where: { userId: { in: ids }, status: "REVERSED" },
      });
      expect(votes).toBe(30);
      expect(votes).toBe(charges);
      expect(reversed).toBe(0);
      const wallets = await prisma.wallet.findMany({
        where: { userId: { in: ids } },
      });
      expect(wallets.every((w) => w.balanceMilli === 800)).toBe(true);
      expect(
        (await prisma.poll.findUniqueOrThrow({ where: { id: poll.id } }))
          .totalVotes,
      ).toBe(30);
    }, 60_000);

    it("LOAD: 20 parallel votes by one person with distinct keys: one vote, one net charge", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const u = await newUser({ balanceMilli: 5000 });
      await prisma.usageCounter.create({
        data: {
          userId: u.user.id,
          day: new Date(new Date().toISOString().slice(0, 10)),
          action: "VOTE",
          used: 3,
        },
      });
      const res = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          castVote(poll.id, u.auth, [poll.options[i % 4].id]),
        ),
      );
      expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      for (const r of res.filter((r) => r.status !== 201))
        expect(r.body.error.code).toBe("ALREADY_VOTED");
      const votes = await prisma.vote.count({ where: { pollId: poll.id } });
      const committed = await prisma.charge.count({
        where: { userId: u.user.id, status: "COMMITTED" },
      });
      expect(votes).toBe(1);
      expect(committed).toBe(votes);
      expect(
        (
          await prisma.wallet.findUniqueOrThrow({
            where: { userId: u.user.id },
          })
        ).balanceMilli,
      ).toBe(4800);
    }, 60_000);

    it("costToVoteMilli shows the real free-left count without the units module", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const u = await newUser();
      const { Views } = await import("../../src/vote/views.js");
      const { VoteConfig } = await import("../../src/vote/vote-config.js");
      const bare = new Views(prisma, new VoteConfig(prisma));
      expect(await bare.freeLeft(u.user.id, "VOTE")).toBe(3);
      await castVote(poll.id, u.auth, [poll.options[0].id]).expect(201);
      expect(await bare.freeLeft(u.user.id, "VOTE")).toBe(2);
    });

    it("answers 429 over the vote limit, with Retry-After", async () => {
      await prisma.configEntry.upsert({
        where: { key: "ratelimit.vote_per_min" },
        create: { key: "ratelimit.vote_per_min", valueJson: 2 },
        update: { valueJson: 2 },
      });
      await new Promise((r) => setTimeout(r, 5200)); // the config reader caches for 5 seconds
      try {
        const { topic } = await newWeek();
        const p = await newPoll(topic.id);
        const u = await newUser();
        const bad = [randomUUID()];
        await castVote(p.id, u.auth, bad).expect(422);
        await castVote(p.id, u.auth, bad).expect(422);
        const third = await castVote(p.id, u.auth, bad).expect(429);
        expect(third.body.error.code).toBe("RATE_LIMITED");
        expect(third.headers["retry-after"]).toBeTruthy();
        expect(third.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
        expect(third.headers["ratelimit-limit"]).toBe("2");
      } finally {
        await prisma.configEntry.delete({
          where: { key: "ratelimit.vote_per_min" },
        });
        await new Promise((r) => setTimeout(r, 5200));
      }
    }, 30_000);
  });

  describe("live results", () => {
    it("hides counts until the person has voted when the poll does not show live results", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id, { showLiveResults: false });
      const u = await newUser();
      const hidden = await http()
        .get(`/api/v1/polls/${poll.id}/results`)
        .expect(403);
      expect(hidden.body.error.code).toBe("FORBIDDEN");
      const view = await http().get(`/api/v1/polls/${poll.id}`).expect(200);
      expect(view.body.options[0]).not.toHaveProperty("votes");
      await castVote(poll.id, u.auth, [poll.options[0].id]).expect(201);
      const mine = await http()
        .get(`/api/v1/polls/${poll.id}/results`)
        .set("Authorization", u.auth)
        .expect(200);
      expect(mine.body.totalVotes).toBe(1);
      expect(mine.body.options[0]).toMatchObject({ votes: 1, percent: 100 });
      await http().get(`/api/v1/polls/${poll.id}/results`).expect(403);
      await prisma.poll.update({
        where: { id: poll.id },
        data: { status: "CLOSED" },
      });
      await redis.getJson("x"); // keep the client warm
      await new Promise((r) => setTimeout(r, 3200));
      await http().get(`/api/v1/polls/${poll.id}/results`).expect(200);
    }, 20_000);

    it("serves a guest the live counts, cached in Redis, and a vote refreshes them", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      const first = await http()
        .get(`/api/v1/polls/${poll.id}/results`)
        .expect(200);
      expect(first.body.totalVotes).toBe(0);
      expect(first.body.leadingOptionId).toBeNull();
      expect(first.headers["cache-control"]).toContain("max-age=5");
      expect(await redis.getJson(`vote:results:${poll.id}`)).toMatchObject({
        id: poll.id,
        totalVotes: 0,
      });
      // change the stored counter behind the API's back: a read inside the cache window still serves the cache
      await prisma.poll.update({
        where: { id: poll.id },
        data: { totalVotes: 99 },
      });
      const cached = await http()
        .get(`/api/v1/polls/${poll.id}/results`)
        .expect(200);
      expect(cached.body.totalVotes).toBe(0);
      await prisma.poll.update({
        where: { id: poll.id },
        data: { totalVotes: 0 },
      });
      const u1 = await newUser();
      const u2 = await newUser();
      await castVote(poll.id, u1.auth, [poll.options[2].id]).expect(201);
      await castVote(poll.id, u2.auth, [poll.options[2].id]).expect(201);
      const after = await http()
        .get(`/api/v1/polls/${poll.id}/results`)
        .expect(200);
      expect(after.body.totalVotes).toBe(2);
      expect(after.body.leadingOptionId).toBe(poll.options[2].id);
      expect(after.body.options[2]).toMatchObject({ votes: 2, percent: 100 });
    });

    it("the read path never counts rows (source check)", () => {
      const dir = join(__dirname, "../../src/vote");
      const src = readdirSync(dir)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => readFileSync(join(dir, f), "utf8"))
        .join("\n");
      expect(src).not.toMatch(/\.vote\.count\(/);
      expect(src).not.toMatch(/voteChoice\.(count|groupBy)/);
      expect(src).not.toMatch(/vote\.groupBy/);
    });

    it("streams the first PollResults line as server-sent events", async () => {
      const { topic } = await newWeek();
      const poll = await newPoll(topic.id);
      await app.listen(0);
      const addr = app.getHttpServer().address() as { port: number };
      const chunk = await new Promise<{ type: string; text: string }>(
        (resolve, reject) => {
          const req = httpGet(
            `http://127.0.0.1:${addr.port}/api/v1/polls/${poll.id}/results/stream`,
            (res) => {
              res.once("data", (d: Buffer) => {
                resolve({
                  type: String(res.headers["content-type"]),
                  text: d.toString(),
                });
                req.destroy();
              });
            },
          );
          req.on("error", (e) => {
            if ((e as { code?: string }).code !== "ECONNRESET") reject(e);
          });
        },
      );
      expect(chunk.type).toContain("text/event-stream");
      expect(chunk.text.startsWith("data: ")).toBe(true);
      expect(JSON.parse(chunk.text.slice(6))).toMatchObject({
        pollId: poll.id,
        totalVotes: 0,
      });
    });
  });

  describe("explain my vote", () => {
    it("only the voter, free, once, an answer under the question", async () => {
      const { topic, question } = await newWeek();
      const poll = await newPoll(topic.id, { questionId: question.id });
      const u = await newUser();
      const other = await newUser();
      const post = (auth: string, body: unknown, key = randomUUID()) =>
        http()
          .post(`/api/v1/polls/${poll.id}/explanation`)
          .set("Authorization", auth)
          .set("Idempotency-Key", key)
          .send(body as object);
      const notYet = await post(u.auth, {
        kind: "TEXT",
        body: "Because rent.",
      }).expect(403);
      expect(notYet.body.error.code).toBe("FORBIDDEN");
      await castVote(poll.id, u.auth, [poll.options[0].id]).expect(201);
      await post(other.auth, { kind: "TEXT", body: "Me too" }).expect(403);
      await http()
        .post(`/api/v1/polls/${poll.id}/explanation`)
        .send({ kind: "TEXT", body: "x" })
        .expect(401);
      await post(u.auth, { kind: "TEXT", body: "   " }).expect(422);
      await post(u.auth, { kind: "VOICE" }).expect(422);
      await post(u.auth, { kind: "TEXT", body: "x".repeat(501) }).expect(422);
      const chargesBefore = await prisma.charge.count({
        where: { userId: u.user.id },
      });
      const key = randomUUID();
      const res = await post(
        u.auth,
        { kind: "TEXT", body: "Because rent." },
        key,
      ).expect(201);
      expect(res.body.answer).toMatchObject({
        explainsVote: true,
        isMine: true,
        body: "Because rent.",
        questionId: question.id,
      });
      expect(res.body.charge.costMilli).toBe(0);
      expect(res.body.allowances.costs.voteAfterFreeMilli).toBe(200);
      const vote = await prisma.vote.findFirstOrThrow({
        where: { pollId: poll.id, userId: u.user.id },
      });
      const row = await prisma.answer.findUniqueOrThrow({
        where: { explainsVoteId: vote.id },
      });
      expect(row.authorId).toBe(u.user.id);
      expect(
        (
          await prisma.question.findUniqueOrThrow({
            where: { id: question.id },
          })
        ).answerCount,
      ).toBe(1);
      expect(await prisma.charge.count({ where: { userId: u.user.id } })).toBe(
        chargesBefore,
      );
      expect(
        await prisma.freeAllowance.findUnique({ where: { userId: u.user.id } }),
      ).toBeNull();
      const replay = await post(
        u.auth,
        { kind: "TEXT", body: "Because rent." },
        key,
      ).expect(201);
      expect(replay.headers["idempotent-replay"]).toBe("true");
      const again = await post(u.auth, {
        kind: "TEXT",
        body: "Second try",
      }).expect(409);
      expect(again.body.error.code).toBe("CONFLICT");
      expect(
        await prisma.answer.count({ where: { authorId: u.user.id } }),
      ).toBe(1);
      await http()
        .post(`/api/v1/polls/${randomUUID()}/explanation`)
        .set("Authorization", u.auth)
        .set("Idempotency-Key", randomUUID())
        .send({ kind: "TEXT", body: "x" })
        .expect(404);
    });

    it("a voice explanation needs the person's own READY clip", async () => {
      const { topic, question } = await newWeek();
      const poll = await newPoll(topic.id, { questionId: question.id });
      const u = await newUser();
      const other = await newUser();
      await castVote(poll.id, u.auth, [poll.options[0].id]).expect(201);
      const clip = (owner: string, status: "READY" | "PROCESSING") =>
        prisma.voiceClip.create({
          data: {
            ownerId: owner,
            purpose: "ANSWER",
            status,
            rawKey: `k/${randomUUID()}`,
            rawMime: "audio/webm",
            maxDurationMs: 10000,
            durationMs: 5000,
          },
        });
      const post = (clipId: string) =>
        http()
          .post(`/api/v1/polls/${poll.id}/explanation`)
          .set("Authorization", u.auth)
          .set("Idempotency-Key", randomUUID())
          .send({ kind: "VOICE", clipId });
      await post((await clip(other.user.id, "READY")).id).expect(404);
      const notReady = await post(
        (await clip(u.user.id, "PROCESSING")).id,
      ).expect(409);
      expect(notReady.body.error.code).toBe("CLIP_NOT_READY");
      const ok = await post((await clip(u.user.id, "READY")).id).expect(201);
      expect(ok.body.answer.kind).toBe("VOICE");
      expect(ok.body.answer.clip.status).toBe("READY");
      expect(
        (
          await prisma.question.findUniqueOrThrow({
            where: { id: question.id },
          })
        ).voiceCount,
      ).toBe(1);
    });
  });

  describe("What Next? proposals", () => {
    const create = (
      qid: string,
      auth: string,
      body: unknown,
      key = randomUUID(),
    ) =>
      http()
        .post(`/api/v1/questions/${qid}/proposals`)
        .set("Authorization", auth)
        .set("Idempotency-Key", key)
        .send(body as object);

    it("creates a proposal, free, rate limited; guest 401; needs the key; validates text", async () => {
      const { question } = await newWeek();
      const u = await newUser();
      await http()
        .post(`/api/v1/questions/${question.id}/proposals`)
        .send({ kind: "TEXT", body: "Fix the roads now" })
        .expect(401);
      const noKey = await http()
        .post(`/api/v1/questions/${question.id}/proposals`)
        .set("Authorization", u.auth)
        .send({ kind: "TEXT", body: "Fix the roads now" })
        .expect(400);
      expect(noKey.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      await create(question.id, u.auth, { kind: "TEXT", body: "abc" }).expect(
        422,
      );
      await create(question.id, u.auth, {
        kind: "TEXT",
        body: "x".repeat(501),
      }).expect(422);
      await create(question.id, u.auth, { kind: "TEXT" }).expect(422);
      await create(question.id, u.auth, {
        kind: "TEXT",
        body: "Fix the roads now",
        extra: 1,
      }).expect(422);
      await create(randomUUID(), u.auth, {
        kind: "TEXT",
        body: "Fix the roads now",
      }).expect(404);
      const key = randomUUID();
      const res = await create(
        question.id,
        u.auth,
        { kind: "TEXT", body: "Fix the roads now" },
        key,
      ).expect(201);
      expect(res.body.proposal).toMatchObject({
        label: "PROPOSED",
        supportCount: 0,
        isMine: true,
        myStance: null,
        questionId: question.id,
      });
      expect(res.body.charge).toMatchObject({
        costMilli: 0,
        usedFreePost: false,
      });
      const row = await prisma.proposal.findUniqueOrThrow({
        where: { id: res.body.proposal.id },
      });
      expect(row.authorId).toBe(u.user.id);
      expect(row.status).toBe("PUBLISHED");
      const replay = await create(
        question.id,
        u.auth,
        { kind: "TEXT", body: "Fix the roads now" },
        key,
      ).expect(201);
      expect(replay.headers["idempotent-replay"]).toBe("true");
      expect(
        await prisma.proposal.count({ where: { questionId: question.id } }),
      ).toBe(1);
      expect(await prisma.charge.count({ where: { userId: u.user.id } })).toBe(
        0,
      );
      expect(
        await prisma.freeAllowance.findUnique({ where: { userId: u.user.id } }),
      ).toBeNull();
    });

    it("the reply carries similar proposals, and the similar route finds them", async () => {
      const { question } = await newWeek();
      const a = await newUser();
      const b = await newUser();
      const first = await create(question.id, a.auth, {
        kind: "TEXT",
        body: "Build more public transport in every city",
      }).expect(201);
      const second = await create(question.id, b.auth, {
        kind: "TEXT",
        body: "Build public transport in every city",
      }).expect(201);
      expect(second.body.similar.map((p: { id: string }) => p.id)).toEqual([
        first.body.proposal.id,
      ]);
      expect(second.body.similar[0].isMine).toBe(false);
      const found = await http()
        .get(`/api/v1/questions/${question.id}/proposals/similar`)
        .query({ text: "more public transport please" })
        .expect(200);
      expect(found.body.items.length).toBeGreaterThanOrEqual(1);
      await http()
        .get(`/api/v1/questions/${question.id}/proposals/similar`)
        .query({ text: "hi" })
        .expect(422);
      await http()
        .get(`/api/v1/questions/${randomUUID()}/proposals/similar`)
        .query({ text: "something long" })
        .expect(404);
    });

    it("lists by support or newest with stable cursor pages", async () => {
      const { question } = await newWeek();
      const authors = await Promise.all([newUser(), newUser(), newUser()]);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await create(question.id, authors[0].auth, {
          kind: "TEXT",
          body: `Proposal number ${i} about different things ${i * 7}`,
        }).expect(201);
        ids.push(r.body.proposal.id);
      }
      await http()
        .put(`/api/v1/proposals/${ids[3]}/stance`)
        .set("Authorization", authors[1].auth)
        .send({ kind: "SUPPORT" })
        .expect(200);
      await http()
        .put(`/api/v1/proposals/${ids[3]}/stance`)
        .set("Authorization", authors[2].auth)
        .send({ kind: "SUPPORT" })
        .expect(200);
      await http()
        .put(`/api/v1/proposals/${ids[1]}/stance`)
        .set("Authorization", authors[1].auth)
        .send({ kind: "SUPPORT" })
        .expect(200);
      const top = await http()
        .get(`/api/v1/questions/${question.id}/proposals`)
        .expect(200);
      expect(top.body.items[0].id).toBe(ids[3]);
      expect(top.body.items[1].id).toBe(ids[1]);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 6; guard++) {
        const page: request.Response = await http()
          .get(`/api/v1/questions/${question.id}/proposals`)
          .query({ sort: "NEW", limit: 2, ...(cursor ? { cursor } : {}) })
          .expect(200);
        seen.push(...page.body.items.map((p: { id: string }) => p.id));
        cursor = page.body.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual([...ids].reverse());
      await http()
        .get(`/api/v1/questions/${question.id}/proposals`)
        .query({ cursor: "junk" })
        .expect(400);
      await http()
        .get(`/api/v1/questions/${question.id}/proposals`)
        .query({ limit: 2, sort: "NEW" })
        .then(async (p) => {
          await http()
            .get(`/api/v1/questions/${question.id}/proposals`)
            .query({ limit: 2, sort: "SUPPORT", cursor: p.body.nextCursor })
            .expect(400);
        });
      const mine = await http()
        .get(`/api/v1/questions/${question.id}/proposals`)
        .set("Authorization", authors[1].auth)
        .expect(200);
      expect(
        mine.body.items.find((p: { id: string }) => p.id === ids[3]).myStance,
      ).toBe("SUPPORT");
    });

    it("support and challenge: one stance each, changeable, removable, counters read from the database", async () => {
      const { question } = await newWeek();
      const author = await newUser();
      const a = await newUser();
      const b = await newUser();
      const p = (
        await create(question.id, author.auth, {
          kind: "TEXT",
          body: "Open the markets late on Fridays",
        }).expect(201)
      ).body.proposal.id as string;
      const stance = (auth: string, kind: string) =>
        http()
          .put(`/api/v1/proposals/${p}/stance`)
          .set("Authorization", auth)
          .send({ kind });
      const counts = async () => {
        const r = await prisma.proposal.findUniqueOrThrow({ where: { id: p } });
        return [r.supportCount, r.challengeCount];
      };
      await http()
        .put(`/api/v1/proposals/${p}/stance`)
        .send({ kind: "SUPPORT" })
        .expect(401);
      await stance(a.auth, "MAYBE").expect(422);
      await stance(a.auth, "SUPPORT").expect(200);
      await stance(a.auth, "SUPPORT").expect(200);
      expect(await counts()).toEqual([1, 0]);
      const changed = await stance(a.auth, "CHALLENGE").expect(200);
      expect(changed.body).toMatchObject({
        myStance: "CHALLENGE",
        supportCount: 0,
        challengeCount: 1,
      });
      await stance(b.auth, "SUPPORT").expect(200);
      expect(await counts()).toEqual([1, 1]);
      expect(
        await prisma.proposalStance.count({ where: { proposalId: p } }),
      ).toBe(2);
      await Promise.all(
        Array.from({ length: 5 }, () => stance(b.auth, "CHALLENGE")),
      );
      expect(await counts()).toEqual([0, 2]);
      expect(
        await prisma.proposalStance.count({
          where: { proposalId: p, userId: b.user.id },
        }),
      ).toBe(1);
      const gone = await http()
        .delete(`/api/v1/proposals/${p}/stance`)
        .set("Authorization", a.auth)
        .expect(200);
      expect(gone.body.myStance).toBeNull();
      await http()
        .delete(`/api/v1/proposals/${p}/stance`)
        .set("Authorization", a.auth)
        .expect(200);
      expect(await counts()).toEqual([0, 1]);
      await http()
        .put(`/api/v1/proposals/${randomUUID()}/stance`)
        .set("Authorization", a.auth)
        .send({ kind: "SUPPORT" })
        .expect(404);
    });

    it("improves a proposal and deletes only your own", async () => {
      const { question } = await newWeek();
      const a = await newUser();
      const b = await newUser();
      const base = (
        await create(question.id, a.auth, {
          kind: "TEXT",
          body: "Plant a tree in every school",
        }).expect(201)
      ).body.proposal.id as string;
      const imp = (
        await create(question.id, b.auth, {
          kind: "TEXT",
          body: "Plant two trees and water them",
          improvesId: base,
        }).expect(201)
      ).body.proposal;
      expect(imp.improvesId).toBe(base);
      expect(
        (await prisma.proposal.findUniqueOrThrow({ where: { id: base } }))
          .improveCount,
      ).toBe(1);
      await create(question.id, b.auth, {
        kind: "TEXT",
        body: "Improving nothing at all here",
        improvesId: randomUUID(),
      }).expect(404);
      await http().delete(`/api/v1/proposals/${imp.id}`).expect(401);
      await http()
        .delete(`/api/v1/proposals/${imp.id}`)
        .set("Authorization", a.auth)
        .expect(403);
      await http()
        .delete(`/api/v1/proposals/${imp.id}`)
        .set("Authorization", b.auth)
        .expect(204);
      expect(
        (await prisma.proposal.findUniqueOrThrow({ where: { id: imp.id } }))
          .status,
      ).toBe("DELETED_BY_AUTHOR");
      expect(
        (await prisma.proposal.findUniqueOrThrow({ where: { id: base } }))
          .improveCount,
      ).toBe(0);
      await http()
        .delete(`/api/v1/proposals/${imp.id}`)
        .set("Authorization", b.auth)
        .expect(404);
      const list = await http()
        .get(`/api/v1/questions/${question.id}/proposals`)
        .expect(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([base]);
    });

    it("the What Next? page: summary only once an editor reviewed it, groups, totals, guest readable", async () => {
      const { topic, question } = await newWeek();
      const a = await newUser();
      const editor = await newUser();
      const p1 = (
        await create(question.id, a.auth, {
          kind: "TEXT",
          body: "Cap rent increases yearly",
        }).expect(201)
      ).body.proposal.id as string;
      await create(question.id, a.auth, {
        kind: "TEXT",
        body: "Build homes for young families",
      }).expect(201);
      await http()
        .put(`/api/v1/proposals/${p1}/stance`)
        .set("Authorization", editor.auth)
        .send({ kind: "SUPPORT" })
        .expect(200);
      const group = await prisma.proposalGroup.create({
        data: {
          questionId: question.id,
          title: "Housing",
          suggestedBy: "auto",
        },
      });
      await prisma.proposal.update({
        where: { id: p1 },
        data: { groupId: group.id },
      });
      await prisma.editorialSummary.create({
        data: {
          topicId: topic.id,
          mainView: "Most voices lean towards rent limits",
          mainViewVoices: 12,
          opposingView: "Some want the market left alone",
          opposingViewVoices: 5,
          pollLine: "Poll is split",
          nextStepsLine: "Ask councils",
          basedOnVoices: 17,
          basedOnVotes: 40,
        },
      });
      const draft = await http()
        .get(`/api/v1/questions/${question.id}/what-next`)
        .expect(200);
      expect(draft.body.summary).toBeNull();
      expect(draft.body.proposalTotal).toBe(2);
      expect(draft.body.groupTotal).toBe(1);
      expect(draft.body.groups[0]).toMatchObject({
        title: "Housing",
        confirmed: false,
        proposalCount: 1,
        supportCount: 1,
      });
      expect(draft.body.groups[0].topProposal.id).toBe(p1);
      expect(draft.body.question).toMatchObject({
        id: question.id,
        proposalCount: 2,
      });
      await prisma.editorialSummary.update({
        where: { topicId: topic.id },
        data: { reviewedById: editor.user.id, reviewedAt: new Date() },
      });
      const shown = await http()
        .get(`/api/v1/questions/${question.id}/what-next`)
        .set("Authorization", editor.auth)
        .expect(200);
      expect(shown.body.summary).toMatchObject({
        mainView: "Most voices lean towards rent limits",
        reviewedByEditor: true,
        basedOnVotes: 40,
      });
      const byGroup = await http()
        .get(`/api/v1/questions/${question.id}/proposals`)
        .query({ groupId: group.id })
        .expect(200);
      expect(byGroup.body.items).toHaveLength(1);
      await http()
        .get(`/api/v1/questions/${randomUUID()}/what-next`)
        .expect(404);
    });

    it("429 over the post limit", async () => {
      await prisma.configEntry.upsert({
        where: { key: "ratelimit.post_per_10min" },
        create: { key: "ratelimit.post_per_10min", valueJson: 3 },
        update: { valueJson: 3 },
      });
      await new Promise((r) => setTimeout(r, 5200));
      try {
        const { question } = await newWeek();
        const u = await newUser();
        for (let i = 0; i < 3; i++)
          await create(question.id, u.auth, {
            kind: "TEXT",
            body: `Idea number ${i} for the town`,
          }).expect(201);
        const over = await create(question.id, u.auth, {
          kind: "TEXT",
          body: "One idea too many for now",
        }).expect(429);
        expect(over.body.error.code).toBe("RATE_LIMITED");
        expect(over.headers["retry-after"]).toBeTruthy();
        expect(
          await prisma.proposal.count({ where: { authorId: u.user.id } }),
        ).toBe(3);
      } finally {
        await prisma.configEntry.delete({
          where: { key: "ratelimit.post_per_10min" },
        });
        await new Promise((r) => setTimeout(r, 5200));
      }
    }, 30_000);
  });
});
