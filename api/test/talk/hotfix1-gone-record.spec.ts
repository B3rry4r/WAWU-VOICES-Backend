/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/** V-HOTFIX-1 round 3: a deleted or removed post's text does not stay in its retry record. */
describe("hotfix 1 round 3: retry record of a gone post", () => {
  let h: Harness;
  let q: { id: string };
  let mod: Person;
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
    mod = await makePerson(h, { roles: ["MODERATOR"] });
  });
  afterAll(() => h.close());

  const answer = (p: Person, key: string, body: string) =>
    h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set("Authorization", p.auth)
      .set("Idempotency-Key", key)
      .send({ kind: "TEXT", body });
  const rec = (p: Person, key: string) =>
    h.prisma.idempotencyRecord.findUnique({
      where: { actorId_key: { actorId: p.id, key } },
    });
  const state = async (p: Person) => ({
    balance: (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
      ?.balanceMilli,
    charges: await h.prisma.charge.count({ where: { userId: p.id } }),
    reversals: await h.prisma.charge.count({
      where: { userId: p.id, status: "REVERSED" },
    }),
    answers: await h.prisma.answer.count({ where: { authorId: p.id } }),
  });

  it("author deletes the answer: the replay says gone, the text is not in the record, nothing moves", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const first = await answer(p, key, "words nobody should keep").expect(201);
    expect(JSON.stringify((await rec(p, key))?.responseBody)).toContain(
      "words nobody should keep",
    );
    await h
      .http()
      .delete(`/api/v1/answers/${first.body.answer.id}`)
      .set("Authorization", p.auth)
      .expect(204);
    const r = await rec(p, key);
    expect(r).not.toBeNull();
    expect(JSON.stringify(r?.responseBody)).not.toContain("words nobody");
    const before = await state(p);
    for (let i = 0; i < 2; i++) {
      const again = await answer(p, key, "words nobody should keep");
      expect(again.status).toBe(404);
      expect(again.body.code ?? again.body.error?.code).toBe("NOT_FOUND");
      expect(JSON.stringify(again.body)).not.toContain("words nobody");
    }
    expect(await state(p)).toEqual(before);
  });

  it("a moderator removes the answer: the same", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const first = await answer(p, key, "removed words").expect(201);
    const item = await h.prisma.moderationItem.create({
      data: {
        targetType: "ANSWER",
        targetId: first.body.answer.id,
        queue: "REPORTED",
        reasons: ["THREAT_OR_VIOLENCE"],
        reportCount: 1,
      },
    });
    await h
      .http()
      .post(`/api/v1/admin/moderation/items/${item.id}/action`)
      .set("Authorization", mod.auth)
      .send({ action: "REMOVE", reason: "Checked by the team." })
      .expect(200);
    expect(JSON.stringify((await rec(p, key))?.responseBody)).not.toContain(
      "removed words",
    );
    const before = await state(p);
    const again = await answer(p, key, "removed words");
    expect(again.status).toBe(404);
    expect(JSON.stringify(again.body)).not.toContain("removed words");
    expect(await state(p)).toEqual(before);
  });

  it("a deleted reply: the same", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const w = await makePerson(h, { freePosts: 5 });
    const a = await answer(w, randomUUID(), "base").expect(201);
    const key = randomUUID();
    const send = () =>
      h
        .http()
        .post(`/api/v1/answers/${a.body.answer.id}/replies`)
        .set("Authorization", p.auth)
        .set("Idempotency-Key", key)
        .send({ kind: "TEXT", body: "reply words", stance: "AGREE" });
    const first = await send().expect(201);
    await h
      .http()
      .delete(`/api/v1/replies/${first.body.reply.id}`)
      .set("Authorization", p.auth)
      .expect(204);
    expect(JSON.stringify((await rec(p, key))?.responseBody)).not.toContain(
      "reply words",
    );
    const before = await state(p);
    expect((await send()).status).toBe(404);
    expect(await state(p)).toEqual(before);
  });

  it("an untouched post still replays its answer", async () => {
    const p = await makePerson(h, { freePosts: 0, balanceMilli: 500_000 });
    const key = randomUUID();
    const first = await answer(p, key, "kept").expect(201);
    const again = await answer(p, key, "kept").expect(201);
    expect(again.body.answer.id).toBe(first.body.answer.id);
  });
});
