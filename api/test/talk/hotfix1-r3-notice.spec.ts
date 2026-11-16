/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import {
  idem,
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/** V-HOTFIX-1 round 3: Report.alsoBlocked is true only when a block was made; no dangling notice for the writer. */
describe("hotfix 1 round 3: alsoBlocked flag and the writer's notice", () => {
  let h: Harness;
  let q: { id: string };
  beforeAll(async () => {
    h = await startHarness();
    q = await makeQuestion(h);
  });
  afterAll(() => h.close());

  const answer = async (p: Person, anonymous: boolean) =>
    (
      await h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set("Authorization", p.auth)
        .set(idem())
        .send({
          kind: "TEXT",
          body: "a thought",
          ...(anonymous ? { anonymous } : {}),
        })
        .expect(201)
    ).body.answer.id as string;
  const get = (p: Person, path: string) =>
    h.http().get(`/api/v1${path}`).set("Authorization", p.auth);

  it("alsoBlocked is stored false for a nameless post and true for a named one", async () => {
    const [w, n, v1, v2] = [
      await makePerson(h),
      await makePerson(h),
      await makePerson(h),
      await makePerson(h),
    ];
    const anon = await answer(w, true);
    const named = await answer(n, false);
    const rep = (p: Person, id: string) =>
      h.http().post("/api/v1/reports").set("Authorization", p.auth).send({
        targetType: "ANSWER",
        targetId: id,
        reason: "SCAM_OR_SPAM",
        alsoBlock: true,
      });
    const a = await rep(v1, anon).expect(201);
    const b = await rep(v2, named).expect(201);
    expect(a.body.blocked).toBe(false);
    expect(b.body.blocked).toBe(true);
    expect(
      (await h.prisma.report.findFirstOrThrow({ where: { reporterId: v1.id } }))
        .alsoBlocked,
    ).toBe(false);
    expect(
      (await h.prisma.report.findFirstOrThrow({ where: { reporterId: v2.id } }))
        .alsoBlocked,
    ).toBe(true);
  });

  /** One world: W's nameless answer, W blocks (or not) B, B replies. Returns what X and B see, ids stripped. */
  async function world(wBlocksB: boolean) {
    const [w, b, x] = [
      await makePerson(h),
      await makePerson(h),
      await makePerson(h),
    ];
    const id = await answer(w, true);
    if (wBlocksB)
      await h
        .http()
        .put(`/api/v1/me/blocks/${b.id}`)
        .set("Authorization", w.auth)
        .expect(204);
    await h
      .http()
      .post(`/api/v1/answers/${id}/replies`)
      .set("Authorization", b.auth)
      .set(idem())
      .send({ kind: "TEXT", body: "a reply", stance: "AGREE" })
      .expect(201);
    const clean = (v: unknown) =>
      JSON.stringify(v)
        .replaceAll(id, "ANS")
        .replaceAll(w.id, "W")
        .replaceAll(b.id, "B")
        .replaceAll(x.id, "X")
        .replace(
          /"(requestId|createdAt|updatedAt|id|handle|at|editedAt|[a-zA-Z]*At)":"[^"]*"/g,
          '"$1":"-"',
        );
    const seen: Record<string, unknown> = {};
    for (const [who, p] of [
      ["x", x],
      ["b", b],
    ] as const)
      for (const path of [
        `/answers/${id}`,
        `/answers/${id}/replies`,
        `/questions/${q.id}/answers`,
        "/notifications",
        "/notifications/unread-count",
      ])
        seen[`${who} ${path}`.replace(id, "ANS")] = clean(
          (await get(p, path)).body,
        );
    const wNotices = (await get(w, "/notifications").expect(200)).body;
    const wReplies = (await get(w, `/answers/${id}/replies`).expect(200)).body;
    return {
      seen,
      wReplyNotices: (wNotices.items as { type: string }[]).filter(
        (i) => i.type === "REPLY",
      ).length,
      wUnread: wNotices.unread as number,
      wListed: (wReplies.items as unknown[]).length,
    };
  }

  it("W blocked B: B's reply is not listed to W and sends W no notice; nobody else's responses change", async () => {
    const control = await world(false);
    const blocked = await world(true);
    expect(control).toMatchObject({ wReplyNotices: 1, wUnread: 1, wListed: 1 });
    expect(blocked).toMatchObject({ wReplyNotices: 0, wUnread: 0, wListed: 0 });
    // X and B see exactly what they see when W has not blocked B (the question list and counts included)
    for (const k of Object.keys(control.seen))
      if (!k.includes("/questions/"))
        expect(blocked.seen[k]).toEqual(control.seen[k]);
  });
});
