import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Harness, startHarness } from "../talk/harness";
import type { Prisma } from "../../src/generated/prisma/client";

const DIR = join(
  __dirname,
  "../../prisma/migrations/20261115100000_daily_words",
);
const UP = readFileSync(join(DIR, "migration.sql"), "utf8");
const DOWN = readFileSync(join(DIR, "rollback.down.sql"), "utf8")
  .replace(/^BEGIN;$/m, "")
  .replace(/^COMMIT;$/m, "");
const WORDS = ["ANGRY", "TIRED", "PROUD", "HOPEFUL"];

/** Rule W: the data migration, run inside a transaction that is always rolled back, so no row is ever left behind. */
describe("daily words migration", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  class Undo extends Error {}
  /** Runs `fn` in a transaction and rolls it back, returning what `fn` returned. */
  async function inTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    let out!: T;
    await h.prisma
      .$transaction(
        async (tx) => {
          out = await fn(tx);
          throw new Undo();
        },
        { timeout: 60_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Undo)) throw e;
      });
    return out;
  }

  async function author(tx: Prisma.TransactionClient) {
    const id = randomUUID();
    await tx.user.create({
      data: {
        id,
        wawuId: `dw-${id}`,
        handle: `d${id.replace(/-/g, "").slice(0, 18)}`,
        referralCode: id.slice(0, 12),
      },
    });
    return id;
  }
  async function answer(
    tx: Prisma.TransactionClient,
    questionId: string,
    status: "PUBLISHED" | "REMOVED" | "HELD",
    mood?: "ANGRY",
  ) {
    await tx.answer.create({
      data: {
        questionId,
        authorId: await author(tx),
        kind: "TEXT",
        body: "x",
        status,
        mood: mood ?? null,
      },
    });
  }
  const make = (
    tx: Prisma.TransactionClient,
    over: Prisma.QuestionUncheckedCreateInput | Record<string, unknown> = {},
  ) =>
    tx.question.create({
      data: { kind: "DAILY", ...over, text: "Daily words?" } as never,
    });
  const words = async (tx: Prisma.TransactionClient, id: string) =>
    (await tx.question.findUniqueOrThrow({ where: { id } })).moodOptions;
  const up = (tx: Prisma.TransactionClient) => tx.$executeRawUnsafe(UP);

  it("gives the four words to an answerless DAILY question in every status", async () => {
    const got = await inTx(async (tx) => {
      const ids: Record<string, string> = {};
      for (const s of ["DRAFT", "SCHEDULED", "LIVE", "CLOSED"] as const)
        ids[s] = (await make(tx, { status: s })).id;
      await up(tx);
      const out: Record<string, string[]> = {};
      for (const [s, id] of Object.entries(ids)) out[s] = await words(tx, id);
      return out;
    });
    for (const s of ["DRAFT", "SCHEDULED", "LIVE", "CLOSED"])
      expect(got[s]).toEqual(WORDS);
  });

  it("leaves a DAILY question with an answer, even a removed or held one, as it was", async () => {
    const got = await inTx(async (tx) => {
      const one = await make(tx, { status: "LIVE" });
      await answer(tx, one.id, "PUBLISHED");
      const removed = await make(tx, { status: "LIVE" });
      await answer(tx, removed.id, "REMOVED");
      const hidden = await make(tx, { status: "CLOSED" });
      await answer(tx, hidden.id, "HELD");
      await up(tx);
      return [
        await words(tx, one.id),
        await words(tx, removed.id),
        await words(tx, hidden.id),
      ];
    });
    expect(got).toEqual([[], [], []]);
  });

  it("leaves the launch question, a question with other words, and every other kind alone", async () => {
    const got = await inTx(async (tx) => {
      const launch = await make(tx, {
        status: "SCHEDULED",
        seedKey: "launch-mood-test",
        moodOptions: WORDS,
      });
      const two = await make(tx, {
        status: "LIVE",
        moodOptions: ["ANGRY", "TIRED"],
      });
      const others: string[] = [];
      for (const kind of ["FLASH", "FOLLOW_UP", "OVERRIDE"])
        others.push((await make(tx, { kind, status: "LIVE" })).id);
      await up(tx);
      return {
        launch: await words(tx, launch.id),
        two: await words(tx, two.id),
        others: await Promise.all(others.map((id) => words(tx, id))),
      };
    });
    expect(got.launch).toEqual(WORDS);
    expect(got.two).toEqual(["ANGRY", "TIRED"]);
    expect(got.others).toEqual([[], [], []]);
  });

  it("running it twice changes nothing more", async () => {
    const got = await inTx(async (tx) => {
      const q = await make(tx, { status: "LIVE" });
      const withAnswer = await make(tx, { status: "LIVE" });
      await answer(tx, withAnswer.id, "PUBLISHED");
      await up(tx);
      const first = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "Question" WHERE cardinality("moodOptions") > 0`,
      );
      const changed = await tx.$executeRawUnsafe(UP);
      const second = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "Question" WHERE cardinality("moodOptions") > 0`,
      );
      return {
        changed,
        same: first[0].n === second[0].n,
        q: await words(tx, q.id),
        a: await words(tx, withAnswer.id),
      };
    });
    expect(got.changed).toBe(0);
    expect(got.same).toBe(true);
    expect(got.q).toEqual(WORDS);
    expect(got.a).toEqual([]);
  });

  describe("the way back", () => {
    /** Starts from a database where no stray answer carries a word, so only this test's rows matter. */
    const clean = (tx: Prisma.TransactionClient) =>
      tx.$executeRawUnsafe(`UPDATE "Answer" SET "mood" = NULL`);

    it("empties the list where no answer carries a word, and keeps the launch question's words", async () => {
      const got = await inTx(async (tx) => {
        await clean(tx);
        const q = await make(tx, { status: "LIVE" });
        const launch = await make(tx, {
          seedKey: "launch-mood-1",
          status: "LIVE",
          moodOptions: WORDS,
        });
        await up(tx);
        const before = await words(tx, q.id);
        await tx.$executeRawUnsafe(DOWN);
        return {
          before,
          after: await words(tx, q.id),
          launch: await words(tx, launch.id),
        };
      });
      expect(got.before).toEqual(WORDS);
      expect(got.after).toEqual([]);
      expect(got.launch).toEqual(WORDS);
    });

    it("refuses, and changes nothing, when an answer to a daily question carries a word", async () => {
      const got = await inTx(async (tx) => {
        await clean(tx);
        const free = await make(tx, { status: "LIVE" });
        const used = await make(tx, {
          status: "LIVE",
          moodOptions: WORDS,
        });
        await answer(tx, used.id, "PUBLISHED", "ANGRY");
        await up(tx);
        await tx.$executeRawUnsafe("SAVEPOINT before_down");
        let refused = "";
        try {
          await tx.$executeRawUnsafe(DOWN);
        } catch (e) {
          refused = String(e);
        }
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT before_down");
        return {
          refused,
          free: await words(tx, free.id),
          used: await words(tx, used.id),
        };
      });
      expect(got.refused).toContain("rollback refused");
      expect(got.free).toEqual(WORDS);
      expect(got.used).toEqual(WORDS);
    });
  });
});
