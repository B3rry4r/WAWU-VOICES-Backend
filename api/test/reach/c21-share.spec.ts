/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { createHash } from "node:crypto";
import { Harness, mkTopic, resetDb, startHarness } from "./helpers";

const ALL_BUT_DATE = [
  "nextTick",
  "setImmediate",
  "clearImmediate",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
  "performance",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "hrtime",
] as never[];
const at = (iso: string) =>
  jest.useFakeTimers({ now: new Date(iso), doNotFake: ALL_BUT_DATE });
const sha = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/** C2.1: M-A (a coming-up card is redrawn once its question opens), L-6 (page status is computed). */
describe("C2.1 share: coming-up card, cache time, page status", () => {
  let h: Harness;
  let qid: string;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    jest.useRealTimers();
    await h.close();
  });
  afterEach(() => jest.useRealTimers());
  beforeEach(async () => {
    jest.useRealTimers();
    await h.cards.idle();
    await resetDb();
    h.store.objects.clear();
    h.renders.count = 0;
    const topic = await mkTopic(h, 1);
    const q = await h.prisma.question.create({
      data: {
        topicId: topic.id,
        kind: "DAILY",
        status: "SCHEDULED",
        isSpare: false,
        text: "When salary arrives, how many hours pass before it disappears?",
        scheduledFor: new Date("2026-11-15T00:00:00Z"),
        startsAt: new Date("2026-11-14T23:00:00Z"),
        endsAt: new Date("2026-11-15T23:00:00Z"),
      },
    });
    qid = q.id;
  });

  const make = async () => {
    const r = await h
      .http()
      .post("/api/v1/share/links")
      .send({ objectType: "QUESTION", objectId: qid })
      .expect(201);
    await h.cards.idle();
    return r.body.code as string;
  };
  const card = (code: string) => h.http().get(`/api/v1/share/${code}/card`);
  const bytes = (r: { body: unknown }) => r.body as Buffer;

  it("M-A: a link made at 05:00 shows the old picture until 23:00, and a new one with no Opens line after; cache time never passes the opening", async () => {
    at("2026-11-14T05:00:00Z");
    const code = await make();
    const stored = await h.prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    expect(stored.leanLine).toBe("Opens Sunday 15 November");
    const far = await card(code).expect(200);
    expect(far.headers["cache-control"]).toBe("public, max-age=300");
    expect(far.headers["x-accel-expires"]).toBe("30");
    const old = sha(bytes(far));

    at("2026-11-14T22:59:59.000Z");
    const near = await card(code).expect(200);
    expect(sha(bytes(near))).toBe(old);
    expect(near.headers["cache-control"]).toBe("public, max-age=1");
    expect(Number(near.headers["x-accel-expires"])).toBeLessThanOrEqual(1);
    const story = await h.http().get(`/api/v1/share/${code}/story`).expect(200);
    expect(story.headers["cache-control"]).toBe("public, max-age=1");
    const rendersBefore = h.renders.count; // the card, and the story drawn on request

    at("2026-11-14T23:00:01.000Z");
    const after = await card(code).expect(200);
    expect(sha(bytes(after))).not.toBe(old);
    expect(h.renders.count).toBe(rendersBefore + 1);
    const now = await h.prisma.shareCard.findFirstOrThrow({
      where: { link: { code } },
    });
    expect(now.leanLine).toBeNull();
    expect(now.status).toBe("READY");
    expect(after.headers["cache-control"]).toBe("public, max-age=3600");
    // and again: the same picture, no more draws
    const again = await card(code).expect(200);
    expect(sha(bytes(again))).toBe(sha(bytes(after)));
    expect(h.renders.count).toBe(rendersBefore + 1);
    const st2 = await h.http().get(`/api/v1/share/${code}/story`).expect(200);
    expect(st2.headers["cache-control"]).toBe("public, max-age=300");
  }, 60_000);

  it("M-A: 100 requests at once at 23:00:01 draw once, none fails, and each gets the old or the new picture", async () => {
    at("2026-11-14T05:00:00Z");
    const code = await make();
    const old = sha(bytes(await card(code).expect(200)));
    at("2026-11-14T23:00:01.000Z");
    const before = h.renders.count;
    const rs = await Promise.all(Array.from({ length: 100 }, () => card(code)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(h.renders.count - before).toBe(1);
    const fresh = sha(bytes(await card(code).expect(200)));
    expect(fresh).not.toBe(old);
    for (const r of rs) expect([old, fresh]).toContain(sha(bytes(r)));
    expect(h.renders.count - before).toBe(1);
  }, 60_000);

  it("M-A: a card made for a question that is already open is never redrawn, and keeps today's cache time", async () => {
    at("2026-11-14T23:30:00Z");
    const code = await make();
    const first = await card(code).expect(200);
    const n = h.renders.count;
    at("2026-11-15T10:00:00Z");
    const r2 = await card(code).expect(200);
    expect(sha(bytes(r2))).toBe(sha(bytes(first)));
    expect(h.renders.count).toBe(n);
    expect(r2.headers["cache-control"]).toBe("public, max-age=3600");
    expect(r2.headers["x-accel-expires"]).toBe("30");
  }, 60_000);

  it("M-A: a failed redraw serves the old picture, with a short cache time", async () => {
    at("2026-11-14T05:00:00Z");
    const code = await make();
    const old = sha(bytes(await card(code).expect(200)));
    at("2026-11-14T23:00:01.000Z");
    h.store.failPuts = true;
    const r = await card(code).expect(200);
    h.store.failPuts = false;
    expect(sha(bytes(r))).toBe(old);
    expect(r.headers["cache-control"]).toBe("public, max-age=30");
  }, 60_000);

  it("L-6: the share page's question.status is the computed one at 22:59:59.9 and 23:00:00.0", async () => {
    at("2026-11-14T22:00:00Z");
    const code = await make();
    const view = async (iso: string) => {
      at(iso);
      const page = await h.http().get(`/api/v1/share/${code}`).expect(200);
      const today = await h.http().get("/api/v1/questions/today").expect(200);
      return { page: page.body.question.status, today: today.body.status };
    };
    const a = await view("2026-11-14T22:59:59.900Z");
    expect(a.page).toBe("SCHEDULED");
    expect(a.page).toBe(a.today);
    const b = await view("2026-11-14T23:00:00.000Z");
    expect(b.page).toBe("LIVE");
    expect(b.page).toBe(b.today);
  }, 60_000);
});
