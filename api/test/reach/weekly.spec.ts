/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- supertest bodies are untyped JSON */
import { Harness, mkTopic, mkUser, resetDb, startHarness } from "./helpers";

describe("reach: weekly report and archive", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(resetDb);

  const get = (path: string, token?: string) => {
    const r = h.http().get(`/api/v1${path}`);
    return token ? r.set("Authorization", `Bearer ${token}`) : r;
  };

  async function report(
    week: number,
    status: "DRAFT" | "HELD" | "APPROVED" | "PUBLISHED",
    over: Record<string, unknown> = {},
  ) {
    const topic = await mkTopic(h, week);
    return h.prisma.weeklyReport.create({
      data: {
        topicId: topic.id,
        status,
        headline: `What Nigerians said, week ${week}`,
        mood: "Angry about prices, still counting every naira.",
        summary: "A summary, not a consensus.",
        themes: [
          { label: "Prices rise faster than pay", count: 3200, complaints: [] },
        ],
        sentiment: { overall: "angry", emotions: [] },
        pollSummary: { line: "41% A stable naira" },
        emotions: [{ name: "Anger", share: 44, change: 6 }],
        basedOnVoices: 11872,
        basedOnVotes: 9406,
        humanReviewed: true,
        publishedAt:
          status === "PUBLISHED"
            ? new Date(Date.UTC(2026, 10, 16 + week, 17))
            : null,
        publishAt:
          status === "APPROVED"
            ? new Date(Date.now() + 86400_000 * week)
            : null,
        ...over,
      },
    });
  }

  it("is open to guests; a stale token is still 401", async () => {
    await report(1, "PUBLISHED");
    await get("/weekly-reports").expect(200);
    await get("/weekly-reports/latest").expect(200);
    await get("/weekly-reports", "bad.token.here").expect(401);
  });

  it("archive shows only PUBLISHED, newest first, with latest and nextPublishAt", async () => {
    const r1 = await report(1, "PUBLISHED");
    const r2 = await report(2, "PUBLISHED");
    await report(3, "DRAFT");
    await report(4, "HELD");
    const approved = await report(5, "APPROVED");
    const body = (await get("/weekly-reports").expect(200)).body;
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([r2.id, r1.id]);
    expect(body.latest.id).toBe(r2.id);
    expect(body.nextCursor).toBeNull();
    expect(body.nextPublishAt).toBe(approved.publishAt!.toISOString());
    expect(body.items[0]).toEqual({
      id: r2.id,
      weekNumber: 2,
      title: "What Nigerians said, week 2",
      range: "16 to 22 Nov 2026",
      mood: "Angry about prices, still counting every naira.",
      basedOnVoices: 11872,
      basedOnVotes: 9406,
      publishedAt: r2.publishedAt!.toISOString(),
    });
  });

  it("pages the archive by cursor, and latest is only on the first page", async () => {
    const ids: string[] = [];
    for (let w = 1; w <= 3; w++) ids.push((await report(w, "PUBLISHED")).id);
    const p1 = (await get("/weekly-reports?limit=2").expect(200)).body;
    expect(p1.items.map((i: { id: string }) => i.id)).toEqual([ids[2], ids[1]]);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = (
      await get(`/weekly-reports?limit=2&cursor=${p1.nextCursor}`).expect(200)
    ).body;
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual([ids[0]]);
    expect(p2.latest).toBeNull();
    expect(p2.nextCursor).toBeNull();
    await get("/weekly-reports?limit=0").expect(422);
    await get("/weekly-reports?cursor=junk").expect(400);
  });

  it("empty archive: latest null, no next date, and /latest is 200 with a null body", async () => {
    const body = (await get("/weekly-reports").expect(200)).body;
    expect(body).toEqual({
      latest: null,
      items: [],
      nextCursor: null,
      nextPublishAt: null,
    });
    // A-L1 (lead ruling WF, 6 Nov): nothing published yet is an answer, not an error.
    const none = await get("/weekly-reports/latest").expect(200);
    expect(none.text).toBe("null");
    expect(none.headers["content-type"]).toMatch(/json/);
  });

  it("serves the full report: label, emotions, quotes without handles, range across months", async () => {
    const r = await report(3, "PUBLISHED"); // 23 to 29 Nov
    const r4 = await report(4, "PUBLISHED"); // 30 Nov to 6 Dec
    const author = await mkUser(h, { handle: "secret.handle" });
    const topic = await h.prisma.topic.findUniqueOrThrow({
      where: { id: r.topicId },
    });
    const q = await h.prisma.question.create({
      data: { topicId: topic.id, text: "Q?", status: "LIVE" },
    });
    const a = await h.prisma.answer.create({
      data: { questionId: q.id, authorId: author.id, kind: "TEXT", body: "b" },
    });
    await h.prisma.weeklyQuote.create({
      data: {
        reportId: r.id,
        answerId: a.id,
        excerpt: "I buy noodles one by one now.",
        placeLabel: "A voice from Lagos",
        consentAt: new Date(),
      },
    });
    const full = (await get(`/weekly-reports/${r.id}`).expect(200)).body;
    expect(full.label).toBe("AI-assisted and human-reviewed");
    expect(full.range).toBe("23 to 29 Nov 2026");
    expect(full.emotions).toEqual([{ name: "Anger", share: 44, change: 6 }]);
    expect(full.quotes).toEqual([
      {
        excerpt: "I buy noodles one by one now.",
        placeLabel: "A voice from Lagos",
        clipUrl: null,
      },
    ]);
    expect(JSON.stringify(full)).not.toContain("secret.handle");
    expect(Object.keys(full).sort()).toEqual(
      [
        "basedOnVoices",
        "basedOnVotes",
        "emotions",
        "id",
        "label",
        "mood",
        "pollSummary",
        "publishedAt",
        "quotes",
        "range",
        "sentiment",
        "summary",
        "themes",
        "title",
        "topicId",
        "weekNumber",
      ].sort(),
    );
    expect((await get(`/weekly-reports/${r4.id}`).expect(200)).body.range).toBe(
      "30 Nov to 6 Dec 2026",
    );
    expect((await get("/weekly-reports/latest").expect(200)).body.id).toBe(
      r4.id,
    );
  });

  it("404 for a report that is not published, unknown, or not an id", async () => {
    const draft = await report(1, "DRAFT");
    const held = await report(2, "HELD");
    const approved = await report(3, "APPROVED");
    for (const id of [
      draft.id,
      held.id,
      approved.id,
      "3f1b1c34-0000-4000-8000-000000000000",
      "not-a-uuid",
    ])
      expect(
        (await get(`/weekly-reports/${id}`).expect(404)).body.error.code,
      ).toBe("NOT_FOUND");
  });

  it("publishDue publishes approved reports whose time has come and tells people once", async () => {
    const ready = await report(1, "APPROVED", {
      publishAt: new Date(Date.now() - 1000),
    });
    const later = await report(2, "APPROVED", {
      publishAt: new Date(Date.now() + 3600_000),
    });
    const draft = await report(3, "DRAFT");
    const a = await mkUser(h);
    const b = await mkUser(h);
    expect(await h.weekly.publishDue()).toBe(1);
    expect(await h.weekly.publishDue()).toBe(0); // a second run does nothing
    expect(
      (
        await h.prisma.weeklyReport.findUniqueOrThrow({
          where: { id: ready.id },
        })
      ).status,
    ).toBe("PUBLISHED");
    expect(
      (
        await h.prisma.weeklyReport.findUniqueOrThrow({
          where: { id: later.id },
        })
      ).status,
    ).toBe("APPROVED");
    expect(
      (
        await h.prisma.weeklyReport.findUniqueOrThrow({
          where: { id: draft.id },
        })
      ).status,
    ).toBe("DRAFT");
    for (const u of [a, b]) {
      const rows = await h.prisma.notification.findMany({
        where: { userId: u.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "WEEKLY_REPORT",
        targetType: "weekly_report",
        targetId: ready.id,
      });
      expect(rows[0].title).toBe("Week 1 report is out");
    }
    expect((await get("/weekly-reports/latest").expect(200)).body.id).toBe(
      ready.id,
    );
    // two servers running it at once still write one row each
    await h.prisma.weeklyReport.update({
      where: { id: later.id },
      data: { publishAt: new Date(Date.now() - 1) },
    });
    await Promise.all([h.weekly.publishDue(), h.weekly.publishDue()]);
    expect(await h.prisma.notification.count({ where: { userId: a.id } })).toBe(
      2,
    );
  });

  it("finishes an announcement a crash cut short: everyone told exactly once, late joiners not", async () => {
    const a = await mkUser(h);
    const b = await mkUser(h);
    const c = await mkUser(h);
    const r = await report(1, "APPROVED", {
      publishAt: new Date(Date.now() - 1000),
    });
    // The crash: the report flipped to PUBLISHED, and only one person was told before the process died.
    await h.prisma.weeklyReport.update({
      where: { id: r.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    await h.prisma.notification.create({
      data: {
        userId: a.id,
        type: "WEEKLY_REPORT",
        title: "Week 1 report is out",
        groupKey: `weekly:${r.id}`,
      },
    });
    await new Promise((ok) => setTimeout(ok, 20));
    const late = await mkUser(h); // joined after the report went out
    expect(await h.weekly.publishDue()).toBe(0);
    for (const u of [a, b, c])
      expect(
        await h.prisma.notification.count({
          where: { userId: u.id, groupKey: `weekly:${r.id}` },
        }),
      ).toBe(1);
    expect(
      await h.prisma.notification.count({ where: { userId: late.id } }),
    ).toBe(0);
    await h.weekly.publishDue();
    await Promise.all([h.weekly.publishDue(), h.weekly.publishDue()]);
    expect(
      await h.prisma.notification.count({
        where: { groupKey: `weekly:${r.id}` },
      }),
    ).toBe(3);
  });

  it("a crash before anyone was told: the next tick tells everyone", async () => {
    const a = await mkUser(h);
    const b = await mkUser(h);
    const r = await report(2, "PUBLISHED");
    await h.prisma.weeklyReport.update({
      where: { id: r.id },
      data: { publishedAt: new Date(Date.now() + 1000) },
    });
    await h.weekly.publishDue();
    for (const u of [a, b])
      expect(
        await h.prisma.notification.count({ where: { userId: u.id } }),
      ).toBe(1);
  });
});
