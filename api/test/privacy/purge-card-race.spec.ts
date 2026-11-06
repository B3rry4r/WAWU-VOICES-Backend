import { Client } from "pg";
import { DeletionService } from "../../src/me/deletion.service";
import { TEST_DATABASE_URL } from "../test-env";
import { mkUser, resetDb, startHarness, type Harness } from "../reach/helpers";

const DAY = 24 * 3_600_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("privacy P2-2: a share card drawn while its owner is purged leaves no file", () => {
  let h: Harness;
  let db: Client;
  beforeAll(async () => {
    await resetDb();
    h = await startHarness();
    db = new Client({ connectionString: TEST_DATABASE_URL });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
    await h.close();
  });

  async function profileCard(code: string) {
    const u = await mkUser(h);
    const link = await h.prisma.shortLink.create({
      data: { code, objectType: "PROFILE", objectId: u.id },
    });
    const card = await h.prisma.shareCard.create({
      data: { linkId: link.id, topicLine: "t" },
    });
    return { u, link, card };
  }

  it("the purge commits during the draw: the file is marked for deletion and nothing is linked", async () => {
    const { u, card } = await profileCard("rc00001");
    await db.query("BEGIN");
    await db.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [u.id]);
    const draw = h.cards.generate("rc00001");
    await wait(500); // the draw has rendered and stored the PNG and waits for the row
    await db.query(`DELETE FROM "ShareCard" WHERE id = $1`, [card.id]);
    await db.query(`UPDATE "User" SET status = 'DELETED' WHERE id = $1`, [
      u.id,
    ]);
    await db.query("COMMIT");
    await draw;
    expect(await h.prisma.shareCard.count({ where: { id: card.id } })).toBe(0);
    const files = await h.prisma.storedFile.findMany({
      where: { kind: "SHARE_CARD", key: { startsWith: "share/rc00001/" } },
    });
    expect(files.length).toBe(1);
    expect(files[0].purgeRequestedAt).not.toBeNull();
    // the storage job (tested with a store in purge-exports-cards.spec.ts) deletes every marked, unreferenced file
  });

  it("a draw that finishes before the purge is cleaned by the purge", async () => {
    const { u } = await profileCard("rc00002");
    await h.cards.generate("rc00002");
    const card = await h.prisma.shareCard.findFirstOrThrow({
      where: { link: { code: "rc00002" } },
    });
    expect(card.storyFileId).not.toBeNull();
    await h.prisma.user.update({
      where: { id: u.id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 20 * DAY),
      },
    });
    await h.app.get(DeletionService).purge(u.id);
    expect(await h.prisma.shareCard.count({ where: { id: card.id } })).toBe(0);
    const f = await h.prisma.storedFile.findUniqueOrThrow({
      where: { id: card.storyFileId as string },
    });
    expect(f.purgeRequestedAt).not.toBeNull();
  });
});
