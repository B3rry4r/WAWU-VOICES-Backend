/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read JSON bodies and raw SQL rows */
import {
  boot,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "./helpers";
import { DeletionService } from "../../src/me/deletion.service";

/** RW9 (lead ruling WF fix round 1): a deletion is cancelled only by the person's own Undo. */
describe("RW9: deletion is cancelled only by Undo", () => {
  let h: Harness;
  let cats: string[];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeAll(async () => {
    h = await boot();
    await reset();
    cats = await seedCategories(4);
  });
  afterAll(() => h.close());

  const request = async (sub: string, handle: string) => {
    const a = await signUp(h, sub, handle, cats);
    await h
      .http()
      .delete("/api/v1/me")
      .set(auth(a.token))
      .send({ confirmHandle: handle, understandUnitsForfeited: true })
      .expect(202);
    return a;
  };
  const status = async (id: string) =>
    (
      await sql<any>(
        `SELECT status, "deletionRequestedAt" d FROM "User" WHERE id=$1`,
        [id],
      )
    )[0];

  it("Me.deletionScheduledFor is requested-at plus 14 days, null when nothing is pending", async () => {
    const a = await signUp(h, "rw9-a", "rw9.a", cats);
    expect(
      (await h.http().get("/api/v1/me").set(auth(a.token)).expect(200)).body
        .deletionScheduledFor,
    ).toBeNull();
    await h
      .http()
      .delete("/api/v1/me")
      .set(auth(a.token))
      .send({ confirmHandle: "rw9.a", understandUnitsForfeited: true })
      .expect(202);
    const me = (await h.http().get("/api/v1/me").set(auth(a.token)).expect(200))
      .body;
    const at = (await status(a.me.id)).d as Date;
    expect(me.status).toBe("DELETION_PENDING");
    expect(me.deletionScheduledFor).toBe(
      new Date(at.getTime() + 14 * 86_400_000).toISOString(),
    );
  });

  it("a token refresh (new iat, new token, POST /me again) leaves the deletion pending", async () => {
    const a = await request("rw9-b", "rw9.b");
    const requested = (await status(a.me.id)).d as Date;
    for (let i = 1; i <= 3; i++) {
      const fresh = h.token("rw9-b", {
        iat: Math.floor(requested.getTime() / 1000) + 60 * i,
      });
      await h.http().get("/api/v1/me").set(auth(fresh)).expect(200);
      await h.http().get("/api/v1/me/settings").set(auth(fresh)).expect(200);
    }
    expect((await status(a.me.id)).status).toBe("DELETION_PENDING");
  });

  it("Undo cancels it, writes an audit line, is idempotent, and the person can write again", async () => {
    const a = await request("rw9-c", "rw9.c");
    const r = await h
      .http()
      .post("/api/v1/me/deletion/cancel")
      .set(auth(a.token))
      .expect(200);
    expect(r.body.status).toBe("ACTIVE");
    expect(r.body.deletionScheduledFor).toBeNull();
    expect(await status(a.me.id)).toMatchObject({ status: "ACTIVE", d: null });
    expect(
      await sql(
        `SELECT 1 FROM "AuditLog" WHERE action='account.delete_cancelled' AND "targetId"=$1`,
        [a.me.id],
      ),
    ).toHaveLength(1);
    const again = await h
      .http()
      .post("/api/v1/me/deletion/cancel")
      .set(auth(a.token))
      .expect(200);
    expect(again.body.status).toBe("ACTIVE");
    expect(
      await sql(
        `SELECT 1 FROM "AuditLog" WHERE action='account.delete_cancelled' AND "targetId"=$1`,
        [a.me.id],
      ),
    ).toHaveLength(1);
    await h
      .http()
      .patch("/api/v1/me/settings")
      .set(auth(a.token))
      .send({ dataSaver: true })
      .expect(200);
    await h.http().post("/api/v1/me/deletion/cancel").expect(401);
  });

  it("the purge runs on day 15, not before; Undo after the purge is 409", async () => {
    const a = await request("rw9-d", "rw9.d");
    const svc = h.app.get(DeletionService);
    const requested = (await status(a.me.id)).d as Date;
    expect(
      await svc.purgeDue(new Date(requested.getTime() + 13 * 86_400_000)),
    ).toBe(0);
    expect((await status(a.me.id)).status).toBe("DELETION_PENDING");
    expect(
      await svc.purgeDue(
        new Date(requested.getTime() + 14 * 86_400_000 + 1000),
      ),
    ).toBeGreaterThanOrEqual(1);
    expect((await status(a.me.id)).status).toBe("DELETED");
    const late = await h
      .http()
      .post("/api/v1/me/deletion/cancel")
      .set(auth(a.token))
      .expect(409);
    expect(late.body.error.message).toBe(
      "This account has already been deleted.",
    );
    expect((await status(a.me.id)).status).toBe("DELETED");
  });
});
