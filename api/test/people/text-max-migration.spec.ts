import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { TEST_DATABASE_URL } from "../test-env";

const dir = join(
  __dirname,
  "../../prisma/migrations/20261114350000_text_max_2500",
);
const up = readFileSync(join(dir, "migration.sql"), "utf8");
const down = readFileSync(join(dir, "rollback.down.sql"), "utf8");

/** V-TEXT2500: the data migration and its rollback, run against rows in the migrated test database. */
describe("migration 20261114350000_text_max_2500", () => {
  let c: Client;
  const KEY = "text.max_chars";
  beforeAll(async () => {
    c = new Client({ connectionString: TEST_DATABASE_URL });
    await c.connect();
  });
  afterAll(async () => {
    await c.query(`DELETE FROM "ConfigEntry" WHERE "key" = $1`, [KEY]);
    await c.end();
  });
  const set = async (v: number | null) => {
    await c.query(`DELETE FROM "ConfigEntry" WHERE "key" = $1`, [KEY]);
    await c.query(`DELETE FROM "ConfigChange" WHERE "key" = $1`, [KEY]);
    if (v !== null)
      await c.query(
        `INSERT INTO "ConfigEntry" ("key", "valueJson", "updatedAt") VALUES ($1, to_jsonb($2::int), now())`,
        [KEY, v],
      );
  };
  const value = async () =>
    (
      await c.query<{ v: number }>(
        `SELECT "valueJson"::int AS v FROM "ConfigEntry" WHERE "key" = $1`,
        [KEY],
      )
    ).rows[0]?.v;
  const changes = async () =>
    (
      await c.query<{ o: number; n: number; reason: string }>(
        `SELECT "oldValue"::int AS o, "newValue"::int AS n, reason FROM "ConfigChange" WHERE "key" = $1`,
        [KEY],
      )
    ).rows;

  it("5000 becomes 2500 with a change row, and the rollback restores it", async () => {
    await set(5000);
    await c.query(up);
    expect(await value()).toBe(2500);
    const ch = await changes();
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ o: 5000, n: 2500 });
    expect(ch[0].reason).toContain("owner, 14 Nov 2026");
    await c.query(down);
    expect(await value()).toBe(5000);
  });

  it("a value an admin chose is left alone, in both directions", async () => {
    await set(3000);
    await c.query(up);
    expect(await value()).toBe(3000);
    expect(await changes()).toHaveLength(0);
    await c.query(down);
    expect(await value()).toBe(3000);
  });

  it("no row: nothing to do", async () => {
    await set(null);
    await c.query(up);
    expect(await value()).toBeUndefined();
    expect(await changes()).toHaveLength(0);
  });
});
