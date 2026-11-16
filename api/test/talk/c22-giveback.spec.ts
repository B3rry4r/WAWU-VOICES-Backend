import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
} from "./harness";

const H = 3_600_000;

/**
 * C22 LOW 3: the post try is given back only for the 409 QUESTION_NOT_OPEN (the question shown as coming up). A 404 of
 * a draft or a hidden spare question counts like any other 404, so one person meets the per-person limit.
 */
describe("C22: the give-back is for the 409 only", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const post = (auth: string, qid: string) =>
    h
      .http()
      .post(`/api/v1/questions/${qid}/answers`)
      .set("Authorization", auth)
      .set("Idempotency-Key", randomUUID())
      .send({ kind: "TEXT", body: "a thought" });

  const forty = async (qid: string) => {
    const p = await makePerson(h, { freePosts: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await post(p.auth, qid)).status);
    return codes;
  };

  it("40 posts by one person to a DRAFT question: 20 x 404, then 429, as for an unknown id", async () => {
    const q = await makeQuestion(h, "DRAFT");
    const codes = await forty(q.id);
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes.slice(20).every((c) => c === 429)).toBe(true);
    const unknown = await forty(randomUUID());
    expect(unknown).toEqual(codes);
  }, 90_000);

  it("40 posts to a hidden spare question (scheduled, not shown as coming up): 20 x 404, then 429", async () => {
    const q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: {
        kind: "DAILY",
        isSpare: true,
        status: "SCHEDULED",
        startsAt: new Date(Date.now() + 2 * H),
        endsAt: new Date(Date.now() + 26 * H),
      },
    });
    const codes = await forty(q.id);
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes.slice(20).every((c) => c === 429)).toBe(true);
  }, 90_000);

  it("30 early tries on the coming-up question: 30 x 409, then a post at the opening is 201", async () => {
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
    const p = await makePerson(h, { freePosts: 5 });
    const ov = await h.prisma.override.create({
      data: {
        questionId: q.id,
        contentKind: "TEXT",
        body: "x",
        startsAt: new Date(Date.now() - H),
        endsAt: new Date(Date.now() + 24 * H),
        status: "SCHEDULED",
        createdById: p.id,
      },
    });
    try {
      for (let i = 0; i < 30; i++)
        expect((await post(p.auth, q.id)).status).toBe(409);
      await set(true);
      expect((await post(p.auth, q.id)).status).toBe(201);
    } finally {
      await h.prisma.override.delete({ where: { id: ov.id } });
    }
  }, 90_000);
});
