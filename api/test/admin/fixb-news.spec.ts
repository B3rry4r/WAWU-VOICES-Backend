/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { bootAdmin, type Admin } from "./helpers";
import { seedQuestion } from "./helpers";

/**
 * V-FIX-B, item 1 (addendum 1): a post carries a tag the person chose; "Request Verified News" writes a request the
 * editors see next to the flagged posts; an editor promotes it and the Verified News tab fills.
 */
describe("V-FIX-B news tags: Not news kept, request Verified News, editor promotes", () => {
  let a: Admin;
  let q: string;
  const idem = (() => {
    let n = 0;
    return () => ({ "Idempotency-Key": `fixb-news-${Date.now()}-${n++}` });
  })();
  const post = (who: string, body: Record<string, unknown>) =>
    a.h
      .http()
      .post(`/api/v1/questions/${q}/answers`)
      .set(a.auth(who))
      .set(idem())
      .send({ kind: "TEXT", body: "Fuel queue at the Ikeja station", ...body });

  const until = async <T>(fn: () => Promise<T | null | undefined | false>) => {
    for (let i = 0; i < 40; i++) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };

  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("editor", ["EDITOR"]);
    await a.person("poster");
    await a.person("reader");
    await a.person("other");
    q = (await seedQuestion(a)).id;
  });
  afterAll(() => a.close());

  it("Not news is accepted again (isNews false or no news fields); a tag or a source without isNews is refused; isNews needs a tag", async () => {
    await post("poster", { isNews: false }).expect(201);
    await post("poster", {}).expect(201);
    const none = await post("poster", { isNews: true }).expect(422);
    expect(none.body.error.code).toBe("TAG_REQUIRED");
    await post("poster", { requestVerified: true }).expect(422);
    await post("poster", { isNews: false, newsTag: "GOSSIP" }).expect(422);
  });

  it("a voice or text post with a chosen tag publishes with that tag", async () => {
    const r = await post("poster", { isNews: true, newsTag: "GOSSIP" }).expect(
      201,
    );
    expect(r.body.answer.news).toMatchObject({ tag: "GOSSIP" });
  });

  it("a normal person cannot mark a post Verified News, even by asking in the same request", async () => {
    const r = await post("poster", {
      isNews: true,
      newsTag: "VERIFIED_NEWS",
      newsSourceName: "Channels TV",
    }).expect(403);
    expect(r.body.error.code).toBe("VERIFIED_NEWS_FORBIDDEN");
    await post("poster", {
      isNews: true,
      newsTag: "GOSSIP",
      requestVerified: true,
      newsSourceName: "Channels TV",
    }).expect(422);
  });

  it("asking for Verified News needs a named source and a real link", async () => {
    const r = await post("poster", {
      isNews: true,
      newsTag: "UNVERIFIED_NEWS",
      requestVerified: true,
    }).expect(422);
    expect(r.body.error.code).toBe("SOURCE_REQUIRED");
    await post("poster", {
      isNews: true,
      newsTag: "UNVERIFIED_NEWS",
      requestVerified: true,
      newsSourceName: "Lagos State Press Office",
      newsSourceUrl: "ftp://nope",
    }).expect(422);
  });

  it("the request goes in the editors' queue next to the flagged posts; an editor promotes it; the Verified News tab fills; people who follow the tag are told", async () => {
    const before = (
      await a.h.http().get("/api/v1/news?tag=VERIFIED_NEWS").expect(200)
    ).body.items.length;
    const made = await post("poster", {
      isNews: true,
      newsTag: "UNVERIFIED_NEWS",
      requestVerified: true,
      newsSourceName: "Lagos State Press Office",
      newsSourceUrl: "https://example.com/statement",
    }).expect(201);
    const id = made.body.answer.id as string;
    // posted as Unverified News; the source rides on the request, not the post
    expect(made.body.answer.news).toMatchObject({
      tag: "UNVERIFIED_NEWS",
      sourceName: null,
    });
    const row = await a.prisma.answer.findUniqueOrThrow({ where: { id } });
    expect(row.newsReviewStatus).toBe("VERIFIED_REQUESTED");
    const req = await a.prisma.newsVerificationRequest.findFirstOrThrow({
      where: { answerId: id },
    });
    expect(req).toMatchObject({
      status: "OPEN",
      requestedById: a.people.poster.id,
      sourceName: "Lagos State Press Office",
    });

    // a flagged post sits in the same queue frame: both tabs, one "waiting" count
    const flagged = await a.prisma.answer.create({
      data: {
        questionId: q,
        authorId: a.people.other.id,
        kind: "TEXT",
        body: "flagged one",
        isNews: true,
        newsTag: "GOSSIP",
        newsReviewStatus: "FLAGGED",
        newsFlagCount: 4,
      },
    });
    const asking = await a.h
      .http()
      .get("/api/v1/admin/news/items?tab=asking-verified")
      .set(a.auth("editor"))
      .expect(200);
    expect(asking.body.items.map((i: any) => i.answer.id)).toEqual([id]);
    expect(asking.body.items[0]).toMatchObject({
      verifiedRequested: true,
      sourceName: "Lagos State Press Office",
    });
    expect(asking.body.counts.askingVerified).toBe(1);
    const flaggedTab = await a.h
      .http()
      .get("/api/v1/admin/news/items?tab=flagged")
      .set(a.auth("editor"))
      .expect(200);
    expect(flaggedTab.body.items.map((i: any) => i.answer.id)).toEqual([
      flagged.id,
    ]);
    expect(flaggedTab.body.waiting).toBe(2);

    // a normal person cannot decide
    await a.h
      .http()
      .post(`/api/v1/admin/news/${id}/decision`)
      .set(a.auth("reader"))
      .send({ decision: "APPROVE_VERIFIED", reason: "I say so." })
      .expect(403);

    const done = await a.h
      .http()
      .post(`/api/v1/admin/news/${id}/decision`)
      .set(a.auth("editor"))
      .send({
        decision: "APPROVE_VERIFIED",
        reason: "Checked with the office.",
      })
      .expect(200);
    expect(done.body.answer.news).toMatchObject({
      tag: "VERIFIED_NEWS",
      sourceName: "Lagos State Press Office",
    });

    const tab = await a.h
      .http()
      .get("/api/v1/news?tag=VERIFIED_NEWS")
      .expect(200);
    expect(tab.body.items.length).toBe(before + 1);
    expect(tab.body.items.map((i: any) => i.id)).toContain(id);
    expect(tab.body.items.find((i: any) => i.id === id).news.sourceUrl).toBe(
      "https://example.com/statement",
    );

    // the poster is told the tag changed, and a follower of Verified News gets one TAG_FOLLOW notice (never the poster)
    const told = await a.prisma.notification.findFirst({
      where: { userId: a.people.poster.id, type: "TAG_CHANGED", targetId: id },
    });
    expect(told).not.toBeNull();
    const follow = await until(() =>
      a.prisma.notification.findFirst({
        where: { userId: a.people.reader.id, type: "TAG_FOLLOW" },
      }),
    );
    expect(follow).toMatchObject({ targetId: id, targetType: "answer" });
    expect(follow?.title).toBe("New under Verified News");
    expect(
      await a.prisma.notification.count({
        where: { userId: a.people.poster.id, type: "TAG_FOLLOW" },
      }),
    ).toBe(0);
  });

  it("the poster can also ask afterwards; once at a time; only the poster; not on a post that is already Verified", async () => {
    const made = await post("poster", {
      isNews: true,
      newsTag: "GOSSIP",
    }).expect(201);
    const id = made.body.answer.id as string;
    const url = `/api/v1/news/${id}/request-verified`;
    const ask = (who: string, b: object) =>
      a.h.http().post(url).set(a.auth(who)).send(b);
    await a.h.http().post(url).send({ sourceName: "x" }).expect(401);
    await ask("other", { sourceName: "Not mine" }).expect(404);
    const empty = await ask("poster", { sourceName: " " }).expect(422);
    expect(empty.body.error.code).toBeDefined();
    await ask("poster", {
      sourceName: "NAN",
      sourceUrl: "javascript:1",
    }).expect(422);
    const ok = await ask("poster", {
      sourceName: "News Agency of Nigeria",
      sourceUrl: "https://example.com/nan",
    }).expect(201);
    expect(ok.body.status).toBe("OPEN");
    const dupe = await ask("poster", { sourceName: "Again" }).expect(409);
    expect(dupe.body.error.details.reason).toBe("ALREADY_REQUESTED");
    const queue = await a.h
      .http()
      .get("/api/v1/admin/news/items?tab=asking-verified")
      .set(a.auth("editor"))
      .expect(200);
    expect(queue.body.items.map((i: any) => i.answer.id)).toContain(id);
    await a.h
      .http()
      .post(`/api/v1/admin/news/${id}/decision`)
      .set(a.auth("editor"))
      .send({ decision: "APPROVE_VERIFIED", reason: "Confirmed." })
      .expect(200);
    const done = await ask("poster", { sourceName: "Late" }).expect(409);
    expect(done.body.error.details.reason).toBe("ALREADY_VERIFIED");
  });

  it("an editor can post Verified News directly with a source (the role checks are as they were)", async () => {
    const r = await post("editor", {
      isNews: true,
      newsTag: "VERIFIED_NEWS",
      newsSourceName: "NiMet bulletin",
    }).expect(201);
    expect(r.body.answer.news).toMatchObject({
      tag: "VERIFIED_NEWS",
      sourceName: "NiMet bulletin",
    });
  });
});
