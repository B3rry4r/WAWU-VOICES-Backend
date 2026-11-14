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

const MIN = 60_000;
const H = 60 * MIN;

/**
 * BATCH-C2 round 3. HIGH 1: the sweeper's start time is stamped by the new code's first boot, never by the migration;
 * LOW 3: an idempotent replay answers only if the stored post is readable now.
 */
describe("BATCH-C2 round 3", () => {
  let h: Harness;
  let q: { id: string };
  let sweeper: ChargeSweeperService;
  const extra: string[] = [];
  const ago = (m: number) => new Date(Date.now() - m * MIN);
  const state = async () =>
    h.prisma.$queryRaw<
      { startAt: Date | null }[]
    >`SELECT "startAt" FROM "ChargeSweeperState" WHERE "id" = 1`;
  const clearState = async (row: boolean) => {
    await h.prisma.$executeRaw`DELETE FROM "ChargeSweeperState"`;
    if (row)
      await h.prisma
        .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, NULL)`;
  };
  const answerUrl = (id = q.id) => `/api/v1/questions/${id}/answers`;
  const send = (p: Person, key: string, body: string, url = answerUrl()) =>
    h
      .http()
      .post(url)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(
        url.endsWith("/replies")
          ? { kind: "TEXT", body, stance: "AGREE" }
          : { kind: "TEXT", body },
      );
  const chargeOf = (p: Person, key: string) =>
    h.prisma.charge.findUniqueOrThrow({
      where: { userId_idempotencyKey: { userId: p.id, idempotencyKey: key } },
    });

  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: {
        status: "LIVE",
        startsAt: new Date(Date.now() - H),
        endsAt: new Date(Date.now() + 24 * H),
      },
    });
    sweeper = h.app.get(ChargeSweeperService);
  });
  afterAll(async () => {
    await h.prisma.$executeRaw`DELETE FROM "ChargeSweeperState"`;
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01')`;
    const ids = (
      await h.prisma.answer.findMany({
        where: { questionId: q.id },
        select: { id: true },
      })
    ).map((a) => a.id);
    await h.prisma.reply
      .deleteMany({ where: { answerId: { in: ids } } })
      .catch(() => undefined);
    await h.prisma.answer
      .deleteMany({ where: { questionId: q.id } })
      .catch(() => undefined);
    // the posts of the LOW 3 cases stay out of the shared database's global lists
    await h.prisma.answer.updateMany({
      where: { questionId: { in: extra } },
      data: { status: "DELETED_BY_AUTHOR" },
    });
    await h.close();
  });

  /** A paid post made by code that does not link its charge: the post and the charge stay, `refId` is null. */
  async function oldCodePost(withPost: boolean, marked = false) {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const r = await send(p, key, "old code " + key).expect(201);
    if (!withPost)
      await h.prisma.answer.deleteMany({ where: { id: r.body.answer.id } });
    await h.prisma.charge.updateMany({
      where: { userId: p.id },
      data: { refType: marked ? "answer" : null, refId: null },
    });
    return { p, key };
  }

  it("a charge made by old code before the first boot, any age, with and without its post: never reversed", async () => {
    await clearState(true); // migrated, not booted
    const a = await oldCodePost(true);
    const b = await oldCodePost(false);
    for (const x of [a, b])
      await h.prisma.charge.updateMany({
        where: { userId: x.p.id },
        data: { createdAt: ago(31) },
      });
    expect(await sweeper.sweep()).toBe(0);
    // the first boot of the new code, later: old charges are before it, whatever their age
    const boot = new Date();
    await sweeper.stampStart(boot);
    for (const age of [31, 600, 90 * 24 * 60]) {
      for (const x of [a, b])
        await h.prisma.charge.updateMany({
          where: { userId: x.p.id },
          data: { createdAt: ago(age) },
        });
      expect(await sweeper.sweep(new Date(Date.now() + 90 * 86_400_000))).toBe(
        0,
      );
    }
    expect((await chargeOf(a.p, a.key)).status).toBe("COMMITTED");
    expect((await chargeOf(b.p, b.key)).status).toBe("COMMITTED");
  });

  it("no start time (row with null, or no row): the sweeper reads nothing, however old the charge", async () => {
    for (const row of [true, false]) {
      await clearState(row);
      const x = await oldCodePost(false);
      await h.prisma.charge.updateMany({
        where: { userId: x.p.id },
        data: { createdAt: ago(600) },
      });
      expect(await sweeper.sweep(new Date(Date.now() + 86_400_000))).toBe(0);
      expect((await chargeOf(x.p, x.key)).status).toBe("COMMITTED");
    }
  });

  it("migrate, wait, boot: the start time is the boot time, not the migrate time; a second boot changes nothing", async () => {
    await clearState(true);
    expect((await state())[0].startAt).toBeNull(); // what the migration leaves
    const migrated = Date.now();
    await new Promise((r) => setTimeout(r, 1500));
    // a timer may fire a millisecond early against Date.now(): wait until the clock itself has passed the mark
    while (Date.now() < migrated + 1500)
      await new Promise((r) => setTimeout(r, 1));
    const boot1 = new Date();
    const got = await sweeper.stampStart(boot1);
    const stored = (await state())[0].startAt as Date;
    expect(stored.getTime()).toBe(boot1.getTime());
    expect(got?.getTime()).toBe(boot1.getTime());
    expect(stored.getTime()).toBeGreaterThanOrEqual(migrated + 1500);
    await new Promise((r) => setTimeout(r, 50));
    const again = await sweeper.stampStart(new Date());
    expect(again?.getTime()).toBe(boot1.getTime());
    expect((await state())[0].startAt?.getTime()).toBe(boot1.getTime());
    // the module's own boot hook does the same and never moves it
    await sweeper.onModuleInit();
    expect((await state())[0].startAt?.getTime()).toBe(boot1.getTime());
  });

  it("two processes booting at once: one start time", async () => {
    await clearState(true);
    const t = Date.now();
    const times = Array.from({ length: 12 }, (_, i) => new Date(t + i));
    const got = await Promise.all(times.map((d) => sweeper.stampStart(d)));
    const stored = (await state())[0].startAt as Date;
    expect(times.map((d) => d.getTime())).toContain(stored.getTime());
    expect(new Set(got.map((d) => d?.getTime())).size).toBe(1);
    expect(got[0]?.getTime()).toBe(stored.getTime());
    expect(
      await h.prisma.$queryRaw`SELECT 1 FROM "ChargeSweeperState"`,
    ).toHaveLength(1);
  });

  it("a charge made by the new code after the boot is swept as before (31 minutes, no post)", async () => {
    await clearState(true);
    await sweeper.stampStart(ago(120));
    const x = await oldCodePost(false, true);
    await h.prisma.charge.updateMany({
      where: { userId: x.p.id },
      data: { createdAt: ago(31) },
    });
    expect(await sweeper.sweep()).toBe(1);
    expect((await chargeOf(x.p, x.key)).status).toBe("REVERSED");
  });

  describe("LOW 3: replay of a stored post when the question is not readable now", () => {
    const counts = async (p: Person) => ({
      answers: await h.prisma.answer.count({ where: { authorId: p.id } }),
      charges: await h.prisma.charge.count({ where: { userId: p.id } }),
      reversed: await h.prisma.charge.count({
        where: { userId: p.id, status: "REVERSED" },
      }),
      balance: (
        await h.prisma.wallet.findUniqueOrThrow({ where: { userId: p.id } })
      ).balanceMilli,
    });

    it("inside the record's life, question moved back before its start: 404 (any other question), nothing changes; open again: the replay answers", async () => {
      const qq = await makeQuestion(h);
      extra.push(qq.id);
      await h.prisma.question.update({
        where: { id: qq.id },
        data: {
          status: "LIVE",
          startsAt: new Date(Date.now() - H),
          endsAt: new Date(Date.now() + 24 * H),
        },
      });
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      const first = await send(p, key, "kept text", answerUrl(qq.id)).expect(
        201,
      );
      const base = await counts(p);
      await h.prisma.question.update({
        where: { id: qq.id },
        data: {
          status: "SCHEDULED",
          startsAt: new Date(Date.now() + 2 * H),
          endsAt: new Date(Date.now() + 26 * H),
        },
      });
      const early = await send(p, key, "kept text", answerUrl(qq.id));
      expect(early.status).toBe(404);
      expect(JSON.stringify(early.body)).not.toContain("kept text");
      expect(await counts(p)).toEqual(base);
      // a fresh key now answers the same
      expect((await send(p, randomUUID(), "x", answerUrl(qq.id))).status).toBe(
        404,
      );
      // open again: the replay is the stored post
      await h.prisma.question.update({
        where: { id: qq.id },
        data: {
          status: "LIVE",
          startsAt: new Date(Date.now() - H),
          endsAt: new Date(Date.now() + 24 * H),
        },
      });
      const again = await send(p, key, "kept text", answerUrl(qq.id));
      expect(again.status).toBe(201);
      expect(again.body.answer.id).toBe(first.body.answer.id);
      expect(await counts(p)).toEqual(base);
    });

    it("the question shown as coming up: 409 QUESTION_NOT_OPEN, nothing changes", async () => {
      const qq = await makeQuestion(h);
      extra.push(qq.id);
      await h.prisma.question.update({
        where: { id: qq.id },
        data: {
          status: "LIVE",
          startsAt: new Date(Date.now() - H),
          endsAt: new Date(Date.now() + 24 * H),
        },
      });
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      await send(p, key, "coming up text", answerUrl(qq.id)).expect(201);
      const base = await counts(p);
      await h.prisma.question.update({
        where: { id: qq.id },
        data: {
          status: "SCHEDULED",
          startsAt: new Date(Date.now() + 2 * H),
          endsAt: new Date(Date.now() + 26 * H),
        },
      });
      const ov = await h.prisma.override.create({
        data: {
          questionId: qq.id,
          contentKind: "TEXT",
          body: "x",
          startsAt: new Date(Date.now() - H),
          endsAt: new Date(Date.now() + 24 * H),
          status: "SCHEDULED",
          createdById: p.id,
        },
      });
      try {
        const r = await send(p, key, "coming up text", answerUrl(qq.id));
        expect(r.status).toBe(409);
        expect(r.body.code ?? r.body.error?.code).toBe("QUESTION_NOT_OPEN");
        expect(JSON.stringify(r.body)).not.toContain("coming up text");
        expect(await counts(p)).toEqual(base);
      } finally {
        await h.prisma.override.delete({ where: { id: ov.id } });
      }
    });

    it("a reply: the same, on the parent's question", async () => {
      const qq = await makeQuestion(h);
      extra.push(qq.id);
      await h.prisma.question.update({
        where: { id: qq.id },
        data: {
          status: "LIVE",
          startsAt: new Date(Date.now() - H),
          endsAt: new Date(Date.now() + 24 * H),
        },
      });
      const w = await makePerson(h, { freePosts: 5 });
      const base0 = await send(
        w,
        randomUUID(),
        "parent",
        answerUrl(qq.id),
      ).expect(201);
      const url = `/api/v1/answers/${base0.body.answer.id}/replies`;
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      await send(p, key, "kept reply", url).expect(201);
      const base = await h.prisma.reply.count({ where: { authorId: p.id } });
      await h.prisma.question.update({
        where: { id: qq.id },
        data: {
          status: "SCHEDULED",
          startsAt: new Date(Date.now() + 2 * H),
          endsAt: new Date(Date.now() + 26 * H),
        },
      });
      const r = await send(p, key, "kept reply", url);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain("kept reply");
      expect(await h.prisma.reply.count({ where: { authorId: p.id } })).toBe(
        base,
      );
      expect(
        await h.prisma.charge.count({
          where: { userId: p.id, status: "REVERSED" },
        }),
      ).toBe(0);
    });
  });
});
