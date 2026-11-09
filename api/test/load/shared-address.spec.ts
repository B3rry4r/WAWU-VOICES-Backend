/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
} from "../talk/harness";

/**
 * LCH-09: the per-address limits at the app's own defaults, from one address.
 *  1. A carrier address with many people behind it, at the planned rate (5 new people a second for a minute, 300 people),
 *     each doing what a person does on the broadcast path (the counts per person are from the dry run, rounded up), gets no 429.
 *  2. Abuse from one address is still stopped, at a value that is a fraction of a second of server work.
 * The limits are per route, per address, so each route is exercised on its own with that many calls.
 */
const PEOPLE = 300;
const CODE = Date.now().toString(36).slice(-7).padStart(7, "b");

describe("a shared carrier address and abuse from one address", () => {
  let h: Harness;
  let qid: string;
  let answerId: string;
  let inviteCode: string;
  const ADDR = "198.51.100.77";

  beforeAll(async () => {
    process.env.GUEST_CACHE_TTL_MS = "0";
    h = await startHarness({ throttleLimit: "default" });
    const q = await makeQuestion(h);
    qid = q.id;
    await h.prisma.question.update({
      where: { id: q.id },
      data: { startsAt: new Date(Date.now() - 86_400_000) },
    });
    const a = await makePerson(h);
    answerId = (
      await h.prisma.answer.create({
        data: { questionId: qid, authorId: a.id, kind: "TEXT", body: "hello" },
      })
    ).id;
    await h.prisma.shortLink.create({
      data: { code: CODE, objectType: "QUESTION", objectId: qid },
    });
    inviteCode = (
      await h
        .http()
        .get("/api/v1/me/invite")
        .set("Authorization", a.auth)
        .expect(200)
    ).body.code;
  });
  afterAll(async () => {
    delete process.env.GUEST_CACHE_TTL_MS;
    await h.close();
  });

  const hit = (path: string, extra: Record<string, string> = {}, addr = ADDR) =>
    h
      .http()
      .get(path)
      .set("X-Forwarded-For", addr)
      .set("X-Guest-Id", randomUUID())
      .set(extra);
  const count429 = async (
    n: number,
    path: string,
    addr: string,
    extra: () => Record<string, string> = () => ({}),
  ) => {
    let limited = 0;
    let first = 0;
    for (let i = 1; i <= n; i++) {
      const r = await hit(path, extra(), addr);
      if (r.status === 429) {
        limited++;
        if (!first) first = i;
      }
    }
    return { limited, first };
  };

  it("300 people behind one address: no read route the path uses says 429", async () => {
    // per person (dry run, rounded up): question 2, answers 1, today 1, config 1, moods 1, invite lookup 0.3, share page views 0.3 (3 calls each)
    const plan: [string, string, number][] = [
      ["question", `/api/v1/questions/${qid}`, 2 * PEOPLE],
      ["answers", `/api/v1/questions/${qid}/answers?limit=1`, PEOPLE],
      ["today", "/api/v1/questions/today", PEOPLE],
      ["config", "/api/v1/config/public", PEOPLE],
      ["moods", `/api/v1/questions/${qid}/moods`, PEOPLE],
      [
        "invite lookup",
        `/api/v1/invites/${inviteCode}`,
        Math.ceil(0.3 * PEOPLE),
      ],
      [
        "share page (3 calls a view)",
        `/api/v1/share/${CODE}`,
        Math.ceil(0.3 * PEOPLE) * 3,
      ],
    ];
    const addr = "198.51.100.101";
    for (const [name, path, n] of plan) {
      const r = await count429(n, path, addr);
      expect([name, r.limited]).toEqual([name, 0]);
    }
  });

  it("300 people behind one address: guest listen reports (2.2 a person, a new visitor id each) and handle checks (3 a sign-up) pass", async () => {
    let limited = 0;
    for (let i = 0; i < Math.ceil(2.3 * PEOPLE); i++) {
      const r = await h
        .http()
        .post(`/api/v1/answers/${answerId}/listen`)
        .set("X-Forwarded-For", "198.51.100.102")
        .set("X-Guest-Id", randomUUID())
        .set("X-Visitor-Id", randomUUID())
        .send({});
      if (r.status === 429) limited++;
    }
    expect(limited).toBe(0);
    const p = await makePerson(h);
    let checks = 0;
    for (let i = 0; i < Math.ceil(0.3 * PEOPLE * 3); i++) {
      const r = await h
        .http()
        .get("/api/v1/me/handle-check?handle=zzzzz1")
        .set("Authorization", p.auth)
        .set("X-Forwarded-For", "198.51.100.103");
      if (r.status === 429) checks++;
    }
    expect(checks).toBe(0);
  });

  it("abuse from one address is still stopped: invite lookup at 300 a minute, handle checks at 300, one route at 1200", async () => {
    const lookup = await count429(
      320,
      `/api/v1/invites/${inviteCode}`,
      "198.51.100.110",
    );
    expect(lookup.first).toBe(301);
    const p = await makePerson(h);
    let first = 0;
    for (let i = 1; i <= 310; i++) {
      const r = await h
        .http()
        .get("/api/v1/me/handle-check?handle=zzzzz1")
        .set("Authorization", p.auth)
        .set("X-Forwarded-For", "198.51.100.111");
      if (r.status === 429 && !first) first = i;
    }
    expect(first).toBe(301);
    const route = await count429(1210, "/api/v1/countries", "198.51.100.112");
    expect(route.first).toBe(1201);
  });

  it("another address is not affected by a limited one", async () => {
    await hit(`/api/v1/invites/${inviteCode}`, {}, "198.51.100.113").expect(
      200,
    );
  });
});
