/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- tests read untyped JSON bodies */
import {
  bootAdmin,
  modItem,
  report,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "./helpers";

/** lead ruling WF, 6 Nov: C-H3, C-H2/RW2, C-M9, C-M3. */
describe("WF-1: appeals, suspension, news flags", () => {
  let a: Admin;
  let q: string;
  const api = "/api/v1";
  const items = `${api}/admin/moderation/items`;

  beforeAll(async () => {
    a = await bootAdmin();
    // the appeal limit (10 per 10 minutes) is not what these tests are about
    await a.prisma.configEntry.upsert({
      where: { key: "ratelimit.appeal_per_10min" },
      create: { key: "ratelimit.appeal_per_10min", valueJson: 1000 },
      update: { valueJson: 1000 },
    });
    await a.person("admin", ["ADMIN"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("mod2", ["MODERATOR"]);
    await a.person("editor", ["EDITOR"]);
    await a.person("poster");
    await a.person("r1");
    await a.person("r2");
    await a.person("r3");
    await a.person("r4");
    q = (await seedQuestion(a)).id;
    await a.prisma.question.update({
      where: { id: q },
      data: {
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
  });
  afterAll(async () => {
    // leave no moderation rows, strikes or notifications for the suites that run after this one
    await a.prisma.$executeRawUnsafe(
      `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification", "Block" CASCADE`,
    );
    await a.close();
  });

  const act = (who: string, id: string, action: string, reason = "Because.") =>
    a.h
      .http()
      .post(`${items}/${id}/action`)
      .set(a.auth(who))
      .send({ action, reason });
  const appeal = (
    who: string,
    targetType: string,
    targetId: string,
    note = "I was wrong to post it, but not this",
  ) =>
    a.h
      .http()
      .post(`${api}/appeals`)
      .set(a.auth(who))
      .send({ targetType, targetId, note });
  const notices = async (who: string) =>
    (await a.h.http().get(`${api}/notifications`).set(a.auth(who)).expect(200))
      .body.items as any[];
  const userItem = (id: string) =>
    a.prisma.moderationItem.findFirstOrThrow({
      where: { targetType: "USER", targetId: id, queue: "APPEAL" },
    });

  async function suspendedFromPost(suspender: string) {
    await a.prisma.notification.deleteMany({});
    await a.prisma.appeal.deleteMany({});
    await a.prisma.strike.deleteMany({});
    await a.prisma.moderationAction.deleteMany({});
    await a.prisma.moderationItem.deleteMany({});
    await a.prisma.user.update({
      where: { id: a.people.poster.id },
      data: { status: "ACTIVE", suspendedUntil: null },
    });
    const ans = await seedAnswer(a, q, a.people.poster.id);
    await report(a, a.people.r1.id, "ANSWER", ans.id);
    const item = await modItem(a, "ANSWER", ans.id, "REPORTED", 1);
    await act(suspender, item.id, "SUSPEND", "Repeated harassment.").expect(
      200,
    );
    return { ans, item };
  }

  describe("C-H3: whoever took any action that led to the appeal cannot decide it", () => {
    it("suspend from a post, then the same moderator tries the appeal on the account: 403, nothing changes", async () => {
      const { ans } = await suspendedFromPost("mod");
      // the suspended person can still appeal (V-28): on the account
      const ap = await appeal("poster", "USER", a.people.poster.id).expect(201);
      expect(ap.body.status).toBe("OPEN");
      const apItem = await userItem(a.people.poster.id);
      const r = await act(
        "mod",
        apItem.id,
        "RESTORE",
        "Changed my mind.",
      ).expect(403);
      expect(r.body.error.message).toBe(
        "Another moderator must decide this appeal.",
      );
      expect(
        (
          await a.prisma.user.findUniqueOrThrow({
            where: { id: a.people.poster.id },
          })
        ).status,
      ).toBe("SUSPENDED");
      expect(
        await a.prisma.strike.count({ where: { userId: a.people.poster.id } }),
      ).toBe(1);
      // and on the post itself: a suspension came from it, the post is still up, the poster may appeal it too
      await appeal("poster", "ANSWER", ans.id).expect(201);
      const postAppeal = await a.prisma.moderationItem.findFirstOrThrow({
        where: { targetType: "ANSWER", targetId: ans.id, queue: "APPEAL" },
      });
      await act("mod", postAppeal.id, "KEEP", "No.").expect(403);
      // a different moderator can
      await act("mod2", apItem.id, "RESTORE", "On reflection, fair.").expect(
        200,
      );
    });

    it("an admin who suspended cannot decide the appeal either; another admin or moderator can", async () => {
      await suspendedFromPost("admin");
      await appeal("poster", "USER", a.people.poster.id).expect(201);
      const apItem = await userItem(a.people.poster.id);
      await act("admin", apItem.id, "RESTORE", "x").expect(403);
      await act("mod", apItem.id, "KEEP", "Stays suspended.").expect(200);
    });

    it("a moderator who did NOT act is free to decide, and a warning on another post of the person also bars the warner", async () => {
      const { item } = await suspendedFromPost("mod2");
      void item;
      const other = await seedAnswer(a, q, a.people.poster.id, {
        body: "another",
      });
      const oi = await modItem(a, "ANSWER", other.id, "REPORTED", 1);
      await act("mod", oi.id, "WARN", "Careful.").expect(200);
      await appeal("poster", "USER", a.people.poster.id).expect(201);
      const apItem = await userItem(a.people.poster.id);
      await act("mod", apItem.id, "RESTORE", "x").expect(403); // warned a post of theirs that led here
      await act("mod2", apItem.id, "RESTORE", "x").expect(403); // suspended them
      await act("admin", apItem.id, "RESTORE", "Fair.").expect(200);
    });
  });

  describe("C-H2 / RW2: the appeal note, reachability, limits", () => {
    it("the moderator reads the poster's own note in the item detail; a suspended person's POST /appeals works", async () => {
      await suspendedFromPost("mod");
      await appeal(
        "poster",
        "USER",
        a.people.poster.id,
        "I quoted the line from a news story",
      ).expect(201);
      // while suspended every other write is refused
      await a.h
        .http()
        .post(`${api}/questions/${q}/answers`)
        .set(a.auth("poster"))
        .set("Idempotency-Key", "wf-susp-1")
        .send({ kind: "TEXT", body: "let me in" })
        .expect(403);
      const apItem = await userItem(a.people.poster.id);
      const d = (
        await a.h
          .http()
          .get(`${items}/${apItem.id}`)
          .set(a.auth("mod2"))
          .expect(200)
      ).body;
      expect(d.appeals).toHaveLength(1);
      expect(d.appeals[0]).toMatchObject({
        note: "I quoted the line from a news story",
        status: "OPEN",
      });
    });

    it("500 characters are allowed, 501 are not; a second appeal on the same thing is 409; a note is required", async () => {
      await suspendedFromPost("mod");
      await appeal(
        "poster",
        "USER",
        a.people.poster.id,
        "x".repeat(501),
      ).expect(422);
      await appeal("poster", "USER", a.people.poster.id, "   ").expect(422);
      await appeal(
        "poster",
        "USER",
        a.people.poster.id,
        "y".repeat(500),
      ).expect(201);
      const again = await appeal("poster", "USER", a.people.poster.id).expect(
        409,
      );
      expect(again.body.error.message).toBe("Your appeal is already with us.");
      const parallel = await Promise.all(
        [1, 2, 3].map(() => appeal("r1", "USER", a.people.r1.id)),
      );
      expect(parallel.every((p) => p.status === 409)).toBe(true); // r1 has no decision against them
    });

    it("nobody can appeal someone else's decision", async () => {
      const { ans } = await suspendedFromPost("mod");
      await appeal("r1", "ANSWER", ans.id).expect(404);
      await appeal("r1", "USER", a.people.poster.id).expect(404);
    });
  });

  describe("C-M9: suspension words, end date, audit, strikes", () => {
    it("the notice says 'suspended' with the end date, carries an Appeal action, and the state follows the appeal", async () => {
      await suspendedFromPost("mod");
      const until = (
        await a.prisma.user.findUniqueOrThrow({
          where: { id: a.people.poster.id },
        })
      ).suspendedUntil as Date;
      const rows = await notices("poster");
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toMatch(
        /^Your account is suspended until \d{1,2} \w{3} \d{4}$/,
      );
      const day = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(until);
      expect(rows[0].title).toBe(`Your account is suspended until ${day}`);
      expect(rows[0].title).not.toMatch(/paused/i);
      expect(rows[0].body).toBe("Repeated harassment.");
      expect(rows[0].appeal).toEqual({
        state: "AVAILABLE",
        targetType: "USER",
        targetId: a.people.poster.id,
      });
      await appeal("poster", "USER", a.people.poster.id).expect(201);
      expect(
        (await notices("poster")).find(
          (n) => n.type === "MODERATION_NOTICE" && n.appeal,
        )?.appeal.state,
      ).toBe("SENT");
      // the API's own refusal for a write uses the same word
      const w = await a.h
        .http()
        .post(`${api}/questions/${q}/answers`)
        .set(a.auth("poster"))
        .set("Idempotency-Key", "wf-susp-2")
        .send({ kind: "TEXT", body: "hi" })
        .expect(403);
      expect(w.body.error.message).toMatch(/suspended/);
      expect(w.body.error.message).not.toMatch(/paused/);
    });

    it("the account's item shows the suspension line in its audit", async () => {
      const { ans } = await suspendedFromPost("mod");
      await appeal("poster", "USER", a.people.poster.id).expect(201);
      const apItem = await userItem(a.people.poster.id);
      const d = (
        await a.h
          .http()
          .get(`${items}/${apItem.id}`)
          .set(a.auth("mod2"))
          .expect(200)
      ).body;
      expect(
        d.audit.some((l: any) => /^suspend: Repeated harassment/.test(l.text)),
      ).toBe(true);
      expect(d.author.strikeCount).toBe(1);
      void ans;
    });

    it("an accepted appeal removes the strike and lifts the suspension; a declined one keeps both", async () => {
      await suspendedFromPost("mod");
      await appeal("poster", "USER", a.people.poster.id).expect(201);
      const apItem = await userItem(a.people.poster.id);
      await act("mod2", apItem.id, "KEEP", "Stays suspended.").expect(200);
      let u = await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.poster.id },
      });
      expect(u.status).toBe("SUSPENDED");
      expect(
        await a.prisma.strike.count({ where: { userId: a.people.poster.id } }),
      ).toBe(1);
      expect((await notices("poster")).map((n) => n.title)).toContain(
        "Your appeal was declined",
      );

      await suspendedFromPost("mod");
      await appeal("poster", "USER", a.people.poster.id).expect(201);
      const apItem2 = await userItem(a.people.poster.id);
      await act("mod2", apItem2.id, "RESTORE", "Our mistake.").expect(200);
      u = await a.prisma.user.findUniqueOrThrow({
        where: { id: a.people.poster.id },
      });
      expect(u.status).toBe("ACTIVE");
      expect(u.suspendedUntil).toBeNull();
      expect(
        await a.prisma.strike.count({ where: { userId: a.people.poster.id } }),
      ).toBe(0);
      const rows = await notices("poster");
      // WF-6 (RX2): an accepted suspension appeal says the account is active again
      expect(rows.map((n) => n.title)).toContain(
        "Your appeal was accepted. Your account is active again.",
      );
      // the old notice no longer offers an appeal that has been decided
      expect(rows.find((n) => /suspended/.test(n.title))?.appeal).toBeNull();
    });

    it("a removed post: KEEP leaves it down and the appeal is declined", async () => {
      await a.prisma.notification.deleteMany({});
      await a.prisma.appeal.deleteMany({});
      await a.prisma.strike.deleteMany({});
      await a.prisma.moderationAction.deleteMany({});
      await a.prisma.moderationItem.deleteMany({});
      const ans = await seedAnswer(a, q, a.people.poster.id, {
        status: "REMOVED",
      });
      await appeal("poster", "ANSWER", ans.id).expect(201);
      const item = await a.prisma.moderationItem.findFirstOrThrow({
        where: { targetType: "ANSWER", targetId: ans.id, queue: "APPEAL" },
      });
      await act("mod", item.id, "KEEP", "It stays down.").expect(200);
      expect(
        (await a.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
          .status,
      ).toBe("REMOVED");
      expect((await notices("poster")).map((n) => n.title)).toEqual([
        "Your appeal was declined",
      ]);
    });
  });

  describe("C-M3: a 'Misleading news tag' report is a news flag", () => {
    it("opens no Moderation item, needs news.flag_threshold flags, and an editor decision settles old items", async () => {
      const news = await seedAnswer(a, q, a.people.poster.id, {
        isNews: true,
        newsTag: "GOSSIP",
        body: "claimed news",
      });
      const flag = (who: string) =>
        a.h.http().post(`${api}/reports`).set(a.auth(who)).send({
          targetType: "ANSWER",
          targetId: news.id,
          reason: "MISLEADING_NEWS_TAG",
        });
      for (const who of ["r1", "r2", "r3"]) await flag(who).expect(201);
      expect(
        await a.prisma.moderationItem.count({ where: { targetId: news.id } }),
      ).toBe(0);
      let row = await a.prisma.answer.findUniqueOrThrow({
        where: { id: news.id },
      });
      expect([row.newsFlagCount, row.newsReviewStatus]).toEqual([3, "NONE"]);
      await flag("r4").expect(201);
      row = await a.prisma.answer.findUniqueOrThrow({ where: { id: news.id } });
      expect([row.newsFlagCount, row.newsReviewStatus]).toEqual([4, "FLAGGED"]);
      expect(
        await a.prisma.moderationItem.count({ where: { targetId: news.id } }),
      ).toBe(0);
      // a configured threshold of 2 is honoured
      await a.prisma.configEntry.upsert({
        where: { key: "news.flag_threshold" },
        create: { key: "news.flag_threshold", valueJson: 2 },
        update: { valueJson: 2 },
      });
      const news2 = await seedAnswer(a, q, a.people.poster.id, {
        isNews: true,
        newsTag: "GOSSIP",
        body: "n2",
      });
      const flag2 = (who: string) =>
        a.h.http().post(`${api}/reports`).set(a.auth(who)).send({
          targetType: "ANSWER",
          targetId: news2.id,
          reason: "MISLEADING_NEWS_TAG",
        });
      await flag2("r1").expect(201);
      expect(
        (await a.prisma.answer.findUniqueOrThrow({ where: { id: news2.id } }))
          .newsReviewStatus,
      ).toBe("NONE");
      await flag2("r2").expect(201);
      expect(
        (await a.prisma.answer.findUniqueOrThrow({ where: { id: news2.id } }))
          .newsReviewStatus,
      ).toBe("FLAGGED");
      await a.prisma.configEntry.delete({
        where: { key: "news.flag_threshold" },
      });
      // an item that only exists for the news tag is closed by the editor's decision; one with other reasons is not
      const only = await a.prisma.moderationItem.create({
        data: {
          targetType: "ANSWER",
          targetId: news.id,
          queue: "REPORTED",
          reasons: ["MISLEADING_NEWS_TAG"],
          reportCount: 1,
        },
      });
      const mixed = await a.prisma.moderationItem.create({
        data: {
          targetType: "ANSWER",
          targetId: news2.id,
          queue: "REPORTED",
          reasons: ["MISLEADING_NEWS_TAG", "SCAM_OR_SPAM"],
          reportCount: 2,
        },
      });
      await a.h
        .http()
        .post(`${api}/admin/news/${news.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "KEEP", reason: "The tag is fair." })
        .expect(200);
      await a.h
        .http()
        .post(`${api}/admin/news/${news2.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "KEEP", reason: "The tag is fair." })
        .expect(200);
      expect(
        (
          await a.prisma.moderationItem.findUniqueOrThrow({
            where: { id: only.id },
          })
        ).status,
      ).toBe("RESOLVED");
      expect(
        (
          await a.prisma.moderationItem.findUniqueOrThrow({
            where: { id: mixed.id },
          })
        ).status,
      ).toBe("OPEN");
      expect(
        await a.prisma.report.count({
          where: {
            targetId: news.id,
            reason: "MISLEADING_NEWS_TAG",
            status: "OPEN",
          },
        }),
      ).toBe(0);
    });
  });
});
