/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read untyped JSON bodies */
import {
  dateOf,
  lagosStart,
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type World,
} from "./harness";

/** lead ruling WF, 6 Nov: RW6 swap, RW5 flash poll, RW1 counts, B-H1 poll share, C-M8 advert checks, A-L1, B-L2, B-L6. */
describe("WF-1: calendar, polls, counts, adverts, payments", () => {
  let w: World;
  const T = lagosToday();
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  const slots = (topicId: string) =>
    sql<{ id: string; slotIndex: number; scheduledFor: Date; startsAt: Date }>(
      `SELECT id, "slotIndex", "scheduledFor", "startsAt" FROM "Question" WHERE "topicId" = $1 AND "isSpare" = false AND kind = 'DAILY' ORDER BY "slotIndex"`,
      [topicId],
    );

  describe("RW6: moving a question swaps the two when the day is taken", () => {
    it("20 parallel swaps leave every day with exactly one question, and each question's dates match its day", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 40,
        startsOn: plusDays(T, 20),
        status: "SCHEDULED",
      });
      const calls = Array.from({ length: 20 }, (_, i) => {
        const from = wk.qs[i % 7];
        const day = plusDays(
          wk.topic.startsOn.toISOString().slice(0, 10),
          (i * 3 + 2) % 7,
        );
        return w.api("post", `/admin/questions/${from.id}/move`, w.editor, {
          day,
        });
      });
      const out = await Promise.all(calls);
      expect(out.every((r) => r.status === 200)).toBe(true);
      const rows = await slots(wk.topic.id);
      expect(rows.map((r) => r.slotIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(new Set(rows.map((r) => r.id)).size).toBe(7);
      rows.forEach((r, i) => {
        const day = plusDays(wk.topic.startsOn.toISOString().slice(0, 10), i);
        expect(r.scheduledFor.toISOString().slice(0, 10)).toBe(day);
        expect(r.startsAt.getTime()).toBe(lagosStart(day).getTime());
      });
      expect(
        await sql(
          `SELECT 1 FROM "AuditLog" WHERE action IN ('question.swap','question.move')`,
        ),
      ).not.toHaveLength(0);
    });

    it("one swap answers with both questions; a free day is a plain move; the same day is a no-op", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 41,
        startsOn: plusDays(T, 40),
        status: "SCHEDULED",
      });
      const start = plusDays(T, 40);
      const r = await w.api(
        "post",
        `/admin/questions/${wk.qs[0].id}/move`,
        w.editor,
        { day: plusDays(start, 4) },
      );
      expect(r.status).toBe(200);
      expect(r.body.question).toMatchObject({
        id: wk.qs[0].id,
        slotIndex: 5,
        day: plusDays(start, 4),
      });
      expect(r.body.swappedWith).toMatchObject({
        id: wk.qs[4].id,
        slotIndex: 1,
        day: start,
      });
      // free the last day, then move into it
      await sql(`DELETE FROM "Question" WHERE id = $1`, [wk.qs[6].id]);
      const m = await w.api(
        "post",
        `/admin/questions/${wk.qs[1].id}/move`,
        w.editor,
        { day: plusDays(start, 6) },
      );
      expect(m.status).toBe(200);
      expect(m.body.swappedWith).toBeNull();
      expect(m.body.question.slotIndex).toBe(7);
      const same = await w.api(
        "post",
        `/admin/questions/${wk.qs[1].id}/move`,
        w.editor,
        { day: plusDays(start, 6) },
      );
      expect(same.status).toBe(200);
      expect(same.body.swappedWith).toBeNull();
    });

    it("refuses: outside the week (422), a bad date (422), a started question (409), a spare (422), unknown (404), wrong role (403/401)", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 42,
        startsOn: plusDays(T, 60),
        status: "SCHEDULED",
      });
      const start = plusDays(T, 60);
      const out = await w.api(
        "post",
        `/admin/questions/${wk.qs[0].id}/move`,
        w.editor,
        { day: plusDays(start, 7) },
      );
      expect(out.status).toBe(422);
      expect(out.body.error.details.fields[0].message).toBe(
        "That day is outside the week.",
      );
      expect(
        (
          await w.api(
            "post",
            `/admin/questions/${wk.qs[0].id}/move`,
            w.editor,
            { day: plusDays(start, -1) },
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api(
            "post",
            `/admin/questions/${wk.qs[0].id}/move`,
            w.editor,
            { day: "2026-02-31" },
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api(
            "post",
            `/admin/questions/${wk.qs[0].id}/move`,
            w.editor,
            { day: "tomorrow" },
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api(
            "post",
            `/admin/questions/${wk.spare[0].id}/move`,
            w.editor,
            { day: start },
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api(
            "post",
            `/admin/questions/${"0190a000-0000-7000-8000-00000000dead"}/move`,
            w.editor,
            { day: start },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await w.api(
            "post",
            `/admin/questions/${wk.qs[0].id}/move`,
            w.moderator,
            { day: plusDays(start, 1) },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await w.api("post", `/admin/questions/${wk.qs[0].id}/move`, null, {
            day: plusDays(start, 1),
          })
        ).status,
      ).toBe(401);
      // nothing moved
      expect((await slots(wk.topic.id)).map((r) => r.id)).toEqual(
        wk.qs.map((q) => q.id),
      );
      // started: today's question of a running week
      const run = await makeWeek(w.prisma, {
        weekNumber: 43,
        startsOn: plusDays(T, -2),
        status: "LIVE",
      });
      const st = await w.api(
        "post",
        `/admin/questions/${run.qs[0].id}/move`,
        w.editor,
        { day: plusDays(T, 3) },
      );
      expect(st.status).toBe(409);
      const toStarted = await w.api(
        "post",
        `/admin/questions/${run.qs[5].id}/move`,
        w.editor,
        { day: plusDays(T, -2) },
      );
      expect(toStarted.status).toBe(409);
      expect(dateOf(T)).toBeTruthy();
    });
  });

  describe("RW5: the API can open a held FLASH question as a flash poll", () => {
    it("GET /polls/current is 200 with a null body when none; POST /admin/polls kind FLASH + questionId opens one; Home shows it", async () => {
      const none = await w.h.http().get("/api/v1/polls/current").expect(200);
      expect(none.text).toBe("null");
      expect(none.headers["content-type"]).toMatch(/json/);
      const held = await w.prisma.question.create({
        data: {
          kind: "FLASH",
          status: "SCHEDULED",
          text: "Should the fuel price drop?",
          isSpare: false,
        },
      });
      const r = await w.api("post", "/admin/polls", w.editor, {
        kind: "FLASH",
        questionId: held.id,
        title: "Should the fuel price drop?",
        choiceMode: "SINGLE",
        options: ["Yes", "No"],
        startsAt: new Date(Date.now() + 1000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      expect(r.status).toBe(201);
      await sql(
        `UPDATE "Poll" SET "startsAt" = now() - interval '1 minute' WHERE id = $1`,
        [r.body.id],
      );
      const cur = await w.h.http().get("/api/v1/polls/current").expect(200);
      expect(cur.body).toMatchObject({
        id: r.body.id,
        kind: "FLASH",
        questionId: held.id,
      });
    });
  });

  describe("RW1: one voices count", () => {
    it("question.voicesCount, topic.voicesCount and profile.voicesCount count top-level answers, voice or text, not removed, deleted, or replies", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 44,
        startsOn: plusDays(T, -1),
        status: "LIVE",
      });
      const q = wk.qs[1];
      await sql(`UPDATE "Question" SET status = 'LIVE' WHERE id = $1`, [q.id]);
      const author = w.plain.id;
      const mk = (over: Record<string, unknown>) =>
        w.prisma.answer.create({
          data: {
            questionId: q.id,
            authorId: author,
            kind: "TEXT",
            body: "x",
            ...over,
          } as never,
        });
      const live1 = await mk({});
      await mk({});
      await mk({ anonymous: true });
      await mk({ status: "REMOVED" });
      await mk({ status: "DELETED_BY_AUTHOR", deletedAt: new Date() });
      await w.prisma.reply.create({
        data: {
          answerId: live1.id,
          authorId: w.admin.id,
          stance: "AGREE",
          kind: "TEXT",
          body: "r",
        },
      });
      await sql(
        `UPDATE "Question" SET "answerCount" = 3, "voiceCount" = 1 WHERE id = $1`,
        [q.id],
      );
      const qv = await w.h.http().get(`/api/v1/questions/${q.id}`).expect(200);
      expect(qv.body.voicesCount).toBe(3);
      expect(qv.body.voicesCount).toBe(qv.body.answerCount);
      const tv = await w.h
        .http()
        .get(`/api/v1/topics/${wk.topic.id}`)
        .expect(200);
      expect(tv.body.voicesCount).toBe(3);
      // the person's page: anonymous ones are not counted for anyone else; on their own page they are
      const other = await w.api("get", `/people/${author}`, w.admin);
      expect(other.body.profile.voicesCount).toBe(2);
      const own = await w.api("get", `/me`, w.plain);
      expect(own.body.profile.voicesCount).toBe(3);
      const found = await w.h
        .http()
        .get(`/api/v1/search?q=pat.plain&type=people`)
        .expect(200);
      expect(found.body.people[0]).toMatchObject({ voicesCount: 2 });
    });
  });

  describe("B-H1: sharing a poll that is SCHEDULED in the database but open by its dates", () => {
    it("the link is made, the page shows the poll, a question share shows its poll; a future poll is still 404", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 45,
        startsOn: plusDays(T, -1),
        status: "LIVE",
      });
      const q = wk.qs[1];
      await sql(`UPDATE "Question" SET status = 'LIVE' WHERE id = $1`, [q.id]);
      // makeWeek's weekly poll is stored SCHEDULED with dates that cover now
      expect(wk.poll?.status).toBe("SCHEDULED");
      const link = await w.api("post", "/share/links", w.plain, {
        objectType: "POLL_RESULT",
        objectId: wk.poll?.id,
      });
      expect(link.status).toBe(201);
      const page = await w.h
        .http()
        .get(`/api/v1/share/${link.body.code}`)
        .expect(200);
      expect(page.body.poll).not.toBeNull();
      expect(page.body.poll.status).toBe("OPEN");
      const ql = await w.api("post", "/share/links", w.plain, {
        objectType: "QUESTION",
        objectId: q.id,
      });
      expect(ql.status).toBe(201);
      const qpage = await w.h
        .http()
        .get(`/api/v1/share/${ql.body.code}`)
        .expect(200);
      expect(qpage.body.poll).not.toBeNull();
      expect(qpage.body.question.hasOpenPoll).toBe(true);
      expect(qpage.body.question.voicesCount).toBe(q.answerCount);
      // by dates it has ended: the stored status is irrelevant, the poll shows as closed and is still shareable
      await sql(
        `UPDATE "Poll" SET "endsAt" = now() - interval '1 minute' WHERE id = $1`,
        [wk.poll?.id],
      );
      const ended = await w.api("post", "/share/links", w.plain, {
        objectType: "POLL_RESULT",
        objectId: wk.poll?.id,
      });
      expect(ended.status).toBe(201);
      expect(
        (await w.h.http().get(`/api/v1/share/${ended.body.code}`).expect(200))
          .body.poll.status,
      ).toBe("CLOSED");
      // not yet open by its dates: still not shareable
      const future = await w.prisma.poll.create({
        data: {
          kind: "FLASH",
          title: "later",
          status: "SCHEDULED",
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 2 * 86_400_000),
        },
      });
      expect(
        (
          await w.api("post", "/share/links", w.plain, {
            objectType: "POLL_RESULT",
            objectId: future.id,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe("C-M8: an advert whose checks fail cannot be approved", () => {
    const ad = (over: Record<string, unknown> = {}) => ({
      brand: "Mama Nkechi's Kitchen",
      kind: "FEED_CARD",
      headline: "Soup of the day",
      linkUrl: "https://example.com/soup",
      ctaLabel: "Visit page",
      states: ["Lagos"],
      startsOn: "2099-01-01",
      endsOn: "2099-02-01",
      frequencyCapPerDay: 3,
      priceKobo: 5000000,
      ...over,
    });
    const decide = (id: string) =>
      w.api("post", `/admin/ads/${id}/decision`, w.adManager, {
        decision: "APPROVE",
      });

    it("each failing check is a 422 that names it; a clean advert is approved", async () => {
      const noAudio = await w.api(
        "post",
        "/admin/ads",
        w.adManager,
        ad({ kind: "AUDIO_SLOT" }),
      );
      expect(noAudio.status).toBe(201);
      const r1 = await decide(noAudio.body.id);
      expect(r1.status).toBe(422);
      expect(r1.body.error.details.fields[0].message).toContain(
        "Audio plays only on tap; transcript checked",
      );
      const noDates = await w.api(
        "post",
        "/admin/ads",
        w.adManager,
        ad({ startsOn: undefined, endsOn: undefined }),
      );
      expect(noDates.status).toBe(201);
      const r2 = await decide(noDates.body.id);
      expect(r2.status).toBe(422);
      expect(r2.body.error.details.fields[0].message).toContain(
        "Dates are set and in order",
      );
      const noLink = await w.api(
        "post",
        "/admin/ads",
        w.adManager,
        ad({ linkUrl: undefined }),
      );
      expect(noLink.status).toBe(201);
      const r3 = await decide(noLink.body.id);
      expect(r3.status).toBe(422);
      expect(r3.body.error.details.fields[0].message).toContain(
        "Labelled Ad, with a working link",
      );
      expect(
        (await w.prisma.ad.findUniqueOrThrow({ where: { id: noLink.body.id } }))
          .status,
      ).toBe("AWAITING_APPROVAL");
      const ok = await w.api("post", "/admin/ads", w.adManager, ad());
      expect((await decide(ok.body.id)).status).toBe(200);
    });
  });
});
