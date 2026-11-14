/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";

const CDN = "https://cdn.test";

/** V-PEOPLE-ON-POSTS: a person's picture (and the Admin mark) comes with their name, never with a post made without one. */
describe("people on posts", () => {
  let h: Harness;
  let q: { id: string };
  let ada: Person; // active, has a picture
  let sus: Person; // suspended, has a picture
  let gone: Person; // deleted, has a picture on the row
  let fileKey: string;
  const auth = (p: Person) => ({ Authorization: p.auth });

  beforeAll(async () => {
    process.env.SPACES_CDN_BASE = CDN;
    h = await startHarness();
    q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: { startsAt: new Date(Date.now() - 3_600_000) },
    });
    ada = await makePerson(h, { balanceMilli: 100_000, freePosts: 5 });
    sus = await makePerson(h);
    gone = await makePerson(h);
    // ada's picture goes through the real upload path: POST /uploads, the PUT, /complete, PATCH /me/profile
    const up = await h
      .http()
      .post("/api/v1/uploads")
      .set(auth(ada))
      .send({ kind: "AVATAR", mime: "image/png", sizeBytes: 1200 })
      .expect(201);
    fileKey = (
      await h.prisma.storedFile.findUniqueOrThrow({
        where: { id: up.body.fileId as string },
      })
    ).key;
    h.store.objects.set(fileKey, Buffer.alloc(1200));
    await h
      .http()
      .post(`/api/v1/uploads/${up.body.fileId as string}/complete`)
      .set(auth(ada))
      .expect(200);
    await h
      .http()
      .patch("/api/v1/me/profile")
      .set(auth(ada))
      .send({ avatarFileId: up.body.fileId })
      .expect(200);
    // the same picture file kind for the other two, written straight on the row
    for (const p of [sus, gone]) {
      const f = await h.prisma.storedFile.create({
        data: {
          ownerId: p.id,
          kind: "AVATAR",
          key: `file/avatar/${randomUUID()}`,
          mime: "image/png",
          bytes: 10,
          confirmedAt: new Date(),
        },
      });
      await h.prisma.user.update({
        where: { id: p.id },
        data: { avatarFileId: f.id },
      });
    }
    await h.prisma.user.update({
      where: { id: sus.id },
      data: { status: "SUSPENDED", suspendedUntil: new Date(Date.now() + 1e8) },
    });
  });
  afterAll(async () => {
    delete process.env.SPACES_CDN_BASE;
    await h.close();
  });

  const answer = (authorId: string, anonymous = false, body = "A view.") =>
    h.prisma.answer.create({
      data: { questionId: q.id, authorId, kind: "TEXT", body, anonymous },
    });
  const reply = (answerId: string, authorId: string) =>
    h.prisma.reply.create({
      data: { answerId, authorId, stance: "AGREE", kind: "TEXT", body: "Yes." },
    });
  const address = () => `${CDN}/${fileKey}`;

  it("upload path: a picture a person uploads ends up on User and comes out of /me", async () => {
    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: ada.id },
    });
    expect(row.avatarFileId).not.toBeNull();
    const me = await h.http().get("/api/v1/me").set(auth(ada)).expect(200);
    expect(me.body.profile.avatarUrl).toBe(address());
  });

  it("the writer of a named answer and of a reply carries the picture; the same person's nameless answer carries none", async () => {
    const named = await answer(ada.id);
    const nameless = await answer(ada.id, true);
    const a = await h.http().get(`/api/v1/answers/${named.id}`).expect(200);
    expect(a.body.author.avatarUrl).toBe(address());
    const n = await h
      .http()
      .get(`/api/v1/answers/${nameless.id}`)
      .set(auth(ada))
      .expect(200);
    expect(n.body.author).toBeNull();
    expect(JSON.stringify(n.body)).not.toContain(fileKey);
    await reply(named.id, ada.id);
    const r = await h
      .http()
      .get(`/api/v1/answers/${named.id}/replies`)
      .expect(200);
    expect(r.body.items[0].author.avatarUrl).toBe(address());
    // a reply made through the API comes back with it too
    const posted = await h
      .http()
      .post(`/api/v1/answers/${named.id}/replies`)
      .set(auth(ada))
      .set(idem())
      .send({ stance: "AGREE", kind: "TEXT", body: "Still yes." })
      .expect(201);
    expect(posted.body.reply.author.avatarUrl).toBe(address());
    // the question's list of answers
    const list = await h
      .http()
      .get(`/api/v1/questions/${q.id}/answers`)
      .set(auth(sus))
      .expect(200);
    const all = list.body.items.map(
      (x: {
        answer: {
          id: string;
          author: { id: string; avatarUrl: string | null } | null;
        };
      }) => x.answer,
    );
    const mineInList = all.filter(
      (x: { author: { id: string } | null }) => x.author?.id === ada.id,
    );
    expect(mineInList.length).toBeGreaterThan(0);
    for (const x of mineInList) expect(x.author.avatarUrl).toBe(address());
    expect(
      all.find((x: { id: string }) => x.id === nameless.id)?.author,
    ).toBeNull();
  });

  it("a list card (recent voices) and a search row carry the picture", async () => {
    await answer(ada.id);
    const card = await h.http().get(`/api/v1/questions/${q.id}`).expect(200);
    const face = card.body.recentVoices.find(
      (x: { id: string }) => x.id === ada.id,
    );
    expect(face.avatarUrl).toBe(address());
    const handle = (
      await h.prisma.user.findUniqueOrThrow({ where: { id: ada.id } })
    ).handle;
    const s = await h
      .http()
      .get(`/api/v1/search?q=${handle}&type=people`)
      .expect(200);
    const row = s.body.people.find((x: { id: string }) => x.id === ada.id);
    expect(row.avatarUrl).toBe(address());
    const s2 = await h
      .http()
      .get(`/api/v1/search?q=A%20view&type=answers`)
      .expect(200);
    const hit = s2.body.answers.find(
      (x: { author: { id: string } | null }) => x.author?.id === ada.id,
    );
    expect(hit.author.avatarUrl).toBe(address());
  });

  it("the share page data carries the picture for a named answer and none for a nameless one", async () => {
    const named = await answer(ada.id);
    const nameless = await answer(ada.id, true);
    const link = async (id: string) => {
      const r = await h
        .http()
        .post("/api/v1/share/links")
        .send({ objectType: "ANSWER", objectId: id })
        .expect(201);
      return h
        .http()
        .get(`/api/v1/share/${r.body.code as string}`)
        .expect(200);
    };
    const p1 = await link(named.id);
    expect(p1.body.featuredVoice.author.avatarUrl).toBe(address());
    const p2 = await link(nameless.id);
    expect(p2.body.featuredVoice.author).toBeNull();
    expect(JSON.stringify(p2.body)).not.toContain(fileKey);
  });

  it("a direct-message partner carries the picture, in the list, the thread and the profile button", async () => {
    const v = await makePerson(h, { balanceMilli: 100_000, freePosts: 5 });
    await h.prisma.user.update({
      where: { id: v.id },
      data: {
        verificationStatus: "APPROVED",
        verifiedUntil: new Date(Date.now() + 86_400_000 * 30),
      },
    });
    await h
      .http()
      .post("/api/v1/dm/messages")
      .set(auth(v))
      .set("Idempotency-Key", randomUUID())
      .send({ toUserId: ada.id, kind: "TEXT", body: "Hello" })
      .expect(201);
    const conv = await h
      .http()
      .get("/api/v1/dm/conversations")
      .set(auth(v))
      .expect(200);
    expect(conv.body.items[0].person.avatarUrl).toBe(address());
    const thread = await h
      .http()
      .get(
        `/api/v1/dm/conversations/${conv.body.items[0].id as string}/messages`,
      )
      .set(auth(v))
      .expect(200);
    expect(thread.body.person.avatarUrl).toBe(address());
    const w = await h
      .http()
      .get(`/api/v1/dm/with/${ada.id}`)
      .set(auth(v))
      .expect(200);
    expect(w.body.person.avatarUrl).toBe(address());
  });

  it("a suspended person and a deleted person carry no picture, though the row still names one", async () => {
    const a = await answer(sus.id);
    const got = await h.http().get(`/api/v1/answers/${a.id}`).expect(200);
    expect(got.body.author.id).toBe(sus.id);
    expect(got.body.author.avatarUrl).toBeNull();
    const row = await h.prisma.user.findUniqueOrThrow({
      where: { id: sus.id },
    });
    expect(row.avatarFileId).not.toBeNull();
    for (const status of ["BANNED", "DELETION_PENDING", "DELETED"] as const) {
      await h.prisma.user.update({ where: { id: gone.id }, data: { status } });
      const { personMarks } = await import("../../src/common/people.js");
      const m = await personMarks(h.prisma, [
        { id: gone.id, avatarFileId: row.avatarFileId, status },
      ]);
      expect(m.get(gone.id)?.avatarUrl).toBeNull();
    }
    // the deleted partner of a conversation shows no picture either
    const v = await makePerson(h, { balanceMilli: 100_000, freePosts: 5 });
    await h.prisma.user.update({
      where: { id: v.id },
      data: {
        verificationStatus: "APPROVED",
        verifiedUntil: new Date(Date.now() + 86_400_000 * 30),
      },
    });
    await h.prisma.user.update({
      where: { id: gone.id },
      data: { status: "ACTIVE" },
    });
    await h
      .http()
      .post("/api/v1/dm/messages")
      .set(auth(v))
      .set("Idempotency-Key", randomUUID())
      .send({ toUserId: gone.id, kind: "TEXT", body: "Hi" })
      .expect(201);
    await h.prisma.user.update({
      where: { id: gone.id },
      data: { status: "DELETED" },
    });
    const conv = await h
      .http()
      .get("/api/v1/dm/conversations")
      .set(auth(v))
      .expect(200);
    expect(conv.body.items[0].person.deleted).toBe(true);
    expect(conv.body.items[0].person.avatarUrl).toBeNull();
  });

  describe("the Admin mark", () => {
    it("is true for an admin's named answer and reply, false for an editor and a member, absent on a nameless post, and off at once when the role goes", async () => {
      const admin = await makePerson(h, { roles: ["ADMIN"] });
      const editor = await makePerson(h, { roles: ["EDITOR"] });
      const mod = await makePerson(h, { roles: ["MODERATOR"] });
      const member = await makePerson(h);
      const seen = async (id: string) =>
        (await h.http().get(`/api/v1/answers/${id}`).expect(200)).body;
      const adminAnswer = await answer(admin.id);
      expect((await seen(adminAnswer.id)).author.admin).toBe(true);
      await reply(adminAnswer.id, admin.id);
      const rs = await h
        .http()
        .get(`/api/v1/answers/${adminAnswer.id}/replies`)
        .expect(200);
      expect(rs.body.items[0].author.admin).toBe(true);
      for (const p of [editor, mod, member]) {
        const a = await answer(p.id);
        expect((await seen(a.id)).author.admin).toBe(false);
        await reply(a.id, p.id);
        const r = await h
          .http()
          .get(`/api/v1/answers/${a.id}/replies`)
          .expect(200);
        expect(r.body.items[0].author.admin).toBe(false);
      }
      const nameless = await answer(admin.id, true);
      const n = await seen(nameless.id);
      expect(n.author).toBeNull();
      expect(JSON.stringify(n)).not.toContain('"admin"');
      // search and the share page read the same mark
      const handle = (
        await h.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
      ).handle;
      const s = await h
        .http()
        .get(`/api/v1/search?q=${handle}&type=people`)
        .expect(200);
      expect(s.body.people[0].admin).toBe(true);
      const link = await h
        .http()
        .post("/api/v1/share/links")
        .send({ objectType: "ANSWER", objectId: adminAnswer.id })
        .expect(201);
      const page = await h
        .http()
        .get(`/api/v1/share/${link.body.code as string}`)
        .expect(200);
      expect(page.body.featuredVoice.author.admin).toBe(true);
      // taking the role away turns it off at once
      await h.prisma.userRoleGrant.deleteMany({ where: { userId: admin.id } });
      expect((await seen(adminAnswer.id)).author.admin).toBe(false);
    });
  });
});
