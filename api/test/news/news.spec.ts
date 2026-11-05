/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- supertest bodies and caught errors are untyped; these specs assert on them directly */
import { randomUUID } from "node:crypto";
import { boot, uid } from "../results/harness";

type H = Awaited<ReturnType<typeof boot>>;
type Tag = "VERIFIED_NEWS" | "UNVERIFIED_NEWS" | "GOSSIP";

describe("news", () => {
  let h: H;
  let q: string;
  let catA: string;
  const people: Record<string, { sub: string; id: string; handle: string }> =
    {};
  const posts: Record<string, string> = {};

  async function person(name: string) {
    const sub = uid(`wawu-${name}`);
    const handle = uid(name)
      .slice(0, 20)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ".");
    const u = await h.prisma.user.create({
      data: { wawuId: sub, handle, referralCode: uid("ref") },
    });
    people[name] = { sub, id: u.id, handle };
    return people[name];
  }

  async function news(
    name: string,
    author: string,
    tag: Tag | null,
    extra: Record<string, unknown> = {},
    at = new Date(),
  ) {
    const a = await h.prisma.answer.create({
      data: {
        questionId: q,
        authorId: people[author].id,
        kind: "TEXT",
        body: `post ${name}`,
        isNews: tag !== null,
        newsTag: tag,
        createdAt: at,
        ...(tag === "VERIFIED_NEWS"
          ? {
              newsSourceName: "Channels TV",
              newsSourceUrl: "https://example.com/s",
            }
          : {}),
        ...extra,
      },
    });
    posts[name] = a.id;
    return a;
  }

  beforeAll(async () => {
    h = await boot();
    await h.prisma.$executeRawUnsafe(
      `TRUNCATE "Answer","Report","ConfigEntry","IdempotencyRecord" CASCADE`,
    );
    catA = (
      await h.prisma.category.create({
        data: { slug: uid("cat"), name: "Politics" },
      })
    ).id;
    q = (
      await h.prisma.question.create({
        data: { text: "What did you see today?", categoryId: catA },
      })
    ).id;
    for (const n of ["ada", "bola", "cy", "dee", "eze", "fay"]) await person(n);
    const t = (n: number) => new Date(Date.now() - n * 60_000);
    await news("v", "ada", "VERIFIED_NEWS", {}, t(1));
    await news("u1", "bola", "UNVERIFIED_NEWS", {}, t(2));
    await news("u2", "bola", "UNVERIFIED_NEWS", {}, t(3));
    await news("g", "cy", "GOSSIP", {}, t(4));
    await news("anon", "cy", "GOSSIP", { anonymous: true }, t(5));
    await news("held", "cy", "UNVERIFIED_NEWS", { status: "HELD" }, t(6));
    await news("removed", "cy", "UNVERIFIED_NEWS", { status: "REMOVED" }, t(7));
    await news(
      "deleted",
      "cy",
      "UNVERIFIED_NEWS",
      { deletedAt: new Date() },
      t(8),
    );
    await news("plain", "cy", null, {}, t(0));
    await h.prisma.tagChange.create({
      data: {
        answerId: posts.u1,
        toTag: "UNVERIFIED_NEWS",
        byUserId: people.bola.id,
        reason: "chosen when posting",
        createdAt: t(2),
      },
    });
    await h.prisma.tagChange.create({
      data: {
        answerId: posts.g,
        fromTag: "UNVERIFIED_NEWS",
        toTag: "GOSSIP",
        byUserId: people.dee.id,
        reason: "an opinion",
        createdAt: t(0.5),
      },
    });
  });

  afterAll(async () => {
    await h.close();
  });

  it("the Newsroom for a guest: published news only, newest first, one tag each, no plain answers", async () => {
    const res = await h.http().get("/api/v1/news").expect(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual([posts.v, posts.u1, posts.u2, posts.g, posts.anon]);
    expect(res.body.nextCursor).toBeNull();
    const v = res.body.items[0];
    expect(v.news).toMatchObject({
      tag: "VERIFIED_NEWS",
      sourceName: "Channels TV",
      sourceUrl: "https://example.com/s",
    });
    expect(v).toMatchObject({
      iLiked: false,
      iSaved: false,
      isMine: false,
      myReaction: null,
      questionText: "What did you see today?",
      categoryName: "Politics",
    });
    expect(res.body.items[4].author).toBeNull(); // anonymous
  });

  it("says who chose the tag: the poster by handle, the team after a change", async () => {
    const res = await h.http().get("/api/v1/news").expect(200);
    const by = (id: string) =>
      res.body.items.find((i: { id: string }) => i.id === id).news.chosenBy;
    expect(by(posts.u1)).toBe(`@${people.bola.handle}`);
    expect(by(posts.g)).toBe("the WAWU team");
    expect(by(posts.v)).toBe(`@${people.ada.handle}`); // no TagChange row: the poster
  });

  it("filters by tag and category, pages with a cursor, rejects a bad tag", async () => {
    const u = await h
      .http()
      .get("/api/v1/news?tag=UNVERIFIED_NEWS")
      .expect(200);
    expect(u.body.items.map((i: { id: string }) => i.id)).toEqual([
      posts.u1,
      posts.u2,
    ]);
    const p1 = await h.http().get("/api/v1/news?limit=2").expect(200);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await h
      .http()
      .get(`/api/v1/news?limit=2&cursor=${p1.body.nextCursor}`)
      .expect(200);
    const p3 = await h
      .http()
      .get(`/api/v1/news?limit=2&cursor=${p2.body.nextCursor}`)
      .expect(200);
    const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map(
      (i: { id: string }) => i.id,
    );
    expect(all).toEqual([posts.v, posts.u1, posts.u2, posts.g, posts.anon]);
    expect(p3.body.nextCursor).toBeNull();
    const other = await h
      .http()
      .get(`/api/v1/news?categoryId=${randomUUID()}`)
      .expect(200);
    expect(other.body.items).toEqual([]);
    const cat = await h
      .http()
      .get(`/api/v1/news?categoryId=${catA}&tag=GOSSIP`)
      .expect(200);
    expect(cat.body.items).toHaveLength(2);
    await h.http().get("/api/v1/news?tag=BREAKING").expect(422);
  });

  it("a signed-in viewer sees isMine, likes, saves and reactions; blocked authors are hidden", async () => {
    await h.prisma.like.create({
      data: { answerId: posts.v, userId: people.eze.id },
    });
    await h.prisma.save.create({
      data: { answerId: posts.v, userId: people.eze.id },
    });
    await h.prisma.reaction.create({
      data: { answerId: posts.v, userId: people.eze.id, kind: "POWERFUL" },
    });
    const res = await h
      .http()
      .get("/api/v1/news")
      .set("Authorization", h.bearer(people.eze.sub))
      .expect(200);
    const v = res.body.items.find((i: { id: string }) => i.id === posts.v);
    expect(v).toMatchObject({
      iLiked: true,
      iSaved: true,
      myReaction: "POWERFUL",
      isMine: false,
    });
    expect(v.reactionBreakdown).toEqual([{ kind: "POWERFUL", count: 1 }]);
    const mine = await h
      .http()
      .get("/api/v1/news")
      .set("Authorization", h.bearer(people.ada.sub))
      .expect(200);
    expect(
      mine.body.items.find((i: { id: string }) => i.id === posts.v).isMine,
    ).toBe(true);
    await h.prisma.block.create({
      data: { blockerId: people.eze.id, blockedId: people.bola.id },
    });
    const blocked = await h
      .http()
      .get("/api/v1/news")
      .set("Authorization", h.bearer(people.eze.sub))
      .expect(200);
    expect(blocked.body.items.map((i: { id: string }) => i.id)).not.toContain(
      posts.u1,
    );
    await h
      .http()
      .get("/api/v1/news")
      .set("Authorization", "Bearer junk")
      .expect(401);
  });

  it("a news post page: found for news, 404 for a plain answer, a held or removed post and a stranger id", async () => {
    const ok = await h.http().get(`/api/v1/news/${posts.v}`).expect(200);
    expect(ok.body.id).toBe(posts.v);
    expect(ok.body.news.tag).toBe("VERIFIED_NEWS");
    for (const id of [
      posts.plain,
      posts.held,
      posts.removed,
      posts.deleted,
      randomUUID(),
    ])
      await h.http().get(`/api/v1/news/${id}`).expect(404);
    await h.http().get("/api/v1/news/not-a-uuid").expect(400);
  });

  it("the three tags with plain meaning, counts read from rows, and Verified News always followed", async () => {
    const res = await h.http().get("/api/v1/news/tags").expect(200);
    expect(res.body.items.map((t: { tag: string }) => t.tag)).toEqual([
      "VERIFIED_NEWS",
      "UNVERIFIED_NEWS",
      "GOSSIP",
    ]);
    const by = (t: string) =>
      res.body.items.find((i: { tag: string }) => i.tag === t);
    expect(by("VERIFIED_NEWS")).toMatchObject({
      label: "Verified News",
      count: 1,
      followed: true,
    });
    expect(by("UNVERIFIED_NEWS")).toMatchObject({
      label: "Unverified News",
      count: 2,
      followed: false,
    });
    expect(by("GOSSIP")).toMatchObject({
      label: "Gossip",
      count: 2,
      newCount: 2,
    });
    expect(by("GOSSIP").meaning).toBe(
      "Talk, rumour, opinion or entertainment. Not presented as fact.",
    );
    expect(JSON.stringify(res.body)).not.toContain("—");
    await h.prisma.newsTagFollow.create({
      data: { userId: people.eze.id, tag: "GOSSIP" },
    });
    const mine = await h
      .http()
      .get("/api/v1/news/tags")
      .set("Authorization", h.bearer(people.eze.sub))
      .expect(200);
    expect(
      mine.body.items.map((i: { followed: boolean }) => i.followed),
    ).toEqual([true, false, true]);
  });

  describe("flags", () => {
    const flag = (who: string, id: string, body: object = {}) =>
      h
        .http()
        .post(`/api/v1/news/${id}/flag`)
        .set("Authorization", h.bearer(people[who].sub))
        .send(body);

    it("401 guest, 403 no profile, 404 not news, 409 own post", async () => {
      await h.http().post(`/api/v1/news/${posts.u2}/flag`).send({}).expect(401);
      const np = await h
        .http()
        .post(`/api/v1/news/${posts.u2}/flag`)
        .set("Authorization", h.bearer("no-profile"))
        .send({})
        .expect(403);
      expect(np.body.error.details.reason).toBe("PROFILE_REQUIRED");
      await flag("ada", posts.plain).expect(404);
      await flag("ada", randomUUID()).expect(404);
      const own = await flag("bola", posts.u2).expect(409);
      expect(own.body.error.details.reason).toBe("OWN_POST");
      expect(await h.prisma.report.count()).toBe(0);
    });

    it("one flag per person per post; the fourth flag (config threshold) sends it to the news review queue", async () => {
      const first = await flag("ada", posts.u2, {
        note: "it is old news",
      }).expect(201);
      expect(first.body).toMatchObject({ status: "OPEN", blocked: false });
      const dupe = await flag("ada", posts.u2).expect(409);
      expect(dupe.body.error.details.reason).toBe("ALREADY_FLAGGED");
      const after1 = await h.prisma.answer.findUniqueOrThrow({
        where: { id: posts.u2 },
      });
      expect(after1).toMatchObject({
        newsFlagCount: 1,
        newsReviewStatus: "NONE",
      });
      const rep = await h.prisma.report.findUniqueOrThrow({
        where: { id: first.body.id },
      });
      expect(rep).toMatchObject({
        targetType: "ANSWER",
        targetId: posts.u2,
        reason: "MISLEADING_NEWS_TAG",
        note: "it is old news",
        reporterId: people.ada.id,
      });
      await flag("cy", posts.u2).expect(201);
      await flag("dee", posts.u2).expect(201);
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: posts.u2 } }))
          .newsReviewStatus,
      ).toBe("NONE");
      await flag("eze", posts.u2).expect(201);
      const done = await h.prisma.answer.findUniqueOrThrow({
        where: { id: posts.u2 },
      });
      expect(done).toMatchObject({
        newsFlagCount: 4,
        newsReviewStatus: "FLAGGED",
      });
      expect(
        await h.prisma.report.count({ where: { targetId: posts.u2 } }),
      ).toBe(4);
    });

    it("the threshold is read from config", async () => {
      await h.prisma.configEntry.create({
        data: { key: "news.flag_threshold", valueJson: 2 },
      });
      await flag("ada", posts.g).expect(201);
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: posts.g } }))
          .newsReviewStatus,
      ).toBe("NONE");
      await flag("bola", posts.g).expect(201);
      expect(
        (await h.prisma.answer.findUniqueOrThrow({ where: { id: posts.g } }))
          .newsReviewStatus,
      ).toBe("FLAGGED");
    });

    it("a flagged post stays visible in the Newsroom until the team decides, and no notification row is created here", async () => {
      await h.http().get(`/api/v1/news/${posts.u2}`).expect(200);
      expect(await h.prisma.notification.count()).toBe(0);
    });
  });
});
