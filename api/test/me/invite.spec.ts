/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import {
  Harness,
  idem,
  makePerson,
  Person,
  startHarness,
} from "../talk/harness";
import { DeletionService } from "../../src/me/deletion.service";
import { ExportService, ExportStore } from "../../src/me/export.service";
import type { Mood } from "../../src/generated/prisma/client";

/** LCH-06: personal invite links and the friends who answered. */
describe("invite links and friends who answered", () => {
  let h: Harness;
  let qid: string;
  beforeAll(async () => {
    process.env.INVITE_CLAIM_LIMIT = "100000";
    process.env.PUBLIC_WEB_BASE = "http://stand-in.test";
    h = await startHarness();
    qid = (
      await h.prisma.question.create({
        data: {
          text: "How do you feel about Nigeria right now?",
          status: "LIVE",
          startsAt: new Date(Date.now() - 3_600_000),
          endsAt: new Date(Date.now() + 86_400_000),
          moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
        },
      })
    ).id;
  });
  afterAll(async () => {
    await h.close();
  });

  const get = (p: Person, path: string) =>
    h.http().get(`/api/v1${path}`).set("Authorization", p.auth);
  const claim = (p: Person, code: string) =>
    h
      .http()
      .post("/api/v1/me/invite/claim")
      .set("Authorization", p.auth)
      .send({ code });
  const settings = (p: Person, body: object) =>
    h
      .http()
      .patch("/api/v1/me/settings")
      .set("Authorization", p.auth)
      .send(body);
  const answer = (p: Person, mood: Mood | null = "HOPEFUL", at = new Date()) =>
    h.prisma.answer.create({
      data: {
        questionId: qid,
        authorId: p.id,
        kind: "TEXT",
        body: "x",
        mood,
        createdAt: at,
      },
    });
  const code = async (p: Person): Promise<string> =>
    (await get(p, "/me/invite").expect(200)).body.code;
  /** A friend who answered through `inviter`'s link. */
  async function friendOf(inviter: Person, mood: Mood = "HOPEFUL") {
    const f = await makePerson(h);
    await answer(f, mood);
    await claim(f, await code(inviter)).expect(204);
    return f;
  }

  describe("the code", () => {
    it("is short, stable, lower case, built from PUBLIC_WEB_BASE, and one per person", async () => {
      const a = await makePerson(h);
      const b = await makePerson(h);
      const r1 = await get(a, "/me/invite").expect(200);
      const r2 = await get(a, "/me/invite").expect(200);
      expect(r1.body.code).toMatch(/^[a-z0-9]{7}$/);
      expect(r2.body.code).toBe(r1.body.code);
      expect(r1.body.url).toBe(`http://stand-in.test/go/${r1.body.code}`);
      expect(r1.body.friendsAnswered).toBe(0);
      expect(await code(b)).not.toBe(r1.body.code);
      expect(await h.prisma.invite.count({ where: { userId: a.id } })).toBe(1);
    });

    it("is made once even when asked for many times at the same moment", async () => {
      const a = await makePerson(h);
      const rs = await Promise.all(
        Array.from({ length: 6 }, () => get(a, "/me/invite")),
      );
      expect(new Set(rs.map((r) => r.body.code)).size).toBe(1);
      expect(await h.prisma.invite.count({ where: { userId: a.id } })).toBe(1);
    });

    it("needs a signed-in person", async () => {
      await h.http().get("/api/v1/me/invite").expect(401);
      await h.http().get("/api/v1/me/friends").expect(401);
      await h
        .http()
        .post("/api/v1/me/invite/claim")
        .send({ code: "abcdefg" })
        .expect(401);
    });
  });

  describe("who counts", () => {
    it("counts a new person who answered, with their word", async () => {
      const ada = await makePerson(h);
      const kemi = await makePerson(h);
      await answer(kemi, "PROUD");
      await claim(kemi, await code(ada)).expect(204);
      const r = await get(ada, "/me/friends").expect(200);
      expect(r.body.count).toBe(1);
      expect(r.body.items).toHaveLength(1);
      expect(r.body.items[0]).toMatchObject({
        word: "PROUD",
        wordShared: true,
      });
      expect(Object.keys(r.body.items[0] as object).sort()).toEqual([
        "answeredAt",
        "displayName",
        "handle",
        "word",
        "wordShared",
      ]);
      expect((await get(ada, "/me/invite")).body.friendsAnswered).toBe(1);
    });

    it("does not count a person who has not answered yet, and counts them once they have", async () => {
      const ada = await makePerson(h);
      const f = await makePerson(h);
      await claim(f, await code(ada)).expect(204);
      expect((await get(ada, "/me/friends")).body.count).toBe(0);
      await answer(f);
      await claim(f, await code(ada)).expect(204);
      expect((await get(ada, "/me/friends")).body.count).toBe(1);
    });

    it("first link wins", async () => {
      const a = await makePerson(h);
      const b = await makePerson(h);
      const f = await makePerson(h);
      await answer(f);
      await claim(f, await code(a)).expect(204);
      await claim(f, await code(b)).expect(204);
      expect((await get(a, "/me/friends")).body.count).toBe(1);
      expect((await get(b, "/me/friends")).body.count).toBe(0);
    });

    it("counts one friend once, however many times the claim is sent", async () => {
      const a = await makePerson(h);
      const f = await makePerson(h);
      await answer(f);
      const c = await code(a);
      await Promise.all([1, 2, 3, 4].map(() => claim(f, c)));
      await claim(f, c);
      expect(
        await h.prisma.inviteFriend.count({ where: { friendId: f.id } }),
      ).toBe(1);
      expect((await get(a, "/me/friends")).body.count).toBe(1);
    });

    it("does not count a person for their own link", async () => {
      const a = await makePerson(h);
      await answer(a);
      await claim(a, await code(a)).expect(204);
      expect((await get(a, "/me/friends")).body.count).toBe(0);
    });

    it("ignores a code nobody has, a badly shaped one, and says nothing different about them", async () => {
      const f = await makePerson(h);
      await answer(f);
      for (const c of ["zzzzzzz", "x", "ABC DEF!", "a".repeat(32)])
        await claim(f, c).expect(204);
      expect(
        await h.prisma.inviteFriend.count({ where: { friendId: f.id } }),
      ).toBe(0);
      await h
        .http()
        .post("/api/v1/me/invite/claim")
        .set("Authorization", f.auth)
        .send({ code: "a".repeat(33) })
        .expect(422);
    });

    it("keeps the link for 30 days: a person whose account is older than that is not claimed", async () => {
      const a = await makePerson(h);
      const old = await makePerson(h);
      const fresh = await makePerson(h);
      await h.prisma.user.update({
        where: { id: old.id },
        data: { createdAt: new Date(Date.now() - 31 * 86_400_000) },
      });
      await h.prisma.user.update({
        where: { id: fresh.id },
        data: { createdAt: new Date(Date.now() - 29 * 86_400_000) },
      });
      await answer(old);
      await answer(fresh);
      const c = await code(a);
      await claim(old, c).expect(204);
      await claim(fresh, c).expect(204);
      const r = await get(a, "/me/friends");
      expect(r.body.count).toBe(1);
    });

    it("ignores a claim when either person has blocked the other, and hides a blocked friend", async () => {
      const a = await makePerson(h);
      const f1 = await makePerson(h);
      const f2 = await makePerson(h);
      await answer(f1);
      await answer(f2);
      await h.prisma.block.create({
        data: { blockerId: a.id, blockedId: f1.id },
      });
      await claim(f1, await code(a)).expect(204);
      expect((await get(a, "/me/friends")).body.count).toBe(0);
      await claim(f2, await code(a)).expect(204);
      expect((await get(a, "/me/friends")).body.count).toBe(1);
      await h.prisma.block.create({
        data: { blockerId: f2.id, blockedId: a.id },
      });
      expect((await get(a, "/me/friends")).body.count).toBe(0);
    });

    it("a code that no longer exists (its owner is gone) claims nobody", async () => {
      const a = await makePerson(h);
      const c = await code(a);
      await h.prisma.invite.deleteMany({ where: { userId: a.id } });
      const f = await makePerson(h);
      await answer(f);
      await claim(f, c).expect(204);
      expect(
        await h.prisma.inviteFriend.count({ where: { friendId: f.id } }),
      ).toBe(0);
    });

    it("a friend stays with the person who invited them even if codes are made again", async () => {
      const a = await makePerson(h);
      const b = await makePerson(h);
      const f = await friendOf(a);
      // someone makes the old code point elsewhere: the friend row names the inviter by id, so nothing moves
      const old = await code(a);
      await h.prisma.invite.update({
        where: { userId: a.id },
        data: {
          code: `r${Date.now().toString(36)}`.slice(0, 7).padEnd(7, "x"),
        },
      });
      await claim(f, old).expect(204);
      await claim(f, await code(b)).expect(204);
      // and a newcomer arriving by the old, rotated-away code claims nobody
      const g = await makePerson(h);
      await answer(g);
      await claim(g, old).expect(204);
      expect(
        await h.prisma.inviteFriend.count({ where: { friendId: g.id } }),
      ).toBe(0);
      expect((await get(a, "/me/friends")).body.count).toBe(1);
      expect((await get(b, "/me/friends")).body.count).toBe(0);
    });

    it("pages the list newest first", async () => {
      const a = await makePerson(h);
      for (let i = 0; i < 3; i++) await friendOf(a);
      const p1 = await get(a, "/me/friends?limit=2").expect(200);
      expect(p1.body.count).toBe(3);
      expect(p1.body.items).toHaveLength(2);
      expect(p1.body.nextCursor).toBeTruthy();
      const p2 = await get(
        a,
        `/me/friends?limit=2&cursor=${p1.body.nextCursor}`,
      ).expect(200);
      expect(p2.body.items).toHaveLength(1);
      expect(p2.body.nextCursor).toBeNull();
    });
  });

  describe("Share my word", () => {
    it("is on by default and shown in settings", async () => {
      const p = await makePerson(h);
      expect((await get(p, "/me/settings").expect(200)).body.shareMyWord).toBe(
        true,
      );
    });

    it("off hides the word at once, the friend still counts; on brings it back", async () => {
      const a = await makePerson(h);
      const f = await friendOf(a, "ANGRY");
      expect((await get(a, "/me/friends")).body.items[0].word).toBe("ANGRY");
      await settings(f, { shareMyWord: false }).expect(200);
      const off = await get(a, "/me/friends").expect(200);
      expect(off.body.count).toBe(1);
      expect(off.body.items).toHaveLength(1);
      expect(off.body.items[0].word).toBeNull();
      expect(off.body.items[0].wordShared).toBe(false);
      expect(JSON.stringify(off.body)).not.toContain("ANGRY");
      await settings(f, { shareMyWord: true }).expect(200);
      expect((await get(a, "/me/friends")).body.items[0].word).toBe("ANGRY");
    });

    it("a friend with no mood answer left shows no word", async () => {
      const a = await makePerson(h);
      const f = await friendOf(a, "TIRED");
      await h.prisma.answer.updateMany({
        where: { authorId: f.id },
        data: { status: "DELETED_BY_AUTHOR", deletedAt: new Date() },
      });
      const r = await get(a, "/me/friends").expect(200);
      expect(r.body.items[0].word).toBeNull();
    });

    it("can be switched on the same call as another setting, and refuses a non-boolean", async () => {
      const p = await makePerson(h);
      const r = await settings(p, { shareMyWord: false, dataSaver: true });
      expect(r.status).toBe(200);
      expect(r.body.shareMyWord).toBe(false);
      await settings(p, { shareMyWord: "no" }).expect(422);
    });
  });

  describe("who can read a friend's word", () => {
    it("nobody but the inviter: not the friend, not another person, not a guest, not the friend's profile", async () => {
      const a = await makePerson(h);
      const stranger = await makePerson(h);
      const f = await friendOf(a, "PROUD");
      // another person's own list
      const s = await get(stranger, "/me/friends").expect(200);
      expect(s.body).toEqual({ count: 0, items: [], nextCursor: null });
      // the friend's own list is about the people they invited, not about who invited them
      const own = await get(f, "/me/friends").expect(200);
      expect(own.body).toEqual({ count: 0, items: [], nextCursor: null });
      expect((await get(f, "/me/invite")).body.code).not.toBe(await code(a));
      // a guest
      await h.http().get("/api/v1/me/friends").expect(401);
      // public profile and people routes say nothing of invites, friends or the switch
      const me = await h.prisma.user.findUniqueOrThrow({ where: { id: f.id } });
      for (const path of [
        `/people/${me.handle}`,
        `/people/${me.handle}/answers`,
      ]) {
        const asGuest = await h.http().get(`/api/v1${path}`);
        const asStranger = await get(stranger, path);
        for (const r of [asGuest, asStranger]) {
          const text = JSON.stringify(r.body).toLowerCase();
          expect(text).not.toContain("invite");
          expect(text).not.toContain("sharemyword");
          expect(text).not.toContain("friend");
        }
      }
      // the inviter's code and counts are not on the inviter's public profile either
      const aHandle = (
        await h.prisma.user.findUniqueOrThrow({ where: { id: a.id } })
      ).handle;
      const pub = await get(stranger, `/people/${aHandle}`);
      const txt = JSON.stringify(pub.body).toLowerCase();
      expect(txt).not.toContain(await code(a));
      expect(txt).not.toContain("friend");
    });

    it("a claim from the real posting flow counts the friend", async () => {
      const a = await makePerson(h);
      const f = await makePerson(h, { freePosts: 5 });
      const posted = await h
        .http()
        .post(`/api/v1/questions/${qid}/answers`)
        .set("Authorization", f.auth)
        .set(idem())
        .send({ kind: "TEXT", body: "Hopeful.", mood: "HOPEFUL" })
        .expect(201);
      expect(posted.body.answer.mood).toBe("HOPEFUL");
      await claim(f, await code(a)).expect(204);
      const r = await get(a, "/me/friends").expect(200);
      expect(r.body.items[0].word).toBe("HOPEFUL");
    });
  });

  describe("data download and deletion", () => {
    it("the download holds my invite code, who I invited and who invited me", async () => {
      const a = await makePerson(h);
      const f = await friendOf(a, "TIRED");
      const store = h.app.get(ExportStore);
      const put: Buffer[] = [];
      jest.spyOn(store, "isConfigured").mockReturnValue(true);
      jest.spyOn(store, "put").mockImplementation((_k, body) => {
        put.push(body);
        return Promise.resolve();
      });
      const exp = h.app.get(ExportService);
      for (const who of [a, f]) {
        const row = await h.prisma.dataExport.create({
          data: { userId: who.id },
        });
        await exp.build(row.id, who.id);
      }
      jest.restoreAllMocks();
      const forA = JSON.parse(put[0].toString());
      const forF = JSON.parse(put[1].toString());
      const aHandle = (
        await h.prisma.user.findUniqueOrThrow({ where: { id: a.id } })
      ).handle;
      const fHandle = (
        await h.prisma.user.findUniqueOrThrow({ where: { id: f.id } })
      ).handle;
      expect(forA.invites.code).toBe(await code(a));
      expect(forA.invites.link).toBe(
        `http://stand-in.test/go/${await code(a)}`,
      );
      expect(forA.invites.friendsAnswered).toBe(1);
      expect(forA.invites.friends[0]).toMatchObject({
        handle: fHandle,
        word: "TIRED",
      });
      expect(forA.settings).toBeNull(); // no settings row yet
      expect(forF.invites.invitedByHandle).toBe(aHandle);
      expect(forF.invites.friends).toEqual([]);
      // the friend's download does not carry the inviter's code or anyone else's word
      expect(JSON.stringify(forF)).not.toContain(await code(a));
    });

    it("the purge removes the links both ways", async () => {
      const gone = await makePerson(h);
      const friendOfGone = await friendOf(gone);
      const inviter = await makePerson(h);
      const goneAsFriend = await friendOf(inviter);
      await code(gone);
      const purge = h.app.get(DeletionService);
      for (const who of [gone, goneAsFriend]) {
        await h.prisma.user.update({
          where: { id: who.id },
          data: {
            status: "DELETION_PENDING",
            deletionRequestedAt: new Date(Date.now() - 15 * 86_400_000),
          },
        });
        await purge.purge(who.id);
      }
      expect(await h.prisma.invite.count({ where: { userId: gone.id } })).toBe(
        0,
      );
      expect(
        await h.prisma.inviteFriend.count({
          where: {
            OR: [
              { inviterId: gone.id },
              { friendId: gone.id },
              { friendId: goneAsFriend.id },
            ],
          },
        }),
      ).toBe(0);
      // the people who stayed are untouched and nothing of the deleted ones shows
      expect((await get(inviter, "/me/friends")).body.count).toBe(0);
      expect((await get(friendOfGone, "/me/invite")).status).toBe(200);
    });

    it("a person waiting to be deleted drops out of the inviter's list and count at once", async () => {
      const a = await makePerson(h);
      const f = await friendOf(a);
      await h.prisma.user.update({
        where: { id: f.id },
        data: { status: "DELETION_PENDING", deletionRequestedAt: new Date() },
      });
      const r = await get(a, "/me/friends").expect(200);
      expect(r.body.count).toBe(0);
      expect(r.body.items).toEqual([]);
    });
  });

  // Last on purpose: once a limit is hit the caller stays blocked for the rest of the minute.
  describe("rate limit", () => {
    it("claims are rate limited, so codes cannot be tried one after another", async () => {
      const f = await makePerson(h);
      process.env.INVITE_CLAIM_LIMIT = "1";
      try {
        const codes = ["aaaaaaa", "bbbbbbb", "ccccccc"];
        const statuses = [];
        for (const c of codes) statuses.push((await claim(f, c)).status);
        expect(statuses).toContain(429);
      } finally {
        process.env.INVITE_CLAIM_LIMIT = "100000";
      }
    });
  });
});
