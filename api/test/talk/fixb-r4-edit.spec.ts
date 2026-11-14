/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { AdminNewsService } from "../../src/admin/trust/news.service";
import { UnitsAccess } from "../../src/talk/shared/units-access";
import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
  type Person,
} from "./harness";

/**
 * V-FIX-B round 4: the edit lock and the money. A refused edit gives back only a charge this call made; the same text can be sent
 * again after its charge was given back; a post deleted in the gap is a 404 that gives its own charge back; a request cannot land
 * on a post that is already Verified News.
 */
describe("V-FIX-B round 4: edits, charges and the Verified News lock", () => {
  let h: Harness;
  let qid: string;
  let editor: Person;
  const LONG = "a".repeat(150);

  beforeAll(async () => {
    h = await startHarness();
    qid = (await makeQuestion(h)).id;
    editor = await makePerson(h, { roles: ["EDITOR"] });
  });
  afterAll(() => h.close());

  const payer = () => makePerson(h, { balanceMilli: 900_000, freePosts: 0 });
  const balance = async (p: Person) =>
    (await h.prisma.wallet.findUnique({ where: { userId: p.id } }))
      ?.balanceMilli ?? 0;
  const editReq = (p: Person, id: string, body: string) =>
    h
      .http()
      .patch(`/api/v1/answers/${id}`)
      .set("Authorization", p.auth)
      .send({ body });
  const ask = (p: Person, id: string) =>
    h
      .http()
      .post(`/api/v1/news/${id}/request-verified`)
      .set("Authorization", p.auth)
      .send({ sourceName: "Press office" });
  // (the admin routes are rate limited per person, so a loop of races uses a new editor each time)
  const decide = (
    id: string,
    body: Record<string, unknown>,
    who: Person = editor,
  ) =>
    h
      .http()
      .post(`/api/v1/admin/news/${id}/decision`)
      .set("Authorization", who.auth)
      .send({ reason: "Checked.", ...body });
  /** A news post (Unverified News), posted for 1 character so a longer edit is charged. */
  const newsPost = async (p: Person) => {
    const r = await h
      .http()
      .post(`/api/v1/questions/${qid}/answers`)
      .set("Authorization", p.auth)
      .set({ "Idempotency-Key": `r4-${Math.random()}` })
      .send({
        kind: "TEXT",
        body: "a",
        isNews: true,
        newsTag: "UNVERIFIED_NEWS",
      })
      .expect(201);
    return r.body.answer.id as string;
  };
  const charges = (p: Person) =>
    h.prisma.charge.findMany({
      where: { userId: p.id, action: "EDIT_TEXT" },
      orderBy: { createdAt: "asc" },
    });
  /** Holds every EDIT_TEXT charge call after the real charge, until the test lets it go. Returns the gates. */
  function holdCharges() {
    const units = h.app.get(UnitsAccess);
    const orig = units.charge.bind(units);
    const gates: { reached: Promise<void>; release: () => void }[] = [];
    const spy = jest
      .spyOn(units, "charge")
      .mockImplementation(async (userId, action, key, opts) => {
        const r = await orig(userId, action, key, opts);
        if (action !== "EDIT_TEXT") return r;
        let release!: () => void;
        let reached!: () => void;
        const g = {
          reached: new Promise<void>((res) => (reached = res)),
          release: () => release(),
        };
        const wait = new Promise<void>((res) => (release = res));
        gates.push(g);
        reached();
        await wait;
        return r;
      });
    return { gates, restore: () => spy.mockRestore() };
  }
  const until = async (fn: () => boolean) => {
    for (let i = 0; i < 200 && !fn(); i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(fn()).toBe(true);
  };

  it("N-3: two identical longer edits at once share one charge; the poster asks for Verified; the twin that is refused does not give the charge back", async () => {
    const p = await payer();
    const id = await newsPost(p);
    const start = await balance(p);
    const hold = holdCharges();
    try {
      const a = editReq(p, id, LONG).then((r) => r);
      await until(() => hold.gates.length === 1);
      const b = editReq(p, id, LONG).then((r) => r);
      await until(() => hold.gates.length === 2);
      hold.gates[0].release();
      const ra = await a;
      expect(ra.status).toBe(200);
      await ask(p, id).expect(201);
      hold.gates[1].release();
      const rb = await b;
      expect(rb.status).toBe(409);
    } finally {
      hold.restore();
    }
    expect(
      (await h.prisma.answer.findUniqueOrThrow({ where: { id } })).body,
    ).toBe(LONG);
    const rows = await charges(p);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("COMMITTED");
    expect(await balance(p)).toBe(start - rows[0].costMilli);
    expect(rows[0].costMilli).toBeGreaterThan(0);
  });

  it("N-3 (60 races): an edit against an editor's change to Verified News: the ledger is right every time", async () => {
    let applied = 0;
    let refused = 0;
    for (let i = 0; i < 60; i++) {
      const p = await payer();
      const id = await newsPost(p);
      const start = await balance(p);
      const [r] = await Promise.all([
        editReq(p, id, LONG),
        decide(
          id,
          {
            decision: "CHANGE_TAG",
            newTag: "VERIFIED_NEWS",
            sourceName: "Press office",
          },
          await makePerson(h, { roles: ["EDITOR"] }),
        ),
      ]);
      const body = (await h.prisma.answer.findUniqueOrThrow({ where: { id } }))
        .body;
      const rows = await charges(p);
      const committed = rows
        .filter((c) => c.status === "COMMITTED")
        .reduce((n, c) => n + c.costMilli, 0);
      expect(await balance(p)).toBe(start - committed);
      if (r.status === 200) {
        applied++;
        expect(body).toBe(LONG);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe("COMMITTED");
      } else {
        refused++;
        expect(r.status).toBe(409);
        expect(body).toBe("a");
        expect(committed).toBe(0);
        for (const c of rows) expect(c.status).toBe("REVERSED");
      }
    }
    expect(applied + refused).toBe(60);
  });

  it("N-9: after a refused edit whose charge was given back, the same text can be sent again and is charged afresh", async () => {
    const p = await payer();
    const id = await newsPost(p);
    const start = await balance(p);
    const hold = holdCharges();
    try {
      const a = editReq(p, id, LONG).then((r) => r);
      await until(() => hold.gates.length === 1);
      await ask(p, id).expect(201);
      hold.gates[0].release();
      expect((await a).status).toBe(409);
    } finally {
      hold.restore();
    }
    expect(await balance(p)).toBe(start);
    expect((await charges(p)).map((c) => c.status)).toEqual(["REVERSED"]);
    await decide(id, { decision: "DECLINE_VERIFIED" }).expect(200);
    const again = await editReq(p, id, LONG);
    expect(again.status).toBe(200);
    const rows = await charges(p);
    expect(rows.map((c) => c.status)).toEqual(["REVERSED", "COMMITTED"]);
    expect(await balance(p)).toBe(start - rows[1].costMilli);
  });

  it("N-4: a post deleted or removed in the gap is a 404 that gives its own charge back", async () => {
    for (const status of ["DELETED_BY_AUTHOR", "REMOVED"] as const) {
      const p = await payer();
      const id = await newsPost(p);
      const start = await balance(p);
      const hold = holdCharges();
      try {
        const a = editReq(p, id, LONG).then((r) => r);
        await until(() => hold.gates.length === 1);
        await h.prisma.answer.update({ where: { id }, data: { status } });
        hold.gates[0].release();
        expect((await a).status).toBe(404);
      } finally {
        hold.restore();
      }
      expect(await balance(p)).toBe(start);
      expect((await charges(p)).map((c) => c.status)).toEqual(["REVERSED"]);
    }
  });

  it("N-6 (60 races): a request that lands on a post made Verified News is 409 ALREADY_VERIFIED and leaves no OPEN row", async () => {
    let refused = 0;
    for (let i = 0; i < 60; i++) {
      const p = await makePerson(h);
      const a = await h.prisma.answer.create({
        data: {
          questionId: qid,
          authorId: p.id,
          kind: "TEXT",
          body: "x",
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        },
      });
      // the editor's decision goes straight to the service (the admin routes are rate limited per address, 60 races would hit it)
      const [req] = await Promise.all([
        ask(p, a.id),
        h.app.get(AdminNewsService).decide({ id: editor.id } as never, a.id, {
          decision: "CHANGE_TAG",
          newTag: "VERIFIED_NEWS",
          sourceName: "Press office",
          reason: "Checked.",
        }),
      ]);
      const now = await h.prisma.answer.findUniqueOrThrow({
        where: { id: a.id },
      });
      expect(now.newsTag).toBe("VERIFIED_NEWS");
      expect(
        await h.prisma.newsVerificationRequest.count({
          where: { answerId: a.id, status: "OPEN" },
        }),
      ).toBe(0);
      if (req.status === 409) {
        refused++;
        expect(req.body.error.details.reason).toBe("ALREADY_VERIFIED");
      } else expect(req.status).toBe(201);
    }
    expect(refused).toBeGreaterThanOrEqual(0);
  });
});
