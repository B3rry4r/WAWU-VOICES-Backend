/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read JSON bodies and raw SQL rows */
import {
  boot,
  reset,
  seedCategories,
  signUp,
  sql,
  type Harness,
} from "./helpers";
import { DeletionService } from "../../src/me/deletion.service";

/**
 * V-FIX-D: an unnamed reply by an account that is deleted behaves exactly as an anonymous answer by that account does today:
 * both stay (as "Anonymous") until the purge, which runs after the 14 day grace the person can undo, and then both are
 * removed in the same transaction with their text blanked and the parents' counters moved the same way. So the count
 * change cannot be tied to the deletion any better or worse than for an anonymous answer, and nothing happens at the
 * moment the person asks.
 */
describe("V-FIX-D: an unnamed reply and a deleted account", () => {
  let h: Harness;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  beforeAll(async () => {
    h = await boot();
    await reset();
  });
  afterAll(() => h.close());

  it("the purge removes the unnamed reply and an anonymous answer alike; asking for deletion changes nothing visible", async () => {
    const cats = await seedCategories(4);
    const owner = await signUp(h, "fd-owner", "fd.owner", cats);
    const leaver = await signUp(h, "fd-leaver", "fd.leaver", cats);
    const q = (
      await sql<{ id: string }>(
        `INSERT INTO "Question"(id,"categoryId",kind,status,text,"updatedAt") VALUES (gen_random_uuid(),$1,'DAILY','LIVE','Are you fine?',now()) RETURNING id`,
        [cats[0]],
      )
    )[0].id;
    const mk = async (author: string, anon: boolean, body: string) =>
      (
        await sql<{ id: string }>(
          `INSERT INTO "Answer"(id,"questionId","authorId",kind,body,status,anonymous,"updatedAt") VALUES (gen_random_uuid(),$1,$2,'TEXT',$3,'PUBLISHED',$4,now()) RETURNING id`,
          [q, author, body, anon],
        )
      )[0].id;
    const root = await mk(owner.me.id, false, "Root answer");
    const anonAnswer = await mk(
      leaver.me.id,
      true,
      "Unnamed answer by the leaver",
    );
    await sql(`UPDATE "Question" SET "answerCount" = 2 WHERE id=$1`, [q]);
    const posted = await h
      .http()
      .post(`/api/v1/answers/${root}/replies`)
      .set(auth(leaver.token))
      .set("Idempotency-Key", "fd-del-1")
      .send({
        stance: "AGREE",
        kind: "TEXT",
        body: "Unnamed reply",
        anonymous: true,
      })
      .expect(201);
    const replyId = posted.body.reply.id as string;
    const counts = async () => ({
      reply: (
        await sql<any>(`SELECT "replyCount" c FROM "Answer" WHERE id=$1`, [
          root,
        ])
      )[0].c,
      answers: (
        await sql<any>(`SELECT "answerCount" c FROM "Question" WHERE id=$1`, [
          q,
        ])
      )[0].c,
    });
    expect(await counts()).toEqual({ reply: 1, answers: 2 });

    await h
      .http()
      .delete("/api/v1/me")
      .set(auth(leaver.token))
      .send({ confirmHandle: "fd.leaver", understandUnitsForfeited: true })
      .expect(202);
    // asking changes nothing anyone can see: the counts and the reply stay until the purge
    expect(await counts()).toEqual({ reply: 1, answers: 2 });
    let list = await h
      .http()
      .get(`/api/v1/answers/${root}/replies`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].author).toBeNull();
    expect(JSON.stringify(list.body)).not.toContain("fd.leaver");

    await h.moduleRef
      .get(DeletionService)
      .purge(leaver.me.id, new Date(Date.now() + 15 * 24 * 3600_000));

    const reply = (
      await sql<any>(`SELECT status, body FROM "Reply" WHERE id=$1`, [replyId])
    )[0];
    const ans = (
      await sql<any>(`SELECT status, body FROM "Answer" WHERE id=$1`, [
        anonAnswer,
      ])
    )[0];
    expect(reply).toMatchObject({ status: "DELETED_BY_AUTHOR", body: null });
    expect(ans).toMatchObject({ status: "DELETED_BY_AUTHOR", body: null });
    expect(await counts()).toEqual({ reply: 0, answers: 1 });
    list = await h.http().get(`/api/v1/answers/${root}/replies`).expect(200);
    expect(list.body.items).toHaveLength(0);
  });
});
