/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "../test-env";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
} from "./harness";

/**
 * The post's row lock (the edit's, and a Verified News request's) must not conflict with the FOR KEY SHARE lock a foreign key
 * check takes when a child row of the post (a reaction, flag, reply) is inserted. A plain FOR UPDATE does, and that formed a
 * deadlock between an edit, a reaction and a flag.
 */
const SRC = (f: string) =>
  readFileSync(join(__dirname, "..", "..", "src", f), "utf8");

/** The lock statement as the code has it: the text inside the tagged template, with its parameter put back. */
function lockSql(file: string, param: string): string {
  const m = SRC(file).match(
    new RegExp(
      '\\$queryRaw`(SELECT id FROM "Answer" WHERE id = \\$\\{' +
        param +
        "\\} FOR [A-Z ]+)`",
    ),
  );
  if (!m) throw new Error(`lock statement not found in ${file}`);
  return m[1].replace("${" + param + "}", "$1");
}

function pgClient() {
  const u = new URL(TEST_DATABASE_URL);
  u.search = "";
  return new Client({ connectionString: u.toString() });
}

describe("the post's row lock does not block foreign key checks", () => {
  let h: Harness;
  let qid: string;
  beforeAll(async () => {
    h = await startHarness();
    qid = (await makeQuestion(h)).id;
  });
  afterAll(() => h.close());

  const cases: [string, string, string][] = [
    ["the edit (posts.service.ts)", "talk/posts.service.ts", "id"],
    [
      "the Verified News request (news.service.ts)",
      "news/news.service.ts",
      "answerId",
    ],
  ];

  it.each(cases)(
    "%s: its lock is FOR NO KEY UPDATE and returns at once while a reaction insert is open",
    async (_name, file, param) => {
      const sql = lockSql(file, param);
      expect(sql).toMatch(/FOR NO KEY UPDATE$/);

      const author = await makePerson(h);
      const other = await makePerson(h);
      const a = await h.prisma.answer.create({
        data: { questionId: qid, authorId: author.id, kind: "TEXT", body: "x" },
      });

      const r = pgClient();
      const e = pgClient();
      await r.connect();
      await e.connect();
      try {
        // (a) transaction R inserts a Reaction for the answer and stays open (its foreign key check key-shares the Answer row)
        await r.query("BEGIN");
        await r.query(
          `INSERT INTO "Reaction" (id, "answerId", "userId", kind, "updatedAt") VALUES ($1, $2, $3, 'POWERFUL', now())`,
          [randomUUID(), a.id, other.id],
        );
        // (b) a second connection takes the lock exactly as the code does: it must not wait for R
        await e.query("BEGIN");
        await e.query("SET LOCAL lock_timeout = '5s'");
        const t0 = Date.now();
        const got = await Promise.race([
          e.query(sql, [a.id]).then(() => "done"),
          new Promise((res) => setTimeout(() => res("waited"), 1000)),
        ]);
        expect(got).toBe("done");
        expect(Date.now() - t0).toBeLessThan(1000);
        // (c) commit both
        await e.query("COMMIT");
        await r.query("COMMIT");
      } finally {
        await r.query("ROLLBACK").catch(() => undefined);
        await e.query("ROLLBACK").catch(() => undefined);
        await r.end();
        await e.end();
      }
    },
    30_000,
  );

  it("sanity: a plain FOR UPDATE does wait for the open reaction insert (so the test above can fail)", async () => {
    const author = await makePerson(h);
    const other = await makePerson(h);
    const a = await h.prisma.answer.create({
      data: { questionId: qid, authorId: author.id, kind: "TEXT", body: "x" },
    });
    const r = pgClient();
    const e = pgClient();
    await r.connect();
    await e.connect();
    try {
      await r.query("BEGIN");
      await r.query(
        `INSERT INTO "Reaction" (id, "answerId", "userId", kind, "updatedAt") VALUES ($1, $2, $3, 'POWERFUL', now())`,
        [randomUUID(), a.id, other.id],
      );
      await e.query("BEGIN");
      const pending = e.query(
        'SELECT id FROM "Answer" WHERE id = $1 FOR UPDATE',
        [a.id],
      );
      const got = await Promise.race([
        pending.then(() => "done"),
        new Promise((res) => setTimeout(() => res("waited"), 700)),
      ]);
      expect(got).toBe("waited");
      await r.query("COMMIT");
      await pending;
      await e.query("COMMIT");
    } finally {
      await r.query("ROLLBACK").catch(() => undefined);
      await e.query("ROLLBACK").catch(() => undefined);
      await r.end();
      await e.end();
    }
  }, 30_000);

  it("an edit, a reaction and a flag on one answer at the same instant, 40 rounds: no 5xx", async () => {
    let bad = 0;
    const seen: unknown[] = [];
    for (let i = 0; i < 40; i++) {
      const p = await makePerson(h, { balanceMilli: 900_000, freePosts: 0 });
      const other = await makePerson(h);
      const made = await h
        .http()
        .post(`/api/v1/questions/${qid}/answers`)
        .set("Authorization", p.auth)
        .set({ "Idempotency-Key": `lnk-${i}-${Math.random()}` })
        .send({
          kind: "TEXT",
          body: "a",
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        })
        .expect(201);
      const id = made.body.answer.id as string;
      const edit = h
        .http()
        .patch(`/api/v1/answers/${id}`)
        .set("Authorization", p.auth)
        .send({ body: "e".repeat(120) });
      const reaction = h
        .http()
        .put(`/api/v1/answers/${id}/reaction`)
        .set("Authorization", other.auth)
        .set({ "Idempotency-Key": `lnk-rx-${i}-${Math.random()}` })
        .send({ kind: "POWERFUL" });
      const flag = h
        .http()
        .post(`/api/v1/news/${id}/flag`)
        .set("Authorization", other.auth)
        .send({});
      const all = await Promise.all([edit, reaction, flag]);
      for (const r of all)
        if (r.status >= 500) {
          bad++;
          seen.push(r.body);
        }
    }
    expect(seen).toEqual([]);
    expect(bad).toBe(0);
  }, 300_000);
});
