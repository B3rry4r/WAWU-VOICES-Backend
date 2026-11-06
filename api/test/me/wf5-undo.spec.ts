/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- tests read JSON bodies and raw SQL rows */
import {
  boot,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "./helpers";

/** lead ruling WF, 6 Nov (WF-5): Undo is refused after the 14 days and by a person with no account. */
describe("WF-5: Undo after the date, and with no account", () => {
  let h: Harness;
  let cats: string[];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeAll(async () => {
    h = await boot();
    await reset();
    cats = await seedCategories(4);
  });
  afterAll(() => h.close());

  it("Undo after deletionScheduledFor is 409 with the purge's words, before the purge runs", async () => {
    const a = await signUp(h, "wf5-u1", "wf5.u1", cats);
    await h
      .http()
      .delete("/api/v1/me")
      .set(auth(a.token))
      .send({ confirmHandle: "wf5.u1", understandUnitsForfeited: true })
      .expect(202);
    // 13 days in: Undo still works on a second request later; here day 14 and a minute has passed, no purge yet
    await sql(
      `UPDATE "User" SET "deletionRequestedAt" = now() - interval '14 days 1 minute' WHERE id = $1`,
      [a.me.id],
    );
    const late = await h
      .http()
      .post("/api/v1/me/deletion/cancel")
      .set(auth(a.token))
      .expect(409);
    expect(late.body.error.message).toBe(
      "This account has already been deleted.",
    );
    const row = (
      await sql<any>(`SELECT status FROM "User" WHERE id=$1`, [a.me.id])
    )[0];
    expect(row.status).toBe("DELETION_PENDING");
  });

  it("Undo on day 13 still works", async () => {
    const a = await signUp(h, "wf5-u2", "wf5.u2", cats);
    await h
      .http()
      .delete("/api/v1/me")
      .set(auth(a.token))
      .send({ confirmHandle: "wf5.u2", understandUnitsForfeited: true })
      .expect(202);
    await sql(
      `UPDATE "User" SET "deletionRequestedAt" = now() - interval '13 days' WHERE id = $1`,
      [a.me.id],
    );
    const ok = await h
      .http()
      .post("/api/v1/me/deletion/cancel")
      .set(auth(a.token))
      .expect(200);
    expect(ok.body.status).toBe("ACTIVE");
    expect(ok.body.deletionScheduledFor).toBeNull();
  });

  it("a person with no account gets 404 'We could not find that account.'", async () => {
    const r = await h
      .http()
      .post("/api/v1/me/deletion/cancel")
      .set(auth(h.token("wf5-no-account")))
      .expect(404);
    expect(r.body.error.message).toBe("We could not find that account.");
  });
});
