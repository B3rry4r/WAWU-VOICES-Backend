/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment */
import {
  bootAdmin,
  report,
  seedAnswer,
  seedQuestion,
  type Admin,
} from "./helpers";

describe("admin: news, results, adverts", () => {
  let a: Admin;
  let q: string;
  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("admin", ["ADMIN"]);
    await a.person("editor", ["EDITOR"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("poster");
    await a.person("r1");
    await a.person("r2");
    q = (await seedQuestion(a)).id;
  });
  afterAll(() => a.close());

  describe("news", () => {
    const base = "/api/v1/admin/news";
    const news = (over: Record<string, unknown> = {}) =>
      seedAnswer(a, q, a.people.poster.id, {
        isNews: true,
        newsTag: "UNVERIFIED_NEWS",
        newsReviewStatus: "FLAGGED",
        newsFlagCount: 2,
        ...over,
      });

    it("roles: member and moderator are 403, editor and admin are in; list gives tab counts, waiting, flag reasons", async () => {
      await a.h.http().get(`${base}/items`).expect(401);
      for (const n of ["poster", "mod", "adman"])
        expect(
          (await a.h.http().get(`${base}/items`).set(a.auth(n)).expect(403))
            .body.error.code,
        ).toBe("ROLE_REQUIRED");
      const flagged = await news();
      await report(
        a,
        a.people.r1.id,
        "ANSWER",
        flagged.id,
        "MISLEADING_NEWS_TAG",
        "Old news",
      );
      await report(
        a,
        a.people.r2.id,
        "ANSWER",
        flagged.id,
        "MISLEADING_NEWS_TAG",
        "Old news",
      );
      const asking = await news({
        newsReviewStatus: "VERIFIED_REQUESTED",
        body: "Levy at the gate",
      });
      await a.prisma.newsVerificationRequest.create({
        data: {
          answerId: asking.id,
          requestedById: a.people.poster.id,
          sourceName: "Oyingbo market office",
          sourceUrl: "https://example.com/n",
        },
      });
      const r = await a.h
        .http()
        .get(`${base}/items`)
        .set(a.auth("editor"))
        .expect(200);
      expect(r.body.waiting).toBe(2);
      expect(r.body.counts).toEqual({
        flagged: 1,
        askingVerified: 1,
        allChanges: 0,
      });
      expect(r.body.items).toHaveLength(1);
      expect(r.body.items[0]).toMatchObject({
        flagCount: 2,
        flagReasons: ["Old news (2)"],
        verifiedRequested: false,
      });
      expect(r.body.items[0].answer.id).toBe(flagged.id);
      const t2 = await a.h
        .http()
        .get(`${base}/items?tab=asking-verified`)
        .set(a.auth("admin"))
        .expect(200);
      expect(t2.body.items[0]).toMatchObject({
        verifiedRequested: true,
        sourceName: "Oyingbo market office",
      });
      await a.h
        .http()
        .get(`${base}/items?tab=bogus`)
        .set(a.auth("admin"))
        .expect(422);
    });

    it("decision: reason needed; CHANGE_TAG writes TagChange and AuditLog, sets tag and status, tells the poster", async () => {
      const x = await news();
      const url = `${base}/${x.id}/decision`;
      await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({ decision: "CHANGE_TAG", newTag: "GOSSIP" })
        .expect(422);
      await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({ decision: "CHANGE_TAG", reason: "x" })
        .expect(422);
      await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({
          decision: "CHANGE_TAG",
          newTag: "UNVERIFIED_NEWS",
          reason: "x",
        })
        .expect(422);
      await a.h
        .http()
        .post(url)
        .set(a.auth("mod"))
        .send({ decision: "KEEP", reason: "x" })
        .expect(403);
      const r = await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({
          decision: "CHANGE_TAG",
          newTag: "GOSSIP",
          reason: "Reads like rumour.",
        })
        .expect(200);
      expect(r.body.answer.news.tag).toBe("GOSSIP");
      const row = await a.prisma.answer.findUniqueOrThrow({
        where: { id: x.id },
      });
      expect(row).toMatchObject({
        newsTag: "GOSSIP",
        newsReviewStatus: "RESOLVED",
      });
      const tc = await a.prisma.tagChange.findFirstOrThrow({
        where: { answerId: x.id },
      });
      expect(tc).toMatchObject({
        fromTag: "UNVERIFIED_NEWS",
        toTag: "GOSSIP",
        byUserId: a.people.editor.id,
        reason: "Reads like rumour.",
      });
      expect(
        await a.prisma.auditLog.count({
          where: {
            action: "news.decision",
            targetId: x.id,
            actorId: a.people.editor.id,
          },
        }),
      ).toBe(1);
      const n = await a.prisma.notification.findFirstOrThrow({
        where: { userId: a.people.poster.id, targetId: x.id },
      });
      expect(n).toMatchObject({
        type: "TAG_CHANGED",
        body: "Reads like rumour.",
      });
      expect(
        await a.prisma.notification.count({
          where: { userId: a.people.poster.id, targetId: x.id },
        }),
      ).toBe(1);
      expect(r.body.changeLog[0].text).toContain(
        "tag changed from Unverified News to Gossip",
      );
      const all = await a.h
        .http()
        .get(`${base}/items?tab=all-changes`)
        .set(a.auth("admin"))
        .expect(200);
      expect(all.body.items.some((i: any) => i.answer.id === x.id)).toBe(true);
    });

    it("Verified News needs a named source (422 SOURCE_REQUIRED); approve and decline need a request", async () => {
      const x = await news({ newsReviewStatus: "VERIFIED_REQUESTED" });
      const url = `${base}/${x.id}/decision`;
      const no = await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({
          decision: "CHANGE_TAG",
          newTag: "VERIFIED_NEWS",
          reason: "Checked.",
        })
        .expect(422);
      expect(no.body.error.code).toBe("SOURCE_REQUIRED");
      await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({ decision: "APPROVE_VERIFIED", reason: "Checked." })
        .expect(409);
      await a.prisma.newsVerificationRequest.create({
        data: {
          answerId: x.id,
          requestedById: a.people.poster.id,
          sourceName: "Market office",
        },
      });
      await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({
          decision: "CHANGE_TAG",
          newTag: "GOSSIP",
          sourceUrl: "ftp://x",
          reason: "x",
        })
        .expect(422);
      const ok = await a.h
        .http()
        .post(url)
        .set(a.auth("editor"))
        .send({
          decision: "APPROVE_VERIFIED",
          reason: "Source confirmed by phone.",
          sourceUrl: "https://example.com/s",
        })
        .expect(200);
      expect(ok.body.answer.news).toMatchObject({
        tag: "VERIFIED_NEWS",
        sourceName: "Market office",
        sourceUrl: "https://example.com/s",
      });
      expect(
        (
          await a.prisma.newsVerificationRequest.findFirstOrThrow({
            where: { answerId: x.id },
          })
        ).status,
      ).toBe("APPROVED");
      const y = await news();
      await a.prisma.newsVerificationRequest.create({
        data: {
          answerId: y.id,
          requestedById: a.people.poster.id,
          sourceName: "Blog",
        },
      });
      await a.h
        .http()
        .post(`${base}/${y.id}/decision`)
        .set(a.auth("admin"))
        .send({ decision: "DECLINE_VERIFIED", reason: "Not a named source." })
        .expect(200);
      expect(
        (await a.prisma.answer.findUniqueOrThrow({ where: { id: y.id } }))
          .newsTag,
      ).toBe("UNVERIFIED_NEWS");
      expect(
        (
          await a.prisma.newsVerificationRequest.findFirstOrThrow({
            where: { answerId: y.id },
          })
        ).status,
      ).toBe("DECLINED");
    });

    it("SEND_TO_MODERATION opens a moderation item; KEEP resolves; a missing or non-news post is 404", async () => {
      const x = await news();
      await a.h
        .http()
        .post(`${base}/${x.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "SEND_TO_MODERATION", reason: "Possible scam." })
        .expect(200);
      expect(
        await a.prisma.moderationItem.count({
          where: { targetId: x.id, status: "OPEN" },
        }),
      ).toBe(1);
      const k = await news();
      const r = await a.h
        .http()
        .post(`${base}/${k.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "KEEP", reason: "Labelled right." })
        .expect(200);
      expect(r.body.answer.news.tag).toBe("UNVERIFIED_NEWS");
      const plain = await seedAnswer(a, q, a.people.poster.id);
      await a.h
        .http()
        .post(`${base}/${plain.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "KEEP", reason: "x" })
        .expect(404);
      await a.h
        .http()
        .post(`${base}/0190a000-0000-7000-8000-000000000abc/decision`)
        .set(a.auth("editor"))
        .send({ decision: "KEEP", reason: "x" })
        .expect(404);
    });

    it("two editors deciding one post at once both finish with a consistent tag", async () => {
      const x = await news();
      const go = (tag: string) =>
        a.h
          .http()
          .post(`${base}/${x.id}/decision`)
          .set(a.auth("editor"))
          .send({ decision: "CHANGE_TAG", newTag: tag, reason: "race" });
      const res = await Promise.all([go("GOSSIP"), go("GOSSIP")]);
      expect(res.map((r) => r.status).sort()).toEqual([200, 422]);
      expect(
        await a.prisma.tagChange.count({ where: { answerId: x.id } }),
      ).toBe(1);
    });
  });

  describe("results", () => {
    const base = "/api/v1/admin/results";
    it("roles; open a thread; the queue; verify a post with a note; the poster is told; sending to moderation", async () => {
      await a.h.http().get(`${base}/threads`).expect(401);
      await a.h.http().get(`${base}/threads`).set(a.auth("mod")).expect(403);
      await a.h
        .http()
        .post(`${base}/threads`)
        .set(a.auth("editor"))
        .send({ title: "", heldOn: "2026-11-30" })
        .expect(422);
      const t = await a.h
        .http()
        .post(`${base}/threads`)
        .set(a.auth("editor"))
        .send({
          title: "Polling unit counts",
          heldOn: "2026-11-30",
          status: "OPEN",
        })
        .expect(201);
      expect(t.body).toMatchObject({
        title: "Polling unit counts",
        status: "OPEN",
        postCount: 0,
        toCheck: 0,
      });
      const list = await a.h
        .http()
        .get(`${base}/threads`)
        .set(a.auth("editor"))
        .expect(200);
      expect(list.body.items[0].id).toBe(t.body.id);
      const post = await a.prisma.resultPost.create({
        data: {
          threadId: t.body.id,
          authorId: a.people.poster.id,
          state: "Lagos",
          lga: "Surulere",
          ward: "Ward 3",
          pollingUnit: "PU 014",
          accredited: 412,
          votesCast: 398,
          rejected: 6,
          idempotencyKey: "k1",
        },
      });
      const posts = await a.h
        .http()
        .get(`${base}/posts?threadId=${t.body.id}`)
        .set(a.auth("editor"))
        .expect(200);
      expect(posts.body.toCheck).toBe(1);
      expect(posts.body.items[0].post.id).toBe(post.id);
      await a.h
        .http()
        .post(`${base}/posts/${post.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "MAYBE" })
        .expect(422);
      await a.h
        .http()
        .post(`${base}/posts/${post.id}/decision`)
        .set(a.auth("user" in a.people ? "poster" : "poster"))
        .send({ decision: "VERIFIED" })
        .expect(403);
      const d = await a.h
        .http()
        .post(`${base}/posts/${post.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "VERIFIED", note: "Figures match the sheet." })
        .expect(200);
      expect(d.body.post).toMatchObject({
        status: "VERIFIED",
        label: "Verified",
      });
      expect(d.body.checkedBy).toBe("@a7b.editor");
      const row = await a.prisma.resultPost.findUniqueOrThrow({
        where: { id: post.id },
      });
      expect(row).toMatchObject({
        status: "VERIFIED",
        checkedById: a.people.editor.id,
        checkNote: "Figures match the sheet.",
      });
      expect(
        await a.prisma.auditLog.count({
          where: { action: "result.decide", targetId: post.id },
        }),
      ).toBe(1);
      const n = await a.prisma.notification.findFirstOrThrow({
        where: { userId: a.people.poster.id, type: "RESULT_CHECKED" },
      });
      expect(n.title).toContain("Verified");
      // one decision, one alert (not one from the service and one from the route)
      expect(
        await a.prisma.notification.count({
          where: { userId: a.people.poster.id, targetId: post.id },
        }),
      ).toBe(1);
      const after = await a.h
        .http()
        .get(`${base}/posts?status=VERIFIED`)
        .set(a.auth("admin"))
        .expect(200);
      expect(after.body.items).toHaveLength(1);
      const p2 = await a.prisma.resultPost.create({
        data: {
          threadId: t.body.id,
          authorId: a.people.poster.id,
          state: "Lagos",
          lga: "Yaba",
          ward: "Ward 9",
          pollingUnit: "PU 007",
          accredited: 10,
          votesCast: 9,
          rejected: 0,
          idempotencyKey: "k2",
        },
      });
      await a.h
        .http()
        .post(`${base}/posts/${p2.id}/decision`)
        .set(a.auth("editor"))
        .send({ decision: "SEND_TO_MODERATION" })
        .expect(200);
      expect(
        await a.prisma.moderationItem.count({
          where: { targetType: "RESULT_POST", targetId: p2.id },
        }),
      ).toBe(1);
      await a.h
        .http()
        .post(`${base}/posts/0190a000-0000-7000-8000-000000000abc/decision`)
        .set(a.auth("editor"))
        .send({ decision: "VERIFIED" })
        .expect(404);
    });
  });

  describe("adverts", () => {
    const base = "/api/v1/admin/ads";
    const body = (over: Record<string, unknown> = {}) => ({
      brand: "Mama Nkechi's Kitchen",
      kind: "AUDIO_SLOT",
      headline: "Hear this week's soup of the day",
      linkUrl: "https://example.com/soup",
      ctaLabel: "Visit page",
      states: ["Lagos", "Ogun"],
      startsOn: "2026-12-02",
      endsOn: "2026-12-15",
      frequencyCapPerDay: 3,
      priceKobo: 5000000,
      ...over,
    });
    it("roles, create into the approval queue, validation", async () => {
      await a.h.http().get(base).expect(401);
      for (const n of ["poster", "mod", "editor"])
        await a.h.http().get(base).set(a.auth(n)).expect(403);
      const bad = await a.h
        .http()
        .post(base)
        .set(a.auth("adman"))
        .send(body({ kind: "NOPE" }))
        .expect(422);
      expect(bad.body.error.code).toBe("VALIDATION_FAILED");
      for (const o of [
        { linkUrl: "javascript:alert(1)" },
        { endsOn: "2026-12-01" },
        { startsOn: "2026-02-30" },
        { priceKobo: 2_000_000_001 },
        { frequencyCapPerDay: 0 },
        { categoryIds: ["0190a000-0000-7000-8000-000000000abc"] },
        { imageFileId: "0190a000-0000-7000-8000-000000000abc" },
      ])
        await a.h
          .http()
          .post(base)
          .set(a.auth("adman"))
          .send(body(o))
          .expect(422);
      const r = await a.h
        .http()
        .post(base)
        .set(a.auth("adman"))
        .send(body({ categoryIds: [a.cats[0]] }))
        .expect(201);
      expect(r.body).toMatchObject({
        status: "AWAITING_APPROVAL",
        live: false,
        brand: "Mama Nkechi's Kitchen",
        categoryIds: [a.cats[0]],
        views: 0,
      });
      expect(r.body.checks.map((c: any) => c.ok)).toEqual([
        true,
        true,
        false,
        true,
      ]);
      expect(
        await a.prisma.auditLog.count({
          where: { action: "ad.create", targetId: r.body.id },
        }),
      ).toBe(1);
      const list = await a.h.http().get(base).set(a.auth("adman")).expect(200);
      expect(list.body.awaitingApproval).toBe(1);
      expect(
        (await a.h.http().get(`${base}?status=LIVE`).set(a.auth("adman")))
          .status,
      ).toBe(422);
    });

    it("decisions: reasons needed, legal moves only, live follows the dates, edit rules", async () => {
      const c = await a.h
        .http()
        .post(base)
        .set(a.auth("adman"))
        .send(
          body({
            kind: "FEED_CARD",
            startsOn: "2020-01-01",
            endsOn: "2099-01-01",
          }),
        )
        .expect(201);
      const id = c.body.id;
      const dec = (d: string, reason?: string, who = "adman") =>
        a.h
          .http()
          .post(`${base}/${id}/decision`)
          .set(a.auth(who))
          .send({ decision: d, reason });
      await dec("REJECT").expect(422);
      await dec("ASK_FOR_CHANGES").expect(422);
      await dec("PAUSE").expect(409);
      await dec("RESUME").expect(409);
      const ask = await dec(
        "ASK_FOR_CHANGES",
        "Remove the line about curing tiredness.",
      ).expect(200);
      expect(ask.body).toMatchObject({
        status: "DRAFT",
        changeRequest: "Remove the line about curing tiredness.",
      });
      await dec("APPROVE").expect(409);
      const edit = await a.h
        .http()
        .patch(`${base}/${id}`)
        .set(a.auth("adman"))
        .send(
          body({
            kind: "FEED_CARD",
            headline: "Soup of the day",
            startsOn: "2020-01-01",
            endsOn: "2099-01-01",
          }),
        )
        .expect(200);
      expect(edit.body).toMatchObject({
        status: "AWAITING_APPROVAL",
        headline: "Soup of the day",
        changeRequest: null,
      });
      const ok = await dec("APPROVE", undefined, "admin").expect(200);
      expect(ok.body).toMatchObject({ status: "APPROVED", live: true });
      expect(
        (await a.prisma.ad.findUniqueOrThrow({ where: { id } })).approvedById,
      ).toBe(a.people.admin.id);
      await a.h
        .http()
        .patch(`${base}/${id}`)
        .set(a.auth("adman"))
        .send(body())
        .expect(409);
      expect((await dec("PAUSE").expect(200)).body).toMatchObject({
        status: "PAUSED",
        live: false,
      });
      expect((await dec("RESUME").expect(200)).body.status).toBe("APPROVED");
      const rej = await dec("REJECT", "Betting.").expect(200);
      expect(rej.body).toMatchObject({
        status: "REJECTED",
        rejectReason: "Betting.",
      });
      await dec("REJECT", "again").expect(409);
      await a.h
        .http()
        .patch(`${base}/${id}`)
        .set(a.auth("adman"))
        .send(body())
        .expect(409);
      await a.h
        .http()
        .patch(`${base}/0190a000-0000-7000-8000-000000000abc`)
        .set(a.auth("adman"))
        .send(body())
        .expect(404);
      await dec("APPROVE", undefined, "mod").expect(403);
      expect(
        await a.prisma.auditLog.count({
          where: { action: "ad.decision", targetId: id },
        }),
      ).toBe(5);
    });

    it("a future-dated approved advert is not live; a health claim fails its check and blocks approval", async () => {
      const bad = await a.h
        .http()
        .post(base)
        .set(a.auth("adman"))
        .send(
          body({
            headline: "Cures tiredness fast",
            startsOn: "2099-01-01",
            endsOn: "2099-02-01",
          }),
        )
        .expect(201);
      expect(bad.body.checks[1].ok).toBe(false);
      await a.h
        .http()
        .post(`${base}/${bad.body.id}/decision`)
        .set(a.auth("adman"))
        .send({ decision: "APPROVE" })
        .expect(422);
      const r = await a.h
        .http()
        .post(base)
        .set(a.auth("adman"))
        .send(
          body({
            // C-M8 (lead ruling WF, 6 Nov): an audio slot with no audio fails its check and cannot be approved.
            kind: "FEED_CARD",
            headline: "Soup of the day",
            startsOn: "2099-01-01",
            endsOn: "2099-02-01",
          }),
        )
        .expect(201);
      await a.h
        .http()
        .post(`${base}/${r.body.id}/decision`)
        .set(a.auth("adman"))
        .send({ decision: "APPROVE" })
        .expect(200);
      const l = await a.h.http().get(base).set(a.auth("adman")).expect(200);
      expect(l.body.items.find((i: any) => i.id === r.body.id).live).toBe(
        false,
      );
    });
  });
});
