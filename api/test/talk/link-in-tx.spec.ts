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

/**
 * V-LINK-IN-TX: the charge is linked to the post in the SAME transaction that stores the post. A stored post and an
 * unlinked charge cannot exist together; if the link cannot be written the post is not stored, the request fails and the
 * in-request reversal gives the charge back (and if that fails too, the sweeper does, at +31 minutes: a real orphan).
 */
describe("V-LINK-IN-TX: the link is written with the post", () => {
  let h: Harness;
  let q: { id: string };
  let target: { id: string };
  let sweeper: ChargeSweeperService;

  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    sweeper = h.app.get(ChargeSweeperService);
    // Chosen keys: a key starting "lnk-fail-" cannot be linked; a key starting "lnk-norev-" cannot be reversed.
    await h.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION lit_guard() RETURNS trigger AS $$
      BEGIN
        IF NEW."idempotencyKey" LIKE 'lnk-%' AND NEW."refId" IS NOT NULL AND OLD."refId" IS NULL THEN
          RAISE EXCEPTION 'LINK-BOOM';
        END IF;
        IF NEW."idempotencyKey" LIKE 'lnk-norev-%' AND NEW."status" = 'REVERSED' THEN
          RAISE EXCEPTION 'REVERSE-BOOM';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await h.prisma.$executeRawUnsafe(
      `CREATE TRIGGER lit_guard BEFORE UPDATE ON "Charge" FOR EACH ROW WHEN (NEW."idempotencyKey" LIKE 'lnk-%') EXECUTE FUNCTION lit_guard()`,
    );
    // The same check inside the transaction: at commit, a post by a watched person must have its charge linked to it.
    await h.prisma.$executeRawUnsafe(
      `CREATE TABLE lit_watch ("userId" text PRIMARY KEY)`,
    );
    await h.prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION lit_commit_check() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM lit_watch w WHERE w."userId" = NEW."authorId")
           AND NOT EXISTS (SELECT 1 FROM "Charge" c WHERE c."userId" = NEW."authorId" AND c."refId" = NEW."id") THEN
          RAISE EXCEPTION 'POST-WITHOUT-LINKED-CHARGE';
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);
    for (const t of ["Answer", "Reply"])
      await h.prisma.$executeRawUnsafe(
        `CREATE CONSTRAINT TRIGGER lit_commit_check AFTER INSERT ON "${t}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION lit_commit_check()`,
      );
    await h.prisma
      .$executeRaw`INSERT INTO "ChargeSweeperState" ("id", "startAt") VALUES (1, '2000-01-01') ON CONFLICT ("id") DO UPDATE SET "startAt" = '2000-01-01'`;
    // Settle other specs' leftovers so a sweep here only sees this spec's charges.
    await sweeper.sweep(new Date(Date.now() + 400 * 86_400_000));
    const a = await makePerson(h, { freePosts: 5 });
    target = (
      await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", a.auth)
        .set("Idempotency-Key", randomUUID())
        .send({ kind: "TEXT", body: "the answer that replies go under" })
        .expect(201)
    ).body.answer;
  });
  afterAll(async () => {
    // DRAFT, not CLOSED: a closed question is still readable, so its posts stay in the global lists (trending) that
    // later specs read on the shared test database. A draft is read by nobody.
    await h.prisma.question.update({
      where: { id: q.id },
      data: { status: "DRAFT" },
    });
    for (const t of ["Answer", "Reply"])
      await h.prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS lit_commit_check ON "${t}"`,
      );
    await h.prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS lit_guard ON "Charge"`,
    );
    await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS lit_guard()`);
    await h.prisma.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS lit_commit_check()`,
    );
    await h.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS lit_watch`);
    await h.close();
  });

  const watch = (p: Person) =>
    h.prisma
      .$executeRaw`INSERT INTO lit_watch ("userId") VALUES (${p.id}) ON CONFLICT DO NOTHING`;
  const clipFor = (
    p: Person,
    purpose: "ANSWER" | "REPLY",
    durationMs: number,
    extraTokenId?: string,
  ) =>
    h.prisma.voiceClip.create({
      data: {
        ownerId: p.id,
        purpose,
        status: "READY",
        rawKey: "raw/x",
        rawMime: "audio/webm",
        playKey: `voice/${randomUUID()}.m4a`,
        playMime: "audio/mp4",
        maxDurationMs: 60000,
        durationMs,
        ...(extraTokenId ? { extraTokenId } : {}),
      },
    });
  const tokenFor = async (p: Person) => {
    const pay = await h.prisma.payment.create({
      data: {
        userId: p.id,
        kind: "EXTRA_VOICE",
        tokenKind: "SECONDS_30",
        amountKobo: 15000,
        status: "SUCCEEDED",
        txRef: "voices-" + randomUUID(),
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 1e6),
      },
    });
    return h.prisma.extraVoiceToken.create({
      data: {
        userId: p.id,
        paymentId: pay.id,
        kind: "SECONDS_30",
        maxSeconds: 30,
      },
    });
  };

  type Kind = "answer" | "reply";
  const post = (p: Person, kind: Kind, key: string, body: object) =>
    h
      .http()
      .post(
        kind === "answer"
          ? `/api/v1/questions/${q.id}/answers`
          : `/api/v1/answers/${target.id}/replies`,
      )
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send(kind === "reply" ? { stance: "AGREE", ...body } : body);
  const posts = (p: Person, kind: Kind) =>
    kind === "answer"
      ? h.prisma.answer.count({ where: { authorId: p.id } })
      : h.prisma.reply.count({ where: { authorId: p.id } });
  const charges = (p: Person) =>
    h.prisma.charge.findMany({ where: { userId: p.id } });
  const balance = async (p: Person) =>
    (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
      ?.balanceMilli ?? 0;
  const freeLeft = async (p: Person) =>
    (await h.prisma.freeAllowance.findUnique({ where: { userId: p.id } }))
      ?.freePostsRemaining ?? 0;
  const counters = async () => ({
    a: (await h.prisma.question.findUniqueOrThrow({ where: { id: q.id } }))
      .answerCount,
    r: (await h.prisma.answer.findUniqueOrThrow({ where: { id: target.id } }))
      .replyCount,
  });

  const cases: {
    name: string;
    kind: Kind;
    free: boolean;
    voice?: "paid" | "prepaid";
  }[] = [
    { name: "text answer, paid", kind: "answer", free: false },
    { name: "text answer, free post", kind: "answer", free: true },
    { name: "voice answer, paid", kind: "answer", free: false, voice: "paid" },
    {
      name: "voice answer, free post",
      kind: "answer",
      free: true,
      voice: "paid",
    },
    {
      name: "voice answer, prepaid token",
      kind: "answer",
      free: false,
      voice: "prepaid",
    },
    { name: "text reply, paid", kind: "reply", free: false },
    { name: "text reply, free post", kind: "reply", free: true },
    { name: "voice reply, paid", kind: "reply", free: false, voice: "paid" },
    {
      name: "voice reply, free post",
      kind: "reply",
      free: true,
      voice: "paid",
    },
  ];

  async function setup(c: (typeof cases)[number]) {
    const p = await makePerson(h, {
      freePosts: c.free ? 3 : 0,
      balanceMilli: c.free ? 0 : 500_000,
    });
    await watch(p);
    let body: object = { kind: "TEXT", body: "A short post, once." };
    if (c.voice) {
      const tok = c.voice === "prepaid" ? await tokenFor(p) : null;
      const clip = await clipFor(
        p,
        c.kind === "answer" ? "ANSWER" : "REPLY",
        25_000,
        tok?.id,
      );
      body = {
        kind: "VOICE",
        clipId: clip.id,
        ...(tok ? { extraVoiceTokenId: tok.id } : {}),
      };
    }
    return { p, body };
  }

  describe.each(cases)("$name", (c) => {
    it("the link cannot be written: request fails, no post, the charge is given back in the request", async () => {
      const { p, body } = await setup(c);
      const before = {
        bal: await balance(p),
        free: await freeLeft(p),
        cnt: await counters(),
      };
      const key = `lnk-fail-${randomUUID()}`;
      const res = await post(p, c.kind, key, body);
      expect(res.status).toBe(500);
      expect(await posts(p, c.kind)).toBe(0);
      const [ch] = await charges(p);
      expect(ch.status).toBe("REVERSED");
      expect(ch.refId).toBeNull();
      expect(await balance(p)).toBe(before.bal);
      expect(await freeLeft(p)).toBe(before.free);
      expect(await counters()).toEqual(before.cnt); // counters rolled back with the post
      if (c.voice === "prepaid")
        expect(
          (
            await h.prisma.extraVoiceToken.findFirstOrThrow({
              where: { userId: p.id },
            })
          ).usedOnClipId,
        ).toBeNull();
      // nothing left for the sweeper
      expect(await sweeper.sweep(new Date(Date.now() + 31 * MIN))).toBe(0);
    });

    it("the link and the reversal both fail: no post, a real orphan, the sweeper gives it back at +31 minutes only", async () => {
      const { p, body } = await setup(c);
      const before = { bal: await balance(p), free: await freeLeft(p) };
      const key = `lnk-norev-${randomUUID()}`;
      const res = await post(p, c.kind, key, body);
      expect(res.status).toBe(500);
      expect(await posts(p, c.kind)).toBe(0);
      const [ch] = await charges(p);
      expect(ch.status).toBe("COMMITTED");
      expect(ch.refType).toBe(c.kind);
      expect(ch.refId).toBeNull();
      // The trigger that blocked the reversal is for the in-request step; the sweeper's own reversal is blocked by it too, so lift it for this key.
      await h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { idempotencyKey: `x-${key}` },
      });
      expect(await sweeper.sweep(new Date(Date.now() + 29 * MIN))).toBe(0);
      expect(await sweeper.sweep(new Date(Date.now() + 31 * MIN))).toBe(1);
      expect((await charges(p))[0].status).toBe("REVERSED");
      expect(await balance(p)).toBe(before.bal);
      expect(await freeLeft(p)).toBe(before.free);
      expect(await posts(p, c.kind)).toBe(0);
    });

    it("the happy path: the post exists only with its charge linked (checked inside the transaction at commit)", async () => {
      const { p, body } = await setup(c);
      const res = await post(p, c.kind, randomUUID(), body).expect(201);
      const id = res.body[c.kind].id;
      const [ch] = await charges(p);
      expect(ch.status).toBe("COMMITTED");
      expect(ch.refType).toBe(c.kind);
      expect(ch.refId).toBe(id);
      expect(ch.usedFreePost).toBe(c.free);
      expect(await sweeper.sweep(new Date(Date.now() + 31 * MIN))).toBe(0);
      expect(await posts(p, c.kind)).toBe(1);
    });
  });

  it("a reader never sees a post whose charge is not linked (20 people posting, one reader loop)", async () => {
    const people = await Promise.all(
      Array.from({ length: 20 }, () =>
        makePerson(h, { freePosts: 0, balanceMilli: 500_000 }),
      ),
    );
    let stop = false;
    let seen = 0;
    const bad: unknown[] = [];
    const reader = (async () => {
      while (!stop) {
        const rows = await h.prisma.$queryRaw<{ id: string }[]>`
          SELECT a."id" FROM "Answer" a
          WHERE a."authorId" = ANY(${people.map((p) => p.id)})
            AND NOT EXISTS (SELECT 1 FROM "Charge" c WHERE c."userId" = a."authorId" AND c."refId" = a."id")`;
        seen++;
        if (rows.length) bad.push(rows);
      }
    })();
    await Promise.all(
      people.map((p) =>
        post(p, "answer", randomUUID(), {
          kind: "TEXT",
          body: "Posting together.",
        }).expect(201),
      ),
    );
    stop = true;
    await reader;
    expect(seen).toBeGreaterThan(5);
    expect(bad).toEqual([]);
    expect(
      await h.prisma.answer.count({
        where: { authorId: { in: people.map((p) => p.id) } },
      }),
    ).toBe(20);
  });

  describe("the link matches exactly one charge", () => {
    it("a replay under an older, unmarked, unlinked charge (no post stored) writes the post and links it", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      await watch(p);
      const key = randomUUID();
      const first = await post(p, "answer", key, {
        kind: "TEXT",
        body: "Stored once.",
      }).expect(201);
      await h.prisma.answer.deleteMany({ where: { id: first.body.answer.id } });
      await h.prisma.idempotencyRecord.deleteMany({
        where: { actorId: p.id, key },
      });
      await h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { refType: null, refId: null },
      });
      const again = await post(p, "answer", key, {
        kind: "TEXT",
        body: "Stored once.",
      }).expect(201);
      const all = await charges(p);
      expect(all).toHaveLength(1);
      expect(all[0].refId).toBe(again.body.answer.id);
      expect(all[0].refType).toBe("answer");
    });

    it("a replay whose charge was reversed or linked meanwhile fails and stores nothing (the link matches none)", async () => {
      const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
      const key = randomUUID();
      const first = await post(p, "answer", key, {
        kind: "TEXT",
        body: "Stored once.",
      }).expect(201);
      // Another request linked the charge to some other post meanwhile: this request's own answer must not be stored.
      await h.prisma.answer.deleteMany({ where: { id: first.body.answer.id } });
      await h.prisma.idempotencyRecord.deleteMany({
        where: { actorId: p.id, key },
      });
      await h.prisma.charge.updateMany({
        where: { userId: p.id },
        data: { refType: "answer", refId: null, status: "REVERSED" },
      });
      const res = await post(p, "answer", key, {
        kind: "TEXT",
        body: "Stored once.",
      });
      expect(res.status).toBe(409);
      expect(await posts(p, "answer")).toBe(0);
    });
  });
});
