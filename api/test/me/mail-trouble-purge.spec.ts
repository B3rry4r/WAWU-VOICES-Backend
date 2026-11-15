/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read raw SQL rows */
import {
  boot,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "./helpers";
import { DeletionService } from "../../src/me/deletion.service";

/** A deleted person leaves no TopicMailTrouble row behind, at the request and at the purge. */
describe("mail trouble rows go with the person", () => {
  let h: Harness;
  let cats: string[];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ids: string[] = [];
  beforeAll(async () => {
    h = await boot();
    await reset();
    cats = await seedCategories(4);
  });
  afterAll(async () => {
    if (ids.length)
      await sql(`DELETE FROM "TopicMailTrouble" WHERE "userId" = ANY($1)`, [
        ids,
      ]);
    await h.close();
  });

  const addTrouble = async (userId: string, templates: string[]) => {
    ids.push(userId);
    for (const t of templates)
      await sql(
        `INSERT INTO "TopicMailTrouble"("userId", template, "window", troubles, "lastTroubleAt") VALUES ($1,$2,'w-test',1,now())`,
        [userId, t],
      );
  };
  const count = async (userId: string) =>
    Number(
      (
        await sql<any>(
          `SELECT count(*)::int n FROM "TopicMailTrouble" WHERE "userId"=$1`,
          [userId],
        )
      )[0].n,
    );
  const requestDeletion = async (token: string, handle: string) =>
    h
      .http()
      .delete("/api/v1/me")
      .set(auth(token))
      .send({ confirmHandle: handle, understandUnitsForfeited: true })
      .expect(202);

  it("asking to delete clears both rows at once and leaves another person's rows", async () => {
    const a = await signUp(h, "mtp-a", "mtp.a", cats);
    const b = await signUp(h, "mtp-b", "mtp.b", cats);
    await addTrouble(a.me.id, ["C01", "C02"]);
    await addTrouble(b.me.id, ["C01", "C02"]);
    await requestDeletion(a.token, "mtp.a");
    expect(await count(a.me.id)).toBe(0);
    expect(await count(b.me.id)).toBe(2);
  });

  it("the purge clears the person's rows and leaves another person's rows", async () => {
    const a = await signUp(h, "mtp-c", "mtp.c", cats);
    const b = await signUp(h, "mtp-d", "mtp.d", cats);
    await requestDeletion(a.token, "mtp.c");
    // rows that arrive after the request (a mail still in flight) must go at the purge
    await addTrouble(a.me.id, ["C01", "C02"]);
    await addTrouble(b.me.id, ["C01"]);
    const [{ d }] = await sql<any>(
      `SELECT "deletionRequestedAt" d FROM "User" WHERE id=$1`,
      [a.me.id],
    );
    await h.app
      .get(DeletionService)
      .purgeDue(new Date((d as Date).getTime() + 14 * 86_400_000 + 1000));
    const [{ status }] = await sql<any>(
      `SELECT status FROM "User" WHERE id=$1`,
      [a.me.id],
    );
    expect(status).toBe("DELETED");
    expect(await count(a.me.id)).toBe(0);
    expect(await count(b.me.id)).toBe(1);
  });

  it("the purge of a person with no such rows works as before", async () => {
    const a = await signUp(h, "mtp-e", "mtp.e", cats);
    await requestDeletion(a.token, "mtp.e");
    const [{ d }] = await sql<any>(
      `SELECT "deletionRequestedAt" d FROM "User" WHERE id=$1`,
      [a.me.id],
    );
    await h.app
      .get(DeletionService)
      .purgeDue(new Date((d as Date).getTime() + 14 * 86_400_000 + 1000));
    const [{ status }] = await sql<any>(
      `SELECT status FROM "User" WHERE id=$1`,
      [a.me.id],
    );
    expect(status).toBe("DELETED");
    expect(await count(a.me.id)).toBe(0);
  });
});
