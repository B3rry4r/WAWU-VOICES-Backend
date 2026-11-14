import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "../test-env";
import { DeletionService } from "../../src/me/deletion.service";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/**
 * V-REL-D2-FIX2 (H2): an editor's decision, a moderator's action, a report, an edit and an account purge on ONE post at once.
 * Every path takes its locks in one order (the post, a reply's answer then the reply, the moderation items, the question
 * counters, then the person), so none of them answers 500 and Postgres never has to break a deadlock.
 *
 * 20 rounds of each mix stay in the suite (D2_ROUNDS=200 gives the full check). The test asserts counts, never time: it fires the
 * requests together, whatever order they land in, and checks what is left in the database.
 */
const ROUNDS = Number(process.env.D2_ROUNDS ?? 20);

interface Round {
  author: Person;
  postId: string;
  itemId: string;
}

describe("H2: one lock order for decision, removal, report, edit and purge", () => {
  let h: Harness;
  let qid: string;
  const everyone: string[] = [];
  const answers: string[] = [];

  beforeAll(async () => {
    h = await startHarness();
    qid = (await makeQuestion(h)).id;
  });
  afterAll(async () => {
    // leave no moderation rows behind: other suites read the moderation list and its first page
    await h.prisma.$executeRawUnsafe(
      `TRUNCATE "ModerationItem", "ModerationAction", "Strike", "Report", "Appeal" RESTART IDENTITY CASCADE`,
    );
    // leave no readable post behind: other suites page /feed/trending and /feed/new (a DRAFT question's posts are not read)
    await h.prisma.question.update({
      where: { id: qid },
      data: { status: "DRAFT" },
    });
    await h.close();
  });

  /** A post with one like, one reaction, one reply and one open moderation item; counters match the rows; the author's wallet has a real ledger. */
  async function build(withWallet: boolean): Promise<Round> {
    const author = await makePerson(h, {
      freePosts: 0,
      ...(withWallet ? { balanceMilli: 900_000 } : {}),
    });
    everyone.push(author.id);
    if (withWallet)
      await h.prisma.ledgerTransaction.create({
        data: {
          kind: "ADJUSTMENT",
          idempotencyKey: `d2:${randomUUID()}`,
          reason: "test",
          entries: {
            create: [
              {
                account: "USER_WALLET",
                walletUserId: author.id,
                deltaMilli: 900_000,
                balanceAfterMilli: 900_000,
              },
              { account: "ADJUSTMENT", deltaMilli: -900_000 },
            ],
          },
        },
      });
    const [liker, reactor, replier] = await Promise.all([
      makePerson(h),
      makePerson(h),
      makePerson(h),
    ]);
    everyone.push(liker.id, reactor.id, replier.id);
    const post = await h.prisma.answer.create({
      data: {
        questionId: qid,
        authorId: author.id,
        kind: "TEXT",
        body: "Fuel queue at the Ikeja station",
        isNews: true,
        newsTag: "UNVERIFIED_NEWS",
        likeCount: 1,
        reactionCount: 1,
        replyCount: 1,
        agreeCount: 1,
      },
    });
    answers.push(post.id);
    await h.prisma.question.update({
      where: { id: qid },
      data: { answerCount: { increment: 1 } },
    });
    await h.prisma.like.create({
      data: { answerId: post.id, userId: liker.id },
    });
    await h.prisma.reaction.create({
      data: { answerId: post.id, userId: reactor.id, kind: "POWERFUL" },
    });
    await h.prisma.reply.create({
      data: {
        answerId: post.id,
        authorId: replier.id,
        stance: "AGREE",
        kind: "TEXT",
        body: "I agree",
      },
    });
    const item = await h.prisma.moderationItem.create({
      data: {
        targetType: "ANSWER",
        targetId: post.id,
        queue: "REPORTED",
        reasons: ["SCAM_OR_SPAM"],
        reportCount: 1,
      },
    });
    return { author, postId: post.id, itemId: item.id };
  }

  const jitter = () =>
    new Promise<void>((r) =>
      setTimeout(
        r,
        Math.floor(Math.random() * Number(process.env.D2_JITTER ?? 6)),
      ),
    );
  const code = (p: Promise<{ status: number }>) =>
    p.then(
      (r) => r.status,
      () => 599,
    );

  // The admin routes are rate limited per person, so every round uses new staff.
  async function staff() {
    const [editor, moderator, reporter] = await Promise.all([
      makePerson(h, { roles: ["EDITOR"] }),
      makePerson(h, { roles: ["MODERATOR"] }),
      makePerson(h),
    ]);
    everyone.push(editor.id, moderator.id, reporter.id);
    return { editor, moderator, reporter };
  }

  const actions = {
    decide: (r: Round, s: Awaited<ReturnType<typeof staff>>, n: number) =>
      h
        .http()
        .post(`/api/v1/admin/news/${r.postId}/decision`)
        .set("Authorization", s.editor.auth)
        .send({
          decision: n % 2 ? "SEND_TO_MODERATION" : "KEEP",
          reason: "Looked at it.",
        }),
    remove: (r: Round, s: Awaited<ReturnType<typeof staff>>) =>
      h
        .http()
        .post(`/api/v1/admin/moderation/items/${r.itemId}/action`)
        .set("Authorization", s.moderator.auth)
        .send({ action: "REMOVE_AND_WARN", reason: "Against the rules." }),
    edit: (r: Round) =>
      h
        .http()
        .patch(`/api/v1/answers/${r.postId}`)
        .set("Authorization", r.author.auth)
        .send({
          body: `Fuel queue at the Ikeja station ${randomUUID().slice(0, 4)}`,
        }),
    report: (r: Round, s: Awaited<ReturnType<typeof staff>>) =>
      h
        .http()
        .post("/api/v1/reports")
        .set("Authorization", s.reporter.auth)
        .send({ targetType: "ANSWER", targetId: r.postId, reason: "OTHER" }),
    purge: async (r: Round) => {
      try {
        await h.app.get(DeletionService, { strict: false }).purge(r.author.id);
        return { status: 200 };
      } catch {
        return { status: 500 };
      }
    },
  };
  type Name = keyof typeof actions;

  const MIXES: [string, Name[]][] = [
    ["decide + remove", ["decide", "remove"]],
    ["decide + remove + edit", ["decide", "remove", "edit"]],
    ["decide + remove + report", ["decide", "remove", "report"]],
    ["decide + purge", ["decide", "purge"]],
    ["remove + purge", ["remove", "purge"]],
    ["purge + remove + decide", ["purge", "remove", "decide"]],
  ];

  const deadlocks = async () => {
    // the statistics are flushed about once a second
    await new Promise((r) => setTimeout(r, 1600));
    const rows = await h.prisma.$queryRaw<{ n: number }[]>`
      SELECT deadlocks::int AS n FROM pg_stat_database WHERE datname = current_database()`;
    return rows[0].n;
  };

  async function invariants(): Promise<string[]> {
    const bad: string[] = [];
    const rows = (await h.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT a.id, a."likeCount" AS lc, a."reactionCount" AS rc, a."replyCount" AS pc, a."newsFlagCount" AS fc,
        (SELECT count(*)::int FROM "Like" l WHERE l."answerId" = a.id) AS likes,
        (SELECT count(*)::int FROM "Reaction" x WHERE x."answerId" = a.id) AS reactions,
        (SELECT count(*)::int FROM "Reply" p WHERE p."answerId" = a.id AND p.status = 'PUBLISHED') AS replies,
        (SELECT count(*)::int FROM "Report" f WHERE f."targetType" = 'ANSWER' AND f."targetId" = a.id AND f.reason = 'MISLEADING_NEWS_TAG') AS flags
       FROM "Answer" a WHERE a.id = ANY($1::text[])`,
      answers,
    )) as {
      id: string;
      lc: number;
      rc: number;
      pc: number;
      fc: number;
      likes: number;
      reactions: number;
      replies: number;
      flags: number;
    }[];
    for (const r of rows) {
      if (r.lc !== r.likes) bad.push(`likes ${r.id}: ${r.lc} vs ${r.likes}`);
      if (r.rc !== r.reactions)
        bad.push(`reactions ${r.id}: ${r.rc} vs ${r.reactions}`);
      if (r.pc !== r.replies)
        bad.push(`replies ${r.id}: ${r.pc} vs ${r.replies}`);
      if (r.fc !== r.flags) bad.push(`flags ${r.id}: ${r.fc} vs ${r.flags}`);
    }
    const txns = await h.prisma.$queryRaw<{ id: string }[]>`
      SELECT "txnId" AS id FROM "LedgerEntry" GROUP BY "txnId" HAVING sum("deltaMilli") <> 0`;
    for (const t of txns)
      bad.push(`ledger transaction ${t.id} does not sum to zero`);
    const wallets = (await h.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT w."userId" AS id FROM "Wallet" w
       WHERE w."userId" = ANY($1::text[])
         AND w."balanceMilli" <> COALESCE((SELECT sum(e."deltaMilli") FROM "LedgerEntry" e WHERE e."walletUserId" = w."userId"), 0)`,
      everyone,
    )) as { id: string }[];
    for (const w of wallets) bad.push(`wallet ${w.id} differs from its ledger`);
    return bad;
  }

  it.each(MIXES)(
    "%s: no 500, counters and ledger agree",
    async (_name, names) => {
      const before = await deadlocks();
      const fives: string[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const r = await build(
          names.includes("edit") || names.includes("purge"),
        );
        const s = await staff();
        if (names.includes("purge"))
          await h.prisma.user.update({
            where: { id: r.author.id },
            data: {
              status: "DELETION_PENDING",
              deletionRequestedAt: new Date(Date.now() - 15 * 86_400_000),
            },
          });
        const out = await Promise.all(
          names.map(async (n, k) => {
            await jitter();
            const res =
              n === "purge"
                ? await actions.purge(r)
                : n === "decide"
                  ? await code(actions.decide(r, s, i + k)).then((c) => ({
                      status: c,
                    }))
                  : await code(
                      (
                        actions[n] as (
                          a: Round,
                          b: typeof s,
                        ) => Promise<{ status: number }>
                      )(r, s),
                    ).then((c) => ({
                      status: c,
                    }));
            return `${n}:${res.status}`;
          }),
        );
        for (const o of out) if (Number(o.split(":")[1]) >= 500) fives.push(o);
      }
      const bad = await invariants();
      const after = await deadlocks();
      if (process.env.D2_REPORT)
        console.log(
          `D2 ${_name}: rounds=${ROUNDS} 500s=${fives.length} ${JSON.stringify(
            fives.reduce<Record<string, number>>(
              (a, f) => ({
                ...a,
                [f.split(":")[0]]: (a[f.split(":")[0]] ?? 0) + 1,
              }),
              {},
            ),
          )} deadlocks=${after - before} bad=${bad.length}`,
        );
      expect(fives).toEqual([]);
      expect(bad).toEqual([]);
      expect(after - before).toBe(0);
    },
    ROUNDS * 4_000 + 60_000,
  );

  // The same order, shown without any luck: one connection holds a row, the action under test starts, and a second connection asks
  // (NOWAIT) which locks the action holds while it waits. No timing decides these.
  describe("the order, one lock at a time", () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** Waits until some backend is blocked on a lock (the action under test), as long as it takes up to 15 s: no fixed guess. */
    const untilWaiting = async (c: Client) => {
      for (let i = 0; i < 300; i++) {
        const r = await c.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if ((r.rows[0] as { n: number }).n > 0) return;
        await sleep(50);
      }
      throw new Error("the action never started waiting");
    };
    const open = async () => {
      const c = new Client({ connectionString: TEST_DATABASE_URL });
      await c.connect();
      return c;
    };
    /** True when the row can be locked at once, false when someone holds a conflicting lock. */
    const free = async (c: Client, sql: string): Promise<boolean> => {
      await c.query("BEGIN");
      try {
        await c.query(sql);
        return true;
      } catch (e) {
        if ((e as { code?: string }).code === "55P03") return false;
        throw e;
      } finally {
        await c.query("ROLLBACK");
      }
    };

    it("a moderator's action takes the post before it waits for the item", async () => {
      const r = await build(false);
      const s = await staff();
      const holder = await open();
      const probe = await open();
      try {
        await holder.query("BEGIN");
        await holder.query(
          `SELECT id FROM "ModerationItem" WHERE id = '${r.itemId}' FOR UPDATE`,
        );
        const act = actions.remove(r, s).then((x) => x.status);
        await untilWaiting(probe); // the action is now waiting for the item
        expect(
          await free(
            probe,
            `SELECT id FROM "Answer" WHERE id = '${r.postId}' FOR NO KEY UPDATE NOWAIT`,
          ),
        ).toBe(false);
        await holder.query("COMMIT");
        expect(await act).toBeLessThan(500);
      } finally {
        await holder.end();
        await probe.end();
      }
    });

    it("an editor's decision holds the post with FOR NO KEY UPDATE (a like or a reply can still be added) while it waits for the item", async () => {
      const r = await build(false);
      const s = await staff();
      const holder = await open();
      const probe = await open();
      try {
        await holder.query("BEGIN");
        await holder.query(
          `SELECT id FROM "ModerationItem" WHERE id = '${r.itemId}' FOR UPDATE`,
        );
        const dec = h
          .http()
          .post(`/api/v1/admin/news/${r.postId}/decision`)
          .set("Authorization", s.editor.auth)
          .send({ decision: "SEND_TO_MODERATION", reason: "Looked at it." })
          .then((x) => x.status);
        await untilWaiting(probe);
        expect(
          await free(
            probe,
            `SELECT id FROM "Answer" WHERE id = '${r.postId}' FOR NO KEY UPDATE NOWAIT`,
          ),
        ).toBe(false); // it holds the post
        expect(
          await free(
            probe,
            `SELECT id FROM "Answer" WHERE id = '${r.postId}' FOR KEY SHARE NOWAIT`,
          ),
        ).toBe(true); // and does not block a child row's key check
        await holder.query("COMMIT");
        expect(await dec).toBeLessThan(500);
      } finally {
        await holder.end();
        await probe.end();
      }
    });

    it("an account purge locks the posts it touches before the person's own row", async () => {
      const r = await build(true);
      await h.prisma.user.update({
        where: { id: r.author.id },
        data: {
          status: "DELETION_PENDING",
          deletionRequestedAt: new Date(Date.now() - 15 * 86_400_000),
        },
      });
      const holder = await open();
      const probe = await open();
      try {
        await holder.query("BEGIN");
        await holder.query(
          `SELECT id FROM "Answer" WHERE id = '${r.postId}' FOR NO KEY UPDATE`,
        );
        const purged = actions.purge(r).then((x) => x.status);
        await untilWaiting(probe); // the purge is now waiting for the post
        expect(
          await free(
            probe,
            `SELECT id FROM "User" WHERE id = '${r.author.id}' FOR UPDATE NOWAIT`,
          ),
        ).toBe(true); // it does not hold the person yet
        await holder.query("COMMIT");
        expect(await purged).toBe(200);
        const u = await h.prisma.user.findUniqueOrThrow({
          where: { id: r.author.id },
        });
        expect(u.status).toBe("DELETED");
      } finally {
        await holder.end();
        await probe.end();
      }
    });

    it("a report takes the post before the moderation item", async () => {
      const r = await build(false);
      const s = await staff();
      const holder = await open();
      const probe = await open();
      try {
        await holder.query("BEGIN");
        await holder.query(
          `SELECT id FROM "ModerationItem" WHERE id = '${r.itemId}' FOR UPDATE`,
        );
        const rep = actions.report(r, s).then((x) => x.status);
        await untilWaiting(probe);
        expect(
          await free(
            probe,
            `SELECT id FROM "Answer" WHERE id = '${r.postId}' FOR NO KEY UPDATE NOWAIT`,
          ),
        ).toBe(false);
        await holder.query("COMMIT");
        expect(await rep).toBe(201);
      } finally {
        await holder.end();
        await probe.end();
      }
    });
  });
});
