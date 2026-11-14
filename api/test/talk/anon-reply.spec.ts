/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import {
  bootAdmin,
  modItem,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "../admin/helpers";

/**
 * V-FIX-D: a reply can be posted without the person's name. Every route that returns replies is read as a guest, as
 * another member and as the writer, and the author must not appear for any of them; the notice and the share page and
 * cards must not carry it either. The reply mail is checked in mail.spec.ts (it has the relay stand-in).
 */
const api = "/api/v1";

describe("V-FIX-D: anonymous replies", () => {
  let a: Admin;
  let q: string;
  let ans: string;
  let anonReply: string;
  let item: { id: string };
  let namedReply: string;
  let key = 0;
  const idem = () => ({ "Idempotency-Key": `fixd-${++key}-${Date.now()}` });
  // Who must never be findable in a response about the unnamed reply.
  let secrets: string[] = [];

  beforeAll(async () => {
    a = await bootAdmin();
    for (const n of ["admin", "mod", "poster", "anon", "named", "other"])
      await a.person(
        n,
        n === "admin" ? ["ADMIN"] : n === "mod" ? ["MODERATOR"] : [],
      );
    q = (await seedQuestion(a, "What should change?")).id;
    await a.prisma.question.update({
      where: { id: q },
      data: {
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    ans = (await seedAnswer(a, q, a.people.poster.id, { body: "mine" })).id;
    secrets = [a.people.anon.handle, a.people.anon.id];
    // The free posts are few at launch; these specs post many replies, and what they test is not the price.
    await a.prisma.freeAllowance.updateMany({
      data: { freePostsRemaining: 200 },
    });
  });
  afterAll(async () => {
    await a.close();
  });

  const reply = (who: string, body: object) =>
    a.h
      .http()
      .post(`${api}/answers/${ans}/replies`)
      .set(a.auth(who))
      .set(idem())
      .send({ stance: "AGREE", kind: "TEXT", body: "I agree", ...body });
  const get = (path: string, who?: string) => {
    const r = a.h.http().get(`${api}${path}`);
    return who ? r.set(a.auth(who)) : r;
  };
  const noAuthor = (label: string, body: unknown) => {
    const text = JSON.stringify(body);
    for (const s of secrets)
      expect({ label, leaked: text.includes(s) }).toEqual({
        label,
        leaked: false,
      });
  };

  it("the reply create body takes anonymous, and the receipt shows no author, to the writer too", async () => {
    const r = await reply("anon", { anonymous: true }).expect(201);
    anonReply = r.body.reply.id;
    expect(r.body.reply.author).toBeNull();
    expect(r.body.reply.isMine).toBe(true);
    noAuthor("receipt", r.body);
    const row = await a.prisma.reply.findUniqueOrThrow({
      where: { id: anonReply },
    });
    expect(row.anonymous).toBe(true);
    // the default is a named reply
    const n = await reply("named", {}).expect(201);
    namedReply = n.body.reply.id;
    expect(n.body.reply.author.handle).toBe(a.people.named.handle);
    expect(
      (await a.prisma.reply.findUniqueOrThrow({ where: { id: namedReply } }))
        .anonymous,
    ).toBe(false);
    // not a boolean: refused
    await reply("other", { anonymous: "yes" }).expect(422);
  });

  it("GET /answers/{id}/replies: the author is null for a guest, another member, the answer's author and the writer; a named reply keeps its author", async () => {
    for (const who of [undefined, "other", "poster", "anon", "named"]) {
      const r = await get(`/answers/${ans}/replies`, who).expect(200);
      const items = r.body.items as {
        id: string;
        author: { handle: string } | null;
        isMine: boolean;
      }[];
      const mine = items.find((i) => i.id === anonReply);
      expect(mine).toBeDefined();
      expect(mine?.author).toBeNull();
      expect(mine?.isMine).toBe(who === "anon");
      expect(items.find((i) => i.id === namedReply)?.author?.handle).toBe(
        a.people.named.handle,
      );
      noAuthor(`replies as ${who ?? "guest"}`, mine);
    }
    // the stance filter and the page cursor use the same view
    const f = await get(`/answers/${ans}/replies?stance=AGREE&limit=1`).expect(
      200,
    );
    noAuthor("filtered page", f.body);
  });

  it("a person's reply list: others and guests never see the unnamed reply; the writer sees it with no author", async () => {
    for (const who of [undefined, "other", "poster"]) {
      const r = await get(`/people/${a.people.anon.id}/replies`, who).expect(
        200,
      );
      expect(r.body.items).toHaveLength(0);
      noAuthor(`profile replies as ${who ?? "guest"}`, r.body);
    }
    const own = await get(`/people/${a.people.anon.id}/replies`, "anon").expect(
      200,
    );
    expect(own.body.items).toHaveLength(1);
    expect(own.body.items[0]).toMatchObject({
      id: anonReply,
      author: null,
      isMine: true,
    });
    // the named replier's list is unchanged
    const named = await get(
      `/people/${a.people.named.id}/replies`,
      "other",
    ).expect(200);
    expect((named.body.items as { id: string }[]).map((i) => i.id)).toEqual([
      namedReply,
    ]);
    expect(named.body.items[0].author.handle).toBe(a.people.named.handle);
    // by handle and by id, the profile itself carries no sign of the reply
    const prof = await get(
      `/people/by-handle/${a.people.anon.handle}`,
      "other",
    );
    expect(prof.status).toBe(200);
    expect(prof.body.profile.replyCount).toBe(0);
    const mine = await get(`/people/${a.people.anon.id}`, "anon").expect(200);
    expect(mine.body.profile.replyCount).toBe(0);
  });

  it("the reply count on a profile counts named replies only, and deleting an unnamed reply does not take one away", async () => {
    const count = async (who: string) =>
      (
        await a.prisma.user.findUniqueOrThrow({
          where: { id: a.people[who].id },
        })
      ).replyCount;
    expect(await count("anon")).toBe(0);
    expect(await count("named")).toBe(1);
    await a.h
      .http()
      .delete(`${api}/replies/${anonReply}`)
      .set(a.auth("anon"))
      .expect(204);
    expect(await count("anon")).toBe(0);
    // post it again for the rest
    const again = await reply("anon", { anonymous: true }).expect(201);
    anonReply = again.body.reply.id;
  });

  it("the notice names no one, in the stored row and in the list; the body is still the reply", async () => {
    await a.prisma.notification.deleteMany({});
    const r = await reply("anon", {
      anonymous: true,
      body: "Same here, every month",
    }).expect(201);
    const row = await a.prisma.notification.findFirstOrThrow({
      where: { userId: a.people.poster.id, type: "REPLY" },
      orderBy: { createdAt: "desc" },
    });
    expect(row.title).toBe("Someone replied to your voice");
    noAuthor("stored notice", row);
    const list = await get("/notifications", "poster").expect(200);
    const mine = (list.body.items as { title: string; body: string }[]).filter(
      (n) => n.body.includes("Same here"),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Someone replied to your voice");
    noAuthor("notification list", list.body);
    // a stored title from before this build (a named title) is still worded again at read time
    await a.prisma.notification.update({
      where: { id: row.id },
      data: { title: `@${a.people.anon.handle} replied to your voice` },
    });
    const old = await get("/notifications", "poster").expect(200);
    noAuthor("notification list, old stored title", old.body);
    // the named reply's notice still names its author
    const n = await reply("named", { body: "Named one here" }).expect(201);
    const nl = await get("/notifications", "poster").expect(200);
    const named = (nl.body.items as { title: string; body: string }[]).find(
      (i) => i.body.includes("Named one"),
    );
    expect(named?.title).toBe(
      `@${a.people.named.handle} replied to your voice`,
    );
    void r;
    void n;
  });

  it("the share link and page for the voice carry no reply author (the cards are drawn in the reach specs)", async () => {
    const link = await a.h
      .http()
      .post(`${api}/share/links`)
      .set(a.auth("other"))
      .send({ objectType: "ANSWER", objectId: ans })
      .expect(201);
    noAuthor("share link", link.body);
    const page = await get(`/share/${link.body.code}`).expect(200);
    noAuthor("share page", page.body);
  });

  it("admins and moderators still see the author of an unnamed reply, with the flag", async () => {
    item = await modItem(a, "REPLY", anonReply);
    for (const who of ["admin", "mod"]) {
      const r = await get(`/admin/moderation/items/${item.id}`, who).expect(
        200,
      );
      expect(r.body.author.handle).toBe(a.people.anon.handle);
      expect(r.body.content.anonymous).toBe(true);
    }
  });

  it("an unnamed reply that moderation removes moves no profile count", async () => {
    await a.h
      .http()
      .post(`${api}/admin/moderation/items/${item.id}/action`)
      .set(a.auth("mod"))
      .send({ action: "REMOVE", reason: "Test removal of an unnamed reply" })
      .expect(200);
    const u = await a.prisma.user.findUniqueOrThrow({
      where: { id: a.people.anon.id },
    });
    expect(u.replyCount).toBe(0);
  });

  describe("V-FIX-D with tonight's rules", () => {
    beforeAll(async () => {
      await a.prisma.freeAllowance.updateMany({
        data: { freePostsRemaining: 200 },
      });
    });

    it("the charge of a reply carries refType reply and its reply id (so the sweeper reverses only unlinked ones)", async () => {
      const r = await reply("anon", {
        anonymous: true,
        body: "Marked charge",
      }).expect(201);
      const c = await a.prisma.charge.findFirstOrThrow({
        where: { userId: a.people.anon.id, refId: r.body.reply.id },
      });
      expect(c.refType).toBe("reply");
    });

    it("the writer of a nameless answer who replies under it is always nameless, whatever the client sends", async () => {
      const own = (
        await seedAnswer(a, q, a.people.anon.id, {
          body: "My nameless answer",
          anonymous: true,
        })
      ).id;
      for (const body of [{}, { anonymous: false }, { anonymous: true }]) {
        const r = await a.h
          .http()
          .post(`${api}/answers/${own}/replies`)
          .set(a.auth("anon"))
          .set(idem())
          .send({
            stance: "EXPERIENCE",
            kind: "TEXT",
            body: "Under my own",
            ...body,
          })
          .expect(201);
        expect(r.body.reply.author).toBeNull();
        expect(
          (
            await a.prisma.reply.findUniqueOrThrow({
              where: { id: r.body.reply.id },
            })
          ).anonymous,
        ).toBe(true);
      }
      // a named answer's writer still follows their own switch
      const named = (
        await seedAnswer(a, q, a.people.named.id, { body: "Named" })
      ).id;
      const n = await a.h
        .http()
        .post(`${api}/answers/${named}/replies`)
        .set(a.auth("named"))
        .set(idem())
        .send({ stance: "AGREE", kind: "TEXT", body: "Under my named" })
        .expect(201);
      expect(n.body.reply.author.handle).toBe(a.people.named.handle);
    });

    it("blocks never change what is shown about an unnamed reply: the list, the counts and the answer's replyCount are the same before and after a block, either way", async () => {
      const fresh = (
        await seedAnswer(a, q, a.people.poster.id, { body: "Block probe" })
      ).id;
      const w = await a.h
        .http()
        .post(`${api}/answers/${fresh}/replies`)
        .set(a.auth("anon"))
        .set(idem())
        .send({
          stance: "AGREE",
          kind: "TEXT",
          body: "Probe reply",
          anonymous: true,
        })
        .expect(201);
      const read = async (who: string) => {
        const l = await get(`/answers/${fresh}/replies`, who).expect(200);
        const ans = await get(`/answers/${fresh}`, who).expect(200);
        return {
          ids: (l.body.items as { id: string }[]).map((i) => i.id),
          counts: l.body.counts,
          rc: ans.body.replyCount,
        };
      };
      const before = {
        other: await read("other"),
        poster: await read("poster"),
      };
      expect(before.other.ids).toContain(w.body.reply.id);
      for (const [blocker, target] of [
        ["other", "anon"],
        ["anon", "other"],
        ["poster", "anon"],
        ["anon", "poster"],
      ]) {
        await a.h
          .http()
          .put(`${api}/me/blocks/${a.people[target].id}`)
          .set(a.auth(blocker))
          .expect(204);
        expect(await read("other")).toEqual(before.other);
        expect(await read("poster")).toEqual(before.poster);
        await a.h
          .http()
          .delete(`${api}/me/blocks/${a.people[target].id}`)
          .set(a.auth(blocker))
          .expect(204);
      }
    });

    it("the 'Someone replied' notice is not suppressed or revealed by a block", async () => {
      const fresh = (
        await seedAnswer(a, q, a.people.poster.id, { body: "Notice probe" })
      ).id;
      await a.h
        .http()
        .post(`${api}/answers/${fresh}/replies`)
        .set(a.auth("anon"))
        .set(idem())
        .send({
          stance: "AGREE",
          kind: "TEXT",
          body: "Notice probe reply",
          anonymous: true,
        })
        .expect(201);
      const count = async () =>
        (
          (await get("/notifications", "poster").expect(200)).body.items as {
            body: string;
            title: string;
          }[]
        )
          .filter((n) => n.body.includes("Notice probe reply"))
          .map((n) => n.title);
      expect(await count()).toEqual(["Someone replied to your voice"]);
      await a.h
        .http()
        .put(`${api}/me/blocks/${a.people.anon.id}`)
        .set(a.auth("poster"))
        .expect(204);
      expect(await count()).toEqual(["Someone replied to your voice"]);
      await a.h
        .http()
        .delete(`${api}/me/blocks/${a.people.anon.id}`)
        .set(a.auth("poster"))
        .expect(204);
      expect(await count()).toEqual(["Someone replied to your voice"]);
    });

    it("reporting an unnamed reply with also-block does not block its writer and says blocked false", async () => {
      const fresh = (
        await seedAnswer(a, q, a.people.poster.id, { body: "Report probe" })
      ).id;
      const w = await a.h
        .http()
        .post(`${api}/answers/${fresh}/replies`)
        .set(a.auth("anon"))
        .set(idem())
        .send({
          stance: "AGREE",
          kind: "TEXT",
          body: "Report probe reply",
          anonymous: true,
        })
        .expect(201);
      const rep = await a.h
        .http()
        .post(`${api}/reports`)
        .set(a.auth("other"))
        .send({
          targetType: "REPLY",
          targetId: w.body.reply.id,
          reason: "SCAM_OR_SPAM",
          alsoBlock: true,
        })
        .expect(201);
      expect(rep.body.blocked).toBe(false);
      const list = await get("/me/blocks", "other").expect(200);
      expect(JSON.stringify(list.body)).not.toContain(a.people.anon.handle);
    });
  });
});
