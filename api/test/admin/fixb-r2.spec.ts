/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { AlertsService } from "../../src/reach/alerts.service";
import { ConfigReader } from "../../src/talk/shared/config-reader";
import { UnitsAccess } from "../../src/talk/shared/units-access";
import { bootAdmin, seedQuestion, type Admin } from "./helpers";

/** V-FIX-B round 2: the Verified News edit lock, unreadable questions, the tag alert switch and cap, one fan-out per tag per hour, advert links. */
describe("V-FIX-B round 2", () => {
  let a: Admin;
  let alerts: AlertsService;
  let q: string;
  const idem = () => ({ "Idempotency-Key": `fixb-r2-${randomUUID()}` });
  const post = (who: string, body: Record<string, unknown>) =>
    a.h
      .http()
      .post(`/api/v1/questions/${q}/answers`)
      .set(a.auth(who))
      .set(idem())
      .send({ kind: "TEXT", body: "Fuel queue at the Ikeja station", ...body });
  const edit = (who: string, id: string) =>
    a.h
      .http()
      .patch(`/api/v1/answers/${id}`)
      .set(a.auth(who))
      .send({ body: "Fuel queue at Ikeja" });
  const mkUser = async (over: Record<string, unknown> = {}) => {
    const n = randomUUID().slice(0, 8);
    return a.prisma.user.create({
      data: {
        wawuId: `r2-${n}`,
        handle: `r2${n}`,
        referralCode: `r2${n}`,
        ...over,
      },
    });
  };
  const tagNotices = (userId: string) =>
    a.prisma.notification.count({ where: { userId, type: "TAG_FOLLOW" } });

  beforeAll(async () => {
    a = await bootAdmin();
    alerts = a.h.app.get(AlertsService);
    await a.person("editor", ["EDITOR"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("poster");
    await a.person("other");
    await a.person("poster3");
    q = (await seedQuestion(a)).id;
    await a.prisma.$executeRawUnsafe(`TRUNCATE "AlertMarker"`);
  });
  afterAll(async () => {
    await a.prisma.$executeRawUnsafe(`TRUNCATE "Ad","AdEvent" CASCADE`);
    await a.close();
  });

  describe("1. a poster cannot rewrite a post checked as Verified News, or being checked", () => {
    it("blocks the edit while a request is open and once it is Verified; an editor may edit their own Verified post", async () => {
      const made = await post("poster", {
        isNews: true,
        newsTag: "UNVERIFIED_NEWS",
        requestVerified: true,
        newsSourceName: "Lagos State Press Office",
      }).expect(201);
      const id = made.body.answer.id as string;
      const open = await edit("poster", id).expect(409);
      expect(open.body.error.message).toBe(
        "An editor is checking this post. It cannot be edited until they decide.",
      );
      await a.h
        .http()
        .post(`/api/v1/admin/news/${id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "APPROVE_VERIFIED", reason: "Checked." })
        .expect(200);
      const ver = await edit("poster", id).expect(409);
      expect(ver.body.error.message).toBe(
        "This post was checked as Verified News and can no longer be edited.",
      );
      expect(
        (await a.prisma.answer.findUniqueOrThrow({ where: { id } })).body,
      ).toBe("Fuel queue at the Ikeja station");
      const own = await post("editor", {
        isNews: true,
        newsTag: "VERIFIED_NEWS",
        newsSourceName: "NiMet bulletin",
      }).expect(201);
      await edit("editor", own.body.answer.id).expect(200);
      // a declined request frees the post again
      const m2 = await post("poster", {
        isNews: true,
        newsTag: "UNVERIFIED_NEWS",
        requestVerified: true,
        newsSourceName: "A friend",
      }).expect(201);
      await edit("poster", m2.body.answer.id).expect(409);
      await a.h
        .http()
        .post(`/api/v1/admin/news/${m2.body.answer.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "DECLINE_VERIFIED", reason: "No source." })
        .expect(200);
      await edit("poster", m2.body.answer.id).expect(200);
    });
  });

  describe("2. nothing is announced from, listed under or approved on a question that has not opened", () => {
    it("is hidden from /news, cannot be requested or approved, and sends no alert", async () => {
      const future = await a.prisma.question.create({
        data: {
          text: "Next week's question",
          kind: "DAILY",
          status: "SCHEDULED",
          startsAt: new Date(Date.now() + 5 * 86_400_000),
          endsAt: new Date(Date.now() + 6 * 86_400_000),
        },
      });
      const follower = await mkUser();
      await a.prisma.newsTagFollow.create({
        data: { userId: follower.id, tag: "UNVERIFIED_NEWS" },
      });
      const ans = await a.prisma.answer.create({
        data: {
          questionId: future.id,
          authorId: a.people.poster.id,
          kind: "TEXT",
          body: "early",
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        },
      });
      expect(await alerts.tagPost(ans.id)).toBe(0);
      expect(await tagNotices(follower.id)).toBe(0);
      await a.h.http().get(`/api/v1/news/${ans.id}`).expect(404);
      const list = await a.h.http().get("/api/v1/news").expect(200);
      expect(list.body.items.map((i: any) => i.id)).not.toContain(ans.id);
      await a.h
        .http()
        .post(`/api/v1/news/${ans.id}/request-verified`)
        .set(a.auth("poster"))
        .send({ sourceName: "Press office" })
        .expect(404);
      await a.prisma.newsVerificationRequest.create({
        data: {
          answerId: ans.id,
          requestedById: a.people.poster.id,
          sourceName: "Press office",
        },
      });
      await a.h
        .http()
        .post(`/api/v1/admin/news/${ans.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "APPROVE_VERIFIED", reason: "Checked." })
        .expect(404);
      await a.h
        .http()
        .post(`/api/v1/admin/news/${ans.id}/decision`)
        .set(a.auth("editor"))
        .send({
          decision: "CHANGE_TAG",
          newTag: "VERIFIED_NEWS",
          sourceName: "x",
          reason: "Checked.",
        })
        .expect(404);
      // a poll under it that "closed" announces nothing and is not marked
      const voter = await mkUser();
      const poll = await a.prisma.poll.create({
        data: {
          questionId: future.id,
          kind: "QUESTION",
          title: "Early poll",
          startsAt: new Date(Date.now() - 3600_000),
          endsAt: new Date(Date.now() - 60_000),
          totalVotes: 1,
        },
      });
      await a.prisma.vote.create({
        data: {
          pollId: poll.id,
          userId: voter.id,
          phoneHash: randomUUID(),
          idempotencyKey: randomUUID(),
        },
      });
      expect(await alerts.pollClosed(poll.id)).toBe(0);
      expect(
        await a.prisma.notification.count({ where: { userId: voter.id } }),
      ).toBe(0);
    });

    it("only a post first published under a tag, and a post first approved as Verified News, tell followers; another change of tag does not", async () => {
      const follower = await a.person("tagfollower");
      await a.prisma.newsTagFollow.createMany({
        data: [
          { userId: follower.id, tag: "GOSSIP" },
          { userId: follower.id, tag: "VERIFIED_NEWS" },
        ],
        skipDuplicates: true,
      });
      await a.prisma.$executeRawUnsafe(`TRUNCATE "AlertMarker"`);
      const before = await tagNotices(follower.id);
      const id = (
        await a.prisma.answer.create({
          data: {
            questionId: q,
            authorId: a.people.poster.id,
            kind: "TEXT",
            body: "fresh",
            isNews: true,
            newsTag: "UNVERIFIED_NEWS",
          },
        })
      ).id;
      await a.h
        .http()
        .post(`/api/v1/admin/news/${id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "CHANGE_TAG", newTag: "GOSSIP", reason: "Opinion." })
        .expect(200);
      await new Promise((r) => setTimeout(r, 300));
      expect(await tagNotices(follower.id)).toBe(before);
      await a.h
        .http()
        .post(`/api/v1/admin/news/${id}/decision`)
        .set(a.auth("editor"))
        .send({
          decision: "CHANGE_TAG",
          newTag: "VERIFIED_NEWS",
          sourceName: "Press office",
          reason: "Confirmed.",
        })
        .expect(200);
      let n = before;
      for (let i = 0; i < 40 && n === before; i++) {
        n = await tagNotices(follower.id);
        if (n === before) await new Promise((r) => setTimeout(r, 50));
      }
      expect(n).toBe(before + 1);
    });
  });

  describe("3. the news tag alerts switch and the daily cap", () => {
    it("is in the settings, defaults on, and a person who turns it off gets none", async () => {
      const s = await a.h
        .http()
        .get("/api/v1/me/settings")
        .set(a.auth("other"))
        .expect(200);
      expect(s.body.notifyTagFollows).toBe(true);
      const off = await a.h
        .http()
        .patch("/api/v1/me/settings")
        .set(a.auth("other"))
        .send({ notifyTagFollows: false })
        .expect(200);
      expect(off.body.notifyTagFollows).toBe(false);
      await a.prisma.newsTagFollow.upsert({
        where: { userId_tag: { userId: a.people.other.id, tag: "GOSSIP" } },
        create: { userId: a.people.other.id, tag: "GOSSIP" },
        update: {},
      });
      const ans = await a.prisma.answer.create({
        data: {
          questionId: q,
          authorId: a.people.poster.id,
          kind: "TEXT",
          body: "g",
          isNews: true,
          newsTag: "GOSSIP",
        },
      });
      const had = await tagNotices(a.people.other.id);
      await alerts.tagPost(ans.id, new Date(Date.now() + 40 * 3_600_000));
      expect(await tagNotices(a.people.other.id)).toBe(had);
    });

    it("at most alerts.tag_follow_per_day notices per person per tag per Lagos day, on top of one an hour; 0 sends none", async () => {
      const u = await mkUser();
      await a.prisma.newsTagFollow.create({
        data: { userId: u.id, tag: "UNVERIFIED_NEWS" },
      });
      await a.prisma.configEntry.upsert({
        where: { key: "alerts.tag_follow_per_day" },
        create: { key: "alerts.tag_follow_per_day", valueJson: 2 },
        update: { valueJson: 2 },
      });
      const ans = await a.prisma.answer.create({
        data: {
          questionId: q,
          authorId: a.people.poster.id,
          kind: "TEXT",
          body: "u",
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        },
      });
      // a Lagos day in the future, with two notices already written for this person under this tag
      const base = new Date(
        Date.now() + (60 + Math.floor(Math.random() * 300)) * 86_400_000,
      );
      base.setUTCHours(10, 5, 0, 0);
      const at = (h: number) => new Date(base.getTime() + h * 3_600_000);
      for (const h of [0, 1])
        await a.prisma.notification.create({
          data: {
            userId: u.id,
            type: "TAG_FOLLOW",
            title: "New under Unverified News",
            groupKey: `tag-follow:UNVERIFIED_NEWS:old${h}`,
            createdAt: at(h),
          },
        });
      // at the cap (2): nothing more that day, though the hour is free
      await alerts.tagPost(ans.id, at(2));
      expect(await tagNotices(u.id)).toBe(2);
      // the cap is 3: one more, then none
      await a.prisma.configEntry.update({
        where: { key: "alerts.tag_follow_per_day" },
        data: { valueJson: 3 },
      });
      await a.prisma.$executeRawUnsafe(`TRUNCATE "AlertMarker"`);
      await alerts.tagPost(ans.id, at(3));
      expect(await tagNotices(u.id)).toBe(3);
      // the notice was written now; date it into the simulated day as it would be
      await a.prisma.notification.updateMany({
        where: {
          userId: u.id,
          groupKey: `tag-follow:UNVERIFIED_NEWS:${at(3).toISOString().slice(0, 13)}`,
        },
        data: { createdAt: at(3) },
      });
      await alerts.tagPost(ans.id, at(4));
      expect(await tagNotices(u.id)).toBe(3);
      // 0 sends none at all
      await a.prisma.configEntry.update({
        where: { key: "alerts.tag_follow_per_day" },
        data: { valueJson: 0 },
      });
      const c0 = await tagNotices(u.id);
      await alerts.tagPost(ans.id, at(5));
      expect(await tagNotices(u.id)).toBe(c0);
      await a.prisma.configEntry.delete({
        where: { key: "alerts.tag_follow_per_day" },
      });
    });
  });

  describe("4. one fan-out per tag per hour", () => {
    it("a second post in the same hour pages no followers; a failed fan-out gives the hour back", async () => {
      const author = await mkUser();
      const f = await mkUser();
      await a.prisma.newsTagFollow.create({
        data: { userId: f.id, tag: "GOSSIP" },
      });
      const mk = () =>
        a.prisma.answer.create({
          data: {
            questionId: q,
            authorId: author.id,
            kind: "TEXT",
            body: "x",
            isNews: true,
            newsTag: "GOSSIP",
          },
        });
      const p1 = await mk();
      const p2 = await mk();
      const hour = new Date(
        Date.now() + (200 + Math.floor(Math.random() * 5000)) * 3_600_000,
      );
      const reads = jest.spyOn(a.prisma.newsTagFollow, "findMany");
      try {
        expect(await alerts.tagPost(p1.id, hour)).toBeGreaterThanOrEqual(1);
        const first = reads.mock.calls.length;
        expect(first).toBeGreaterThanOrEqual(1);
        expect(await alerts.tagPost(p2.id, hour)).toBe(0);
        // not one query on the followers for the second post
        expect(reads.mock.calls.length).toBe(first);
        const marker = await a.prisma.alertMarker.findMany({
          where: { key: { startsWith: "tag-follow:GOSSIP:" } },
        });
        expect(marker.length).toBeGreaterThanOrEqual(1);
        // ten posts at once: one fan-out
        const next = new Date(hour.getTime() + 3_600_000);
        const before = reads.mock.calls.length;
        const ten = await Promise.all(
          Array.from({ length: 10 }, async () => (await mk()).id),
        );
        await Promise.all(ten.map((id) => alerts.tagPost(id, next)));
        expect(reads.mock.calls.length - before).toBeLessThanOrEqual(1);
      } finally {
        reads.mockRestore();
      }
      // failure: the marker is given back
      const later = new Date(hour.getTime() + 10 * 3_600_000);
      const boom = jest
        .spyOn(a.prisma.newsTagFollow, "findMany")
        .mockRejectedValueOnce(new Error("db down"));
      await expect(alerts.tagPost(p1.id, later)).rejects.toThrow("db down");
      boom.mockRestore();
      expect(await alerts.tagPost(p1.id, later)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("5. an advert's link is a real https address for every kind, on create and on update", () => {
    const kinds = ["FEED_CARD", "BANNER", "AUDIO_SLOT", "WALLET_OFFER"];
    const bad = [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com/x",
      "http://example.com",
      "https:example",
      "https://localhost/x",
      "https://user:pw@example.com/x",
      "//example.com",
    ];
    it("refuses every bad link for every kind (create and update) and accepts https", async () => {
      for (const kind of kinds) {
        const body = {
          brand: "Soup Ltd",
          kind,
          headline: "Soup",
          startsOn: "2026-01-01",
          endsOn: "2099-01-01",
        };
        for (const linkUrl of bad) {
          const r = await a.h
            .http()
            .post("/api/v1/admin/ads")
            .set(a.auth("adman"))
            .send({ ...body, linkUrl });
          expect([kind, linkUrl, r.status]).toEqual([kind, linkUrl, 422]);
        }
        const ok = await a.h
          .http()
          .post("/api/v1/admin/ads")
          .set(a.auth("adman"))
          .send({ ...body, linkUrl: "https://example.com/soup" })
          .expect(201);
        for (const linkUrl of bad) {
          const r = await a.h
            .http()
            .patch(`/api/v1/admin/ads/${ok.body.id}`)
            .set(a.auth("adman"))
            .send({ linkUrl });
          expect([kind, linkUrl, r.status]).toEqual([kind, linkUrl, 422]);
        }
      }
    });
    it("an old row with another kind of link is not handed to the page", async () => {
      const creator = await mkUser();
      const ad = await a.prisma.ad.create({
        data: {
          brand: "Old",
          kind: "FEED_CARD",
          status: "APPROVED",
          headline: "Old ad",
          linkUrl: "javascript:alert(1)",
          approvedAt: new Date(),
          createdById: creator.id,
        },
      });
      const r = await a.h
        .http()
        .get("/api/v1/ads/placement?kind=FEED_CARD")
        .expect(200);
      expect(r.body.ad?.id).toBe(ad.id);
      expect(r.body.ad.linkUrl).toBeNull();
    });
  });

  describe("round 3", () => {
    const decide = (id: string, body: Record<string, unknown>) =>
      a.h
        .http()
        .post(`/api/v1/admin/news/${id}/decision`)
        .set(a.auth("editor"))
        .send({ reason: "Checked.", ...body });
    const mkAsked = async (body = "Fuel queue at the Ikeja station") => {
      const ans = await a.prisma.answer.create({
        data: {
          questionId: q,
          authorId: a.people.poster3.id,
          kind: "TEXT",
          body,
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
          newsReviewStatus: "VERIFIED_REQUESTED",
        },
      });
      await a.prisma.newsVerificationRequest.create({
        data: {
          answerId: ans.id,
          requestedById: a.people.poster3.id,
          sourceName: "Press office",
        },
      });
      return ans.id;
    };

    it("N-1: an approval that lands between the check and the write wins, and the edit is refused before any charge exists", async () => {
      const ans = await a.prisma.answer.create({
        data: {
          questionId: q,
          authorId: a.people.poster3.id,
          kind: "TEXT",
          body: "Fuel queue at the Ikeja station",
          isNews: true,
          newsTag: "UNVERIFIED_NEWS",
        },
      });
      const config = a.h.app.get(ConfigReader);
      const units = a.h.app.get(UnitsAccess);
      const orig = config.num.bind(config);
      let held = false;
      const gap = jest
        .spyOn(config, "num")
        .mockImplementation(async (key: string) => {
          if (key === "text.max_chars" && !held) {
            held = true;
            // the editor approves while the edit is between its first check and the lock
            await decide(ans.id, {
              decision: "CHANGE_TAG",
              newTag: "VERIFIED_NEWS",
              sourceName: "Press office",
            }).expect(200);
          }
          return orig(key);
        });
      const charge = jest.spyOn(units, "charge");
      const reverse = jest.spyOn(units, "reverse");
      try {
        const r = await a.h
          .http()
          .patch(`/api/v1/answers/${ans.id}`)
          .set(a.auth("poster3"))
          .send({
            body: "Fuel queue at the Ikeja station, and now it is moving fast",
          });
        expect(r.status).toBe(409);
        expect(r.body.error.message).toBe(
          "This post was checked as Verified News and can no longer be edited.",
        );
        // round 5: the refusal comes before pricing, so no charge was made and nothing was given back
        // (round 3 and 4 asserted: one charge call and one reversal of it)
        expect(charge).toHaveBeenCalledTimes(0);
        expect(reverse).toHaveBeenCalledTimes(0);
      } finally {
        gap.mockRestore();
        charge.mockRestore();
        reverse.mockRestore();
      }
      expect(
        (await a.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
          .body,
      ).toBe("Fuel queue at the Ikeja station");
    });

    it("N-2: every decision closes an open request; after the ones that do not give the tag the poster may edit and ask again", async () => {
      const cases: [string, Record<string, unknown>, string, boolean][] = [
        [
          "APPROVE_VERIFIED",
          { decision: "APPROVE_VERIFIED" },
          "APPROVED",
          true,
        ],
        [
          "DECLINE_VERIFIED",
          { decision: "DECLINE_VERIFIED" },
          "DECLINED",
          false,
        ],
        ["KEEP", { decision: "KEEP" }, "DECLINED", false],
        [
          "CHANGE_TAG",
          { decision: "CHANGE_TAG", newTag: "GOSSIP" },
          "DECLINED",
          false,
        ],
        [
          "SEND_TO_MODERATION",
          { decision: "SEND_TO_MODERATION" },
          "DECLINED",
          false,
        ],
        [
          "CHANGE_TAG (Verified)",
          {
            decision: "CHANGE_TAG",
            newTag: "VERIFIED_NEWS",
            sourceName: "Press office",
          },
          "APPROVED",
          true,
        ],
      ];
      for (const [name, body, status, locked] of cases) {
        const id = await mkAsked();
        await decide(id, body).expect(200);
        // V-FIX-B round 4 (N-5): the poster is told once, whichever way the editor answers (before this round, KEEP and
        // SEND_TO_MODERATION told nobody)
        const told = await a.prisma.notification.findMany({
          where: {
            userId: a.people.poster3.id,
            type: "TAG_CHANGED",
            targetId: id,
          },
        });
        expect([name, told.length]).toEqual([name, 1]);
        if (name === "KEEP" || name === "SEND_TO_MODERATION") {
          expect(told[0].title).toBe(
            "An editor looked at your request. Your post keeps its tag.",
          );
          expect(JSON.stringify(told[0]).toLowerCase()).not.toContain(
            "moderation",
          );
        }
        const req = await a.prisma.newsVerificationRequest.findFirstOrThrow({
          where: { answerId: id },
        });
        expect([name, req.status]).toEqual([name, status]);
        const r = await a.h
          .http()
          .patch(`/api/v1/answers/${id}`)
          .set(a.auth("poster3"))
          .send({ body: "Fuel queue at Ikeja" });
        expect([name, r.status]).toEqual([name, locked ? 409 : 200]);
        if (!locked) {
          const again = await a.h
            .http()
            .post(`/api/v1/news/${id}/request-verified`)
            .set(a.auth("poster3"))
            .send({ sourceName: "Press office again" });
          expect([name, again.status]).toEqual([name, 201]);
        }
      }
    });

    it("L-1: a real ended poll is announced behind 50 polls whose question is not readable", async () => {
      const draft = await a.prisma.question.create({
        data: { text: "Draft", kind: "DAILY", status: "DRAFT" },
      });
      await a.prisma.poll.createMany({
        data: Array.from({ length: 52 }, (_, i) => ({
          questionId: draft.id,
          kind: "QUESTION" as const,
          title: `Stuck ${i}`,
          startsAt: new Date(Date.now() - 50 * 3_600_000),
          endsAt: new Date(Date.now() - (49 - i * 0.1) * 3_600_000),
          totalVotes: 0,
        })),
      });
      const real = await a.prisma.question.create({
        data: { text: "Real", kind: "DAILY", status: "LIVE" },
      });
      const poll = await a.prisma.poll.create({
        data: {
          questionId: real.id,
          kind: "QUESTION",
          title: "Real poll",
          startsAt: new Date(Date.now() - 3 * 3_600_000),
          endsAt: new Date(Date.now() - 60_000),
          totalVotes: 1,
        },
      });
      const voter = await mkUser();
      await a.prisma.vote.create({
        data: {
          pollId: poll.id,
          userId: voter.id,
          phoneHash: randomUUID(),
          idempotencyKey: randomUUID(),
        },
      });
      await alerts.sweep();
      expect(
        await a.prisma.notification.count({
          where: { userId: voter.id, type: "POLL_CLOSED" },
        }),
      ).toBe(1);
      expect(
        (await a.prisma.poll.findUniqueOrThrow({ where: { id: poll.id } }))
          .closeAlertedAt,
      ).not.toBeNull();
    });

    it("L-2: a post is announced as Verified News once, even after Verified, Gossip, Verified", async () => {
      const f = await mkUser();
      await a.prisma.newsTagFollow.create({
        data: { userId: f.id, tag: "VERIFIED_NEWS" },
      });
      const ans = await a.prisma.answer.create({
        data: {
          questionId: q,
          authorId: a.people.poster3.id,
          kind: "TEXT",
          body: "v",
          isNews: true,
          newsTag: "VERIFIED_NEWS",
          newsSourceName: "NAN",
        },
      });
      const base = Date.now() + 900 * 3_600_000;
      await alerts.tagPost(ans.id, new Date(base));
      expect(await tagNotices(f.id)).toBe(1);
      await a.prisma.answer.update({
        where: { id: ans.id },
        data: { newsTag: "GOSSIP" },
      });
      await a.prisma.answer.update({
        where: { id: ans.id },
        data: { newsTag: "VERIFIED_NEWS" },
      });
      await alerts.tagPost(ans.id, new Date(base + 5 * 3_600_000));
      expect(await tagNotices(f.id)).toBe(1);
    });
  });
});
