/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- tests read untyped JSON bodies */
import {
  dateOf,
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type World,
} from "./harness";

/** Bundle K (V-42): the question pool. K1 list, K2 bulk add, K3 put a pool question on a day. */
describe("K: question pool", () => {
  let w: World;
  const T = lagosToday();
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  const pool = (q = "pool=1") =>
    w.api("get", `/admin/questions?${q}`, w.editor);
  const add = (lines: string[], kind = "DAILY", who = w.editor) =>
    w.api("post", "/admin/questions/bulk", who, { kind, lines });

  describe("K1: GET /admin/questions?pool=1", () => {
    it("an editor sees exactly the pool; a moderator, a plain person and a signed-out caller do not", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 70,
        startsOn: plusDays(T, 30),
      });
      const mk = (text: string, extra: object = {}) =>
        w.prisma.question.create({ data: { kind: "DAILY", text, ...extra } });
      await mk("In the pool, daily");
      const flash = await mk("In the pool, flash", { kind: "FLASH" });
      await mk("Closed pool question", { status: "CLOSED" });
      await mk("Has a day but no week", {
        scheduledFor: dateOf(plusDays(T, 3)),
      });
      await mk("A follow-up", { kind: "FOLLOW_UP" });
      const started = await mk("Flash already started", { kind: "FLASH" });
      await w.prisma.poll.create({
        data: {
          kind: "FLASH",
          questionId: started.id,
          title: "x",
          status: "OPEN",
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 3_600_000),
          options: {
            create: [
              { label: "Yes", sortOrder: 1 },
              { label: "No", sortOrder: 2 },
            ],
          },
        },
      });
      const r = await pool();
      expect(r.status).toBe(200);
      expect(r.body.items.map((i: any) => i.text).sort()).toEqual([
        "In the pool, daily",
        "In the pool, flash",
      ]);
      expect(r.body.total).toBe(2);
      expect(r.body.nextCursor).toBeNull();
      expect(r.body.items.find((i: any) => i.id === flash.id)).toMatchObject({
        kind: "FLASH",
        day: null,
        slotIndex: null,
        isSpare: false,
      });
      // the week's own questions are never in the pool
      expect(r.body.items.some((i: any) => i.id === wk.qs[0].id)).toBe(false);
      expect(
        (await w.api("get", "/admin/questions?pool=1", w.admin)).status,
      ).toBe(200);
      expect(
        (await w.api("get", "/admin/questions?pool=1", w.moderator)).status,
      ).toBe(403);
      expect(
        (await w.api("get", "/admin/questions?pool=1", w.plain)).status,
      ).toBe(403);
      expect((await w.api("get", "/admin/questions?pool=1", null)).status).toBe(
        401,
      );
    });

    it("asks for pool=1, pages newest first with a cursor, and refuses a bad limit or cursor", async () => {
      expect((await pool("")).status).toBe(422);
      expect((await pool("pool=0")).status).toBe(422);
      await sql(`TRUNCATE "Question" CASCADE`);
      for (let i = 1; i <= 5; i++)
        await w.prisma.question.create({
          data: { kind: "DAILY", text: `Pool number ${i}` },
        });
      const p1 = await pool("pool=1&limit=2");
      expect(p1.body.items.map((i: any) => i.text)).toEqual([
        "Pool number 5",
        "Pool number 4",
      ]);
      expect(p1.body.nextCursor).toBeTruthy();
      const p2 = await pool(`pool=1&limit=2&cursor=${p1.body.nextCursor}`);
      expect(p2.body.items.map((i: any) => i.text)).toEqual([
        "Pool number 3",
        "Pool number 2",
      ]);
      const p3 = await pool(`pool=1&limit=2&cursor=${p2.body.nextCursor}`);
      expect(p3.body.items.map((i: any) => i.text)).toEqual(["Pool number 1"]);
      expect(p3.body.nextCursor).toBeNull();
      expect((await pool("pool=1&limit=0")).status).toBe(400);
      expect((await pool("pool=1&cursor=nonsense")).status).toBe(400);
    });
  });

  describe("K2: POST /admin/questions/bulk", () => {
    it("30 pasted lines become 30 pool questions, each with an audit row, none public", async () => {
      await sql(`TRUNCATE "Question", "AuditLog" CASCADE`);
      const lines = Array.from(
        { length: 30 },
        (_, i) => `What changed in your street this year, part ${i + 1}?`,
      );
      const r = await add(lines);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ created: 30, refused: 0 });
      expect(r.body.items.map((i: any) => i.line)).toEqual(
        lines.map((_, i) => i + 1),
      );
      const rows = await sql<any>(`SELECT * FROM "Question"`);
      expect(rows).toHaveLength(30);
      for (const q of rows) {
        expect(q).toMatchObject({
          topicId: null,
          scheduledFor: null,
          slotIndex: null,
          startsAt: null,
          endsAt: null,
          status: "DRAFT",
          kind: "DAILY",
          createdById: w.editor.id,
        });
      }
      expect(
        await sql(`SELECT 1 FROM "AuditLog" WHERE action = 'question.create'`),
      ).toHaveLength(30);
      expect((await pool("pool=1&limit=50")).body.total).toBe(30);
    });

    it("names a 2-character line by its number, keeps the good ones, skips blanks but still counts them", async () => {
      await sql(`TRUNCATE "Question" CASCADE`);
      const long = "x".repeat(401);
      const r = await add(
        [
          "A good first question?",
          "ab",
          "",
          "  Another good one?  ",
          long,
          "Tab\u0007bell line here",
        ],
        "FLASH",
      );
      expect(r.status).toBe(200);
      expect(r.body.created).toBe(2);
      expect(r.body.refused).toBe(3);
      const by = (n: number) => r.body.items.find((i: any) => i.line === n);
      expect(by(2).error).toMatch(/too short/i);
      expect(by(2).question).toBeNull();
      expect(by(3)).toBeUndefined();
      expect(by(4).question.text).toBe("Another good one?");
      expect(by(5).error).toMatch(/too long/i);
      expect(by(6).error).toMatch(/special characters/i);
      const rows = await sql<any>(
        `SELECT text, kind FROM "Question" ORDER BY text`,
      );
      expect(rows.map((q: any) => q.text)).toEqual([
        "A good first question?",
        "Another good one?",
      ]);
      expect(rows.every((q: any) => q.kind === "FLASH")).toBe(true);
      expect(JSON.stringify(r.body)).not.toMatch(/—/);
    });

    it("refuses more than 50 lines, nothing at all, an unknown category, a bad kind, and a non-editor", async () => {
      await sql(`TRUNCATE "Question" CASCADE`);
      const many = Array.from(
        { length: 51 },
        (_, i) => `Question number ${i + 1} here`,
      );
      expect((await add(many)).status).toBe(422);
      expect((await add(["", "  "])).status).toBe(422);
      expect((await add([])).status).toBe(422);
      expect((await add(many.slice(0, 50))).body.created).toBe(50);
      const cat = await w.api("post", "/admin/questions/bulk", w.editor, {
        kind: "DAILY",
        categoryId: "0190a000-0000-7000-8000-00000000dead",
        lines: ["Fine question here"],
      });
      expect(cat.status).toBe(422);
      expect(
        (
          await w.api("post", "/admin/questions/bulk", w.editor, {
            kind: "OVERRIDE",
            lines: ["Fine question here"],
          })
        ).status,
      ).toBe(422);
      expect(
        (await add(["Fine question here"], "DAILY", w.moderator)).status,
      ).toBe(403);
      expect(
        (
          await w.api("post", "/admin/questions/bulk", null, {
            kind: "DAILY",
            lines: ["Fine question here"],
          })
        ).status,
      ).toBe(401);
      expect(await sql(`SELECT 1 FROM "Question"`)).toHaveLength(50);
    });

    it("a category is kept on every line", async () => {
      await sql(`TRUNCATE "Question" CASCADE`);
      const r = await w.api("post", "/admin/questions/bulk", w.editor, {
        kind: "DAILY",
        categoryId: w.cats[1],
        lines: ["First one here?", "Second one here?"],
      });
      expect(r.body.created).toBe(2);
      expect(
        r.body.items.every((i: any) => i.question.categoryId === w.cats[1]),
      ).toBe(true);
    });
  });

  describe("K3: POST /admin/questions/:id/schedule", () => {
    const poolQ = async (text: string, extra: object = {}) =>
      w.prisma.question.create({ data: { kind: "DAILY", text, ...extra } });
    const sched = (
      id: string,
      day: string,
      replace?: boolean,
      who = w.editor,
    ) =>
      w.api(
        "post",
        `/admin/questions/${id}/schedule`,
        who,
        replace === undefined ? { day } : { day, replace },
      );

    it("a free day takes it at once; the calendar shows it there and the week counts it", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 71,
        startsOn: plusDays(T, 40),
      });
      await sql(`DELETE FROM "Question" WHERE id = $1`, [wk.qs[2].id]);
      const q = await poolQ("Free day question");
      const day = plusDays(T, 42);
      const r = await sched(q.id, day);
      expect(r.status).toBe(200);
      expect(r.body.swappedWith).toBeNull();
      expect(r.body.question).toMatchObject({
        id: q.id,
        day,
        slotIndex: 3,
        status: "SCHEDULED",
      });
      const row = (
        await sql<any>(`SELECT * FROM "Question" WHERE id = $1`, [q.id])
      )[0];
      expect(row.topicId).toBe(wk.topic.id);
      expect(row.startsAt.getTime()).toBe(dateOf(day).getTime() - 3_600_000);
      expect(row.endsAt.getTime()).toBe(
        dateOf(plusDays(T, 47)).getTime() - 3_600_000,
      );
      const cal = await w.api("get", `/admin/topics/${wk.topic.id}`, w.editor);
      expect(cal.body.questions.find((x: any) => x.day === day).id).toBe(q.id);
      expect(
        (
          await sql<any>(`SELECT "questionCount" FROM "Topic" WHERE id = $1`, [
            wk.topic.id,
          ])
        )[0].questionCount,
      ).toBe(10);
      expect((await pool()).body.items.some((i: any) => i.id === q.id)).toBe(
        false,
      );
      expect(
        await sql(
          `SELECT 1 FROM "AuditLog" WHERE action = 'question.schedule' AND "targetId" = $1`,
          [q.id],
        ),
      ).toHaveLength(1);
    });

    it("a taken day is refused until confirmed; then the two swap and the old question goes to the pool", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 72,
        startsOn: plusDays(T, 50),
      });
      const old = wk.qs[4];
      const q = await poolQ("Takes the fifth day");
      const day = plusDays(T, 54);
      const first = await sched(q.id, day);
      expect(first.status).toBe(409);
      expect(first.body.error.code).toBe("DAY_TAKEN");
      expect(first.body.error.details.question).toMatchObject({
        id: old.id,
        text: old.text,
      });
      expect(
        (
          await sql<any>(`SELECT "topicId" FROM "Question" WHERE id = $1`, [
            q.id,
          ])
        )[0].topicId,
      ).toBeNull();
      const no = await sched(q.id, day, false);
      expect(no.status).toBe(409);
      const ok = await sched(q.id, day, true);
      expect(ok.status).toBe(200);
      expect(ok.body.question).toMatchObject({ id: q.id, day, slotIndex: 5 });
      expect(ok.body.swappedWith).toMatchObject({
        id: old.id,
        day: null,
        slotIndex: null,
      });
      const back = (
        await sql<any>(`SELECT * FROM "Question" WHERE id = $1`, [old.id])
      )[0];
      expect(back).toMatchObject({
        topicId: null,
        scheduledFor: null,
        slotIndex: null,
        startsAt: null,
        endsAt: null,
        status: "DRAFT",
      });
      expect((await pool()).body.items.some((i: any) => i.id === old.id)).toBe(
        true,
      );
      expect(
        (
          await sql<any>(`SELECT "questionCount" FROM "Topic" WHERE id = $1`, [
            wk.topic.id,
          ])
        )[0].questionCount,
      ).toBe(10);
      expect(
        await sql(
          `SELECT 1 FROM "AuditLog" WHERE action IN ('question.swap','question.unschedule')`,
        ),
      ).toHaveLength(2);
    });

    it("no week on that day is refused in plain words; so are a flash question, a closed one, one already on a day, a started day", async () => {
      const lone = await poolQ("No week for this");
      const nowhere = await sched(lone.id, plusDays(T, 400));
      expect(nowhere.status).toBe(422);
      expect(nowhere.body.error.details.fields[0].message).toBe(
        "There is no week on that day. Add the week in the calendar first.",
      );
      const wk = await makeWeek(w.prisma, {
        weekNumber: 73,
        startsOn: plusDays(T, 60),
      });
      const flash = await poolQ("A flash one", { kind: "FLASH" });
      expect(
        (await sched(flash.id, plusDays(T, 61))).body.error.details.fields[0]
          .message,
      ).toMatch(/flash poll/);
      const closed = await poolQ("Closed one", { status: "CLOSED" });
      expect((await sched(closed.id, plusDays(T, 61))).status).toBe(422);
      expect((await sched(wk.qs[0].id, plusDays(T, 61))).status).toBe(422);
      expect((await sched(wk.spare[0].id, plusDays(T, 61))).status).toBe(422);
      expect(
        (await sched("0190a000-0000-7000-8000-00000000dead", plusDays(T, 61)))
          .status,
      ).toBe(404);
      expect((await sched(lone.id, "2026-02-31")).status).toBe(422);
      // a week that is under way: today is taken by a started question, so it cannot be swapped out
      const live = await makeWeek(w.prisma, {
        weekNumber: 74,
        startsOn: plusDays(T, -2),
      });
      const todayQ = live.qs[2];
      await sql(`UPDATE "Question" SET status = 'LIVE' WHERE id = $1`, [
        todayQ.id,
      ]);
      const started = await sched(lone.id, T, true);
      expect(started.status).toBe(409);
      expect(started.body.error.message).toMatch(/started/);
      await sql(`DELETE FROM "Question" WHERE id = $1`, [live.qs[0].id]);
      const past = await sched(lone.id, plusDays(T, -2));
      expect(past.status).toBe(409);
      expect(past.body.error.message).toMatch(/already started/);
    });

    it("only an editor or admin; and parallel puts on one day leave exactly one question there", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 75,
        startsOn: plusDays(T, 70),
      });
      await sql(`DELETE FROM "Question" WHERE id = $1`, [wk.qs[1].id]);
      const day = plusDays(T, 71);
      const qs = await Promise.all(
        Array.from({ length: 6 }, (_, i) => poolQ(`Racer ${i}`)),
      );
      expect((await sched(qs[0].id, day, undefined, w.moderator)).status).toBe(
        403,
      );
      expect((await sched(qs[0].id, day, undefined, w.plain)).status).toBe(403);
      const out = await Promise.all(qs.map((q) => sched(q.id, day, true)));
      expect(out.every((o) => o.status === 200)).toBe(true);
      const onDay = await sql<any>(
        `SELECT id FROM "Question" WHERE "topicId" = $1 AND "slotIndex" = 2 AND "isSpare" = false`,
        [wk.topic.id],
      );
      expect(onDay).toHaveLength(1);
      expect(
        await sql(
          `SELECT 1 FROM "Question" WHERE "topicId" IS NULL AND text LIKE 'Racer%'`,
        ),
      ).toHaveLength(5);
      expect(
        (
          await sql<any>(`SELECT "questionCount" FROM "Topic" WHERE id = $1`, [
            wk.topic.id,
          ])
        )[0].questionCount,
      ).toBe(10);
    });
  });
});
