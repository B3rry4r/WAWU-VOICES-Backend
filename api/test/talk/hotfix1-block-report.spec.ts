/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import {
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/** V-HOTFIX-1, fault 1: reporting a post made without a name never blocks its writer. */
describe("hotfix 1: report with alsoBlock on a nameless post", () => {
  let h: Harness;
  let q: { id: string };
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
  });
  afterAll(() => h.close());

  const postAnswer = async (p: Person, anonymous: boolean) =>
    (
      await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({
          kind: "TEXT",
          body: anonymous ? "a nameless thought" : "a named thought",
          ...(anonymous ? { anonymous: true } : {}),
        })
        .expect(201)
    ).body.answer.id as string;
  const report = (p: Person, id: string, alsoBlock = true) =>
    h.http().post("/api/v1/reports").set("Authorization", p.auth).send({
      targetType: "ANSWER",
      targetId: id,
      reason: "SCAM_OR_SPAM",
      alsoBlock,
    });
  const blocks = async (p: Person) =>
    (
      await h
        .http()
        .get("/api/v1/me/blocks")
        .set("Authorization", p.auth)
        .expect(200)
    ).body;

  it("a nameless answer: report kept, blocked false, no Block row, block list unchanged", async () => {
    const w = await makePerson(h);
    const v = await makePerson(h);
    const id = await postAnswer(w, true);
    const before = await blocks(v);
    const r = await report(v, id).expect(201);
    expect(r.body.blocked).toBe(false);
    expect(
      await h.prisma.block.count({
        where: { OR: [{ blockedId: w.id }, { blockerId: v.id }] },
      }),
    ).toBe(0);
    expect(await blocks(v)).toEqual(before);
    const row = await h.prisma.report.findUniqueOrThrow({
      where: { id: r.body.id },
    });
    expect(row).toMatchObject({ reporterId: v.id, targetId: id });
    expect(
      await h.prisma.moderationItem.count({
        where: { targetId: id, queue: "REPORTED" },
      }),
    ).toBe(1);
    // the writer is told nothing and the report is still counted once
    const again = await report(v, id).expect(409);
    expect(again.body.error.code).toBe("CONFLICT");
  });

  it("a nameless answer reported without alsoBlock answers the same shape", async () => {
    const w = await makePerson(h);
    const v = await makePerson(h);
    const id = await postAnswer(w, true);
    const r = await report(v, id, false).expect(201);
    expect(r.body.blocked).toBe(false);
  });

  it("a named answer still blocks its writer", async () => {
    const w = await makePerson(h);
    const v = await makePerson(h);
    const id = await postAnswer(w, false);
    const r = await report(v, id).expect(201);
    expect(r.body.blocked).toBe(true);
    expect(
      await h.prisma.block.count({
        where: { blockerId: v.id, blockedId: w.id },
      }),
    ).toBe(1);
    const list = await blocks(v);
    expect(JSON.stringify(list)).toContain(w.id);
  });
});
