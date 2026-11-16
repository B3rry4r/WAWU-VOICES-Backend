/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { AlertsService, ALERT_BATCH } from "../../src/reach/alerts.service";
import { bootAdmin, type Admin } from "../admin/helpers";

/**
 * V-FIX-B, item 2: POLL_CLOSED, CATEGORY_ALERT and TAG_FOLLOW in-app notices are written where their event happens,
 * respect each person's own switches, are written once, and are written a page at a time.
 */
describe("V-FIX-B alerts: poll closed, category alert, tag follow", () => {
  let a: Admin;
  let alerts: AlertsService;
  let seq = 0;

  const mkUser = async (over: Record<string, unknown> = {}) => {
    const n = ++seq;
    return a.prisma.user.create({
      data: {
        wawuId: `fixb-al-${n}-${randomUUID()}`,
        handle: `fa${n}${randomUUID().slice(0, 6)}`,
        referralCode: `r${n}${randomUUID().slice(0, 8)}`,
        ...over,
      },
    });
  };
  const notices = (type: string, targetId?: string) =>
    a.prisma.notification.findMany({
      where: { type: type as never, ...(targetId ? { targetId } : {}) },
      orderBy: { userId: "asc" },
    });
  const mkPoll = async (over: Record<string, unknown> = {}) => {
    const q = await a.prisma.question.create({
      data: { text: "Should fuel be cheaper?", status: "LIVE", kind: "DAILY" },
    });
    const p = await a.prisma.poll.create({
      data: {
        questionId: q.id,
        kind: "QUESTION",
        title: "Should fuel be cheaper?",
        startsAt: new Date(Date.now() - 3 * 3_600_000),
        endsAt: new Date(Date.now() - 60_000),
        totalVotes: 3,
        ...over,
      },
    });
    return { q, p };
  };
  const vote = (pollId: string, userId: string) =>
    a.prisma.vote.create({
      data: {
        pollId,
        userId,
        phoneHash: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    });

  beforeAll(async () => {
    a = await bootAdmin();
    alerts = a.h.app.get(AlertsService);
  });
  afterAll(() => a.close());

  describe("a poll closes", () => {
    it("tells people who voted or saved the question, once, if they allow poll results", async () => {
      const { q, p } = await mkPoll();
      const v1 = await mkUser();
      const v2 = await mkUser();
      const off = await mkUser({
        settings: { create: { notifyPollResults: false } },
      });
      const saver = await mkUser();
      const outsider = await mkUser();
      const gone = await mkUser({ status: "SUSPENDED" });
      for (const u of [v1, v2, off, gone, saver]) await vote(p.id, u.id);
      // saver both voted and saved: still one notice
      await a.prisma.savedQuestion.create({
        data: { userId: saver.id, questionId: q.id },
      });
      const saverOnly = await mkUser();
      await a.prisma.savedQuestion.create({
        data: { userId: saverOnly.id, questionId: q.id },
      });
      await a.prisma.poll.update({
        where: { id: p.id },
        data: { totalVotes: 5 },
      });

      const sent = await alerts.pollClosed(p.id);
      const rows = await notices("POLL_CLOSED", p.id);
      const who = rows.map((r) => r.userId).sort();
      expect(who).toEqual([v1.id, v2.id, saver.id, saverOnly.id].sort());
      expect(sent).toBe(4);
      expect(who).not.toContain(off.id);
      expect(who).not.toContain(outsider.id);
      expect(who).not.toContain(gone.id);
      expect(rows[0]).toMatchObject({
        title: "Poll closed",
        targetType: "poll",
        targetId: p.id,
        readAt: null,
      });
      expect(rows[0].body).toBe(
        "Should fuel be cheaper? See how 5 voters answered.",
      );
      expect(
        (await a.prisma.poll.findUniqueOrThrow({ where: { id: p.id } }))
          .closeAlertedAt,
      ).not.toBeNull();
      // a second run adds nothing
      expect(await alerts.pollClosed(p.id)).toBe(0);
      expect(await notices("POLL_CLOSED", p.id)).toHaveLength(4);
    });

    it("the sweep announces a poll that ended and not one still open or one it already did", async () => {
      const closed = await mkPoll();
      const voter = await mkUser();
      await vote(closed.p.id, voter.id);
      const open = await mkPoll({ endsAt: new Date(Date.now() + 3_600_000) });
      await vote(open.p.id, voter.id);
      const old = await mkPoll({
        endsAt: new Date(Date.now() - 5 * 86_400_000),
        startsAt: new Date(Date.now() - 6 * 86_400_000),
      });
      await vote(old.p.id, voter.id);
      const r = await alerts.sweep();
      expect(r.polls).toBeGreaterThanOrEqual(1);
      expect(
        (await notices("POLL_CLOSED", closed.p.id)).map((x) => x.userId),
      ).toEqual([voter.id]);
      expect(await notices("POLL_CLOSED", open.p.id)).toHaveLength(0);
      expect(await notices("POLL_CLOSED", old.p.id)).toHaveLength(0);
      expect((await alerts.sweep()).polls).toBe(0);
    });

    it("shows in the person's notifications, and not under a switched-off setting", async () => {
      const u = await a.person("pollreader");
      const { p, q } = await mkPoll();
      await vote(p.id, u.id);
      await alerts.pollClosed(p.id);
      const list = await a.h
        .http()
        .get("/api/v1/notifications?type=polls")
        .set(a.auth("pollreader"))
        .expect(200);
      expect(list.body.items.map((i: any) => i.type)).toContain("POLL_CLOSED");
      // the notice carries the question its results are on (the web opens /q/{questionId}/results)
      const row = list.body.items.find((i: any) => i.type === "POLL_CLOSED");
      expect(row).toMatchObject({
        targetType: "poll",
        targetId: p.id,
        questionId: q.id,
      });
    });
  });

  describe("a new question opens in a category someone has Alerts on for", () => {
    it("tells followers with Alerts on, once, and respects both switches", async () => {
      const cat = await a.prisma.category.create({
        data: { slug: `c-${randomUUID().slice(0, 8)}`, name: "Money" },
      });
      const other = await a.prisma.category.create({
        data: { slug: `c-${randomUUID().slice(0, 8)}`, name: "Roads" },
      });
      const on = await mkUser();
      const chipOff = await mkUser();
      const switchOff = await mkUser({
        settings: { create: { notifyCategoryAlerts: false } },
      });
      const elsewhere = await mkUser();
      const deleting = await mkUser({ deletionRequestedAt: new Date() });
      await a.prisma.userCategory.createMany({
        data: [
          { userId: on.id, categoryId: cat.id, alertsOn: true },
          { userId: chipOff.id, categoryId: cat.id, alertsOn: false },
          { userId: switchOff.id, categoryId: cat.id, alertsOn: true },
          { userId: elsewhere.id, categoryId: other.id, alertsOn: true },
          { userId: deleting.id, categoryId: cat.id, alertsOn: true },
        ],
      });
      const fresh = await a.prisma.question.create({
        data: {
          text: "Why do banks fail us on payday?",
          categoryId: cat.id,
          kind: "DAILY",
          status: "SCHEDULED",
          startsAt: new Date(Date.now() - 10 * 60_000),
          endsAt: new Date(Date.now() + 20 * 3_600_000),
        },
      });
      const future = await a.prisma.question.create({
        data: {
          text: "Tomorrow's question",
          categoryId: cat.id,
          kind: "DAILY",
          status: "SCHEDULED",
          startsAt: new Date(Date.now() + 3_600_000),
          endsAt: new Date(Date.now() + 25 * 3_600_000),
        },
      });
      const stale = await a.prisma.question.create({
        data: {
          text: "Last week's question",
          categoryId: cat.id,
          kind: "DAILY",
          status: "SCHEDULED",
          startsAt: new Date(Date.now() - 3 * 86_400_000),
          endsAt: new Date(Date.now() + 3_600_000),
        },
      });
      const r = await alerts.sweep();
      expect(r.questions).toBeGreaterThanOrEqual(1);
      const rows = await notices("CATEGORY_ALERT", fresh.id);
      expect(rows.map((x) => x.userId)).toEqual([on.id]);
      expect(rows[0]).toMatchObject({
        title: "New in Money",
        body: "Why do banks fail us on payday?",
        targetType: "question",
        targetId: fresh.id,
      });
      expect(await notices("CATEGORY_ALERT", future.id)).toHaveLength(0);
      expect(await notices("CATEGORY_ALERT", stale.id)).toHaveLength(0);
      expect((await alerts.sweep()).questions).toBe(0);
      // the question that has not opened yet is announced when it does
      await a.prisma.question.update({
        where: { id: future.id },
        data: { startsAt: new Date(Date.now() - 1000) },
      });
      await alerts.sweep();
      expect(
        (await notices("CATEGORY_ALERT", future.id)).map((x) => x.userId),
      ).toEqual([on.id]);
    });
  });

  describe("a new post under a tag someone follows", () => {
    const publish = async (author: string, tag: string, over = {}) => {
      const q = await a.prisma.question.create({
        data: {
          text: "What happened at the market?",
          status: "LIVE",
          kind: "DAILY",
        },
      });
      return a.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: author,
          kind: "TEXT",
          body: "x",
          isNews: true,
          newsTag: tag as never,
          ...over,
        },
      });
    };

    it("tells followers of that tag, not the poster, not people who block them, not other tags, and no more than once an hour", async () => {
      const author = await mkUser();
      const f1 = await mkUser();
      const f2 = await mkUser();
      const blocker = await mkUser();
      const unfollowed = await mkUser();
      const gossipOnly = await mkUser();
      await a.prisma.newsTagFollow.createMany({
        data: [
          { userId: author.id, tag: "UNVERIFIED_NEWS" },
          { userId: f1.id, tag: "UNVERIFIED_NEWS" },
          { userId: f2.id, tag: "UNVERIFIED_NEWS" },
          { userId: blocker.id, tag: "UNVERIFIED_NEWS" },
          { userId: gossipOnly.id, tag: "GOSSIP" },
        ],
      });
      await a.prisma.block.create({
        data: { blockerId: blocker.id, blockedId: author.id },
      });
      const post = await publish(author.id, "UNVERIFIED_NEWS");
      expect(await alerts.tagPost(post.id)).toBe(2);
      const rows = await notices("TAG_FOLLOW", post.id);
      expect(rows.map((r) => r.userId).sort()).toEqual([f1.id, f2.id].sort());
      expect(rows[0]).toMatchObject({
        title: "New under Unverified News",
        body: "What happened at the market?",
        targetType: "answer",
      });
      expect(unfollowed.id).not.toBe(rows[0].userId);
      // a second post in the same hour is the same nudge, not a second notice
      const again = await publish(author.id, "UNVERIFIED_NEWS");
      expect(await alerts.tagPost(again.id)).toBe(0);
      // the same person who unfollows gets nothing
      await a.prisma.newsTagFollow.delete({
        where: { userId_tag: { userId: f1.id, tag: "UNVERIFIED_NEWS" } },
      });
      const nextHour = new Date(Date.now() + 2 * 3_600_000);
      expect(await alerts.tagPost(again.id, nextHour)).toBe(1); // f2 only
      // a post that is not live, or has no tag, says nothing
      const held = await publish(author.id, "GOSSIP", { status: "HELD" });
      expect(await alerts.tagPost(held.id)).toBe(0);
    });

    it("a post made through the API tells the people who follow its tag", async () => {
      const poster = await a.person("tagposter");
      const reader = await a.person("tagreader");
      await a.prisma.newsTagFollow.create({
        data: { userId: reader.id, tag: "GOSSIP" },
      });
      const q = await a.prisma.question.create({
        data: { text: "Any gist?", status: "LIVE", kind: "DAILY" },
      });
      const r = await a.h
        .http()
        .post(`/api/v1/questions/${q.id}/answers`)
        .set(a.auth("tagposter"))
        .set("Idempotency-Key", `fixb-al-${randomUUID()}`)
        .send({ kind: "TEXT", body: "gist", isNews: true, newsTag: "GOSSIP" })
        .expect(201);
      let row = null;
      for (let i = 0; i < 40 && !row; i++) {
        row = await a.prisma.notification.findFirst({
          where: { userId: reader.id, type: "TAG_FOLLOW" },
        });
        if (!row) await new Promise((x) => setTimeout(x, 50));
      }
      expect(row).toMatchObject({ targetId: r.body.answer.id });
      expect(
        await a.prisma.notification.count({
          where: { userId: poster.id, type: "TAG_FOLLOW" },
        }),
      ).toBe(0);
    });
  });

  describe("a big fan-out is paged", () => {
    it(`writes ${ALERT_BATCH * 2 + 100} followers in three inserts, not one per person`, async () => {
      const total = ALERT_BATCH * 2 + 100;
      const author = await mkUser();
      const base = randomUUID().slice(0, 8);
      await a.prisma.user.createMany({
        data: Array.from({ length: total }, (_, i) => ({
          wawuId: `fixb-big-${base}-${i}`,
          handle: `big${base}${i}`.slice(0, 20),
          referralCode: `bg${base}${i}`,
        })),
      });
      const people = await a.prisma.user.findMany({
        where: { wawuId: { startsWith: `fixb-big-${base}-` } },
        select: { id: true },
      });
      await a.prisma.newsTagFollow.createMany({
        data: people.map((p) => ({
          userId: p.id,
          tag: "VERIFIED_NEWS" as const,
        })),
      });
      const q = await a.prisma.question.create({
        data: { text: "Big story", status: "LIVE", kind: "DAILY" },
      });
      const post = await a.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: author.id,
          kind: "TEXT",
          body: "x",
          isNews: true,
          newsTag: "VERIFIED_NEWS",
          newsSourceName: "NAN",
        },
      });
      const spy = jest.spyOn(a.prisma.notification, "createMany");
      const reads = jest.spyOn(a.prisma.newsTagFollow, "findMany");
      try {
        const hour = new Date(Date.now() + 9 * 3_600_000);
        const sent = await alerts.tagPost(post.id, hour);
        const followers = await a.prisma.newsTagFollow.count({
          where: { tag: "VERIFIED_NEWS" },
        });
        expect(sent).toBe(followers - 0);
        expect(sent).toBeGreaterThanOrEqual(total);
        const calls = spy.mock.calls.length;
        // one insert per page of 500 followers, never one per person
        expect(calls).toBe(Math.ceil(followers / ALERT_BATCH));
        expect(reads.mock.calls.length).toBe(calls);
        expect(calls).toBeLessThan(followers / 100);
      } finally {
        spy.mockRestore();
        reads.mockRestore();
      }
    });
  });
});
