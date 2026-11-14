/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { dateOnly, lagosDay } from "../../src/feed/lagos";
import { GuestReadCache } from "../../src/feed/guest-cache";
import {
  makePerson,
  startHarness,
  type Harness,
  type Person,
} from "../talk/harness";

/**
 * LCH-09: guest reads are shared for a few seconds (the broadcast sends everybody to the same pages). The rule under
 * test: the shared copy never carries a person's own data, whoever filled it, and a signed-in person never reads it.
 * Two people, one cache.
 */
describe("guest reads are shared, a person's own data never is", () => {
  let h: Harness;
  let questionId: string;
  let ada: Person;
  let bayo: Person;
  let answerBy: { ada: string; bayo: string };

  beforeAll(async () => {
    process.env.GUEST_CACHE_TTL_MS = "60000";
    h = await startHarness();
    const now = new Date();
    const q = await h.prisma.question.create({
      data: {
        text: "How do you feel about Nigeria right now?",
        kind: "DAILY",
        status: "LIVE",
        // Pinned wins the day's pick (todayRow orders by pinned). Other specs sharing this database (launch-shift seeds
        // the question bank, which has questions dated 12 to 15 Nov) can leave a second question for the same date.
        pinned: true,
        scheduledFor: dateOnly(lagosDay(now)),
        startsAt: new Date(now.getTime() - 3_600_000),
        endsAt: new Date(now.getTime() + 20 * 3_600_000),
      },
    });
    questionId = q.id;
    ada = await makePerson(h);
    bayo = await makePerson(h);
    const mk = async (p: Person, body: string) =>
      (
        await h.prisma.answer.create({
          data: { questionId, authorId: p.id, kind: "TEXT", body },
        })
      ).id;
    answerBy = {
      ada: await mk(ada, "Ada says hello"),
      bayo: await mk(bayo, "Bayo says hello"),
    };
  });
  beforeEach(() => h.app.get(GuestReadCache).clear());
  afterAll(async () => {
    delete process.env.GUEST_CACHE_TTL_MS;
    await h.close();
  });

  const today = (auth?: string) => {
    const r = h.http().get("/api/v1/questions/today");
    return auth ? r.set("Authorization", auth) : r;
  };
  const answers = (opts: { auth?: string; guest?: string } = {}) => {
    let r = h.http().get(`/api/v1/questions/${questionId}/answers`);
    if (opts.auth) r = r.set("Authorization", opts.auth);
    if (opts.guest) r = r.set("X-Guest-Id", opts.guest);
    return r;
  };
  const mine = (body: any, id: string) =>
    body.items.find((i: any) => i.answer.id === id).answer;

  it("a saved question shows as saved to its owner only, whoever read first", async () => {
    await h
      .http()
      .put(`/api/v1/questions/${questionId}/save`)
      .set("Authorization", ada.auth)
      .expect(204);
    // the guest fills the shared copy first
    const g1 = await today().expect(200);
    expect(g1.body.iSaved).toBe(false);
    const a = await today(ada.auth).expect(200);
    expect(a.body.iSaved).toBe(true);
    // and the guest still sees the shared one, not Ada's
    expect((await today().expect(200)).body.iSaved).toBe(false);
    // the other way round: Ada reads on an empty cache, then a guest
    h.app.get(GuestReadCache).clear();
    expect((await today(ada.auth).expect(200)).body.iSaved).toBe(true);
    expect((await today().expect(200)).body.iSaved).toBe(false);
    expect((await today(bayo.auth).expect(200)).body.iSaved).toBe(false);
  });

  it("a question by id: the same, and a missing one is not kept", async () => {
    await h
      .http()
      .put(`/api/v1/questions/${questionId}/save`)
      .set("Authorization", ada.auth);
    const get = (auth?: string) => {
      const r = h.http().get(`/api/v1/questions/${questionId}`);
      return auth ? r.set("Authorization", auth) : r;
    };
    expect((await get(ada.auth).expect(200)).body.iSaved).toBe(true);
    expect((await get().expect(200)).body.iSaved).toBe(false);
    expect((await get(ada.auth).expect(200)).body.iSaved).toBe(true);
    await h.http().get(`/api/v1/questions/${randomUUID()}`).expect(404);
    await h.http().get(`/api/v1/questions/${randomUUID()}`).expect(404);
  });

  it("answers: my like, my reaction, my own answer and my blocks are never in the shared page", async () => {
    const g = randomUUID();
    // Bayo reacts to Ada's answer; Ada blocks nobody yet
    await h
      .http()
      .put(`/api/v1/answers/${answerBy.ada}/reaction`)
      .set("Authorization", bayo.auth)
      .set("Idempotency-Key", randomUUID())
      .send({ kind: "RELATABLE" });
    await h
      .http()
      .put(`/api/v1/answers/${answerBy.ada}/like`)
      .set("Authorization", bayo.auth);
    // a guest fills the cache
    const shared = (await answers({ guest: randomUUID() }).expect(200)).body;
    expect(mine(shared, answerBy.ada)).toMatchObject({
      iLiked: false,
      myReaction: null,
      isMine: false,
    });
    // Bayo's own page has his like and reaction, and his own answer is his
    const b = (await answers({ auth: bayo.auth }).expect(200)).body;
    expect(mine(b, answerBy.ada)).toMatchObject({
      iLiked: true,
      myReaction: "RELATABLE",
    });
    expect(mine(b, answerBy.bayo).isMine).toBe(true);
    // Ada's page says her answer is hers and not Bayo's
    const a = (await answers({ auth: ada.auth }).expect(200)).body;
    expect(mine(a, answerBy.ada).isMine).toBe(true);
    expect(mine(a, answerBy.bayo).isMine).toBe(false);
    // after all that the shared page is still nobody's
    const again = (await answers({ guest: g }).expect(200)).body;
    expect(mine(again, answerBy.ada)).toMatchObject({
      iLiked: false,
      myReaction: null,
      isMine: false,
    });
    expect(mine(again, answerBy.bayo).isMine).toBe(false);
  });

  it("a person's blocks hide people from that person only", async () => {
    await h
      .http()
      .put(`/api/v1/me/blocks/${bayo.id}`)
      .set("Authorization", ada.auth)
      .expect(204);
    // guest first
    const g = (await answers({ guest: randomUUID() }).expect(200)).body;
    expect(g.items).toHaveLength(2);
    const a = (await answers({ auth: ada.auth }).expect(200)).body;
    expect(a.items.map((i: any) => i.answer.id)).toEqual([answerBy.ada]);
    expect(
      (await answers({ guest: randomUUID() }).expect(200)).body.items,
    ).toHaveLength(2);
    // Ada first, on an empty cache
    h.app.get(GuestReadCache).clear();
    expect(
      (await answers({ auth: ada.auth }).expect(200)).body.items,
    ).toHaveLength(1);
    expect(
      (await answers({ guest: randomUUID() }).expect(200)).body.items,
    ).toHaveLength(2);
    await h
      .http()
      .delete(`/api/v1/me/blocks/${bayo.id}`)
      .set("Authorization", ada.auth);
  });

  it("two guests share one page but each sees only their own like", async () => {
    const g1 = randomUUID();
    const g2 = randomUUID();
    await h
      .http()
      .put(`/api/v1/answers/${answerBy.bayo}/like`)
      .set("X-Guest-Id", g1)
      .expect(200);
    const second = (await answers({ guest: g2 }).expect(200)).body;
    expect(mine(second, answerBy.bayo).iLiked).toBe(false);
    const first = (await answers({ guest: g1 }).expect(200)).body;
    expect(mine(first, answerBy.bayo).iLiked).toBe(true);
    // g1's read did not leak into the shared copy
    expect(
      mine((await answers({ guest: g2 }).expect(200)).body, answerBy.bayo)
        .iLiked,
    ).toBe(false);
    expect(mine((await answers().expect(200)).body, answerBy.bayo).iLiked).toBe(
      false,
    );
  });

  it("says who may keep it: guests share, signed-in people never", async () => {
    const g = await today().expect(200);
    expect(g.headers["cache-control"]).toBe("public, max-age=60");
    expect(g.headers["x-accel-expires"]).toBe("60");
    expect(g.headers.vary).toMatch(/Authorization/);
    const s = await today(ada.auth).expect(200);
    expect(s.headers["cache-control"]).toBe("private, no-cache");
    expect(s.headers["x-accel-expires"]).toBeUndefined();
    // the answers page varies by guest id, so the proxy is never offered it
    const ga = await answers({ guest: randomUUID() }).expect(200);
    expect(ga.headers["x-accel-expires"]).toBeUndefined();
    expect(ga.headers.vary).toMatch(/X-Guest-Id/);
    const sa = await answers({ auth: ada.auth }).expect(200);
    expect(sa.headers["cache-control"]).toBe("private, no-cache");
  });

  it("a new answer shows once the copy is older than the time to live, and not before", async () => {
    process.env.GUEST_CACHE_TTL_MS = "400";
    const before = (await answers().expect(200)).body.items.length;
    await h.prisma.answer.create({
      data: { questionId, authorId: ada.id, kind: "TEXT", body: "One more" },
    });
    expect((await answers().expect(200)).body.items).toHaveLength(before);
    await new Promise((r) => setTimeout(r, 450));
    expect((await answers().expect(200)).body.items).toHaveLength(before + 1);
    process.env.GUEST_CACHE_TTL_MS = "60000";
  });

  it("at 0 the cache is off and every read is fresh", async () => {
    process.env.GUEST_CACHE_TTL_MS = "0";
    const before = (await answers().expect(200)).body.items.length;
    await h.prisma.answer.create({
      data: { questionId, authorId: ada.id, kind: "TEXT", body: "Another" },
    });
    expect((await answers().expect(200)).body.items).toHaveLength(before + 1);
    const g = await today().expect(200);
    expect(g.headers["cache-control"]).toBe("private, no-cache");
    process.env.GUEST_CACHE_TTL_MS = "60000";
  });
});
