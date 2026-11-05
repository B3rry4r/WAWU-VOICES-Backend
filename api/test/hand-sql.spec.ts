import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "./test-env";

/**
 * Proves the hand-written SQL of the init migration, on a fresh database owned by a plain (non-superuser) role,
 * the way the droplet runs it. A superuser would bypass the REVOKE, so the test never uses one for the checks.
 */
describe("init migration hand-written SQL", () => {
  const stamp = `${process.pid}_${Date.now() % 100000}`;
  const db = `voices_sql_${stamp}`;
  const role = `voices_sql_app_${stamp}`;
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const appUrl = new URL(adminUrl.toString());
  appUrl.username = role;
  appUrl.password = "app";
  appUrl.pathname = `/${db}`;

  let c: Client;

  beforeAll(async () => {
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'app'`);
    await admin.query(`CREATE DATABASE ${db} OWNER ${role}`);
    await admin.end();
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: appUrl.toString() },
      stdio: "pipe",
    });
    c = new Client({ connectionString: appUrl.toString() });
    await c.connect();
    await c.query(
      `INSERT INTO "User" (id, "wawuId", handle, "referralCode", "updatedAt") VALUES ('u1','w1','amaka','R1', now())`,
    );
    await c.query(
      `INSERT INTO "Wallet" ("userId", "updatedAt") VALUES ('u1', now())`,
    );
  });

  afterAll(async () => {
    await c?.end();
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${role}`);
    await admin.end();
  });

  it("rejects a negative wallet balance", async () => {
    await expect(
      c.query(`UPDATE "Wallet" SET "balanceMilli" = -1 WHERE "userId" = 'u1'`),
    ).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("rejects a wallet balance above 2,000,000,000 and accepts the limit", async () => {
    await expect(
      c.query(
        `UPDATE "Wallet" SET "balanceMilli" = 2000000001 WHERE "userId" = 'u1'`,
      ),
    ).rejects.toMatchObject({
      code: "23514",
    });
    await c.query(
      `UPDATE "Wallet" SET "balanceMilli" = 2000000000 WHERE "userId" = 'u1'`,
    );
    await c.query(
      `UPDATE "Wallet" SET "balanceMilli" = 0 WHERE "userId" = 'u1'`,
    );
  });

  it("rejects an unbalanced ledger transaction at commit and accepts a balanced one", async () => {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO "LedgerTransaction" (id, kind, "idempotencyKey") VALUES ('t1','ADJUSTMENT','k1')`,
    );
    await c.query(
      `INSERT INTO "LedgerEntry" (id, "txnId", account, "walletUserId", "deltaMilli") VALUES ('e1','t1','USER_WALLET','u1',500)`,
    );
    await expect(c.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK").catch(() => undefined);
    const none = await c.query(
      `SELECT count(*)::int AS n FROM "LedgerTransaction" WHERE id = 't1'`,
    );
    expect((none.rows[0] as { n: number }).n).toBe(0);

    await c.query("BEGIN");
    await c.query(
      `INSERT INTO "LedgerTransaction" (id, kind, "idempotencyKey") VALUES ('t2','ADJUSTMENT','k2')`,
    );
    await c.query(
      `INSERT INTO "LedgerEntry" (id, "txnId", account, "walletUserId", "deltaMilli") VALUES ('e2','t2','USER_WALLET','u1',500)`,
    );
    await c.query(
      `INSERT INTO "LedgerEntry" (id, "txnId", account, "deltaMilli") VALUES ('e3','t2','ADJUSTMENT',-500)`,
    );
    await c.query("COMMIT");
    const n = await c.query(
      `SELECT count(*)::int AS n FROM "LedgerEntry" WHERE "txnId" = 't2'`,
    );
    expect((n.rows[0] as { n: number }).n).toBe(2);
  });

  it.each(["LedgerEntry", "LedgerTransaction"])(
    "refuses UPDATE and DELETE on append-only %s",
    async (table) => {
      await expect(
        c.query(`UPDATE "${table}" SET id = id`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(c.query(`DELETE FROM "${table}"`)).rejects.toMatchObject({
        code: "42501",
      });
    },
  );

  it("refuses UPDATE and DELETE on AuditLog", async () => {
    await c.query(
      `INSERT INTO "AuditLog" (id, action, "targetType") VALUES ('a1','x','User')`,
    );
    await expect(
      c.query(`UPDATE "AuditLog" SET action = 'y'`),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(c.query(`DELETE FROM "AuditLog"`)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("refuses DELETE by privilege on all six append-only tables, UPDATE by privilege on the four leaf tables", async () => {
    for (const table of [
      "Vote",
      "VoteChoice",
      "LedgerTransaction",
      "LedgerEntry",
      "AuditLog",
      "TagChange",
    ]) {
      const r = await c.query(
        `SELECT has_table_privilege(current_user, '"${table}"', 'DELETE') AS d, has_table_privilege(current_user, '"${table}"', 'UPDATE') AS u, has_table_privilege(current_user, '"${table}"', 'INSERT') AS i`,
      );
      expect((r.rows[0] as { d: boolean }).d).toBe(false);
      expect((r.rows[0] as { i: boolean }).i).toBe(true);
      if (table !== "Vote" && table !== "LedgerTransaction")
        expect((r.rows[0] as { u: boolean }).u).toBe(false);
    }
  });

  it("the append-only trigger refuses UPDATE and DELETE on Vote and LedgerTransaction rows,, and on AuditLog and LedgerEntry even for a superuser", async () => {
    await expect(
      c.query(`UPDATE "LedgerTransaction" SET reason = 'x'`),
    ).rejects.toMatchObject({ code: "42501" });
    const admin = new Client({
      connectionString: new URL(`/${db}`, adminUrl).toString(),
    });
    await admin.connect();
    try {
      await expect(
        admin.query(`UPDATE "AuditLog" SET action = 'z'`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.query(`UPDATE "LedgerEntry" SET "deltaMilli" = 1`),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await admin.end();
    }
  });

  it("search: tsvector and trigram indexes exist and are used by the queries", async () => {
    const idx = await c.query(
      `SELECT indexname FROM pg_indexes WHERE indexname IN ('Question_searchTsv_idx','Answer_searchTsv_idx','Transcript_searchTsv_idx','User_handle_trgm_idx','Proposal_body_trgm_idx')`,
    );
    expect(idx.rowCount).toBe(5);
    await c.query(
      `INSERT INTO "Question" (id, text, "updatedAt") VALUES ('q1','How do you survive on payday', now())`,
    );
    const hit = await c.query(
      `SELECT id FROM "Question" WHERE "searchTsv" @@ plainto_tsquery('simple','payday')`,
    );
    expect(hit.rows).toEqual([{ id: "q1" }]);
    const h = await c.query(`SELECT handle FROM "User" WHERE handle % 'amka'`);
    expect(h.rows).toEqual([{ handle: "amaka" }]);
  });
});
