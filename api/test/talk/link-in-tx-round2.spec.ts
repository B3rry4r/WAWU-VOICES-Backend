/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";
import { ChargeSweeperService } from "../../src/talk/charge-sweeper.service";
import { PostsService } from "../../src/talk/posts.service";
import { UnitsService } from "../../src/units/units.service";
import type { Profile } from "../../src/talk/shared/profile.service";

const MIN = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** V-LINK-IN-TX round 2: a linked charge is never reversed; the sweeper cannot reverse at the moment of linking; old rows are healed. */
describe("V-LINK-IN-TX round 2", () => {
  let h: Harness;
  let q: { id: string };
  let sweeper: ChargeSweeperService;
  let posts: PostsService;
  let units: UnitsService;

  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    sweeper = h.app.get(ChargeSweeperService);
    posts = h.app.get(PostsService);
    units = h.app.get(UnitsService);
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01') ON CONFLICT ("id") DO UPDATE SET "startAt" = '2000-01-01'`;
    await sweeper.sweep(new Date(Date.now() + 400 * 86_400_000));
  });
  afterAll(async () => {
    // DRAFT, not CLOSED: a closed question is still readable, so its posts stay in the global lists (trending) that
    // later specs read on the shared test database. A draft is read by nobody.
    await h.prisma.question.update({
      where: { id: q.id },
      data: { status: "DRAFT" },
    });
    await h.close();
  });

  const profile = async (p: Person): Promise<Profile> => ({
    ...(await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } })),
    roleNames: [],
  });
  const answer = (p: Person, key: string, body = "One post, once.") =>
    h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send({ kind: "TEXT", body });
  const charges = (p: Person) =>
    h.prisma.charge.findMany({ where: { userId: p.id } });
  const answers = (p: Person) =>
    h.prisma.answer.findMany({ where: { authorId: p.id } });
  /** A row as the old code left it: the post is stored, the charge is marked and not linked. */
  async function oldShape(p: Person, minutesAgo = 40) {
    const key = randomUUID();
    const res = await answer(p, key).expect(201);
    const id: string = res.body.answer.id;
    const at = new Date(Date.now() - minutesAgo * MIN);
    await h.prisma.charge.updateMany({
      where: { userId: p.id, idempotencyKey: key },
      data: { refId: null, createdAt: at },
    });
    await h.prisma.answer.update({
      where: { id },
      data: { createdAt: new Date(at.getTime() + 2_000) },
    });
    return { key, id };
  }

  describe("M1: a linked charge is never reversed", () => {
    it("the commit succeeds but the app sees an error: one post, the charge stays COMMITTED and linked", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const prisma = h.prisma;
      const real = prisma.$transaction.bind(prisma) as (
        ...a: unknown[]
      ) => Promise<unknown>;
      let thrown = false;
      const spy = jest
        .spyOn(prisma, "$transaction")
        .mockImplementation((...a: unknown[]) =>
          real(...a).then(async (r) => {
            if (
              !thrown &&
              (await prisma.answer.count({ where: { authorId: p.id } }))
            ) {
              thrown = true;
              throw new Error("connection lost after commit");
            }
            return r;
          }),
        );
      let res;
      try {
        res = await answer(p, randomUUID());
      } finally {
        spy.mockRestore();
      }
      expect(thrown).toBe(true);
      expect(res.status).toBe(500);
      const [post] = await answers(p);
      const [ch] = await charges(p);
      expect(post).toBeDefined();
      expect(ch.status).toBe("COMMITTED");
      expect(ch.refId).toBe(post.id);
      expect(
        (await h.prisma.wallet.findUniqueOrThrow({ where: { userId: p.id } }))
          .balanceMilli,
      ).toBeLessThan(500_000);
    });

    it("6 parallel calls with one key into the service: one post, the charge stays COMMITTED", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const me = await profile(p);
      const key = randomUUID();
      const out = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          posts.createAnswer(
            me,
            q.id,
            { kind: "TEXT", body: "Six at once." },
            key,
          ),
        ),
      );
      expect(out.some((o) => o.status === "fulfilled")).toBe(true);
      expect(await answers(p)).toHaveLength(1);
      const all = await charges(p);
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe("COMMITTED");
      expect(all[0].refId).toBe((await answers(p))[0].id);
    });

    it("reverse, reverseByKey and a guarded reverse all leave a linked charge alone; an unlinked one is still reversed", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      await answer(p, key).expect(201);
      const [ch] = await charges(p);
      expect(await units.reverse(ch.id, "x")).toEqual({ reversed: false });
      expect(await units.reverseByKey(p.id, key)).toEqual({ reversed: false });
      expect(
        await units.reverseGuarded(ch.id, "x", () => Promise.resolve(true)),
      ).toEqual({ reversed: false });
      expect((await charges(p))[0].status).toBe("COMMITTED");
      await h.prisma.charge.update({
        where: { id: ch.id },
        data: { refId: null },
      });
      expect(await units.reverse(ch.id, "x")).toEqual({ reversed: true });
      expect((await charges(p))[0].status).toBe("REVERSED");
    });
  });

  describe("M2: the sweeper cannot reverse while a post links", () => {
    it("the post transaction holds the link open, the sweep runs, the post commits: reversed 0, linked and COMMITTED", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      await answer(p, key).expect(201);
      const [ch] = await charges(p);
      await h.prisma.charge.update({
        where: { id: ch.id },
        data: { refId: null, createdAt: new Date(Date.now() - 40 * MIN) },
      });
      const postId = (await answers(p))[0].id;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let linked!: () => void;
      const linkedP = new Promise<void>((r) => (linked = r));
      const txn = h.prisma.$transaction(async (tx) => {
        const { count } = await tx.charge.updateMany({
          where: { id: ch.id, refId: null, status: "COMMITTED" },
          data: { refId: postId },
        });
        expect(count).toBe(1);
        linked();
        await gate;
      });
      await linkedP;
      const sweep = sweeper.sweep(new Date());
      await sleep(600);
      release();
      await txn;
      expect(await sweep).toBe(0);
      const [after] = await charges(p);
      expect(after.status).toBe("COMMITTED");
      expect(after.refId).toBe(postId);
      expect(await answers(p)).toHaveLength(1);
    });

    it("200 posts, 20 people, 3 sweepers looping with the clock 31 minutes ahead: no post has a reversed charge, the books balance", async () => {
      const people = await Promise.all(
        Array.from({ length: 20 }, () =>
          makePerson(h, { freePosts: 4, balanceMilli: 800_000 }),
        ),
      );
      const start = new Map(
        people.map((p) => [p.id, { free: 4, bal: 800_000 }]),
      );
      let stop = false;
      const ahead = () => new Date(Date.now() + 31 * MIN);
      const loops = Array.from({ length: 3 }, async () => {
        while (!stop) await sweeper.sweep(ahead()).catch(() => 0);
      });
      const jobs: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++)
        for (const p of people)
          jobs.push(
            answer(p, randomUUID(), `Post ${i} ${randomUUID()}`).then(
              () => undefined,
              () => undefined,
            ),
          );
      await Promise.all(jobs);
      stop = true;
      await Promise.all(loops);
      const ids = people.map((p) => p.id);
      const bad = await h.prisma.$queryRaw<{ id: string }[]>`
        SELECT a."id" FROM "Answer" a JOIN "Charge" c ON c."userId" = a."authorId" AND c."refId" = a."id"
        WHERE a."authorId" = ANY(${ids}) AND c."status" <> 'COMMITTED'`;
      expect(bad).toEqual([]);
      const unbalanced = await h.prisma.$queryRaw<{ txnId: string }[]>`
        SELECT e."txnId" FROM "LedgerEntry" e
        WHERE e."txnId" IN (SELECT "txnId" FROM "LedgerEntry" WHERE "walletUserId" = ANY(${ids}))
        GROUP BY e."txnId" HAVING sum(e."deltaMilli") <> 0`;
      expect(unbalanced).toEqual([]);
      for (const p of people) {
        const wal = await h.prisma.wallet.findUniqueOrThrow({
          where: { userId: p.id },
        });
        const sum = await h.prisma.ledgerEntry.aggregate({
          _sum: { deltaMilli: true },
          where: { walletUserId: p.id, account: "USER_WALLET" },
        });
        expect(wal.balanceMilli).toBe(
          start.get(p.id)!.bal + (sum._sum.deltaMilli ?? 0),
        );
        // every stored post has a kept charge, and no kept charge lacks its post
        const kept = (await charges(p)).filter((c) => c.status === "COMMITTED");
        expect(kept.length).toBe((await answers(p)).length);
      }
    }, 120_000);
  });

  describe("M3: old rows are healed", () => {
    it("(a) replaying the key of an old-shape row: 201 with the stored post, the charge is linked, the sweeper leaves it", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const { key, id } = await oldShape(p);
      await h.prisma.idempotencyRecord.deleteMany({
        where: { actorId: p.id, key },
      });
      const again = await answer(p, key).expect(201);
      expect(again.body.answer.id).toBe(id);
      expect(await answers(p)).toHaveLength(1);
      const [ch] = await charges(p);
      expect(ch.refId).toBe(id);
      expect(ch.status).toBe("COMMITTED");
      expect(await sweeper.sweep(new Date(Date.now() + 31 * MIN))).toBe(0);
    });

    it("(b) the heal links the unambiguous row and is safe to run twice", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const { id } = await oldShape(p);
      const first = await sweeper.healUnlinked();
      expect(first.linked).toBeGreaterThanOrEqual(1);
      expect((await charges(p))[0].refId).toBe(id);
      const second = await sweeper.healUnlinked();
      expect(second.linked).toBe(0);
      expect((await charges(p))[0].refId).toBe(id);
      expect(await sweeper.sweep(new Date(Date.now() + 31 * MIN))).toBe(0);
    });

    it("(b) two candidate posts: left alone and counted", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const one = await oldShape(p);
      // a second stored post of the same person and kind in the window whose own charge was lost (also unlinked)
      const two = await oldShape(p);
      const at = new Date(Date.now() - 40 * MIN);
      await h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { createdAt: at },
      });
      await h.prisma.answer.updateMany({
        where: { id: { in: [one.id, two.id] } },
        data: { createdAt: new Date(at.getTime() + 2_000) },
      });
      const r = await sweeper.healUnlinked();
      expect(r.ambiguous).toBeGreaterThanOrEqual(2);
      expect((await charges(p)).map((c) => c.refId)).toEqual([null, null]);
    });

    it("(b) a charge with no post is left for the sweeper; an already linked one is untouched", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const { id } = await oldShape(p);
      await h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { refId: id },
      });
      const linkedBefore = (await charges(p))[0];
      const o = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      const res = await answer(o, key).expect(201);
      await h.prisma.answer.delete({ where: { id: res.body.answer.id } });
      await h.prisma.charge.updateMany({
        where: { userId: o.id },
        data: { refId: null, createdAt: new Date(Date.now() - 40 * MIN) },
      });
      await sweeper.healUnlinked();
      expect((await charges(p))[0]).toEqual(linkedBefore);
      expect((await charges(o))[0].refId).toBeNull();
      expect(
        await sweeper.sweep(new Date(Date.now() + 31 * MIN)),
      ).toBeGreaterThanOrEqual(1);
      expect((await charges(o))[0].status).toBe("REVERSED");
    });

    it("(b) on a database with no such rows it does nothing", async () => {
      await sweeper.healUnlinked();
      expect(await sweeper.healUnlinked()).toEqual({ linked: 0, ambiguous: 0 });
    });
  });
});
