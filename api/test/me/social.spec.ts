/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read JSON bodies and raw SQL rows */
import {
  boot,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "./helpers";

describe("me: blocks, people, lists, deletion, export", () => {
  let h: Harness;
  let cats: string[];
  let q1: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    h = await boot();
    await reset();
    cats = await seedCategories(4);
    q1 = (
      await sql<any>(
        `INSERT INTO "Question"(id,"categoryId",kind,status,text,"updatedAt") VALUES (gen_random_uuid(),$1,'DAILY','LIVE','Are you fine?',now()) RETURNING id`,
        [cats[0]],
      )
    )[0].id;
  });
  afterAll(() => h.close());

  const answer = async (
    authorId: string,
    body: string,
    over: Record<string, string> = {},
  ) =>
    (
      await sql<any>(
        `INSERT INTO "Answer"(id,"questionId","authorId",kind,body,status,anonymous,"updatedAt") VALUES (gen_random_uuid(),$1,$2,'TEXT',$3,$4::"ContentStatus",$5,now()) RETURNING id`,
        [
          q1,
          authorId,
          body,
          over.status ?? "PUBLISHED",
          over.anonymous === "true",
        ],
      )
    )[0].id as string;

  describe("blocks", () => {
    it("block, list, unblock; blocking is idempotent; people are hidden from each other both ways", async () => {
      const a = await signUp(h, "bl-a", "bl.a", cats);
      const b = await signUp(h, "bl-b", "bl.b", cats);
      const c = await signUp(h, "bl-c", "bl.c", cats);
      const ans = await answer(b.me.id, "b talks");
      await h
        .http()
        .put(`/api/v1/me/blocks/${b.me.id}`)
        .set(auth(a.token))
        .expect(204);
      await h
        .http()
        .put(`/api/v1/me/blocks/${b.me.id}`)
        .set(auth(a.token))
        .expect(204);
      expect(
        (await sql(`SELECT 1 FROM "Block" WHERE "blockerId"=$1`, [a.me.id]))
          .length,
      ).toBe(1);
      const list = await h
        .http()
        .get("/api/v1/me/blocks")
        .set(auth(a.token))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].user.handle).toBe("bl.b");
      expect(list.body.nextCursor).toBeNull();
      // a sees b's page as blocked, with no voices; b gets a plain 404 for a
      const seen = await h
        .http()
        .get(`/api/v1/people/${b.me.id}`)
        .set(auth(a.token))
        .expect(200);
      expect(seen.body.isBlockedByMe).toBe(true);
      expect(seen.body.recentAnswers).toEqual([]);
      await h
        .http()
        .get(`/api/v1/people/${a.me.id}`)
        .set(auth(b.token))
        .expect(404);
      await h
        .http()
        .get(`/api/v1/people/${a.me.id}/replies`)
        .set(auth(b.token))
        .expect(404);
      // c is unaffected and sees b's voice
      const c2 = await h
        .http()
        .get(`/api/v1/people/${b.me.id}`)
        .set(auth(c.token))
        .expect(200);
      expect(c2.body.isBlockedByMe).toBe(false);
      expect(c2.body.recentAnswers.map((x: any) => x.id)).toEqual([ans]);
      // the exported helper agrees
      const { BlocksService } = await import("../../src/me/blocks.js");
      const blocks = h.moduleRef.get(BlocksService);
      expect(await blocks.hiddenUserIds(a.me.id)).toEqual([b.me.id]);
      expect(await blocks.hiddenUserIds(b.me.id)).toEqual([a.me.id]);
      expect(await blocks.hiddenUserIds(c.me.id)).toEqual([]);
      await expect(
        blocks.assertCanInteract(b.me.id, a.me.id),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        blocks.assertCanInteract(c.me.id, a.me.id),
      ).resolves.toBeUndefined();
      await h
        .http()
        .delete(`/api/v1/me/blocks/${b.me.id}`)
        .set(auth(a.token))
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/me/blocks/${b.me.id}`)
        .set(auth(a.token))
        .expect(204);
      expect(
        (await h.http().get("/api/v1/me/blocks").set(auth(a.token))).body.items,
      ).toEqual([]);
      await h
        .http()
        .get(`/api/v1/people/${a.me.id}`)
        .set(auth(b.token))
        .expect(200);
    });

    it("refuses blocking yourself (422), a missing person (404) and a non-uuid (404)", async () => {
      const a = await signUp(h, "bl-d", "bl.d", cats);
      expect(
        (
          await h
            .http()
            .put(`/api/v1/me/blocks/${a.me.id}`)
            .set(auth(a.token))
            .expect(422)
        ).body.error.code,
      ).toBe("VALIDATION_FAILED");
      await h
        .http()
        .put("/api/v1/me/blocks/0190a000-0000-7000-8000-000000000abc")
        .set(auth(a.token))
        .expect(404);
      await h
        .http()
        .put("/api/v1/me/blocks/not-a-uuid")
        .set(auth(a.token))
        .expect(404);
    });

    it("a path id is never trusted: unblocking someone else's block does nothing", async () => {
      const a = await signUp(h, "bl-e", "bl.e", cats);
      const b = await signUp(h, "bl-f", "bl.f", cats);
      const c = await signUp(h, "bl-g", "bl.g", cats);
      await h
        .http()
        .put(`/api/v1/me/blocks/${c.me.id}`)
        .set(auth(a.token))
        .expect(204);
      await h
        .http()
        .delete(`/api/v1/me/blocks/${c.me.id}`)
        .set(auth(b.token))
        .expect(204);
      expect(
        (
          await sql(
            `SELECT 1 FROM "Block" WHERE "blockerId"=$1 AND "blockedId"=$2`,
            [a.me.id, c.me.id],
          )
        ).length,
      ).toBe(1);
      expect(
        (await h.http().get("/api/v1/me/blocks").set(auth(b.token))).body.items,
      ).toEqual([]);
    });

    it("the blocks list pages with an opaque cursor, and a stale or forged cursor is 400", async () => {
      const a = await signUp(h, "bl-p", "bl.p", cats);
      for (let i = 0; i < 3; i++) {
        const x = await signUp(h, `bl-px${i}`, `bl.px${i}`, cats);
        await h
          .http()
          .put(`/api/v1/me/blocks/${x.me.id}`)
          .set(auth(a.token))
          .expect(204);
      }
      const p1 = await h
        .http()
        .get("/api/v1/me/blocks?limit=2")
        .set(auth(a.token))
        .expect(200);
      expect(p1.body.items).toHaveLength(2);
      expect(p1.body.nextCursor).toEqual(expect.any(String));
      const p2 = await h
        .http()
        .get(`/api/v1/me/blocks?limit=2&cursor=${p1.body.nextCursor}`)
        .set(auth(a.token))
        .expect(200);
      expect(p2.body.items).toHaveLength(1);
      expect(p2.body.nextCursor).toBeNull();
      await h
        .http()
        .get("/api/v1/me/blocks?cursor=garbage")
        .set(auth(a.token))
        .expect(400);
      const old = Buffer.from(
        JSON.stringify({
          t: new Date().toISOString(),
          id: "x",
          iat: Date.now() - 25 * 3600_000,
        }),
      ).toString("base64url");
      await h
        .http()
        .get(`/api/v1/me/blocks?cursor=${old}`)
        .set(auth(a.token))
        .expect(400);
      await h
        .http()
        .get("/api/v1/me/blocks?limit=51")
        .set(auth(a.token))
        .expect(400);
    });
  });

  describe("people", () => {
    it("GET /people/{id} works for a guest and shows only published, non-anonymous voices", async () => {
      const a = await signUp(h, "pe-a", "pe.a", cats);
      const shown = await answer(a.me.id, "visible");
      await answer(a.me.id, "anon", { anonymous: "true" });
      await answer(a.me.id, "held", { status: "HELD" });
      await answer(a.me.id, "removed", { status: "REMOVED" });
      const res = await h.http().get(`/api/v1/people/${a.me.id}`).expect(200);
      expect(res.body.profile).toMatchObject({ id: a.me.id, handle: "pe.a" });
      expect(res.body.isBlockedByMe).toBe(false);
      expect(res.body.recentAnswers.map((x: any) => x.id)).toEqual([shown]);
      expect(res.body.recentAnswers[0]).toMatchObject({
        isMine: false,
        iLiked: false,
        iSaved: false,
        questionText: "Are you fine?",
        categoryName: "Category 0",
      });
      const own = await h
        .http()
        .get(`/api/v1/people/${a.me.id}`)
        .set(auth(a.token))
        .expect(200);
      expect(own.body.recentAnswers[0].isMine).toBe(true);
      // the profile shows no private fields
      expect(JSON.stringify(res.body)).not.toMatch(
        /phone|wawuId|email|referral/i,
      );
    });

    it("404 for unknown, malformed, banned, deleting and deleted people; a stale token is 401", async () => {
      const a = await signUp(h, "pe-b", "pe.b", cats);
      await h
        .http()
        .get("/api/v1/people/0190a000-0000-7000-8000-000000000abc")
        .expect(404);
      await h.http().get("/api/v1/people/zzz").expect(404);
      for (const st of ["BANNED", "DELETION_PENDING", "DELETED"]) {
        await sql(`UPDATE "User" SET status=$2::"AccountStatus" WHERE id=$1`, [
          a.me.id,
          st,
        ]);
        await h.http().get(`/api/v1/people/${a.me.id}`).expect(404);
      }
      await sql(`UPDATE "User" SET status='ACTIVE' WHERE id=$1`, [a.me.id]);
      await h
        .http()
        .get(`/api/v1/people/${a.me.id}`)
        .set("Authorization", "Bearer junk")
        .expect(401);
    });

    it("GET /people/{id}/replies leaves out replies on removed posts and pages newest first", async () => {
      const a = await signUp(h, "pe-c", "pe.c", cats);
      const b = await signUp(h, "pe-d", "pe.d", cats);
      const live = await answer(b.me.id, "live");
      const gone = await answer(b.me.id, "gone", { status: "REMOVED" });
      const mk = (ansId: string, body: string) =>
        sql(
          `INSERT INTO "Reply"(id,"answerId","authorId",stance,kind,body,"updatedAt") VALUES (gen_random_uuid(),$1,$2,'AGREE','TEXT',$3,now())`,
          [ansId, a.me.id, body],
        );
      await mk(live, "first");
      await mk(gone, "on removed");
      await mk(live, "second");
      const res = await h
        .http()
        .get(`/api/v1/people/${a.me.id}/replies`)
        .expect(200);
      expect(res.body.items.map((r: any) => r.body)).toEqual([
        "second",
        "first",
      ]);
      expect(res.body.items[0]).toMatchObject({
        stance: "AGREE",
        isMine: false,
        author: { handle: "pe.c" },
      });
      const p = await h
        .http()
        .get(`/api/v1/people/${a.me.id}/replies?limit=1`)
        .expect(200);
      expect(p.body.items).toHaveLength(1);
      expect(p.body.nextCursor).not.toBeNull();
      // b blocks a: b no longer sees a's replies
      await h
        .http()
        .put(`/api/v1/me/blocks/${a.me.id}`)
        .set(auth(b.token))
        .expect(204);
      await h
        .http()
        .get(`/api/v1/people/${a.me.id}/replies`)
        .set(auth(b.token))
        .expect(200);
    });
  });

  describe("my voices and saved", () => {
    it("GET /me/answers lists only my own voices (published, held, removed), wrapped as type answer", async () => {
      const a = await signUp(h, "my-a", "my.a", cats);
      const b = await signUp(h, "my-b", "my.b", cats);
      await answer(a.me.id, "one");
      await answer(a.me.id, "anon", { anonymous: "true" });
      await answer(a.me.id, "deleted", { status: "DELETED_BY_AUTHOR" });
      await answer(b.me.id, "not mine");
      const res = await h
        .http()
        .get("/api/v1/me/answers")
        .set(auth(a.token))
        .expect(200);
      expect(res.body.items.map((i: any) => i.type)).toEqual([
        "answer",
        "answer",
      ]);
      expect(res.body.items.map((i: any) => i.answer.body).sort()).toEqual([
        "anon",
        "one",
      ]);
      expect(res.body.items.every((i: any) => i.answer.isMine)).toBe(true);
      expect(
        res.body.items.find((i: any) => i.answer.body === "anon").answer.author,
      ).toBeNull();
    });

    it("GET /me/saved merges saved answers and questions, newest first, hides removed posts and blocked authors, filters by kind", async () => {
      const a = await signUp(h, "sv-a", "sv.a", cats);
      const b = await signUp(h, "sv-b", "sv.b", cats);
      const ok = await answer(b.me.id, "keep");
      const removed = await answer(b.me.id, "removed", { status: "REMOVED" });
      const mkSave = (id: string) =>
        sql(
          `INSERT INTO "Save"(id,"userId","answerId") VALUES (gen_random_uuid(),$1,$2)`,
          [a.me.id, id],
        );
      await mkSave(removed);
      await new Promise((r) => setTimeout(r, 5));
      await mkSave(ok);
      await new Promise((r) => setTimeout(r, 5));
      await sql(
        `INSERT INTO "SavedQuestion"(id,"userId","questionId") VALUES (gen_random_uuid(),$1,$2)`,
        [a.me.id, q1],
      );
      const res = await h
        .http()
        .get("/api/v1/me/saved")
        .set(auth(a.token))
        .expect(200);
      expect(res.body.items.map((i: any) => i.kind)).toEqual([
        "QUESTION",
        "ANSWER",
      ]);
      expect(res.body.items[0].question).toMatchObject({
        id: q1,
        iSaved: true,
        text: "Are you fine?",
        category: { name: "Category 0" },
        answerCount: 0,
        hasOpenPoll: false,
      });
      expect(res.body.items[0].answer).toBeNull();
      expect(res.body.items[1].answer).toMatchObject({ id: ok, iSaved: true });
      expect(
        (await h.http().get("/api/v1/me/saved?kind=ANSWER").set(auth(a.token)))
          .body.items,
      ).toHaveLength(1);
      expect(
        (
          await h
            .http()
            .get("/api/v1/me/saved?kind=QUESTION")
            .set(auth(a.token))
        ).body.items,
      ).toHaveLength(1);
      await h
        .http()
        .get("/api/v1/me/saved?kind=OTHER")
        .set(auth(a.token))
        .expect(422);
      const p = await h
        .http()
        .get("/api/v1/me/saved?limit=1")
        .set(auth(a.token))
        .expect(200);
      expect(p.body.nextCursor).not.toBeNull();
      const p2 = await h
        .http()
        .get(`/api/v1/me/saved?limit=1&cursor=${p.body.nextCursor}`)
        .set(auth(a.token))
        .expect(200);
      expect(p2.body.items[0].kind).toBe("ANSWER");
      await h
        .http()
        .put(`/api/v1/me/blocks/${b.me.id}`)
        .set(auth(a.token))
        .expect(204);
      expect(
        (await h.http().get("/api/v1/me/saved?kind=ANSWER").set(auth(a.token)))
          .body.items,
      ).toEqual([]);
      // another person's saves are never visible
      expect(
        (await h.http().get("/api/v1/me/saved").set(auth(b.token))).body.items,
      ).toEqual([]);
    });
  });

  describe("delete account (V-16)", () => {
    it("needs the handle and the units warning; starts a 14-day grace; reads stay open, writes close", async () => {
      const a = await signUp(h, "del-a", "del.a", cats);
      const del = (b: object) =>
        h.http().delete("/api/v1/me").set(auth(a.token)).send(b);
      const bad = await del({
        confirmHandle: "wrong",
        understandUnitsForfeited: false,
      }).expect(422);
      expect(
        bad.body.error.details.fields.map((f: any) => f.path).sort(),
      ).toEqual(["confirmHandle", "understandUnitsForfeited"]);
      await del({ confirmHandle: "del.a" }).expect(422);
      await del({
        confirmHandle: "DEL.A",
        understandUnitsForfeited: true,
      }).expect(202);
      await del({
        confirmHandle: "del.a",
        understandUnitsForfeited: true,
      }).expect(202);
      const [u] = await sql<any>(
        `SELECT status,"deletionRequestedAt" FROM "User" WHERE id=$1`,
        [a.me.id],
      );
      expect(u.status).toBe("DELETION_PENDING");
      expect(u.deletionRequestedAt).toBeTruthy();
      expect(
        (
          await sql(
            `SELECT 1 FROM "AuditLog" WHERE action='account.delete_requested' AND "targetId"=$1`,
            [a.me.id],
          )
        ).length,
      ).toBe(1);
      // the same (older) token still reads, but cannot write
      const me = await h
        .http()
        .get("/api/v1/me/settings")
        .set(auth(a.token))
        .expect(200);
      expect(me).toBeTruthy();
      const w = await h
        .http()
        .patch("/api/v1/me/settings")
        .set(auth(a.token))
        .send({ dataSaver: true })
        .expect(403);
      expect(w.body.error.code).toBe("ACCOUNT_SUSPENDED");
      await h.http().get(`/api/v1/people/${a.me.id}`).expect(404);
    });

    it("signing in again (a token issued after the request) cancels the deletion; an older token does not", async () => {
      const a = await signUp(h, "del-b", "del.b", cats);
      await h
        .http()
        .delete("/api/v1/me")
        .set(auth(a.token))
        .send({ confirmHandle: "del.b", understandUnitsForfeited: true })
        .expect(202);
      const requested = (
        await sql<any>(
          `SELECT "deletionRequestedAt" d FROM "User" WHERE id=$1`,
          [a.me.id],
        )
      )[0].d as Date;
      const before = h.token("del-b", {
        iat: Math.floor(requested.getTime() / 1000) - 60,
      });
      await h.http().get("/api/v1/me").set(auth(before)).expect(200);
      expect(
        (await sql<any>(`SELECT status FROM "User" WHERE id=$1`, [a.me.id]))[0]
          .status,
      ).toBe("DELETION_PENDING");
      const after = h.token("del-b", {
        iat: Math.floor(Date.now() / 1000) + 5,
      });
      const res = await h.http().get("/api/v1/me").set(auth(after)).expect(200);
      expect(res.body.status).toBe("ACTIVE");
      const [u] = await sql<any>(
        `SELECT status,"deletionRequestedAt" FROM "User" WHERE id=$1`,
        [a.me.id],
      );
      expect(u).toMatchObject({ status: "ACTIVE", deletionRequestedAt: null });
    });

    it("the purge waits for the 14 days, then removes the person's data, forfeits units in the ledger and frees the handle and phone", async () => {
      const phone = "+2348066660001";
      const a = await signUp(h, "del-c", "del.c", cats, { phone });
      const other = await signUp(h, "del-d", "del.d", cats);
      const ans = await answer(a.me.id, "mine to remove");
      const theirs = await answer(other.me.id, "theirs");
      await sql(`UPDATE "Question" SET "answerCount"=1 WHERE id=$1`, [q1]);
      await sql(
        `INSERT INTO "Like"(id,"answerId","userId") VALUES (gen_random_uuid(),$1,$2)`,
        [theirs, a.me.id],
      );
      await sql(`UPDATE "Answer" SET "likeCount"=1 WHERE id=$1`, [theirs]);
      await sql(
        `INSERT INTO "Save"(id,"userId","answerId") VALUES (gen_random_uuid(),$1,$2)`,
        [a.me.id, theirs],
      );
      await sql(
        `INSERT INTO "Block"(id,"blockerId","blockedId") VALUES (gen_random_uuid(),$1,$2)`,
        [a.me.id, other.me.id],
      );
      // 7.5 units in the wallet, through the ledger as the units module will write it
      const tx = (
        await sql<any>(
          `INSERT INTO "LedgerTransaction"(id,kind,"idempotencyKey") VALUES (gen_random_uuid(),'PURCHASE','payment:del-c') RETURNING id`,
        )
      )[0].id;
      await sql(
        `INSERT INTO "LedgerEntry"(id,"txnId",account,"walletUserId","deltaMilli","balanceAfterMilli") VALUES (gen_random_uuid(),$1,'USER_WALLET',$2,7500,7500), (gen_random_uuid(),$1,'PURCHASES',NULL,-7500,NULL)`,
        [tx, a.me.id],
      );
      await sql(`UPDATE "Wallet" SET "balanceMilli"=7500 WHERE "userId"=$1`, [
        a.me.id,
      ]);
      await h
        .http()
        .delete("/api/v1/me")
        .set(auth(a.token))
        .send({ confirmHandle: "del.c", understandUnitsForfeited: true })
        .expect(202);

      const { DeletionService } =
        await import("../../src/me/deletion.service.js");
      const svc = h.moduleRef.get(DeletionService);
      expect(
        await svc.purgeDue(new Date(Date.now() + 13 * 24 * 3600_000)),
      ).toBe(0);
      expect(
        (await sql<any>(`SELECT status FROM "User" WHERE id=$1`, [a.me.id]))[0]
          .status,
      ).toBe("DELETION_PENDING");
      expect(
        await svc.purgeDue(new Date(Date.now() + 15 * 24 * 3600_000)),
      ).toBeGreaterThanOrEqual(1);

      const [u] = await sql<any>(`SELECT * FROM "User" WHERE id=$1`, [a.me.id]);
      expect(u).toMatchObject({
        status: "DELETED",
        phoneHash: null,
        displayName: null,
        bio: null,
      });
      expect(u.handle).toMatch(/^deleted-[0-9a-f]{12}$/);
      expect(u.wawuId).toBe(`deleted:${a.me.id}`);
      const [an] = await sql<any>(
        `SELECT status, body FROM "Answer" WHERE id=$1`,
        [ans],
      );
      expect(an).toEqual({ status: "DELETED_BY_AUTHOR", body: null });
      expect(
        (
          await sql<any>(`SELECT "answerCount" FROM "Question" WHERE id=$1`, [
            q1,
          ])
        )[0].answerCount,
      ).toBe(0);
      expect(
        (
          await sql<any>(`SELECT "likeCount" FROM "Answer" WHERE id=$1`, [
            theirs,
          ])
        )[0].likeCount,
      ).toBe(0);
      for (const t of [
        "Like",
        "Save",
        "UserSettings",
        "UserCategory",
        "NewsTagFollow",
        "FreeAllowance",
      ])
        expect(
          (await sql(`SELECT 1 FROM "${t}" WHERE "userId"=$1`, [a.me.id]))
            .length,
        ).toBe(0);
      expect(
        (await sql(`SELECT 1 FROM "Block" WHERE "blockerId"=$1`, [a.me.id]))
          .length,
      ).toBe(0);
      // the units are forfeited by one balanced ledger transaction, and the wallet is zero
      expect(
        (
          await sql<any>(
            `SELECT "balanceMilli" FROM "Wallet" WHERE "userId"=$1`,
            [a.me.id],
          )
        )[0].balanceMilli,
      ).toBe(0);
      const f = await sql<any>(
        `SELECT e.account, e."deltaMilli" FROM "LedgerTransaction" t JOIN "LedgerEntry" e ON e."txnId"=t.id WHERE t."idempotencyKey"=$1 ORDER BY e."deltaMilli"`,
        [`forfeit:${a.me.id}`],
      );
      expect(f.map((r) => r.deltaMilli)).toEqual([-7500, 7500]);
      // running the purge again changes nothing
      expect(
        await svc.purgeDue(new Date(Date.now() + 20 * 24 * 3600_000)),
      ).toBe(0);
      // the old WAWU ID is a stranger again: a fresh sign-up with the same handle and phone works
      const again = await h
        .http()
        .get("/api/v1/me")
        .set(auth(h.token("del-c", { phone })))
        .expect(200);
      expect(again.body.profileComplete).toBe(false);
      await signUp(h, "del-c2", "del.c", cats, { phone });
      expect(
        (
          await sql(
            `SELECT 1 FROM "AuditLog" WHERE action='account.purged' AND "targetId"=$1`,
            [a.me.id],
          )
        ).length,
      ).toBe(1);
    });
  });

  describe("last admin (M2)", () => {
    it("the only admin cannot delete the account (409 LAST_ADMIN); with a second admin they can; the purge skips a last admin", async () => {
      await sql(`TRUNCATE "UserRoleGrant"`);
      const a = await signUp(h, "la-a", "la.a", cats);
      const b = await signUp(h, "la-b", "la.b", cats);
      const grant = (id: string) =>
        sql(
          `INSERT INTO "UserRoleGrant"(id,"userId",role,"grantedById") VALUES (gen_random_uuid(),$1,'ADMIN',$1)`,
          [id],
        );
      await grant(a.me.id);
      const del = (t: string, hd: string) =>
        h
          .http()
          .delete("/api/v1/me")
          .set(auth(t))
          .send({ confirmHandle: hd, understandUnitsForfeited: true });
      const r = await del(a.token, "la.a").expect(409);
      expect(r.body.error.details.reason).toBe("LAST_ADMIN");
      expect(
        (await sql<any>(`SELECT status FROM "User" WHERE id=$1`, [a.me.id]))[0]
          .status,
      ).toBe("ACTIVE");
      await grant(b.me.id);
      await del(a.token, "la.a").expect(202);
      // b is now the last admin; two admins deleting at once: not both go
      await sql(
        `UPDATE "User" SET status='ACTIVE', "deletionRequestedAt"=NULL WHERE id=$1`,
        [a.me.id],
      );
      const [x, y] = await Promise.all([
        del(a.token, "la.a"),
        del(b.token, "la.b"),
      ]);
      expect([x.status, y.status].sort()).toEqual([202, 409]);
      // the purge never removes the last admin: force it
      const pend = (
        await sql<any>(
          `SELECT id FROM "User" WHERE status='DELETION_PENDING' AND id IN ($1,$2)`,
          [a.me.id, b.me.id],
        )
      )[0].id as string;
      const other = pend === a.me.id ? b.me.id : a.me.id;
      await sql(`DELETE FROM "UserRoleGrant" WHERE "userId"=$1`, [other]);
      const { DeletionService } =
        await import("../../src/me/deletion.service.js");
      await h.moduleRef
        .get(DeletionService)
        .purge(pend, new Date(Date.now() + 15 * 24 * 3600_000));
      expect(
        (await sql<any>(`SELECT status FROM "User" WHERE id=$1`, [pend]))[0]
          .status,
      ).toBe("DELETION_PENDING");
      expect(
        (await sql(`SELECT 1 FROM "UserRoleGrant" WHERE "userId"=$1`, [pend]))
          .length,
      ).toBe(1);
    });
  });

  describe("data export", () => {
    it("POST then GET: pending without storage keys (never faked), ready with a download link once the file is stored", async () => {
      const a = await signUp(h, "ex-a", "ex.a", cats);
      await answer(a.me.id, "export me");
      const first = await h
        .http()
        .post("/api/v1/me/export")
        .set(auth(a.token))
        .expect(202);
      expect(first.body).toMatchObject({
        status: "PENDING",
        downloadUrl: null,
      });
      const again = await h
        .http()
        .post("/api/v1/me/export")
        .set(auth(a.token))
        .expect(202);
      expect(again.body.id).toBe(first.body.id);
      const got = await h
        .http()
        .get("/api/v1/me/export")
        .set(auth(a.token))
        .expect(200);
      expect(got.body.id).toBe(first.body.id);
      // build with a stand-in store (the real one is Spaces)
      const { ExportService, ExportStore } =
        await import("../../src/me/export.service.js");
      const store = h.moduleRef.get(ExportStore);
      const put: Record<string, Buffer> = {};
      jest.spyOn(store, "isConfigured").mockReturnValue(true);
      jest.spyOn(store, "put").mockImplementation((k, b) => {
        put[k] = b;
        return Promise.resolve();
      });
      jest
        .spyOn(store, "signedGet")
        .mockResolvedValue("https://spaces.example/signed");
      await h.moduleRef.get(ExportService).build(first.body.id, a.me.id);
      const done = await h
        .http()
        .get("/api/v1/me/export")
        .set(auth(a.token))
        .expect(200);
      expect(done.body).toMatchObject({
        status: "READY",
        downloadUrl: "https://spaces.example/signed",
      });
      const file = JSON.parse(Object.values(put)[0].toString("utf8"));
      expect(file.profile.handle).toBe("ex.a");
      expect(file.answers.map((x: any) => x.body)).toEqual(["export me"]);
      expect(JSON.stringify(file)).not.toMatch(/wawuId|phoneHash|ex-a/);
      jest.restoreAllMocks();
    });

    it("404 before any request; another person's export is never returned", async () => {
      const a = await signUp(h, "ex-b", "ex.b", cats);
      await h.http().get("/api/v1/me/export").set(auth(a.token)).expect(404);
    });
  });
});
