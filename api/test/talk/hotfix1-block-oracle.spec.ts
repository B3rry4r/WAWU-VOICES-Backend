/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- supertest bodies are untyped JSON */
import {
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/**
 * V-HOTFIX-1, fault 2: blocks never filter, count or notify differently for a post made without a name, so block and
 * unblock cannot be used to find its writer. A named post still follows the blocks.
 */
describe("hotfix 1: blocks and a nameless post", () => {
  let h: Harness;
  let q: { id: string };
  let w: Person;
  let v: Person;
  let other: Person;
  let anonId: string;
  let namedId: string;
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: {
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
    w = await makePerson(h);
    v = await makePerson(h);
    other = await makePerson(h);
    const post = async (body: object) =>
      (
        await h
          .http()
          .post(`/api/v1/questions/${q.id}/answers`)
          .set("Authorization", w.auth)
          .set(idem())
          .send(body)
          .expect(201)
      ).body.answer.id as string;
    anonId = await post({
      kind: "TEXT",
      body: "zebrafruit nameless thought",
      anonymous: true,
    });
    // a named reply by a third person on the nameless answer, so counts exist
    await h
      .http()
      .post(`/api/v1/answers/${anonId}/replies`)
      .set("Authorization", other.auth)
      .set(idem())
      .send({ kind: "TEXT", body: "I agree", stance: "AGREE" })
      .expect(201);
    await h.prisma.answer.updateMany({
      where: { id: anonId },
      data: { rankScore: 5 },
    });
  });
  afterAll(() => h.close());

  const routes = () => [
    "/api/v1/home",
    `/api/v1/questions/${q.id}`,
    `/api/v1/questions/${q.id}/answers`,
    `/api/v1/questions/${q.id}/answers?sort=TRENDING`,
    `/api/v1/questions/${q.id}/answers?sort=DEBATED`,
    "/api/v1/feed/trending",
    "/api/v1/feed/new",
    "/api/v1/search?q=zebrafruit&type=answers",
    "/api/v1/search?q=zebrafruit",
    "/api/v1/news",
    `/api/v1/answers/${anonId}`,
    `/api/v1/answers/${anonId}/replies`,
    `/api/v1/answers/${anonId}/replies?stance=AGREE`,
  ];
  /** Every route's status and body for the viewer, with the fields that move on their own left out. */
  const capture = async (p: Person, skipNamed = false) => {
    const out: Record<string, unknown> = {};
    for (const r of routes()) {
      const res = await h.http().get(r).set("Authorization", p.auth);
      let body = JSON.stringify(res.body);
      if (skipNamed) body = body.split(namedId).join("NAMED");
      out[r] = {
        status: res.status,
        body: JSON.parse(
          body.replace(/"requestId":"[^"]*"/g, '"requestId":"-"'),
        ),
      };
    }
    return out;
  };
  const strip = (o: Record<string, unknown>) => {
    // the named answer follows the blocks by design, so it is taken out of the comparison of the nameless one
    const copy = JSON.parse(JSON.stringify(o)) as Record<
      string,
      { status: number; body: any }
    >;
    for (const k of Object.keys(copy)) {
      const b = copy[k].body;
      if (b && Array.isArray(b.items))
        b.items = b.items.filter(
          (i: any) => (i.id ?? i.answer?.id) !== namedId,
        );
      if (b && Array.isArray(b.answers))
        b.answers = b.answers.filter((i: any) => i.id !== namedId);
    }
    return copy;
  };
  const block = (by: Person, target: Person) =>
    h
      .http()
      .put(`/api/v1/me/blocks/${target.id}`)
      .set("Authorization", by.auth)
      .expect(204);
  const unblock = (by: Person, target: Person) =>
    h
      .http()
      .delete(`/api/v1/me/blocks/${target.id}`)
      .set("Authorization", by.auth)
      .expect(204);

  it("the nameless answer reads the same for V before, after V blocks W, after W blocks V, and after both", async () => {
    const base = strip(await capture(v));
    // the nameless answer is really served on every route the comparison is about
    for (const r of [
      `/api/v1/questions/${q.id}/answers`,
      "/api/v1/feed/trending",
      "/api/v1/search?q=zebrafruit&type=answers",
      `/api/v1/answers/${anonId}`,
    ])
      expect(JSON.stringify(base[r])).toContain(anonId);
    expect(
      (base[`/api/v1/answers/${anonId}/replies`] as { body: any }).body.items,
    ).toHaveLength(1);
    await block(v, w);
    expect(strip(await capture(v))).toEqual(base);
    await unblock(v, w);
    expect(strip(await capture(v))).toEqual(base);
    await block(w, v);
    expect(strip(await capture(v))).toEqual(base);
    await block(v, w);
    expect(strip(await capture(v))).toEqual(base);
    await unblock(v, w);
    await unblock(w, v);
    expect(strip(await capture(v))).toEqual(base);
  });

  it("a named post by W still vanishes for V when either blocks", async () => {
    namedId = (
      await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", w.auth)
        .set(idem())
        .send({ kind: "TEXT", body: "quokkaberry named thought" })
        .expect(201)
    ).body.answer.id as string;
    const seen = async () =>
      (
        await h
          .http()
          .get(`/api/v1/answers/${namedId}`)
          .set("Authorization", v.auth)
      ).status;
    expect(await seen()).toBe(200);
    await block(v, w);
    expect(await seen()).toBe(404);
    await unblock(v, w);
    await block(w, v);
    expect(await seen()).toBe(404);
    await unblock(w, v);
    expect(await seen()).toBe(200);
    const list = async () =>
      JSON.stringify(
        (
          await h
            .http()
            .get(`/api/v1/questions/${q.id}/answers`)
            .set("Authorization", v.auth)
        ).body,
      ).includes(namedId);
    expect(await list()).toBe(true);
    await block(v, w);
    expect(await list()).toBe(false);
    await unblock(v, w);
  });

  it("replying to the nameless answer works and notifies its writer unless the writer cannot see that reply (blocks either way)", async () => {
    const notices = async () =>
      (
        await h
          .http()
          .get("/api/v1/notifications")
          .set("Authorization", w.auth)
          .expect(200)
      ).body;
    const reply = (p: Person) =>
      h
        .http()
        .post(`/api/v1/answers/${anonId}/replies`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({
          kind: "TEXT",
          body: "reply " + Math.random(),
          stance: "AGREE",
        });
    const count = async () =>
      ((await notices()).items as { type: string }[]).filter(
        (i) => i.type === "REPLY",
      ).length;
    const unread = async () => (await notices()).unread as number;
    const start = await count();
    const startUnread = await unread();
    expect((await reply(v)).status).toBe(201);
    expect(await count()).toBe(start + 1);
    // W blocks V: V can still reply, but W cannot see that reply in their own list, so W gets no notice for it
    // (round 3; round 1 asserted +2 here)
    await block(w, v);
    expect((await reply(v)).status).toBe(201);
    expect(await count()).toBe(start + 1);
    expect(await unread()).toBe(startUnread + 1);
    await unblock(w, v);
    await block(v, w);
    expect((await reply(v)).status).toBe(201);
    expect(await count()).toBe(start + 1);
    await unblock(v, w);
    expect(await count()).toBe(start + 1);
    expect(await unread()).toBe(startUnread + 1);
  });

  it("ranking ignores blocks on a nameless answer", async () => {
    const liker = await makePerson(h);
    await h
      .http()
      .put(`/api/v1/answers/${anonId}/like`)
      .set("Authorization", liker.auth);
    const { RankingService } =
      await import("../../src/feed/ranking.service.js");
    const ranking = h.app.get(RankingService);
    const now = new Date();
    await ranking.run(now);
    const a = await h.prisma.answer.findUniqueOrThrow({
      where: { id: anonId },
    });
    expect(a.rankScore).not.toBe(5);
    await block(w, liker);
    await ranking.run(now);
    const b = await h.prisma.answer.findUniqueOrThrow({
      where: { id: anonId },
    });
    expect(b.rankScore).toBe(a.rankScore);
    await unblock(w, liker);
  });
});
