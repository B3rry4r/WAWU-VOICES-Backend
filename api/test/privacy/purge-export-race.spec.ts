import { Client } from "pg";
import { DeletionService } from "../../src/me/deletion.service";
import { ExportService, ExportStore } from "../../src/me/export.service";
import { StoragePurgeService } from "../../src/media/storage-purge.service";
import { TEST_DATABASE_URL } from "../test-env";
import {
  makePerson,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";

const DAY = 24 * 3_600_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("privacy P2-2: the export build and the purge never leak a file", () => {
  let h: Harness;
  let db: Client;
  beforeAll(async () => {
    h = await startHarness();
    db = new Client({ connectionString: TEST_DATABASE_URL });
    await db.connect();
    const store = h.app.get(ExportStore);
    jest.spyOn(store, "isConfigured").mockReturnValue(true);
    jest.spyOn(store, "put").mockImplementation((k) => {
      h.store.objects.set(k, Buffer.from("x"));
      return Promise.resolve();
    });
    await h.app.get(StoragePurgeService).run(new Date(Date.now() + 100 * DAY));
  });
  afterAll(async () => {
    await db.query(`DROP TRIGGER IF EXISTS p22_slow ON "StoredFile"`);
    await db.end();
    jest.restoreAllMocks();
    await h.close();
  });

  const retire = (p: Person) =>
    h.prisma.user.update({
      where: { id: p.id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 20 * DAY),
      },
    });
  const newExport = (p: Person) =>
    h.prisma.dataExport.create({ data: { userId: p.id } });
  const build = (id: string, p: Person) =>
    h.app.get(ExportService).build(id, p.id);
  const purge = (p: Person) => h.app.get(DeletionService).purge(p.id);

  async function expectNoLeak(p: Person) {
    const files = await h.prisma.storedFile.findMany({
      where: { ownerId: p.id, kind: "DATA_EXPORT" },
    });
    for (const f of files)
      expect(f.purgeRequestedAt ?? f.purgedAt).not.toBeNull();
    const linked = await h.prisma.dataExport.count({
      where: { userId: p.id, fileId: { not: null } },
    });
    expect(linked).toBe(0);
    await h.app.get(StoragePurgeService).run();
    for (const f of files) expect(h.store.objects.has(f.key)).toBe(false);
  }

  it("window 1: the purge commits after the export read the status and before it links: the file is marked, not linked", async () => {
    const p = await makePerson(h);
    await retire(p);
    const row = await newExport(p);
    // hold the row the way the purge does, start the build, then finish the purge while the build waits
    await db.query("BEGIN");
    await db.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [p.id]);
    const done = build(row.id, p);
    await wait(400);
    await db.query(`UPDATE "User" SET status = 'DELETED' WHERE id = $1`, [
      p.id,
    ]);
    await db.query("COMMIT");
    await done;
    expect(
      await h.prisma.dataExport.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ fileId: null, status: "EXPIRED" });
    await expectNoLeak(p);
  });

  it("window 2: the purge starts while the export is writing its file: it waits, then marks the file and detaches the row", async () => {
    await db.query(`
      CREATE OR REPLACE FUNCTION p22_slow() RETURNS trigger AS $$
      BEGIN IF NEW.kind = 'DATA_EXPORT' THEN PERFORM pg_sleep(0.8); END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.query(
      `CREATE TRIGGER p22_slow BEFORE INSERT ON "StoredFile" FOR EACH ROW EXECUTE FUNCTION p22_slow()`,
    );
    try {
      const p = await makePerson(h);
      await retire(p);
      const row = await newExport(p);
      const b = build(row.id, p);
      await wait(300); // the build holds the share lock and sleeps inside the insert
      await purge(p);
      await b;
      const after = await h.prisma.dataExport.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.fileId).toBeNull();
      expect(
        (await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } })).status,
      ).toBe("DELETED");
      await expectNoLeak(p);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS p22_slow ON "StoredFile"`);
    }
  });

  it("20 races with random offsets leak nothing", async () => {
    for (let i = 0; i < 20; i++) {
      const p = await makePerson(h);
      await retire(p);
      const row = await newExport(p);
      const offset = Math.floor(Math.random() * 80);
      const first = Math.random() < 0.5;
      await Promise.all([
        (async () => {
          if (!first) await wait(offset);
          await build(row.id, p);
        })(),
        (async () => {
          if (first) await wait(offset);
          await purge(p);
        })(),
      ]);
      expect(
        (await h.prisma.user.findUniqueOrThrow({ where: { id: p.id } })).status,
      ).toBe("DELETED");
      await expectNoLeak(p);
    }
  }, 120_000);
});
