/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- tests read untyped JSON bodies */
import { bootAdmin, seedAnswer, seedQuestion, type Admin } from "./helpers";

/** lead ruling WF, 6 Nov: RW8 (blocking hides both people on every read path) and RW7 (notification words). */
describe("WF-1: RW8 blocking, RW7 notification words", () => {
  let a: Admin;
  let q: string;
  const api = "/api/v1";

  beforeAll(async () => {
    a = await bootAdmin();
    for (const n of ["ada", "ngozi", "tunde", "kemi", "blocker"])
      await a.person(n);
    q = (await seedQuestion(a, "What should change?")).id;
    await a.prisma.question.update({
      where: { id: q },
      data: {
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
  });
  afterAll(async () => {
    // leave no moderation rows, strikes or notifications for the suites that run after this one
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification", "Block" CASCADE`,
    );
    await a.close();
  });

  const get = (path: string, who?: string) => {
    const r = a.h.http().get(`${api}${path}`);
    return who ? r.set(a.auth(who)) : r;
  };
  const block = (blocker: string, blocked: string) =>
    a.prisma.block.create({
      data: {
        blockerId: a.people[blocker].id,
        blockedId: a.people[blocked].id,
      },
    });
  const unblockAll = () => a.prisma.block.deleteMany({});

  describe("RW8: an answer by someone you blocked, or who blocked you, is not served", () => {
    for (const direction of [
      "viewer blocked author",
      "author blocked viewer",
    ]) {
      it(`GET /answers/{id}, replies, news, search, like/react/save: ${direction}`, async () => {
        await unblockAll();
        const ans = await seedAnswer(a, q, a.people.ngozi.id, {
          body: "ngozi zebra opinion",
        });
        const reply = await a.prisma.reply.create({
          data: {
            answerId: ans.id,
            authorId: a.people.ngozi.id,
            stance: "AGREE",
            kind: "TEXT",
            body: "ngozi replies",
          },
        });
        const mine = await seedAnswer(a, q, a.people.ada.id, {
          body: "ada root",
        });
        const replyToMine = await a.prisma.reply.create({
          data: {
            answerId: mine.id,
            authorId: a.people.ngozi.id,
            stance: "DISAGREE",
            kind: "TEXT",
            body: "ngozi on ada",
          },
        });
        // before the block everything is served
        await get(`/answers/${ans.id}`, "ada").expect(200);
        expect(
          (await get(`/answers/${mine.id}/replies`, "ada").expect(200)).body
            .items,
        ).toHaveLength(1);
        if (direction === "viewer blocked author") await block("ada", "ngozi");
        else await block("ngozi", "ada");

        const direct = await get(`/answers/${ans.id}`, "ada").expect(404);
        expect(direct.body.error.message).toBe("We could not find that.");
        await get(`/answers/${ans.id}/replies`, "ada").expect(404);
        // her reply under MY answer is gone from my list, in both directions
        expect(
          (await get(`/answers/${mine.id}/replies`, "ada").expect(200)).body
            .items,
        ).toHaveLength(0);
        // her answer is still served to a stranger, and to a guest
        await get(`/answers/${ans.id}`, "tunde").expect(200);
        await get(`/answers/${ans.id}`).expect(200);
        // lists
        const list = await get(`/questions/${q}/answers`, "ada").expect(200);
        expect(
          list.body.items.map((i: { answer: { id: string } }) => i.answer.id),
        ).not.toContain(ans.id);
        const search = await get(`/search?q=zebra&type=answers`, "ada").expect(
          200,
        );
        expect(search.body.answers.map((x: { id: string }) => x.id)).toEqual(
          [],
        );
        // writes on it
        await a.h
          .http()
          .put(`${api}/answers/${ans.id}/like`)
          .set(a.auth("ada"))
          .expect(404);
        await a.h
          .http()
          .put(`${api}/answers/${ans.id}/save`)
          .set(a.auth("ada"))
          .expect(404);
        await a.h
          .http()
          .put(`${api}/answers/${ans.id}/reaction`)
          .set(a.auth("ada"))
          .set("Idempotency-Key", `k-${direction}`)
          .send({ kind: "POWERFUL" })
          .expect(404);
        void reply;
        void replyToMine;
      });
    }

    it("a blocked person's reply is hidden from the replies of a third answer too, and unblocking brings it back", async () => {
      await unblockAll();
      const mine = await seedAnswer(a, q, a.people.ada.id);
      await a.prisma.reply.create({
        data: {
          answerId: mine.id,
          authorId: a.people.tunde.id,
          stance: "AGREE",
          kind: "TEXT",
          body: "from tunde",
        },
      });
      await block("tunde", "ada"); // tunde blocked ada
      expect(
        (await get(`/answers/${mine.id}/replies`, "ada").expect(200)).body
          .items,
      ).toHaveLength(0);
      await unblockAll();
      expect(
        (await get(`/answers/${mine.id}/replies`, "ada").expect(200)).body
          .items,
      ).toHaveLength(1);
    });

    it("the news route, saved list and the person's page serve nothing of a blocked person", async () => {
      await unblockAll();
      const post = await seedAnswer(a, q, a.people.ngozi.id, {
        isNews: true,
        newsTag: "GOSSIP",
        body: "news from ngozi",
      });
      await get(`/news/${post.id}`, "ada").expect(200);
      await block("ngozi", "ada");
      await get(`/news/${post.id}`, "ada").expect(404);
      const list = await get(`/news`, "ada").expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(
        post.id,
      );
      await get(`/people/${a.people.ngozi.id}`, "ada").expect(404);
      await unblockAll();
    });
  });

  describe("RW7: notification words name the person, never a blocked one", () => {
    const reply = (who: string, answerId: string, body: string, key: string) =>
      a.h
        .http()
        .post(`${api}/answers/${answerId}/replies`)
        .set(a.auth(who))
        .set("Idempotency-Key", key)
        .send({ stance: "AGREE", kind: "TEXT", body });

    it("a reply: '@kemi.b replied to your voice' with the quote as the body, a target, and the question to open", async () => {
      await unblockAll();
      await a.prisma.notification.deleteMany({});
      const mine = await seedAnswer(a, q, a.people.ada.id, { body: "mine" });
      const long =
        "I think the market women deserve a hearing before anything else is decided about the roads in our town";
      await reply("kemi", mine.id, long, "wf-r1").expect(201);
      const n = (await get(`/notifications`, "ada").expect(200)).body;
      expect(n.items).toHaveLength(1);
      const row = n.items[0];
      expect(row.title).toBe("@a7b.kemi replied to your voice");
      expect(row.body.startsWith("“I think the market women")).toBe(true);
      expect(row.body.endsWith("…”")).toBe(true);
      expect([...row.body].length).toBeLessThanOrEqual(64);
      expect(row.targetType).toBe("answer");
      expect(row.targetId).toBe(mine.id);
      expect(row.questionId).toBe(q);
      expect(n.unread).toBe(1);
      expect(
        (await get(`/me`, "ada").expect(200)).body.unreadNotifications,
      ).toBe(1);
    });

    it("reactions fold into '@x and N others reacted to your voice'; a blocked reactor is never named or counted", async () => {
      await unblockAll();
      await a.prisma.notification.deleteMany({});
      const mine = await seedAnswer(a, q, a.people.ada.id, {
        body: "react to me",
      });
      for (const who of ["tunde", "kemi", "ngozi"])
        await a.h
          .http()
          .put(`${api}/answers/${mine.id}/reaction`)
          .set(a.auth(who))
          .set("Idempotency-Key", `wf-react-${who}`)
          .send({ kind: "POWERFUL" })
          .expect(200);
      let rows = (await get(`/notifications`, "ada").expect(200)).body.items;
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe(
        "@a7b.tunde and 2 others reacted to your voice",
      );
      expect(rows[0].actorCount).toBe(3);
      expect(rows[0].body).toBe("“react to me”");
      // tunde (the first reactor) blocks ada: ada must not see his name, and the count drops by one
      await block("tunde", "ada");
      rows = (await get(`/notifications`, "ada").expect(200)).body.items;
      expect(rows[0].title).toBe("@a7b.kemi and 1 other reacted to your voice");
      expect(JSON.stringify(rows)).not.toContain("tunde");
      // everyone who reacted is blocked either way: the notice goes, and the bell with it
      await block("ada", "kemi");
      await block("ngozi", "ada");
      rows = (await get(`/notifications`, "ada").expect(200)).body.items;
      expect(rows).toHaveLength(0);
      expect(
        (await get(`/me`, "ada").expect(200)).body.unreadNotifications,
      ).toBe(0);
      await unblockAll();
    });

    it("a reply from a person blocked since is not shown or counted; no notice is made when blocked already", async () => {
      await unblockAll();
      await a.prisma.notification.deleteMany({});
      const mine = await seedAnswer(a, q, a.people.ada.id, { body: "mine 2" });
      await reply("ngozi", mine.id, "first", "wf-r2").expect(201);
      expect(
        (await get(`/notifications`, "ada").expect(200)).body.items,
      ).toHaveLength(1);
      await block("ada", "ngozi");
      const after = (await get(`/notifications`, "ada").expect(200)).body;
      expect(after.items).toHaveLength(0);
      expect(after.unread).toBe(0);
      await unblockAll();
      await block("ada", "tunde");
      await reply("tunde", mine.id, "x", "wf-r3").expect(404); // F4: the block is not revealed
      await unblockAll();
    });

    it("a notice that has no body in the database still comes with one", async () => {
      await a.prisma.notification.deleteMany({});
      await a.prisma.notification.create({
        data: {
          userId: a.people.ada.id,
          type: "RESULT_CHECKED",
          title: "Your result was checked and marked Verified",
          targetType: "result_post",
          targetId: mine_id(),
        },
      });
      const rows = (await get(`/notifications`, "ada").expect(200)).body.items;
      expect(typeof rows[0].body).toBe("string");
      expect(rows[0].body.length).toBeGreaterThan(0);
      expect(rows[0].questionId).toBeNull();
    });
  });
});

function mine_id(): string {
  return "0190a000-0000-7000-8000-00000000beef";
}
