/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
} from "./harness";
import { ConfigReader } from "./../../src/talk/shared/config-reader";

/**
 * Lead rulings LS10 and RT1 (6 Nov): the listen route has its own limits, and events mode halves limits only while it
 * is on. The global per-address limit is set to 5 here so a route that is not exempt would show it at once.
 */
describe("listen route limits, events mode, and the address a request is counted under", () => {
  let h: Harness;
  let answerId: string;
  beforeAll(async () => {
    h = await startHarness({ throttleLimit: 5 });
    const q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: { startsAt: new Date(Date.now() - 86_400_000) },
    });
    const author = await makePerson(h);
    const clip = await h.prisma.voiceClip.create({
      data: {
        ownerId: author.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: `raw/${randomUUID()}`,
        rawMime: "audio/webm",
        playKey: `voice/${randomUUID()}.m4a`,
        maxDurationMs: 10_000,
        durationMs: 10_000,
      },
    });
    answerId = (
      await h.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: author.id,
          kind: "VOICE",
          clipId: clip.id,
        },
      })
    ).id;
  });
  afterAll(() => h.close());

  const listen = (
    addr: string,
    visitor: string,
    body: object = { completed: false },
  ) =>
    h
      .http()
      .post(`/api/v1/answers/${answerId}/listen`)
      .set("X-Forwarded-For", addr)
      .set("X-Visitor-Id", visitor)
      .send(body);

  it("LS10: 3000 reports a minute per address hold (not the global 5), the 3001st is 429 (LCH-09: was 300)", async () => {
    let ok = 0;
    for (let i = 0; i < 3000; i++)
      if ((await listen("198.51.100.1", randomUUID())).status === 204) ok++;
    expect(ok).toBe(3000);
    const over = await listen("198.51.100.1", randomUUID());
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("RATE_LIMITED");
    // another address has its own 3000
    await listen("198.51.100.2", randomUUID()).expect(204);
  });

  it("LS10: 120 reports a minute per visitor hold, the 121st is 429", async () => {
    const v = randomUUID();
    let last = await listen("198.51.100.3", v);
    for (let i = 1; i < 120; i++) last = await listen("198.51.100.3", v);
    expect(last.status).toBe(204);
    expect(last.headers["ratelimit-limit"]).toBe("120");
    await listen("198.51.100.3", v).expect(429);
    // the same visitor id from another address is the same visitor: still held
    await listen("198.51.100.4", v).expect(429);
  });

  it("the global per-address limit still applies to other routes", async () => {
    const get = () =>
      h.http().get("/api/v1/categories").set("X-Forwarded-For", "198.51.100.5");
    for (let i = 0; i < 5; i++) await get().expect(200);
    await get().expect(429);
  });

  it("RT1: events mode multiplies the limits only while it is on", async () => {
    const cfg = h.app.get(ConfigReader);
    const set = async (on: boolean) => {
      for (const [key, valueJson] of [
        ["ratelimit.events_mode", on],
        ["ratelimit.events_mode_factor", 0.5],
      ] as const)
        await h.prisma.configEntry.upsert({
          where: { key },
          create: { key, valueJson },
          update: { valueJson },
        });
      cfg.invalidate();
    };
    try {
      await set(false); // the factor is 0.5 but the mode is off: nothing is halved
      const off = await listen("198.51.100.6", randomUUID());
      expect(off.headers["ratelimit-limit"]).toBe("120");
      await set(true);
      const on = await listen("198.51.100.7", randomUUID());
      expect(on.headers["ratelimit-limit"]).toBe("60");
    } finally {
      await h.prisma.configEntry.deleteMany({
        where: { key: { startsWith: "ratelimit.events_mode" } },
      });
      cfg.invalidate();
    }
    // with no row at all the mode is off
    const none = await listen("198.51.100.8", randomUUID());
    expect(none.headers["ratelimit-limit"]).toBe("120");
  });

  it("RT2: only the address the proxy appended counts; names put in front of it buy nothing", async () => {
    const get = (xff: string) =>
      h.http().get("/api/v1/categories").set("X-Forwarded-For", xff);
    // one real address, a different made-up first entry every time: still one bucket (5 allowed)
    for (let i = 0; i < 5; i++)
      await get(`10.0.0.${i}, 203.0.113.9`).expect(200);
    await get("10.0.0.99, 203.0.113.9").expect(429);
    await get("1.2.3.4, 10.9.9.9, 203.0.113.9").expect(429);
    // a different real address has its own bucket
    await get("10.0.0.0, 203.0.113.10").expect(200);
  });
});
