import { randomUUID } from "node:crypto";
import {
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
} from "./harness";

/**
 * C2.1 L-2 (C22: the 409 only): the post try is given back only for the 409 QUESTION_NOT_OPEN. Every 404 (unknown question, unknown answer) counts, so it can be limited.
 */
describe("C2.1 L-2: the give-back is by reason", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const H = 3_600_000;
  const post = (auth: string, qid: string, key = randomUUID()) =>
    h
      .http()
      .post(`/api/v1/questions/${qid}/answers`)
      .set("Authorization", auth)
      .set("Idempotency-Key", key)
      .send({ kind: "TEXT", body: "a thought" });

  it("40 posts to an unknown question id end in 429", async () => {
    const p = await makePerson(h, { freePosts: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 40; i++)
      codes.push((await post(p.auth, randomUUID())).status);
    expect(codes.filter((c) => c === 404).length).toBe(20);
    expect(codes.slice(20).every((c) => c === 429)).toBe(true);
    expect(codes[39]).toBe(429);
  }, 60_000);

  it("40 replies to an unknown answer end in 429", async () => {
    const p = await makePerson(h, { freePosts: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 40; i++)
      codes.push(
        (
          await h
            .http()
            .post(`/api/v1/answers/${randomUUID()}/replies`)
            .set("Authorization", p.auth)
            .set(idem())
            .send({ kind: "TEXT", body: "r", stance: "AGREE" })
        ).status,
      );
    expect(codes.filter((c) => c === 404).length).toBe(20);
    expect(codes[39]).toBe(429);
  }, 60_000);

  it("30 refused early tries (409 on the question shown as coming up) are given back; a post at the opening is accepted", async () => {
    const q = await makeQuestion(h);
    const set = (open: boolean) =>
      h.prisma.question.update({
        where: { id: q.id },
        data: open
          ? {
              status: "LIVE",
              startsAt: new Date(Date.now() - H),
              endsAt: new Date(Date.now() + 24 * H),
            }
          : {
              status: "SCHEDULED",
              startsAt: new Date(Date.now() + 2 * H),
              endsAt: new Date(Date.now() + 26 * H),
            },
      });
    await set(false);
    // C22: the give-back is for the 409 only, so the question is shown as coming up (a live override makes it today's).
    const who = await makePerson(h, { freePosts: 5 });
    const ov = await h.prisma.override.create({
      data: {
        questionId: q.id,
        contentKind: "TEXT",
        body: "x",
        startsAt: new Date(Date.now() - H),
        endsAt: new Date(Date.now() + 24 * H),
        status: "SCHEDULED",
        createdById: who.id,
      },
    });
    const p = who;
    try {
      for (let i = 0; i < 30; i++)
        expect((await post(p.auth, q.id)).status).toBe(409);
      await set(true);
      expect((await post(p.auth, q.id)).status).toBe(201);
    } finally {
      await h.prisma.override.delete({ where: { id: ov.id } });
    }
  }, 60_000);
});
