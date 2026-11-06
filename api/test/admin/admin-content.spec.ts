/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- tests read untyped JSON bodies */
import {
  dateOf,
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  uuid,
  world,
  type World,
} from "./harness";

describe("admin content: calendar, questions, polls, summary, groups", () => {
  let w: World;
  const T = lagosToday();
  const FUTURE = plusDays(T, 60);

  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  const audits = async (action: string, targetId?: string) =>
    sql<{
      actorId: string;
      reason: string | null;
      before: any;
      after: any;
    }>(
      `SELECT "actorId", reason, before, after FROM "AuditLog" WHERE action = $1 ${targetId ? `AND "targetId" = '${targetId}'` : ""} ORDER BY "createdAt"`,
      [action],
    );

  describe("topics", () => {
    it("creates a week: endsOn is six days on, a draft, audited; same week number or overlapping dates 409", async () => {
      const r = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 201,
        title: "Money talk",
        startsOn: FUTURE,
        sensitive: true,
        whatNextPrompt: "What is one promise?",
      });
      expect(r.status).toBe(201);
      expect(r.body.topic).toMatchObject({
        weekNumber: 201,
        status: "DRAFT",
        startsOn: FUTURE,
        endsOn: plusDays(FUTURE, 6),
        sensitive: true,
        countryCode: "NG",
        questionCount: 0,
      });
      expect(r.body.questions).toEqual([]);
      expect(r.body.poll).toBeNull();
      const row = await sql<{ title: string }>(
        `SELECT title FROM "Topic" WHERE "weekNumber" = 201`,
      );
      expect(row[0].title).toBe("Money talk");
      const a = await audits("topic.create", r.body.topic.id);
      expect(a).toHaveLength(1);
      expect(a[0].actorId).toBe(w.editor.id);
      expect(a[0].after.title).toBe("Money talk");

      const dup = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 201,
        title: "Again",
        startsOn: plusDays(FUTURE, 30),
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe("CONFLICT");
      const overlap = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 202,
        title: "Overlap",
        startsOn: plusDays(FUTURE, 3),
      });
      expect(overlap.status).toBe(409);
      expect(overlap.body.error.message).toContain("201");
      expect(
        await sql(`SELECT 1 FROM "Topic" WHERE "weekNumber" = 202`),
      ).toHaveLength(0);
    });

    it("validates: bad date, short title, unknown field, scheduling a week with no questions", async () => {
      const bad = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 203,
        title: "ab",
        startsOn: "2026-02-31",
      });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe("VALIDATION_FAILED");
      expect(bad.body.error.details.fields.map((f: any) => f.path)).toContain(
        "title",
      );
      const date = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 203,
        title: "Fine title",
        startsOn: "2026-02-31",
      });
      expect(date.status).toBe(422);
      expect(date.body.error.details.fields[0].path).toBe("startsOn");
      const extra = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 203,
        title: "Fine title",
        startsOn: plusDays(FUTURE, 20),
        nope: 1,
      });
      expect(extra.status).toBe(422);
      const sched = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 203,
        title: "Fine title",
        startsOn: plusDays(FUTURE, 20),
        status: "SCHEDULED",
      });
      expect(sched.status).toBe(422);
      expect(sched.body.error.details.fields[0].path).toBe("status");
      expect(
        await sql(`SELECT 1 FROM "Topic" WHERE "weekNumber" = 203`),
      ).toHaveLength(0);
      const live = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 203,
        title: "Fine title",
        startsOn: plusDays(FUTURE, 20),
        status: "LIVE",
      });
      expect(live.status).toBe(422);
    });

    it("lists in calendar order with chip counts, totals, filters, search and a cursor", async () => {
      await sql(`TRUNCATE "Topic" RESTART IDENTITY CASCADE`);
      const base = plusDays(T, 100);
      for (let i = 1; i <= 5; i++)
        await makeWeek(w.prisma, {
          weekNumber: 300 + i,
          startsOn: plusDays(base, (i - 1) * 7),
          status: (
            ["LIVE", "SCHEDULED", "SCHEDULED", "IN_REVIEW", "DRAFT"] as const
          )[i - 1],
          title: i === 5 ? "Election Week: Your Vote" : `Topic number ${i}`,
          sensitive: i === 5 || i === 1,
          poll: i < 5,
        });
      const all = await w.api("get", "/admin/topics?q=", w.editor);
      expect(all.status).toBe(200);
      expect(all.body.items.map((i: any) => i.weekNumber)).toEqual([
        301, 302, 303, 304, 305,
      ]);
      expect(all.body.items[0]).toEqual({
        weekNumber: 301,
        topicId: expect.any(String),
        title: "Topic number 1",
        startsOn: base,
        status: "LIVE",
      });
      expect(all.body.counts).toEqual({
        live: 1,
        scheduled: 2,
        inReview: 1,
        draft: 1,
        sensitive: 2,
      });
      expect(all.body.totals).toEqual({ weeks: 5, questions: 50 });
      const noq = await w.api("get", "/admin/topics", w.editor);
      expect(noq.status).toBe(200);

      const p1 = await w.api("get", "/admin/topics?limit=2", w.editor);
      expect(p1.body.items.map((i: any) => i.weekNumber)).toEqual([301, 302]);
      expect(p1.body.nextCursor).toEqual(expect.any(String));
      const p2 = await w.api(
        "get",
        `/admin/topics?limit=2&cursor=${p1.body.nextCursor}`,
        w.editor,
      );
      expect(p2.body.items.map((i: any) => i.weekNumber)).toEqual([303, 304]);
      const p3 = await w.api(
        "get",
        `/admin/topics?limit=2&cursor=${p2.body.nextCursor}`,
        w.editor,
      );
      expect(p3.body.items.map((i: any) => i.weekNumber)).toEqual([305]);
      expect(p3.body.nextCursor).toBeNull();
      expect(
        (await w.api("get", "/admin/topics?cursor=junk", w.editor)).status,
      ).toBe(400);
      expect(
        (await w.api("get", "/admin/topics?limit=0", w.editor)).status,
      ).toBe(400);

      const sched = await w.api(
        "get",
        "/admin/topics?status=scheduled",
        w.editor,
      );
      expect(sched.body.items.map((i: any) => i.weekNumber)).toEqual([
        302, 303,
      ]);
      const inRev = await w.api(
        "get",
        "/admin/topics?status=in_review",
        w.editor,
      );
      expect(inRev.body.items.map((i: any) => i.weekNumber)).toEqual([304]);
      expect(
        (await w.api("get", "/admin/topics?status=nonsense", w.editor)).status,
      ).toBe(422);
      const sens = await w.api("get", "/admin/topics?sensitive=true", w.editor);
      expect(sens.body.items.map((i: any) => i.weekNumber)).toEqual([301, 305]);
      expect(
        (await w.api("get", "/admin/topics?sensitive=maybe", w.editor)).status,
      ).toBe(422);
      // chips always count the whole calendar, not the filtered page
      expect(sens.body.counts.draft).toBe(1);
      const byTitle = await w.api("get", "/admin/topics?q=election", w.editor);
      expect(byTitle.body.items.map((i: any) => i.weekNumber)).toEqual([305]);
      const byWeek = await w.api("get", "/admin/topics?q=303", w.editor);
      expect(byWeek.body.items.map((i: any) => i.weekNumber)).toEqual([303]);
      const byQuestion = await w.api(
        "get",
        "/admin/topics?q=" + encodeURIComponent("Week 304 day 3"),
        w.editor,
      );
      expect(byQuestion.body.items.map((i: any) => i.weekNumber)).toEqual([
        304,
      ]);
      const none = await w.api("get", "/admin/topics?q=zzzzzz", w.editor);
      expect(none.body.items).toEqual([]);
    });

    it("a week opens with its 7 questions, spares and poll; 404 for an unknown or malformed id", async () => {
      const t = (
        await sql<{ id: string }>(
          `SELECT id FROM "Topic" WHERE "weekNumber" = 301`,
        )
      )[0];
      const r = await w.api("get", `/admin/topics/${t.id}`, w.editor);
      expect(r.status).toBe(200);
      expect(r.body.topic).toMatchObject({
        weekNumber: 301,
        voiceCount: 0,
        questionCount: 10,
      });
      expect(r.body.topic.weeklyPollId).toBe(r.body.poll.id);
      expect(r.body.questions.map((q: any) => q.slotIndex)).toEqual([
        1, 2, 3, 4, 5, 6, 7,
      ]);
      expect(r.body.questions[0].day).toBe(plusDays(plusDays(T, 100), 0));
      expect(r.body.spare).toHaveLength(3);
      expect(r.body.spare[0].isSpare).toBe(true);
      expect(r.body.poll.options.map((o: any) => o.label)).toEqual([
        "One",
        "Two",
        "Three",
        "Four",
      ]);
      expect(r.body.poll.label).toBe("Open poll");
      expect(
        (await w.api("get", `/admin/topics/${uuid}`, w.editor)).status,
      ).toBe(404);
      expect(
        (await w.api("get", "/admin/topics/not-a-uuid", w.editor)).status,
      ).toBe(404);
    });

    it("moving a week shifts only that week: its questions and unopened poll move, other weeks stay", async () => {
      const wk = (n: number) =>
        sql<{ id: string }>(
          `SELECT id FROM "Topic" WHERE "weekNumber" = ${n}`,
        ).then((r) => r[0].id);
      const id302 = await wk(302);
      const before = await sql<{
        id: string;
        scheduledFor: Date | null;
        startsAt: Date | null;
      }>(
        `SELECT q.id, q."scheduledFor", q."startsAt" FROM "Question" q JOIN "Topic" t ON t.id = q."topicId" WHERE t."weekNumber" <> 305 ORDER BY q.id`,
      );
      const pollBefore = await sql<{ id: string; startsAt: Date }>(
        `SELECT p.id, p."startsAt" FROM "Poll" p JOIN "Topic" t ON t.id = p."topicId" WHERE t."weekNumber" <> 305 ORDER BY p.id`,
      );
      const start302 = plusDays(plusDays(T, 100), 7);
      // week 302's days fit in a gap: move it two days later would overlap week 303, so first prove the overlap
      const clash = await w.api("patch", `/admin/topics/${id302}`, w.editor, {
        weekNumber: 302,
        title: "Topic number 2",
        startsOn: plusDays(start302, 2),
      });
      expect(clash.status).toBe(409);
      expect(clash.body.error.message).toContain("303");
      expect(
        (
          await sql<{ startsOn: Date }>(
            `SELECT "startsOn" FROM "Topic" WHERE id = $1`,
            [id302],
          )
        )[0].startsOn,
      ).toEqual(dateOf(start302));
      // week 305 is the last one: moving it later is free
      const id305 = await wk(305);
      const old305 = plusDays(plusDays(T, 100), 28);
      const to = plusDays(old305, 10);
      const r = await w.api("patch", `/admin/topics/${id305}`, w.editor, {
        weekNumber: 305,
        title: "Election Week: Your Vote",
        startsOn: to,
      });
      expect(r.status).toBe(200);
      expect(r.body.topic).toMatchObject({
        startsOn: to,
        endsOn: plusDays(to, 6),
      });
      expect(r.body.questions.map((q: any) => q.day)).toEqual(
        [0, 1, 2, 3, 4, 5, 6].map((i) => plusDays(to, i)),
      );
      const qrows = await sql<{
        scheduledFor: Date;
        startsAt: Date;
        endsAt: Date;
      }>(
        `SELECT "scheduledFor", "startsAt", "endsAt" FROM "Question" WHERE "topicId" = $1 AND "slotIndex" = 1`,
        [id305],
      );
      expect(qrows[0].scheduledFor).toEqual(dateOf(to));
      expect(qrows[0].startsAt.getTime()).toBe(
        dateOf(to).getTime() - 3_600_000,
      );
      // every other week's rows are byte for byte the same
      const after = await sql<{
        id: string;
        scheduledFor: Date | null;
        startsAt: Date | null;
      }>(
        `SELECT q.id, q."scheduledFor", q."startsAt" FROM "Question" q JOIN "Topic" t ON t.id = q."topicId" WHERE t."weekNumber" <> 305 ORDER BY q.id`,
      );
      expect(after).toEqual(before);
      const pollAfter = await sql<{ id: string; startsAt: Date }>(
        `SELECT p.id, p."startsAt" FROM "Poll" p JOIN "Topic" t ON t.id = p."topicId" WHERE t."weekNumber" <> 305 ORDER BY p.id`,
      );
      expect(pollAfter).toEqual(pollBefore);
      const movedPoll = await sql<{ startsAt: Date }>(
        `SELECT "startsAt" FROM "Poll" WHERE "topicId" = $1`,
        [id305],
      );
      expect(movedPoll).toHaveLength(0); // week 305 had no poll in this fixture
      const a = await audits("topic.move", id305);
      expect(a).toHaveLength(1);
      expect(a[0].after.moved).toHaveLength(7);
      expect(a[0].before.startsOn).toBe(old305);
    });

    it("moving a week also shifts its unopened poll by the same days", async () => {
      const id304 = (
        await sql<{ id: string }>(
          `SELECT id FROM "Topic" WHERE "weekNumber" = 304`,
        )
      )[0].id;
      const old = plusDays(plusDays(T, 100), 21);
      const poll = (
        await sql<{ startsAt: Date; endsAt: Date }>(
          `SELECT "startsAt", "endsAt" FROM "Poll" WHERE "topicId" = $1`,
          [id304],
        )
      )[0];
      // 304 sits between 303 and 305 (305 moved away to +38): room for +3 days only up to the next week
      const to = plusDays(old, 3);
      const r = await w.api("patch", `/admin/topics/${id304}`, w.editor, {
        weekNumber: 304,
        title: "Topic number 4",
        startsOn: to,
      });
      expect(r.status).toBe(200);
      const now = (
        await sql<{ startsAt: Date; endsAt: Date }>(
          `SELECT "startsAt", "endsAt" FROM "Poll" WHERE "topicId" = $1`,
          [id304],
        )
      )[0];
      expect(now.startsAt.getTime() - poll.startsAt.getTime()).toBe(
        3 * 86_400_000,
      );
      expect(now.endsAt.getTime() - poll.endsAt.getTime()).toBe(3 * 86_400_000);
      expect(r.body.poll.startsAt).toBe(now.startsAt.toISOString());
    });

    it("a live or closed week cannot move; a closed week cannot change status; status changes follow the rules", async () => {
      const live = (
        await sql<{ id: string }>(
          `SELECT id FROM "Topic" WHERE "weekNumber" = 301`,
        )
      )[0].id;
      const moved = await w.api("patch", `/admin/topics/${live}`, w.editor, {
        weekNumber: 301,
        title: "Topic number 1",
        startsOn: plusDays(plusDays(T, 100), 1),
      });
      expect(moved.status).toBe(409);
      const back = await w.api("patch", `/admin/topics/${live}`, w.editor, {
        weekNumber: 301,
        title: "Topic number 1",
        startsOn: plusDays(T, 100),
        status: "DRAFT",
      });
      expect(back.status).toBe(409);
      const title = await w.api("patch", `/admin/topics/${live}`, w.editor, {
        weekNumber: 301,
        title: "A better title",
        startsOn: plusDays(T, 100),
      });
      expect(title.status).toBe(200);
      expect(title.body.topic.title).toBe("A better title");
      const closed = await w.api("patch", `/admin/topics/${live}`, w.editor, {
        weekNumber: 301,
        title: "A better title",
        startsOn: plusDays(T, 100),
        status: "CLOSED",
      });
      expect(closed.status).toBe(200);
      const reopen = await w.api("patch", `/admin/topics/${live}`, w.editor, {
        weekNumber: 301,
        title: "A better title",
        startsOn: plusDays(T, 100),
        status: "SCHEDULED",
      });
      expect(reopen.status).toBe(409);
      const dup = await w.api("patch", `/admin/topics/${live}`, w.editor, {
        weekNumber: 302,
        title: "A better title",
        startsOn: plusDays(T, 100),
      });
      expect(dup.status).toBe(409);
      expect(
        (
          await w.api("patch", `/admin/topics/${uuid}`, w.editor, {
            weekNumber: 9,
            title: "Nope nope",
            startsOn: FUTURE,
          })
        ).status,
      ).toBe(404);
    });

    it("scheduling a draft week needs all seven days filled", async () => {
      const draft = await w.api("post", "/admin/topics", w.editor, {
        weekNumber: 410,
        title: "Half a week",
        startsOn: plusDays(T, 300),
      });
      const id = draft.body.topic.id;
      for (const slot of [1, 2, 3]) {
        const q = await w.api("post", "/admin/questions", w.editor, {
          topicId: id,
          kind: "DAILY",
          text: `Question for day ${slot}`,
          slotIndex: slot,
        });
        expect(q.status).toBe(201);
      }
      const no = await w.api("patch", `/admin/topics/${id}`, w.editor, {
        weekNumber: 410,
        title: "Half a week",
        startsOn: plusDays(T, 300),
        status: "SCHEDULED",
      });
      expect(no.status).toBe(422);
      expect(no.body.error.details.fields[0].message).toContain("4, 5, 6, 7");
      for (const slot of [4, 5, 6, 7])
        await w.api("post", "/admin/questions", w.editor, {
          topicId: id,
          kind: "DAILY",
          text: `Question for day ${slot}`,
          slotIndex: slot,
        });
      const ok = await w.api("patch", `/admin/topics/${id}`, w.editor, {
        weekNumber: 410,
        title: "Half a week",
        startsOn: plusDays(T, 300),
        status: "SCHEDULED",
      });
      expect(ok.status).toBe(200);
      expect(ok.body.topic.status).toBe("SCHEDULED");
      expect(ok.body.topic.questionCount).toBe(7);
    });
  });

  describe("questions", () => {
    let topicId: string;
    beforeAll(async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 500,
        startsOn: plusDays(T, 400),
        status: "DRAFT",
        poll: false,
      });
      topicId = wk.topic.id;
      await sql(
        `DELETE FROM "Question" WHERE "topicId" = $1 AND "slotIndex" IN (6, 7)`,
        [topicId],
      );
    });

    it("creates a daily question in a free slot: day, start and end are derived; taken slot and day outside the week are 422", async () => {
      const r = await w.api("post", "/admin/questions", w.editor, {
        topicId,
        kind: "DAILY",
        text: "What did you pay for today?",
        hint: "Walk us through it.",
        slotIndex: 6,
        categoryId: w.cats[0],
      });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        slotIndex: 6,
        day: plusDays(plusDays(T, 400), 5),
        status: "DRAFT",
        isSpare: false,
        categoryId: w.cats[0],
        voiceCount: 0,
        hint: "Walk us through it.",
        pinned: false,
      });
      const row = (
        await sql<{ startsAt: Date; endsAt: Date; createdById: string }>(
          `SELECT "startsAt", "endsAt", "createdById" FROM "Question" WHERE id = $1`,
          [r.body.id],
        )
      )[0];
      expect(row.startsAt.getTime()).toBe(
        dateOf(r.body.day).getTime() - 3_600_000,
      );
      expect(row.endsAt.getTime()).toBe(
        dateOf(plusDays(plusDays(T, 400), 7)).getTime() - 3_600_000,
      );
      expect(row.createdById).toBe(w.editor.id);
      expect(
        (
          await sql<{ questionCount: number }>(
            `SELECT "questionCount" FROM "Topic" WHERE id = $1`,
            [topicId],
          )
        )[0].questionCount,
      ).toBe(9);
      const taken = await w.api("post", "/admin/questions", w.editor, {
        topicId,
        kind: "DAILY",
        text: "Same slot again",
        slotIndex: 6,
      });
      expect(taken.status).toBe(422);
      expect(taken.body.error.details.fields[0].path).toBe("slotIndex");
      const out = await w.api("post", "/admin/questions", w.editor, {
        topicId,
        kind: "DAILY",
        text: "Outside the week",
        scheduledFor: plusDays(plusDays(T, 400), 9),
      });
      expect(out.status).toBe(422);
      expect(out.body.error.details.fields[0].path).toBe("scheduledFor");
      const mismatch = await w.api("post", "/admin/questions", w.editor, {
        topicId,
        kind: "DAILY",
        text: "Day and slot disagree",
        scheduledFor: plusDays(plusDays(T, 400), 6),
        slotIndex: 3,
      });
      expect(mismatch.status).toBe(422);
      const byDay = await w.api("post", "/admin/questions", w.editor, {
        topicId,
        kind: "DAILY",
        text: "Picked by day",
        scheduledFor: plusDays(plusDays(T, 400), 6),
      });
      expect(byDay.status).toBe(201);
      expect(byDay.body.slotIndex).toBe(7);
      expect(
        (await audits("question.create", r.body.id))[0].after.slotIndex,
      ).toBe(6);
    });

    it("spare, flash and follow-up questions; OVERRIDE kind, unknown week or category, scheduled without a day are 422", async () => {
      const spare = await w.api("post", "/admin/questions", w.editor, {
        topicId,
        kind: "FOLLOW_UP",
        text: "A follow up for later",
        isSpare: true,
      });
      expect(spare.status).toBe(201);
      expect(spare.body).toMatchObject({
        isSpare: true,
        slotIndex: null,
        day: null,
      });
      const flash = await w.api("post", "/admin/questions", w.editor, {
        kind: "FLASH",
        text: "Is your bank app working right now?",
      });
      expect(flash.status).toBe(201);
      expect(flash.body.slotIndex).toBeNull();
      expect(
        (
          await w.api("post", "/admin/questions", w.editor, {
            kind: "OVERRIDE",
            text: "Nope nope nope",
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api("post", "/admin/questions", w.editor, {
            topicId: uuid,
            kind: "DAILY",
            text: "Unknown week",
          })
        ).body.error.details.fields[0].path,
      ).toBe("topicId");
      expect(
        (
          await w.api("post", "/admin/questions", w.editor, {
            kind: "FLASH",
            text: "Unknown category",
            categoryId: uuid,
          })
        ).body.error.details.fields[0].path,
      ).toBe("categoryId");
      expect(
        (
          await w.api("post", "/admin/questions", w.editor, {
            topicId,
            kind: "FOLLOW_UP",
            text: "Spare with a day",
            isSpare: true,
            slotIndex: 2,
          })
        ).status,
      ).toBe(422);
      const nodate = await w.api("post", "/admin/questions", w.editor, {
        topicId,
        kind: "DAILY",
        text: "Scheduled with no day",
        status: "SCHEDULED",
        isSpare: false,
      });
      expect(nodate.status).toBe(422);
      expect(
        (
          await w.api("post", "/admin/questions", w.editor, {
            kind: "FLASH",
            text: "Already live",
            status: "LIVE",
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api("post", "/admin/questions", w.editor, {
            kind: "FLASH",
            text: "x",
          })
        ).status,
      ).toBe(422);
    });

    it("edits, schedules, features and closes a question; pinned is one per week; a closed question stays closed", async () => {
      const a = (
        await w.api("post", "/admin/questions", w.editor, {
          topicId,
          kind: "FOLLOW_UP",
          text: "Pin me please",
          isSpare: true,
        })
      ).body;
      const pinned = await w.api(
        "patch",
        `/admin/questions/${a.id}`,
        w.editor,
        {
          topicId,
          kind: "FOLLOW_UP",
          text: "Pin me please",
          isSpare: true,
          pinned: true,
          featured: true,
        },
      );
      expect(pinned.status).toBe(200);
      expect(pinned.body.pinned).toBe(true);
      const other = (
        await sql<{ id: string }>(
          `SELECT id FROM "Question" WHERE "topicId" = $1 AND "slotIndex" = 2`,
          [topicId],
        )
      )[0].id;
      const second = await w.api(
        "patch",
        `/admin/questions/${other}`,
        w.editor,
        { topicId, kind: "DAILY", text: "Day two, pinned", pinned: true },
      );
      expect(second.status).toBe(200);
      expect(
        await sql(`SELECT 1 FROM "Question" WHERE "topicId" = $1 AND pinned`, [
          topicId,
        ]),
      ).toHaveLength(1);
      expect(
        (
          await sql<{ featured: boolean }>(
            `SELECT featured FROM "Question" WHERE id = $1`,
            [a.id],
          )
        )[0].featured,
      ).toBe(true);

      const move = await w.api("patch", `/admin/questions/${other}`, w.editor, {
        topicId,
        kind: "DAILY",
        text: "Day two, pinned",
        slotIndex: 1,
      });
      expect(move.status).toBe(422);
      const close = await w.api(
        "patch",
        `/admin/questions/${other}`,
        w.editor,
        { topicId, kind: "DAILY", text: "Day two, pinned", status: "CLOSED" },
      );
      expect(close.status).toBe(200);
      expect(close.body.status).toBe("CLOSED");
      const endsAt = (
        await sql<{ endsAt: Date }>(
          `SELECT "endsAt" FROM "Question" WHERE id = $1`,
          [other],
        )
      )[0].endsAt;
      expect(endsAt.getTime()).toBeLessThanOrEqual(Date.now());
      const reopen = await w.api(
        "patch",
        `/admin/questions/${other}`,
        w.editor,
        {
          topicId,
          kind: "DAILY",
          text: "Day two, pinned",
          status: "SCHEDULED",
        },
      );
      expect(reopen.status).toBe(422);
      const back = await w.api("patch", `/admin/questions/${other}`, w.editor, {
        topicId,
        kind: "DAILY",
        text: "Day two, pinned",
        status: "DRAFT",
      });
      expect(back.status).toBe(422);
      const edit = await w.api("patch", `/admin/questions/${a.id}`, w.editor, {
        topicId,
        kind: "FOLLOW_UP",
        text: "Pin me, reworded",
        isSpare: true,
      });
      expect(edit.body.text).toBe("Pin me, reworded");
      const au = await audits("question.update", a.id);
      expect(au.length).toBeGreaterThanOrEqual(2);
      expect(au[au.length - 1].before).toMatchObject({ text: "Pin me please" });
      expect(au[au.length - 1].after).toMatchObject({
        text: "Pin me, reworded",
      });
      expect(
        (
          await w.api("patch", `/admin/questions/${uuid}`, w.editor, {
            kind: "DAILY",
            text: "Nobody home",
          })
        ).status,
      ).toBe(404);
    });

    it("an override question cannot be edited here", async () => {
      const q = await w.prisma.question.create({
        data: {
          kind: "OVERRIDE",
          status: "CLOSED",
          text: "An override headline",
        },
      });
      const r = await w.api("patch", `/admin/questions/${q.id}`, w.editor, {
        kind: "DAILY",
        text: "Trying to edit it",
      });
      expect(r.status).toBe(422);
    });

    it("moving a question to a free day re-derives its day and start; 30 parallel creates for one slot make exactly one question", async () => {
      const free = (
        await w.api("post", "/admin/questions", w.editor, {
          topicId,
          kind: "FOLLOW_UP",
          text: "Move me to a day",
          isSpare: true,
        })
      ).body;
      const moved = await w.api(
        "patch",
        `/admin/questions/${free.id}`,
        w.editor,
        {
          topicId,
          kind: "DAILY",
          text: "Move me to a day",
          isSpare: false,
          slotIndex: 3,
        },
      );
      // slot 3 is taken by the fixture: 422, the question is untouched
      expect(moved.status).toBe(422);
      expect(
        (
          await sql<{ isSpare: boolean }>(
            `SELECT "isSpare" FROM "Question" WHERE id = $1`,
            [free.id],
          )
        )[0].isSpare,
      ).toBe(true);
      await sql(
        `DELETE FROM "Question" WHERE "topicId" = $1 AND "slotIndex" = 3`,
        [topicId],
      );
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          w.api("post", "/admin/questions", w.editor, {
            topicId,
            kind: "DAILY",
            text: `Racing for day three ${i}`,
            slotIndex: 3,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 422)).toHaveLength(29);
      expect(
        await sql(
          `SELECT 1 FROM "Question" WHERE "topicId" = $1 AND "slotIndex" = 3 AND NOT "isSpare"`,
          [topicId],
        ),
      ).toHaveLength(1);
    });
  });

  describe("polls", () => {
    let topicId: string;
    let questionId: string;
    beforeAll(async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 600,
        startsOn: plusDays(T, 500),
        status: "DRAFT",
        poll: false,
      });
      topicId = wk.topic.id;
      questionId = wk.qs[0].id;
    });
    const body = (over: Record<string, unknown> = {}) => ({
      kind: "WEEKLY",
      title: "What should every candidate be forced to do?",
      choiceMode: "SINGLE",
      options: [
        "Publish their assets",
        "Debate in public",
        "Sign binding promises",
        "Account for all spending",
      ],
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      topicId,
      ...over,
    });

    it("creates a weekly poll: scheduled, options in order, linked to the week; one weekly poll per week", async () => {
      const r = await w.api("post", "/admin/polls", w.editor, body());
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        kind: "WEEKLY",
        status: "SCHEDULED",
        topicId,
        totalVotes: 0,
        choiceMode: "SINGLE",
        publicInterest: false,
        costToVoteMilli: 200,
        myVote: null,
        label: "Open poll",
      });
      expect(r.body.options.map((o: any) => o.label)).toEqual([
        "Publish their assets",
        "Debate in public",
        "Sign binding promises",
        "Account for all spending",
      ]);
      const rows = await sql<{
        label: string;
        sortOrder: number;
        voteCount: number;
      }>(
        `SELECT label, "sortOrder", "voteCount" FROM "PollOption" WHERE "pollId" = $1 ORDER BY "sortOrder"`,
        [r.body.id],
      );
      expect(rows.map((x) => x.sortOrder)).toEqual([1, 2, 3, 4]);
      expect(rows.every((x) => x.voteCount === 0)).toBe(true);
      const dup = await w.api("post", "/admin/polls", w.editor, body());
      expect(dup.status).toBe(422);
      expect(dup.body.error.details.fields[0].path).toBe("kind");
      expect(
        await sql(`SELECT 1 FROM "Poll" WHERE "topicId" = $1`, [topicId]),
      ).toHaveLength(1);
      expect(await audits("poll.create", r.body.id)).toHaveLength(1);
      const pub = await w.api("post", "/admin/polls", w.editor, {
        kind: "FLASH",
        title: "Is your bank app working?",
        choiceMode: "SINGLE",
        options: ["Yes", "No"],
        startsAt: new Date(Date.now() + 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        publicInterest: true,
      });
      expect(pub.status).toBe(201);
      expect(pub.body.costToVoteMilli).toBe(0);
    });

    it("refuses bad polls: one option, repeated options, closes before it opens, closes in the past, missing week or question", async () => {
      const f = async (over: Record<string, unknown>) =>
        (
          await w.api(
            "post",
            "/admin/polls",
            w.editor,
            body({ topicId: undefined, kind: "FLASH", ...over }),
          )
        ).body.error;
      expect((await f({ options: ["Only one"] })).code).toBe(
        "VALIDATION_FAILED",
      );
      expect(
        (await f({ options: ["Same", "same"] })).details.fields[0].path,
      ).toBe("options");
      expect(
        (await f({ options: ["Fine", "  "] })).details.fields[0].path,
      ).toBe("options");
      expect(
        (
          await f({
            endsAt: new Date(Date.now() + 1000).toISOString(),
            startsAt: new Date(Date.now() + 5000).toISOString(),
          })
        ).details.fields[0].path,
      ).toBe("endsAt");
      expect(
        (
          await f({
            startsAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
            endsAt: new Date(Date.now() - 86_400_000).toISOString(),
          })
        ).details.fields.map((x: any) => x.path),
      ).toContain("endsAt");
      expect(
        (
          await w.api(
            "post",
            "/admin/polls",
            w.editor,
            body({ topicId: undefined }),
          )
        ).body.error.details.fields[0].path,
      ).toBe("topicId");
      expect(
        (
          await w.api(
            "post",
            "/admin/polls",
            w.editor,
            body({ kind: "QUESTION", topicId: undefined }),
          )
        ).body.error.details.fields[0].path,
      ).toBe("questionId");
      expect(
        (
          await w.api(
            "post",
            "/admin/polls",
            w.editor,
            body({ kind: "FLASH", topicId: uuid }),
          )
        ).body.error.details.fields[0].path,
      ).toBe("topicId");
      expect(
        (
          await w.api(
            "post",
            "/admin/polls",
            w.editor,
            body({
              kind: "FLASH",
              options: Array.from({ length: 11 }, (_, i) => `o${i}`),
            }),
          )
        ).status,
      ).toBe(422);
      expect(
        (await w.api("post", "/admin/polls", w.editor, body({ kind: "NOPE" })))
          .status,
      ).toBe(422);
      const q = await w.api(
        "post",
        "/admin/polls",
        w.editor,
        body({ kind: "QUESTION", topicId: undefined, questionId }),
      );
      expect(q.status).toBe(201);
      expect(q.body.questionId).toBe(questionId);
      expect(
        (
          await w.api(
            "post",
            "/admin/polls",
            w.editor,
            body({ kind: "QUESTION", topicId: undefined, questionId }),
          )
        ).status,
      ).toBe(422);
    });

    it("edits a poll before it opens (options replaced); an open poll is 409 CONFLICT and a closed one 409 POLL_CLOSED", async () => {
      const poll = (
        await sql<{ id: string }>(
          `SELECT id FROM "Poll" WHERE "topicId" = $1`,
          [topicId],
        )
      )[0].id;
      const r = await w.api(
        "patch",
        `/admin/polls/${poll}`,
        w.editor,
        body({
          title: "A sharper poll question",
          options: ["Yes", "No", "Not sure"],
          choiceMode: "MULTIPLE",
        }),
      );
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        title: "A sharper poll question",
        choiceMode: "MULTIPLE",
      });
      expect(r.body.options.map((o: any) => o.label)).toEqual([
        "Yes",
        "No",
        "Not sure",
      ]);
      expect(
        await sql(`SELECT 1 FROM "PollOption" WHERE "pollId" = $1`, [poll]),
      ).toHaveLength(3);
      const a = await audits("poll.update", poll);
      expect(a[0].before.options).toHaveLength(4);
      expect(a[0].after.options).toHaveLength(3);

      await sql(
        `UPDATE "Poll" SET "startsAt" = now() - interval '1 hour', status = 'OPEN' WHERE id = $1`,
        [poll],
      );
      const open = await w.api(
        "patch",
        `/admin/polls/${poll}`,
        w.editor,
        body({ options: ["Yes", "No"] }),
      );
      expect(open.status).toBe(409);
      expect(open.body.error.code).toBe("CONFLICT");
      await sql(`UPDATE "Poll" SET status = 'CLOSED' WHERE id = $1`, [poll]);
      const closed = await w.api(
        "patch",
        `/admin/polls/${poll}`,
        w.editor,
        body({ options: ["Yes", "No"] }),
      );
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe("POLL_CLOSED");
      expect(
        await sql(`SELECT 1 FROM "PollOption" WHERE "pollId" = $1`, [poll]),
      ).toHaveLength(3);
      expect(
        (await w.api("patch", `/admin/polls/${uuid}`, w.editor, body())).status,
      ).toBe(404);
    });

    it("a poll with votes cannot be edited, even if it looks scheduled", async () => {
      const p = await w.api(
        "post",
        "/admin/polls",
        w.editor,
        body({ kind: "FLASH", topicId: undefined }),
      );
      await sql(`UPDATE "Poll" SET "totalVotes" = 4 WHERE id = $1`, [
        p.body.id,
      ]);
      const r = await w.api(
        "patch",
        `/admin/polls/${p.body.id}`,
        w.editor,
        body({ kind: "FLASH", topicId: undefined, options: ["A", "B"] }),
      );
      expect(r.status).toBe(409);
    });
  });

  describe("What Next? editorial summary", () => {
    let topicId: string;
    beforeAll(async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 700,
        startsOn: plusDays(T, 600),
        status: "DRAFT",
        poll: true,
      });
      topicId = wk.topic.id;
      await sql(
        // RW1 (lead ruling WF, 6 Nov): "Based on N voices" counts top-level answers (answerCount), not voice clips.
        `UPDATE "Question" SET "voiceCount" = 7, "answerCount" = 40 WHERE "topicId" = $1 AND "slotIndex" IN (1, 2)`,
        [topicId],
      );
      await sql(`UPDATE "Poll" SET "totalVotes" = 123 WHERE "topicId" = $1`, [
        topicId,
      ]);
    });
    const body = (over: Record<string, unknown> = {}) => ({
      mainView: "Most voices so far lean towards written promises.",
      mainViewVoices: 50,
      opposingView: "Others say promises are never kept anyway.",
      opposingViewVoices: 20,
      pollLine: "The poll is split between debates and binding promises.",
      nextStepsLine: "The most supported ideas go to the editors.",
      approve: false,
      ...over,
    });

    it("saves a draft (not shown), counts come from the database, then approves it", async () => {
      const r = await w.api(
        "put",
        `/admin/topics/${topicId}/summary`,
        w.editor,
        body(),
      );
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        topicId,
        mainViewVoices: 50,
        basedOnVoices: 80,
        basedOnVotes: 123,
        reviewedByEditor: false,
      });
      const row = (
        await sql<{ reviewedById: string | null; aiDrafted: boolean }>(
          `SELECT "reviewedById", "aiDrafted" FROM "EditorialSummary" WHERE "topicId" = $1`,
          [topicId],
        )
      )[0];
      expect(row.reviewedById).toBeNull();
      expect(row.aiDrafted).toBe(false);
      await sql(
        // RW1 (lead ruling WF, 6 Nov): the count is of answers, so this changes answerCount.
        `UPDATE "Question" SET "voiceCount" = 70, "answerCount" = 70 WHERE "topicId" = $1 AND "slotIndex" = 1`,
        [topicId],
      );
      const ok = await w.api(
        "put",
        `/admin/topics/${topicId}/summary`,
        w.editor,
        body({
          approve: true,
          mainView: "Most voices lean towards written promises, in writing.",
        }),
      );
      expect(ok.status).toBe(200);
      expect(ok.body.reviewedByEditor).toBe(true);
      expect(ok.body.basedOnVoices).toBe(110);
      const rev = (
        await sql<{ reviewedById: string; reviewedAt: Date }>(
          `SELECT "reviewedById", "reviewedAt" FROM "EditorialSummary" WHERE "topicId" = $1`,
          [topicId],
        )
      )[0];
      expect(rev.reviewedById).toBe(w.editor.id);
      expect(rev.reviewedAt).toBeInstanceOf(Date);
      const un = await w.api(
        "put",
        `/admin/topics/${topicId}/summary`,
        w.editor,
        body(),
      );
      expect(un.body.reviewedByEditor).toBe(false);
      expect(
        await sql(`SELECT 1 FROM "EditorialSummary" WHERE "topicId" = $1`, [
          topicId,
        ]),
      ).toHaveLength(1);
      expect(await audits("summary.approve", topicId)).toHaveLength(1);
      expect(await audits("summary.save", topicId)).toHaveLength(2);
    });

    it("refuses wording that says everyone agrees; unknown week 404; missing field 422", async () => {
      const r = await w.api(
        "put",
        `/admin/topics/${topicId}/summary`,
        w.editor,
        body({ mainView: "Everyone agrees that promises matter." }),
      );
      expect(r.status).toBe(422);
      expect(r.body.error.details.fields[0].path).toBe("mainView");
      expect(
        (await w.api("put", `/admin/topics/${uuid}/summary`, w.editor, body()))
          .status,
      ).toBe(404);
      const { approve: _a, ...noApprove } = body();
      void _a;
      expect(
        (
          await w.api(
            "put",
            `/admin/topics/${topicId}/summary`,
            w.editor,
            noApprove,
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api(
            "put",
            `/admin/topics/${topicId}/summary`,
            w.editor,
            body({ mainViewVoices: -1 }),
          )
        ).status,
      ).toBe(422);
    });
  });

  describe("proposal groups", () => {
    let qA: string;
    let qB: string;
    const ids: string[] = [];
    beforeAll(async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 800,
        startsOn: plusDays(T, 700),
        poll: false,
      });
      qA = wk.qs[0].id;
      qB = wk.qs[1].id;
      for (const [i, q] of [qA, qA, qA, qB].entries())
        ids.push(
          (
            await w.prisma.proposal.create({
              data: {
                questionId: q,
                authorId: w.plain.id,
                body: `Proposal ${i}`,
                supportCount: [5, 9, 2, 1][i],
                challengeCount: [1, 2, 0, 0][i],
              },
            })
          ).id,
        );
    });

    it("a moderator confirms a group: members get the group id, totals and the top proposal come back", async () => {
      const r = await w.api("post", "/admin/proposal-groups", w.moderator, {
        title: "Written promises",
        proposalIds: ids.slice(0, 3),
      });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        title: "Written promises",
        confirmed: true,
        proposalCount: 3,
        supportCount: 16,
        challengeCount: 3,
      });
      expect(r.body.topProposal).toMatchObject({
        id: ids[1],
        label: "PROPOSED",
        supportCount: 9,
        isMine: false,
        myStance: null,
      });
      const rows = await sql<{ groupId: string }>(
        `SELECT "groupId" FROM "Proposal" WHERE id = ANY($1)`,
        [ids.slice(0, 3)],
      );
      expect(new Set(rows.map((x) => x.groupId))).toEqual(new Set([r.body.id]));
      const g = (
        await sql<{ confirmedById: string; confirmedAt: Date | null }>(
          `SELECT "confirmedById", "confirmedAt" FROM "ProposalGroup" WHERE id = $1`,
          [r.body.id],
        )
      )[0];
      expect(g.confirmedById).toBe(w.moderator.id);
      expect(g.confirmedAt).toBeInstanceOf(Date);
      expect(
        (await audits("proposal_group.confirm", r.body.id))[0].actorId,
      ).toBe(w.moderator.id);
    });

    it("proposals for two questions, a missing proposal, a repeated id, an empty list are refused and nothing is written", async () => {
      const before = (await sql(`SELECT 1 FROM "ProposalGroup"`)).length;
      expect(
        (
          await w.api("post", "/admin/proposal-groups", w.moderator, {
            title: "Mixed",
            proposalIds: [ids[0], ids[3]],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api("post", "/admin/proposal-groups", w.moderator, {
            title: "Ghost",
            proposalIds: [ids[0], uuid],
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await w.api("post", "/admin/proposal-groups", w.moderator, {
            title: "Twice",
            proposalIds: [ids[0], ids[0]],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api("post", "/admin/proposal-groups", w.moderator, {
            title: "Empty",
            proposalIds: [],
          })
        ).status,
      ).toBe(422);
      expect((await sql(`SELECT 1 FROM "ProposalGroup"`)).length).toBe(before);
    });

    it("moving proposals into a new group removes the old group when it is left empty", async () => {
      const first = await w.api("post", "/admin/proposal-groups", w.moderator, {
        title: "Solo group",
        proposalIds: [ids[3]],
      });
      expect(first.status).toBe(201);
      const second = await w.api("post", "/admin/proposal-groups", w.admin, {
        title: "Solo group again",
        proposalIds: [ids[3]],
      });
      expect(second.status).toBe(201);
      expect(
        await sql(`SELECT 1 FROM "ProposalGroup" WHERE id = $1`, [
          first.body.id,
        ]),
      ).toHaveLength(0);
    });
  });
});
