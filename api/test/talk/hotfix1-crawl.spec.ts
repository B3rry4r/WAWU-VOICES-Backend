/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import {
  guestAuth,
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/**
 * V-HOTFIX-1 round 2: the crawl. Every GET route of docs/contract/openapi.yaml that can return a post or a count, read
 * by four kinds of viewer (the person who will block, a neighbour, the replier, a guest) plus the writer, before any
 * block, after the viewer blocks the writer, after the writer blocks the viewer, and after both, then after unblocking.
 *  - the nameless answer (and everything on it: replies, counts, saves, reactions, listens, notices, share link) must
 *    read exactly the same in every state;
 *  - the named answer by the same writer must follow the blocks as before (gone for the blocked pair, shown to others).
 * The nameless answer sits on its own question; the named one on another, so counts on one never include the other.
 */
describe("hotfix 1: crawl of every route that can return a post or a count", () => {
  let h: Harness;
  let qAnon: { id: string };
  let qNamed: { id: string };
  let w: Person;
  let v: Person;
  let x: Person;
  let r: Person;
  let z: Person;
  let anonId: string;
  let namedId: string;
  let shareCode: string;
  // a word no earlier run left in the shared test database
  const word = `zebra${Date.now().toString(36).replace(/[0-9]/g, "q")}`;
  let guest: Record<string, string>;

  const live = (id: string) =>
    h.prisma.question.update({
      where: { id },
      data: {
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
  // a new client address for every request, so a per-address throttle (search allows 60 a minute) never answers instead of the route
  let hop = 0;
  const as = (p: Person | null) => ({
    ...(p ? { Authorization: p.auth } : guest),
    "X-Forwarded-For": `10.${(hop >> 16) & 255}.${(hop >> 8) & 255}.${++hop & 255}`,
  });

  /**
   * BATCH-C2 round 3 (setup only): this spec's posts stay in the shared test database and a global list (trending, new,
   * news) refills its page with an older one when a named post leaves it for a viewer. A run after an earlier run of this
   * spec, or of the folder, then sees an extra named post and the comparison differs. The spec's own posts are taken out
   * of every list (status DELETED_BY_AUTHOR, no row is removed) before it starts and when it ends.
   */
  const retire = (where: object) =>
    h.prisma.answer.updateMany({
      where,
      data: { status: "DELETED_BY_AUTHOR" },
    });
  const earlierRuns = {
    OR: [
      { body: "a named thought on another subject" },
      { body: { endsWith: " nameless thought" } },
    ],
    status: { not: "DELETED_BY_AUTHOR" as const },
  };

  beforeAll(async () => {
    h = await startHarness();
    await retire(earlierRuns);
    qAnon = await makeQuestion(h);
    qNamed = await makeQuestion(h);
    await live(qAnon.id);
    await live(qNamed.id);
    guest = guestAuth();
    w = await makePerson(h, { freePosts: 10 });
    v = await makePerson(h);
    x = await makePerson(h);
    r = await makePerson(h);
    z = await makePerson(h);
    const post = async (qid: string, body: object) =>
      (
        await h
          .http()
          .post(`/api/v1/questions/${qid}/answers`)
          .set("Authorization", w.auth)
          .set(idem())
          .send(body)
          .expect(201)
      ).body.answer.id as string;
    anonId = await post(qAnon.id, {
      kind: "TEXT",
      body: `${word} nameless thought`,
      anonymous: true,
    });
    namedId = await post(qNamed.id, {
      kind: "TEXT",
      body: "a named thought on another subject",
    });
    for (const [p, stance] of [
      [r, "AGREE"],
      [z, "DISAGREE"],
    ] as const)
      await h
        .http()
        .post(`/api/v1/answers/${anonId}/replies`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind: "TEXT", body: `a ${stance} reply`, stance })
        .expect(201);
    await h
      .http()
      .post(`/api/v1/answers/${namedId}/replies`)
      .set("Authorization", r.auth)
      .set(idem())
      .send({ kind: "TEXT", body: "a reply on the named one", stance: "AGREE" })
      .expect(201);
    // saves, likes, reactions and a listen by V and X on the nameless answer
    for (const p of [v, x]) {
      await h
        .http()
        .put(`/api/v1/answers/${anonId}/save`)
        .set("Authorization", p.auth)
        .expect((res) => expect(res.status).toBeLessThan(300));
      await h
        .http()
        .put(`/api/v1/answers/${anonId}/like`)
        .set("Authorization", p.auth)
        .expect((res) => expect(res.status).toBeLessThan(300));
      await h
        .http()
        .put(`/api/v1/answers/${anonId}/save`)
        .set("Authorization", p.auth);
      await h
        .http()
        .put(`/api/v1/answers/${namedId}/save`)
        .set("Authorization", p.auth);
    }
    const link = await h
      .http()
      .post("/api/v1/share/links")
      .set("Authorization", v.auth)
      .send({ objectType: "ANSWER", objectId: anonId });
    shareCode = (link.body.code ?? "none") as string;
    await h.prisma.answer.updateMany({
      where: { id: { in: [anonId, namedId] } },
      data: { rankScore: 5 },
    });
  });
  afterAll(async () => {
    await retire({ questionId: { in: [qAnon.id, qNamed.id] } });
    await h.close();
  });

  const routes = () => [
    "/api/v1/me/answers",
    "/api/v1/me/saved",
    `/api/v1/people/${r.id}/replies`,
    `/api/v1/people/${r.id}`,
    "/api/v1/home",
    "/api/v1/questions/today",
    "/api/v1/questions",
    `/api/v1/questions/${qAnon.id}`,
    "/api/v1/feed/trending",
    "/api/v1/feed/trending-questions",
    "/api/v1/feed/new",
    `/api/v1/questions/${qAnon.id}/answers`,
    `/api/v1/questions/${qAnon.id}/answers?sort=TOP`,
    `/api/v1/questions/${qAnon.id}/answers?sort=DEBATED`,
    `/api/v1/questions/${qAnon.id}/answers?sort=NEW`,
    `/api/v1/questions/${qAnon.id}/moods`,
    `/api/v1/questions/${qAnon.id}/polls`,
    `/api/v1/questions/${qAnon.id}/what-next`,
    `/api/v1/answers/${anonId}/where-you-sit`,
    `/api/v1/answers/${anonId}`,
    `/api/v1/answers/${anonId}/card`,
    `/api/v1/answers/${anonId}/videos`,
    `/api/v1/answers/${anonId}/replies`,
    `/api/v1/answers/${anonId}/replies?stance=AGREE`,
    `/api/v1/answers/${anonId}/replies?stance=DISAGREE`,
    "/api/v1/news",
    `/api/v1/news/${anonId}`,
    `/api/v1/search?q=${word}`,
    `/api/v1/search?q=${word}&type=answers`,
    "/api/v1/notifications",
    "/api/v1/notifications/unread-count",
    `/api/v1/share/${shareCode}`,
    "/api/v1/me/friends",
    "/api/v1/me/invite",
    "/api/v1/weekly-reports/latest",
  ];
  const named = (qid: string) => [
    `/api/v1/answers/${namedId}`,
    `/api/v1/answers/${namedId}/replies`,
    `/api/v1/questions/${qid}/answers`,
  ];

  const strip = (text: string) =>
    text
      .replace(/"requestId":"[^"]*"/g, '"requestId":"-"')
      .replace(/"(serverTime|now|generatedAt)":"[^"]*"/g, '"$1":"-"')
      // a page marker of the trending-questions list carries a clock reading; whether there is one stays compared
      .replace(/"nextCursor":"[^"]*"/g, '"nextCursor":"<cursor>"');
  /** Drop every object that belongs to the named answer, so only the nameless one is compared. */
  const dropNamed = (v: unknown): unknown => {
    if (Array.isArray(v))
      return v
        .filter(
          (i) =>
            !refersNamed(i) && (typeof i !== "object" || i === null || mine(i)),
        )
        .map((i) => dropNamed(i));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [k, dropNamed(val)]),
      );
    return v;
  };
  /**
   * BATCH-C2 round 3 (setup of the comparison): the shared test database holds other specs' posts, and a global list
   * refills its page with one of them when a named post leaves it; only what refers to this spec's own rows is compared.
   */
  const mine = (i: unknown): boolean => {
    const s = JSON.stringify(i);
    return [anonId, qAnon.id, w.id, v.id, x.id, r.id, z.id].some((id) =>
      s.includes(id),
    );
  };
  const refersNamed = (i: unknown): boolean => {
    const s = JSON.stringify(i);
    return !!s && (s.includes(namedId) || s.includes(qNamed.id));
  };
  const get = async (viewer: Person | null, url: string) => {
    const res = await h.http().get(url).set(as(viewer));
    let body: unknown = null;
    try {
      body = JSON.parse(strip(JSON.stringify(res.body)));
    } catch {
      body = null;
    }
    return { status: res.status, body: dropNamed(body) };
  };
  /** The writer's own person page changes with a block (it is about the person, not a post), but must never list the nameless answer. */
  const writerPages = () => [
    `/api/v1/people/${w.id}`,
    `/api/v1/people/${w.id}/replies`,
    `/api/v1/people/by-handle/none`,
  ];
  const capture = async (viewer: Person | null) => {
    const out: Record<string, unknown> = {};
    for (const u of routes()) out[u] = await get(viewer, u);
    for (const u of writerPages()) {
      const res = await h.http().get(u).set(as(viewer));
      expect(JSON.stringify(res.body)).not.toContain(anonId);
    }
    return out;
  };
  const viewers = () =>
    [
      ["V (will block)", v],
      ["X (neighbour)", x],
      ["R (replier)", r],
      ["W (writer)", w],
      ["guest", null],
    ] as const;
  const put = (by: Person, t: Person) =>
    h
      .http()
      .put(`/api/v1/me/blocks/${t.id}`)
      .set("Authorization", by.auth)
      .expect(204);
  const del = (by: Person, t: Person) =>
    h
      .http()
      .delete(`/api/v1/me/blocks/${t.id}`)
      .set("Authorization", by.auth)
      .expect(204);
  const snapshot = async () => {
    const all: Record<string, Record<string, unknown>> = {};
    for (const [name, p] of viewers()) all[name] = await capture(p);
    return all;
  };
  const same = (
    base: Record<string, Record<string, unknown>>,
    now: Record<string, Record<string, unknown>>,
    state: string,
  ) => {
    for (const name of Object.keys(base))
      for (const u of Object.keys(base[name])) {
        // the viewer's own block list is theirs to see change; every other route must not move
        if (u.includes("/me/blocks")) continue;
        // R wrote a named reply on the nameless answer: when R and the writer block each other, the two of them lose
        // each other's named reply and person page, as on main. Every other viewer must still see no change at all.
        if (
          state.includes(r.id) &&
          (name.startsWith("W") || name.startsWith("R"))
        )
          continue;
        expect({ state, name, u, got: now[name][u] }).toEqual({
          state,
          name,
          u,
          got: base[name][u],
        });
      }
  };

  it("the nameless answer reads identically for every viewer in every block state", async () => {
    const base = await snapshot();
    // sanity: the crawl really sees the nameless answer and the replies on it
    expect(
      JSON.stringify(base["V (will block)"]["/api/v1/feed/trending"]),
    ).toContain(anonId);
    expect(
      JSON.stringify(base["V (will block)"]["/api/v1/me/saved"]),
    ).toContain(anonId);
    expect(
      JSON.stringify(base["W (writer)"]["/api/v1/notifications"]),
    ).toContain("reply");
    // which routes answered 200 (the rest answer the same error in every state, which the crawl also compares)
    if (process.env.CRAWL_VERBOSE)
      for (const [k, val] of Object.entries(base["V (will block)"]))
        console.log((val as { status: number }).status, k);
    expect(
      JSON.stringify(
        base["V (will block)"][`/api/v1/questions/${qAnon.id}/answers`],
      ),
    ).toContain(anonId);
    expect(
      JSON.stringify(base["V (will block)"][`/api/v1/people/${r.id}/replies`]),
    ).toContain("AGREE");
    // R and Z wrote named replies on the nameless answer: a reply is a named post, so the writer blocking R (or Z) is the
    // writer's own choice about R, and R's reply leaves the writer's thread as on main. Everything else must not move.
    for (const p of [v, x, r]) {
      // viewer blocks the writer
      await put(p, w);
      same(base, await snapshot(), `${p.id} blocks W`);
      await del(p, w);
      same(base, await snapshot(), `${p.id} unblocked W`);
      // the writer blocks the viewer (not R: that would hide R's own named reply from the writer, as on main)
      if (p !== r) {
        await put(w, p);
        same(base, await snapshot(), `W blocks ${p.id}`);
        await put(p, w);
        same(base, await snapshot(), `both ways with ${p.id}`);
        await del(p, w);
        await del(w, p);
        same(base, await snapshot(), `${p.id} cleared`);
      }
    }
  }, 300_000);

  it("the named answer by the same writer still follows the blocks, as on main", async () => {
    const ok = async (p: Person | null, code: number) =>
      expect(
        (await h.http().get(`/api/v1/answers/${namedId}`).set(as(p))).status,
      ).toBe(code);
    await ok(v, 200);
    await put(v, w);
    await ok(v, 404);
    await ok(x, 200);
    await ok(null, 200);
    await del(v, w);
    await ok(v, 200);
    await put(w, v);
    await ok(v, 404);
    await ok(r, 200);
    await del(w, v);
    await ok(v, 200);
    // and it drops out of the question's list for the blocked pair only
    const list = (p: Person | null) =>
      h
        .http()
        .get(`/api/v1/questions/${qNamed.id}/answers`)
        .set(as(p))
        .then((res) => JSON.stringify(res.body));
    expect(await list(v)).toContain(namedId);
    await put(v, w);
    expect(await list(v)).not.toContain(namedId);
    expect(await list(x)).toContain(namedId);
    await del(v, w);
    expect(named(qNamed.id)).toHaveLength(3);
  });

  it("a reaction notice about the nameless answer keeps its count and stays when the writer blocks a reactor", async () => {
    const kind = (await h.http().get("/api/v1/reactions")).body.items[0].kind;
    for (const p of [r, z])
      await h
        .http()
        .put(`/api/v1/answers/${anonId}/reaction`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({ kind })
        .expect(200);
    // the notices about the nameless answer (a reply notice on the named answer by R is about a named post and does follow the block)
    const notice = async () => {
      const res = await h
        .http()
        .get("/api/v1/notifications")
        .set(as(w))
        .expect(200);
      return (res.body.items as any[])
        .filter((i) => i.questionId === qAnon.id)
        .map((i) => [i.type, i.actorCount])
        .sort();
    };
    const base = await notice();
    expect(base).toEqual([
      ["REACTIONS", 2],
      ["REPLY", 1],
      ["REPLY", 1],
    ]);
    await put(w, r);
    expect(await notice()).toEqual(base);
    await put(r, w);
    expect(await notice()).toEqual(base);
    await del(w, r);
    await del(r, w);
    expect(await notice()).toEqual(base);
  }, 60_000);
});
