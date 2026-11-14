/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { AdminNewsService } from "../../src/admin/trust/news.service";
import { ConfigReader } from "../../src/talk/shared/config-reader";
import { textCostMilli } from "../../src/units/text-price";
import { EditGate } from "../../src/talk/posts.service";
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
  /** Holds the first EDIT_TEXT charge call after the real charge, until the test lets it go. */
  function holdFirstCharge() {
    const units = h.app.get(UnitsAccess);
    const orig = units.charge.bind(units);
    let release!: () => void;
    let reached!: () => void;
    const hit = new Promise<void>((res) => (reached = res));
    const wait = new Promise<void>((res) => (release = res));
    let used = false;
    const spy = jest
      .spyOn(units, "charge")
      .mockImplementation(async (userId, action, key, opts) => {
        const r = await orig(userId, action, key, opts);
        if (action === "EDIT_TEXT" && !used) {
          used = true;
          reached();
          await wait;
        }
        return r;
      });
    return { hit, release: () => release(), restore: () => spy.mockRestore() };
  }
  const liveCost = (rows: { status: string; costMilli: number }[]) =>
    rows
      .filter((c) => c.status === "COMMITTED")
      .reduce((n, c) => n + c.costMilli, 0);
  /** After any run: a longer text stands with exactly one live charge; a refused edit leaves no charge row; the wallet is the start less the live charges. */
  const ledgerRight = async (p: Person, id: string, start: number) => {
    const body = (await h.prisma.answer.findUniqueOrThrow({ where: { id } }))
      .body;
    const rows = await charges(p);
    expect(rows.filter((c) => c.status !== "COMMITTED")).toHaveLength(0);
    expect(await balance(p)).toBe(start - liveCost(rows));
    if (body === LONG) {
      expect(rows).toHaveLength(1);
      expect(rows[0].costMilli).toBeGreaterThan(0);
    } else {
      expect(body).toBe("a");
      expect(rows).toHaveLength(0);
    }
    return body;
  };
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it.each([2, 3, 5])(
    "R4-1: %i identical longer edits at once, the first held after its charge, the poster asks for Verified and the editor declines: the text stands with one live charge and nothing is given back",
    async (n) => {
      const p = await payer();
      const id = await newsPost(p);
      const start = await balance(p);
      const hold = holdFirstCharge();
      try {
        const edits = Array.from({ length: n }, () =>
          editReq(p, id, LONG).then((r) => r),
        );
        await hold.hit; // one edit has charged and holds the post's lock; the others queue behind it
        await pause(100);
        const request = ask(p, id).then((r) => r);
        await pause(100);
        hold.release();
        const results = await Promise.all(edits);
        const asked = await request;
        // the edits queued first, so they all stand (the twins find the text already equal and charge nothing)
        expect(results.map((r) => r.status)).toEqual(Array(n).fill(200));
        expect(asked.status).toBe(201);
        await decide(id, { decision: "DECLINE_VERIFIED" }).expect(200);
      } finally {
        hold.restore();
      }
      expect(await ledgerRight(p, id, start)).toBe(LONG);
    },
  );

  it("R4-2 (300 plain races): identical edits against the poster's request and at once a decision: the ledger is right in every one", async () => {
    const delays = [25, 45];
    const decisions = ["DECLINE_VERIFIED", "KEEP", "SEND_TO_MODERATION"];
    let stood = 0;
    let kept = 0;
    for (let i = 0; i < 300; i++) {
      const p = await payer();
      const id = await newsPost(p);
      const start = await balance(p);
      const k = 2 + (i % 2);
      const edits = Array.from({ length: k }, () =>
        editReq(p, id, LONG).then((r) => r),
      );
      const request = pause(delays[0]).then(() => ask(p, id).then((r) => r));
      const decision = pause(delays[1]).then(() =>
        h.app
          .get(AdminNewsService)
          .decide({ id: editor.id } as never, id, {
            decision: decisions[i % 3],
            reason: "Checked.",
          })
          .catch(() => null),
      );
      const [results] = await Promise.all([
        Promise.all(edits),
        request,
        decision,
      ]);
      for (const r of results) expect([200, 409]).toContain(r.status);
      const body = await ledgerRight(p, id, start);
      if (body === LONG) stood++;
      else kept++;
    }
    expect(stood + kept).toBe(300);
  }, 300_000);

  it("N-3 (60 races): an edit against an editor's change to Verified News: the ledger is right every time, and a refused edit leaves no charge row", async () => {
    let applied = 0;
    let refused = 0;
    for (let i = 0; i < 60; i++) {
      const p = await payer();
      const id = await newsPost(p);
      const start = await balance(p);
      const [r] = await Promise.all([
        editReq(p, id, LONG),
        h.app.get(AdminNewsService).decide({ id: editor.id } as never, id, {
          decision: "CHANGE_TAG",
          newTag: "VERIFIED_NEWS",
          sourceName: "Press office",
          reason: "Checked.",
        }),
      ]);
      const body = await ledgerRight(p, id, start);
      if (r.status === 200) {
        applied++;
        expect(body).toBe(LONG);
      } else {
        refused++;
        expect(r.status).toBe(409);
        expect(body).toBe("a");
      }
    }
    expect(applied + refused).toBe(60);
  });

  it("N-8: two different longer edits at once are priced as two steps in the order they ran, and the total is the sequential total", async () => {
    const p = await payer();
    const id = await newsPost(p);
    // a 33 character text to start from
    await h.prisma.answer.update({
      where: { id },
      data: { body: "b".repeat(33), editedAt: new Date() },
    });
    const start = await balance(p);
    const t100 = "c".repeat(100);
    const t140 = "d".repeat(140);
    const [r1, r2] = await Promise.all([
      editReq(p, id, t100),
      editReq(p, id, t140),
    ]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const rows = await charges(p);
    const finalLen = (
      (await h.prisma.answer.findUniqueOrThrow({ where: { id } })).body ?? ""
    ).length;
    const cost = (n: number) => textCostMilli(n, 5000, 150);
    // the steps are 33 to X then X to Y (or 33 to Y alone when the shorter one ran second and is free): never both from 33
    expect(liveCost(rows)).toBe(cost(Math.max(100, 140)) - cost(33));
    expect(finalLen === 100 || finalLen === 140).toBe(true);
    expect(await balance(p)).toBe(start - liveCost(rows));
    expect(rows.filter((c) => c.status !== "COMMITTED")).toHaveLength(0);
  });

  it("only reversal left: a write that fails after this call's own charge gives it back, and the same text can then be sent again and is charged afresh", async () => {
    const p = await payer();
    const id = await newsPost(p);
    const start = await balance(p);
    const prisma = h.prisma;
    const realTx = prisma.$transaction.bind(prisma) as (
      fn: (tx: unknown) => Promise<unknown>,
    ) => Promise<unknown>;
    const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(((
      fn: (tx: unknown) => Promise<unknown>,
    ) =>
      realTx((tx) =>
        fn(
          new Proxy(tx as object, {
            get: (t, k) => {
              if (k === "answer")
                return new Proxy((t as { answer: object }).answer, {
                  get: (a, m) => {
                    if (m === "update")
                      return () => {
                        throw new Error("db down");
                      };
                    const v = (a as Record<string | symbol, unknown>)[m];
                    return typeof v === "function"
                      ? (v as (...x: unknown[]) => unknown).bind(a)
                      : v;
                  },
                });
              const v = (t as Record<string | symbol, unknown>)[k];
              return typeof v === "function"
                ? (v as (...x: unknown[]) => unknown).bind(t)
                : v;
            },
          }),
        ),
      )) as never);
    try {
      const failed = await editReq(p, id, LONG);
      expect(failed.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(await balance(p)).toBe(start);
    expect((await charges(p)).map((c) => c.status)).toEqual(["REVERSED"]);
    expect(
      (await h.prisma.answer.findUniqueOrThrow({ where: { id } })).body,
    ).toBe("a");
    expect((await editReq(p, id, LONG)).status).toBe(200);
    const rows = await charges(p);
    expect(rows.map((c) => c.status)).toEqual(["REVERSED", "COMMITTED"]);
    expect(await balance(p)).toBe(start - rows[1].costMilli);
  });

  it("R4-3: the count of earlier give-backs matches the exact key, not a prefix", async () => {
    const p = await payer();
    const id = await newsPost(p);
    const start = await balance(p);
    // a reversed charge for a different change whose key only begins the same way (5 to 100 against 5 to 10)
    await h.prisma.charge.create({
      data: {
        userId: p.id,
        action: "EDIT_TEXT",
        status: "REVERSED",
        costMilli: 0,
        idempotencyKey: `edit:${id}:1:150:00`,
      },
    });
    await h.prisma.charge.create({
      data: {
        userId: p.id,
        action: "EDIT_TEXT",
        status: "REVERSED",
        costMilli: 0,
        idempotencyKey: `edit:${id}:1:1500:0`,
      },
    });
    expect((await editReq(p, id, LONG)).status).toBe(200);
    const rows = (await charges(p)).filter((c) => c.status === "COMMITTED");
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotencyKey.startsWith(`edit:${id}:1:150:`)).toBe(true);
    // the key of the new charge carries no give-back suffix: only keys of this exact change count
    expect(rows[0].idempotencyKey.endsWith(":r1")).toBe(false);
    expect(await balance(p)).toBe(start - rows[0].costMilli);
  });

  it("N-4: a post deleted or removed before the lock is a 404 and no charge row exists", async () => {
    for (const status of ["DELETED_BY_AUTHOR", "REMOVED"] as const) {
      const p = await payer();
      const id = await newsPost(p);
      const start = await balance(p);
      const config = h.app.get(ConfigReader);
      const orig = config.num.bind(config);
      let hit = false;
      const gap = jest
        .spyOn(config, "num")
        .mockImplementation(async (key: string) => {
          if (key === "text.max_chars" && !hit) {
            hit = true;
            await h.prisma.answer.update({ where: { id }, data: { status } });
          }
          return orig(key);
        });
      try {
        expect((await editReq(p, id, LONG)).status).toBe(404);
      } finally {
        gap.mockRestore();
      }
      expect(await balance(p)).toBe(start);
      expect(await charges(p)).toHaveLength(0);
    }
  });

  it("lock order: edit, a second edit, a decision, reply, reaction, report, flag, request and delete at once, 80 times: no errors", async () => {
    const svc = h.app.get(AdminNewsService);
    let bad = 0;
    for (let i = 0; i < 80; i++) {
      const p = await payer();
      const other = await payer();
      const id = await newsPost(p);
      const replyReq = h
        .http()
        .post(`/api/v1/answers/${id}/replies`)
        .set("Authorization", other.auth)
        .set({ "Idempotency-Key": `r5-rep-${i}-${Math.random()}` })
        .send({ stance: "AGREE", kind: "TEXT", body: "agree" });
      const reaction = h
        .http()
        .put(`/api/v1/answers/${id}/reaction`)
        .set("Authorization", other.auth)
        .set({ "Idempotency-Key": `r5-rx-${i}-${Math.random()}` })
        .send({ kind: "POWERFUL" });
      const report = h
        .http()
        .post("/api/v1/reports")
        .set("Authorization", other.auth)
        .send({ targetType: "ANSWER", targetId: id, reason: "SPAM" });
      const flag = h
        .http()
        .post(`/api/v1/news/${id}/flag`)
        .set("Authorization", other.auth)
        .send({});
      const all = await Promise.all([
        editReq(p, id, LONG),
        editReq(p, id, "e".repeat(120)),
        ask(p, id),
        replyReq,
        reaction,
        report,
        flag,
        svc
          .decide({ id: editor.id } as never, id, {
            decision: "KEEP",
            reason: "Checked.",
          })
          .then(() => ({ status: 200 }))
          .catch(() => ({ status: 409 })),
        h.http().delete(`/api/v1/answers/${id}`).set("Authorization", p.auth),
      ]);
      for (const r of all) if (r.status >= 500) bad++;
    }
    expect(bad).toBe(0);
  }, 300_000);

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

  describe("round 6", () => {
    const paidChars = async (id: string) =>
      (await h.prisma.answer.findUniqueOrThrow({ where: { id } })).paidChars;
    const cost = (n: number) => textCostMilli(n, 5000, 150);
    const textPost = async (p: Person, n: number) => {
      const r = await h
        .http()
        .post(`/api/v1/questions/${qid}/answers`)
        .set("Authorization", p.auth)
        .set({ "Idempotency-Key": `r6-${Math.random()}` })
        .send({
          kind: "TEXT",
          body: "x".repeat(n),
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        })
        .expect(201);
      return r.body.answer.id as string;
    };

    it("R5-1: the gate lets 6 in, makes the rest wait holding nothing, and turns the seventh away with 503 and Retry-After 2 after its wait (5 seconds in production), having charged and changed nothing", async () => {
      const gate = new EditGate();
      expect(
        await Promise.all([1, 2, 3].map(() => gate.acquire(30, 3))),
      ).toEqual([true, true, true]);
      const t0 = Date.now();
      expect(await gate.acquire(60, 3)).toBe(false);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
      const next = gate.acquire(1000, 3);
      gate.release();
      expect(await next).toBe(true);

      const people = await Promise.all(
        Array.from({ length: 7 }, () => payer()),
      );
      const ids = await Promise.all(people.map((p) => newsPost(p)));
      // the real wait is 5 seconds; a held transaction would be cut off by the database's own 5 second limit first, so the test waits 0.6
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const realAcquire = EditGate.prototype.acquire;
      const shortWait = jest
        .spyOn(EditGate.prototype, "acquire")
        .mockImplementation(function (
          this: EditGate,
          _w?: number,
          slots?: number,
        ) {
          return realAcquire.call(this, 600, slots);
        });
      const units = h.app.get(UnitsAccess);
      const orig = units.charge.bind(units);
      let release!: () => void;
      const hold = new Promise<void>((res) => (release = res));
      const spy = jest
        .spyOn(units, "charge")
        .mockImplementation(async (u, a, k, o) => {
          const r = await orig(u, a, k, o);
          if (a === "EDIT_TEXT") await hold;
          return r;
        });
      try {
        const six = people
          .slice(0, 6)
          .map((p, i) => editReq(p, ids[i], LONG).then((r) => r));
        await pause(500); // six are inside, each holding its charge
        const seventh = await editReq(people[6], ids[6], LONG);
        expect(seventh.status).toBe(503);
        expect(seventh.headers["retry-after"]).toBe("2");
        expect(seventh.body.error.code).toBe("UNAVAILABLE");
        expect(await charges(people[6])).toHaveLength(0);
        expect(
          (await h.prisma.answer.findUniqueOrThrow({ where: { id: ids[6] } }))
            .body,
        ).toBe("a");
        release();
        for (const r of await Promise.all(six)) expect(r.status).toBe(200);
      } finally {
        release();
        spy.mockRestore();
        shortWait.mockRestore();
      }
      expect((await editReq(people[6], ids[6], LONG)).status).toBe(200);
    }, 60_000);

    it.each([21, 30, 40, 60, 200])(
      "R5-1: %i edits on different posts at once and a bystander's request: no 500, the bystander is quick, each edit ends 200 or 503, a 503 changed and charged nothing, resending completes it",
      async (n) => {
        const people = await Promise.all(
          Array.from({ length: n }, () => payer()),
        );
        const ids = await Promise.all(
          people.map(
            async (p) =>
              (
                await h.prisma.answer.create({
                  data: {
                    questionId: qid,
                    authorId: p.id,
                    kind: "TEXT",
                    body: "a",
                    paidChars: 1,
                    isNews: true,
                    newsTag: "UNVERIFIED_NEWS",
                  },
                })
              ).id,
          ),
        );
        const starts = await Promise.all(people.map((p) => balance(p)));
        const bystander = await makePerson(h);
        // What the same number of plain requests costs a bystander in this one process (the test and the API share one event
        // loop, and every request verifies a signed token): the yardstick for the largest run.
        const control = async () => {
          const plain = people.map((p) =>
            h
              .http()
              .get("/api/v1/me")
              .set("Authorization", p.auth)
              .then((r) => r),
          );
          await pause(150);
          const c0 = Date.now();
          await h.http().get("/api/v1/me").set("Authorization", bystander.auth);
          const t = Date.now() - c0;
          await Promise.all(plain);
          return t;
        };
        const baseline = n >= 100 ? await control() : 0;
        const edits = people.map((p, i) =>
          editReq(p, ids[i], LONG).then((r) => r),
        );
        await pause(150);
        const t0 = Date.now();
        const me = await h
          .http()
          .get("/api/v1/me")
          .set("Authorization", bystander.auth);
        const took = Date.now() - t0;
        const results = await Promise.all(edits);
        expect(me.status).toBeLessThan(500);
        expect(took).toBeLessThan(
          n >= 100 ? Math.max(500, baseline * 2 + 300) : 500,
        );
        for (const r of results) expect([200, 503]).toContain(r.status);
        for (let i = 0; i < n; i++) {
          if (results[i].status === 503) {
            expect(results[i].headers["retry-after"]).toBe("2");
            expect(results[i].body.error.code).toBe("UNAVAILABLE");
            expect(await charges(people[i])).toHaveLength(0);
            expect(
              (
                await h.prisma.answer.findUniqueOrThrow({
                  where: { id: ids[i] },
                })
              ).body,
            ).toBe("a");
            // resending completes it
            expect((await editReq(people[i], ids[i], LONG)).status).toBe(200);
          }
          expect(await ledgerRight(people[i], ids[i], starts[i])).toBe(LONG);
        }
      },
      240_000,
    );

    it("R5-2: grow, shorten, grow again: a person never pays twice for the same length (33 to 100, 33, 100, 140, 100, 140, 140 costs 2230, 0, 0, 1340, 0, 0, 0)", async () => {
      const p = await payer();
      const id = await textPost(p, 33);
      expect(await paidChars(id)).toBe(33);
      const steps = [100, 33, 100, 140, 100, 140, 140];
      const want = [2230, 0, 0, 1340, 0, 0, 0];
      for (let i = 0; i < steps.length; i++) {
        const before = await balance(p);
        const r = await editReq(
          p,
          id,
          String.fromCharCode(98 + i).repeat(steps[i]),
        );
        expect([i, r.status]).toEqual([i, 200]);
        expect([i, before - (await balance(p))]).toEqual([i, want[i]]);
      }
      expect(await paidChars(id)).toBe(140);
    });

    it("R5-2: a post from before the column (null) takes the length of its text as paid on its first edit", async () => {
      const p = await payer();
      const id = (
        await h.prisma.answer.create({
          data: {
            questionId: qid,
            authorId: p.id,
            kind: "TEXT",
            body: "b".repeat(33),
            paidChars: null,
            isNews: true,
            newsTag: "UNVERIFIED_NEWS",
          },
        })
      ).id;
      const start = await balance(p);
      expect((await editReq(p, id, "c".repeat(100))).status).toBe(200);
      expect(start - (await balance(p))).toBe(cost(100) - cost(33));
      expect(await paidChars(id)).toBe(100);
      // a null post edited shorter first: the length it had is what counts as paid
      const id2 = (
        await h.prisma.answer.create({
          data: {
            questionId: qid,
            authorId: p.id,
            kind: "TEXT",
            body: "b".repeat(80),
            paidChars: null,
            isNews: true,
            newsTag: "UNVERIFIED_NEWS",
          },
        })
      ).id;
      const mid = await balance(p);
      expect((await editReq(p, id2, "c".repeat(40))).status).toBe(200);
      expect((await editReq(p, id2, "d".repeat(80))).status).toBe(200);
      expect(await balance(p)).toBe(mid);
      expect(await paidChars(id2)).toBe(80);
    });

    it("R5-2: an edit refused under the lock does not raise the stored length", async () => {
      const p = await payer();
      const id = await textPost(p, 33);
      await ask(p, id).expect(201);
      const start = await balance(p);
      expect((await editReq(p, id, "c".repeat(100))).status).toBe(409);
      expect(await paidChars(id)).toBe(33);
      expect(await balance(p)).toBe(start);
      expect(await charges(p)).toHaveLength(0);
    });

    it("R5-2: a write that fails after its charge leaves the stored length as it was, with the reversal", async () => {
      const p = await payer();
      const id = await textPost(p, 33);
      const start = await balance(p);
      const prisma = h.prisma;
      const realTx = prisma.$transaction.bind(prisma) as (
        fn: (tx: unknown) => Promise<unknown>,
      ) => Promise<unknown>;
      const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(((
        fn: (tx: unknown) => Promise<unknown>,
      ) =>
        realTx((tx) =>
          fn(
            new Proxy(tx as object, {
              get: (t, key) => {
                if (key === "answer")
                  return new Proxy((t as { answer: object }).answer, {
                    get: (a, m) => {
                      if (m === "update")
                        return () => {
                          throw new Error("db down");
                        };
                      const v = (a as Record<string | symbol, unknown>)[m];
                      return typeof v === "function"
                        ? (v as (...x: unknown[]) => unknown).bind(a)
                        : v;
                    },
                  });
                const v = (t as Record<string | symbol, unknown>)[key];
                return typeof v === "function"
                  ? (v as (...x: unknown[]) => unknown).bind(t)
                  : v;
              },
            }),
          ),
        )) as never);
      try {
        expect((await editReq(p, id, "c".repeat(100))).status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(await paidChars(id)).toBe(33);
      expect(await balance(p)).toBe(start);
      expect((await charges(p)).map((c) => c.status)).toEqual(["REVERSED"]);
      // and the retry pays once
      expect((await editReq(p, id, "c".repeat(100))).status).toBe(200);
      expect(await paidChars(id)).toBe(100);
      expect(start - (await balance(p))).toBe(cost(100) - cost(33));
    });
  });
});
