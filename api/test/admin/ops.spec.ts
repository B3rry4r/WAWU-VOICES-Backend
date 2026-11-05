/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- tests read untyped JSON bodies */
import { AdminWriteLimitGuard } from "../../src/admin/admin-access";
import { CONFIG_CATALOGUE } from "../../src/admin/config-catalogue";
import { lagosDayStart } from "../../src/admin/support";
import {
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  uuid,
  world,
  type Staff,
  type World,
} from "./harness";

describe("admin: roles, today, weekly reports, config, audit, limits", () => {
  let w: World;
  const T = lagosToday();
  // A flash poll window that always sits inside the Lagos day T, whatever the
  // hour the suite runs at: starts a minute from now (never before the day
  // began), and near the day's end moves earlier so start < end < next midnight.
  function flashWindowInLagosDay(day: string, now = new Date()) {
    const dayStart = lagosDayStart(day).getTime();
    const dayEnd = dayStart + 86_400_000;
    const start = Math.min(
      Math.max(now.getTime() + 60_000, dayStart),
      dayEnd - 3 * 60_000,
    );
    return { startsAt: new Date(start), endsAt: new Date(dayEnd - 60_000) };
  }
  let written = 0; // successful admin writes made through `wr`: each must leave an AuditLog row
  let auditStart = 0;

  const wr: World["api"] = async (method, path, who, body) => {
    const r = await w.api(method, path, who, body);
    if (method !== "get" && r.status < 300 && !path.endsWith("/preview"))
      written++;
    return r;
  };

  beforeAll(async () => {
    w = await world();
    auditStart = Number(
      (await sql<{ n: string }>(`SELECT count(*) AS n FROM "AuditLog"`))[0].n,
    );
  });
  afterAll(() => w.close());

  // ---------------------------------------------------------------- roles on every operation

  type Op = [string, string, ("EDITOR" | "MODERATOR" | "AD_MANAGER")[]];
  const OPS: Op[] = [
    ["get", "/admin/today", ["EDITOR", "MODERATOR", "AD_MANAGER"]],
    ["get", "/admin/topics", ["EDITOR"]],
    ["post", "/admin/topics", ["EDITOR"]],
    ["get", `/admin/topics/${uuid}`, ["EDITOR"]],
    ["patch", `/admin/topics/${uuid}`, ["EDITOR"]],
    ["put", `/admin/topics/${uuid}/summary`, ["EDITOR"]],
    ["post", "/admin/questions", ["EDITOR"]],
    ["patch", `/admin/questions/${uuid}`, ["EDITOR"]],
    ["post", "/admin/polls", ["EDITOR"]],
    ["patch", `/admin/polls/${uuid}`, ["EDITOR"]],
    ["post", "/admin/proposal-groups", ["MODERATOR"]],
    ["get", "/admin/overrides", ["EDITOR"]],
    ["post", "/admin/overrides", ["EDITOR"]],
    ["post", "/admin/overrides/preview", ["EDITOR"]],
    ["post", `/admin/overrides/${uuid}/cancel`, ["EDITOR"]],
    ["get", "/admin/weekly-reports", ["EDITOR"]],
    ["get", `/admin/weekly-reports/${uuid}`, ["EDITOR"]],
    ["patch", `/admin/weekly-reports/${uuid}`, ["EDITOR"]],
    ["post", `/admin/weekly-reports/${uuid}/approve`, ["EDITOR"]],
    ["post", `/admin/weekly-reports/${uuid}/hold`, ["EDITOR"]],
    ["get", "/admin/config", []],
    ["put", "/admin/config/cost.vote_milli", []],
    ["get", "/admin/config/changes", []],
    ["post", `/admin/config/changes/${uuid}/rollback`, []],
    ["get", "/admin/audit", []],
  ];

  it("lists exactly the 25 operations of this task", () => {
    expect(OPS).toHaveLength(25);
  });

  it.each(OPS)(
    "%s %s: 401 with no token, 403 for a person with no role, role gates match the contract",
    async (method, path, allowed) => {
      const call = (who: Staff | null) =>
        w.api(method as never, path, who, method === "get" ? undefined : {});
      const anon = await call(null);
      expect(anon.status).toBe(401);
      const plain = await call(w.plain);
      expect(plain.status).toBe(403);
      expect(plain.body.error.code).toBe("ROLE_REQUIRED");
      const roles: [string, Staff][] = [
        ["EDITOR", w.editor],
        ["MODERATOR", w.moderator],
        ["AD_MANAGER", w.adManager],
      ];
      for (const [name, who] of roles) {
        const r = await call(who);
        if ((allowed as string[]).includes(name))
          expect([401, 403]).not.toContain(r.status);
        else {
          expect(r.status).toBe(403);
          expect(r.body.error.code).toBe("ROLE_REQUIRED");
        }
      }
      const admin = await call(w.admin);
      expect([401, 403]).not.toContain(admin.status);
    },
  );

  it("a suspended editor cannot use the console", async () => {
    await sql(
      `UPDATE "User" SET status = 'SUSPENDED', "suspendedUntil" = now() + interval '1 day' WHERE id = $1`,
      [w.editor.id],
    );
    const r = await w.api("get", "/admin/topics", w.editor);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("ACCOUNT_SUSPENDED");
    await sql(
      `UPDATE "User" SET status = 'ACTIVE', "suspendedUntil" = NULL WHERE id = $1`,
      [w.editor.id],
    );
    expect((await w.api("get", "/admin/topics", w.editor)).status).toBe(200);
  });

  // ---------------------------------------------------------------- today

  describe("today", () => {
    it("is 200 with empty and zero values before any week exists", async () => {
      const r = await w.api("get", "/admin/today", w.editor);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        weekNumber: 0,
        flowState: "NORMAL",
        nextQuestion: null,
        schedule: [],
        stats: {
          voicesToday: 0,
          voicePercent: 0,
          pollVotes: 0,
          shares: 0,
          openReports: 0,
          oldestReportMinutes: null,
        },
        needsAttention: {
          newsTags: 0,
          moderation: 0,
          sensitive: 0,
          resultPosts: 0,
          ads: 0,
          weeklyReports: 0,
        },
      });
      expect(r.body.topic.title).toBe("");
      expect(r.body.todaysQuestion.text).toBe("");
    });

    it("counts what happened today, what waits for the team, and lists the day's schedule", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 1,
        startsOn: plusDays(T, -1),
        status: "LIVE",
        sensitive: true,
        categoryId: w.cats[1],
      });
      const today = wk.qs[1];
      const mkAnswer = (kind: "TEXT" | "VOICE", extra: object = {}) =>
        w.prisma.answer.create({
          data: {
            questionId: today.id,
            authorId: w.plain.id,
            kind,
            body: kind === "TEXT" ? "My view" : null,
            ...extra,
          },
        });
      await mkAnswer("TEXT");
      await mkAnswer("TEXT");
      await mkAnswer("TEXT");
      await mkAnswer("VOICE");
      await mkAnswer("VOICE");
      await mkAnswer("TEXT", {
        createdAt: new Date(Date.now() - 3 * 86_400_000),
      }); // an old one is not today's
      await mkAnswer("TEXT", { status: "REMOVED" });
      const a1 = await mkAnswer("TEXT");
      await w.prisma.reply.create({
        data: {
          answerId: a1.id,
          authorId: w.plain.id,
          stance: "AGREE",
          kind: "TEXT",
          body: "Agreed",
        },
      });
      await sql(`UPDATE "Poll" SET "totalVotes" = 77 WHERE "topicId" = $1`, [
        wk.topic.id,
      ]);
      const link = await w.prisma.shortLink.create({
        data: { code: "abc1234", objectType: "QUESTION", objectId: today.id },
      });
      for (const target of [
        "WHATSAPP",
        "WHATSAPP",
        "WHATSAPP",
        "TELEGRAM",
      ] as const)
        await w.prisma.shareEvent.create({
          data: { linkId: link.id, kind: "intent", target },
        });
      for (let i = 0; i < 5; i++)
        await w.prisma.shareEvent.create({
          data: { linkId: link.id, kind: "link_open" },
        });
      await w.prisma.report.create({
        data: {
          reporterId: w.plain.id,
          targetType: "ANSWER",
          targetId: a1.id,
          reason: "OTHER",
          createdAt: new Date(Date.now() - 3 * 3_600_000 - 5000),
        },
      });
      await w.prisma.report.create({
        data: {
          reporterId: w.editor.id,
          targetType: "ANSWER",
          targetId: a1.id,
          reason: "OTHER",
        },
      });
      await w.prisma.report.create({
        data: {
          reporterId: w.admin.id,
          targetType: "ANSWER",
          targetId: a1.id,
          reason: "OTHER",
          status: "DISMISSED",
        },
      });
      const mi = (
        queue: "REPORTED" | "APPEAL" | "SENSITIVE",
        n: number,
        status: "OPEN" | "RESOLVED" = "OPEN",
      ) =>
        w.prisma.moderationItem.createMany({
          data: Array.from({ length: n }, (_, i) => ({
            targetType: "ANSWER" as const,
            targetId: `${queue}-${status}-${i}`,
            queue,
            status,
          })),
        });
      await mi("REPORTED", 2);
      await mi("APPEAL", 1);
      await mi("SENSITIVE", 4);
      await mi("SENSITIVE", 1, "RESOLVED");
      for (const n of [1, 2]) {
        const a = await w.prisma.answer.create({
          data: {
            questionId: today.id,
            authorId: w.plain.id,
            kind: "TEXT",
            body: `News ${n}`,
            isNews: true,
            newsTag: "UNVERIFIED_NEWS",
            newsReviewStatus: "FLAGGED",
            newsFlagCount: 4,
          },
        });
        if (n === 1)
          await w.prisma.newsVerificationRequest.create({
            data: {
              answerId: a.id,
              requestedById: w.plain.id,
              sourceName: "The Paper",
            },
          });
      }
      await w.prisma.ad.createMany({
        data: [
          {
            brand: "A",
            kind: "FEED_CARD",
            headline: "One",
            status: "AWAITING_APPROVAL",
            createdById: w.admin.id,
          },
          {
            brand: "B",
            kind: "FEED_CARD",
            headline: "Two",
            status: "AWAITING_APPROVAL",
            createdById: w.admin.id,
          },
          {
            brand: "C",
            kind: "FEED_CARD",
            headline: "Three",
            status: "APPROVED",
            createdById: w.admin.id,
          },
        ],
      });
      const th = await w.prisma.resultThread.create({
        data: {
          title: "Election Week",
          heldOn: new Date(`${T}T00:00:00Z`),
          createdById: w.admin.id,
        },
      });
      for (let i = 0; i < 4; i++)
        await w.prisma.resultPost.create({
          data: {
            threadId: th.id,
            authorId: w.plain.id,
            state: "Lagos",
            lga: "Ikeja",
            ward: "1",
            pollingUnit: `PU ${i}`,
            accredited: 100,
            votesCast: 90,
            rejected: 2,
            idempotencyKey: `k${i}`,
            ...(i === 3
              ? {
                  status: "VERIFIED" as const,
                  checkedAt: new Date(),
                  checkedById: w.admin.id,
                }
              : {}),
          },
        });
      const prev = await makeWeek(w.prisma, {
        weekNumber: 0,
        startsOn: plusDays(T, -8),
        status: "CLOSED",
        poll: false,
      });
      await w.prisma.weeklyReport.create({
        data: {
          topicId: prev.topic.id,
          headline: "Week 0",
          summary: "Summary",
          status: "DRAFT",
        },
      });
      await w.prisma.poll.create({
        data: {
          kind: "FLASH",
          title: "Is your bank app working?",
          status: "SCHEDULED",
          ...flashWindowInLagosDay(T),
          options: {
            create: [
              { label: "Yes", sortOrder: 1 },
              { label: "No", sortOrder: 2 },
            ],
          },
        },
      });

      const r = await w.api("get", "/admin/today", w.moderator);
      expect(r.status).toBe(200);
      expect(r.body.date).toBe(T);
      expect(r.body.weekNumber).toBe(1);
      expect(r.body.topic).toMatchObject({
        weekNumber: 1,
        sensitive: true,
        startsOn: plusDays(T, -1),
      });
      expect(r.body.flowState).toBe("NORMAL");
      expect(r.body.todaysQuestion).toMatchObject({
        id: today.id,
        kind: "DAILY",
        sensitive: true,
        category: { id: w.cats[1] },
        hasOpenPoll: false,
      });
      expect(r.body.stats).toMatchObject({
        voicesToday: 9,
        voicePercent: 22,
        pollVotes: 77,
        shares: 4,
        openReports: 2,
      });
      expect(r.body.stats.sharesByTarget).toEqual([
        { target: "WHATSAPP", count: 3 },
        { target: "TELEGRAM", count: 1 },
      ]);
      expect(r.body.stats.oldestReportMinutes).toBeGreaterThanOrEqual(180);
      expect(r.body.stats.oldestReportMinutes).toBeLessThan(185);
      expect(r.body.nextQuestion.id).toBe(wk.qs[2].id);
      expect(r.body.needsAttention).toEqual({
        newsFlagged: 2,
        newsAskingVerified: 1,
        adsAwaiting: 2,
        moderationOpen: 7,
        newsTags: 3,
        resultPosts: 3,
        ads: 2,
        weeklyReports: 1,
        moderation: 3,
        sensitive: 4,
      });
      const titles = (r.body.schedule as any[]).map((s) => s.title);
      expect(
        titles.some((t) => /^Today's question (went|goes) live$/.test(t)),
      ).toBe(true);
      expect(titles).toContain("Flash poll: Is your bank app working?");
      const report = (r.body.schedule as any[]).find((s) =>
        s.title.startsWith("Week 0 report"),
      );
      expect(report.state).toBe("NEEDS_YOU");
      const times = (r.body.schedule as any[]).map((s) =>
        new Date(s.at).getTime(),
      );
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(
        (r.body.schedule as any[]).find((s) => s.title.startsWith("Flash poll"))
          .state,
      ).toBe("SCHEDULED");
    });
  });

  // ---------------------------------------------------------------- weekly report

  describe("weekly report", () => {
    let topicId: string;
    let reportId: string;
    const answers: string[] = [];
    const draft = {
      headline: "What Nigerians said this week",
      mood: "Not fine, but still talking.",
      summary: "Most voices said prices hurt. People are split on what to do.",
      themes: [
        { label: "Prices", count: 400, complaints: ["Rice costs too much"] },
        { label: "Transport", count: 250, complaints: ["Fares keep rising"] },
      ],
      emotions: [{ name: "Worried", share: 41, change: 3 }],
    };

    beforeAll(async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 20,
        startsOn: plusDays(T, -30),
        status: "CLOSED",
      });
      topicId = wk.topic.id;
      await sql(`UPDATE "Poll" SET status = 'CLOSED' WHERE "topicId" = $1`, [
        topicId,
      ]);
      for (let i = 0; i < 3; i++)
        answers.push(
          (
            await w.prisma.answer.create({
              data: {
                questionId: wk.qs[0].id,
                authorId: w.plain.id,
                kind: "TEXT",
                body: `Voice ${i}`,
              },
            })
          ).id,
        );
      const r = await w.prisma.weeklyReport.create({
        data: {
          topicId,
          status: "DRAFT",
          headline: draft.headline,
          mood: draft.mood,
          summary: draft.summary,
          themes: draft.themes,
          emotions: draft.emotions,
          basedOnVoices: 11872,
          basedOnVotes: 9406,
          languagesRead: ["English", "Pidgin"],
          quotes: {
            create: [
              {
                answerId: answers[0],
                excerpt: "Rice is too dear",
                placeLabel: "A voice from Lagos",
                consentAt: new Date(),
              },
            ],
          },
        },
      });
      reportId = r.id;
    });

    it("lists and opens the draft with its checks, quotes and numbers", async () => {
      const r = await w.api(
        "get",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
      );
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        id: reportId,
        topicId,
        weekNumber: 20,
        status: "DRAFT",
        headline: draft.headline,
        basedOnVoices: 11872,
        basedOnVotes: 9406,
        languagesRead: ["English", "Pidgin"],
        publishAt: null,
        cardTitle: null,
        editorNote: null,
      });
      expect(r.body.pollClosedAt).toEqual(expect.any(String));
      expect(r.body.quotes).toEqual([
        {
          answerId: answers[0],
          excerpt: "Rice is too dear",
          placeLabel: "A voice from Lagos",
          consent: true,
        },
      ]);
      expect(r.body.checks).toEqual([
        { text: "No names, handles or phone numbers", ok: true },
        { text: "Groups too small to stay anonymous left out", ok: true },
        {
          text: "Leading view and the main opposing view both shown",
          ok: true,
        },
        { text: "Quotes: 1 of 1 with the speaker's consent", ok: true },
        { text: "Languages read: English, Pidgin", ok: true },
        { text: "No claim that everyone thinks the same", ok: true },
      ]);
      const list = await w.api("get", "/admin/weekly-reports", w.editor);
      expect(list.body.items.map((x: any) => x.id)).toContain(reportId);
      expect(
        (await w.api("get", "/admin/weekly-reports?status=DRAFT", w.editor))
          .body.items.length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        (await w.api("get", "/admin/weekly-reports?status=APPROVED", w.editor))
          .body.items,
      ).toEqual([]);
      expect(
        (await w.api("get", "/admin/weekly-reports?status=nope", w.editor))
          .status,
      ).toBe(422);
      expect(
        (await w.api("get", `/admin/weekly-reports/${uuid}`, w.editor)).status,
      ).toBe(404);
    });

    it("the checks warn about a handle, a phone number, a tiny group and an absolute", async () => {
      await sql(
        `UPDATE "WeeklyReport" SET summary = 'Everyone is angry. Call 08031234567 or ask @ada.okafor', themes = $2::jsonb WHERE id = $1`,
        [reportId, JSON.stringify([{ label: "Tiny", count: 3 }])],
      );
      const r = await w.api(
        "get",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
      );
      const ok = Object.fromEntries(
        (r.body.checks as any[]).map((c) => [c.text.split(":")[0], c.ok]),
      );
      expect(ok["No names, handles or phone numbers"]).toBe(false);
      expect(ok["Groups too small to stay anonymous left out"]).toBe(false);
      expect(ok["Leading view and the main opposing view both shown"]).toBe(
        false,
      );
      expect(
        (r.body.checks as any[]).find((c) => c.text.startsWith('"Everyone"'))
          .text,
      ).toBe('"Everyone" in the summary: say "most voices" instead');
      // a quoted person's handle counts as a name too
      await sql(
        `UPDATE "WeeklyReport" SET summary = 'Ask pat.plain about it', themes = $2::jsonb WHERE id = $1`,
        [reportId, JSON.stringify(draft.themes)],
      );
      const names = await w.api(
        "get",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
      );
      expect(names.body.checks[0].ok).toBe(false);
      await sql(`UPDATE "WeeklyReport" SET summary = $2 WHERE id = $1`, [
        reportId,
        draft.summary,
      ]);
    });

    it.each([
      "Ask (@someone.else) about it",
      "Call 080-3123-4567 now",
      "Call 0803 123 4567 now",
      "Call (0803) 123.4567 now",
      "Reach +234 803 123 4567",
      "Reach +234-803-123-4567",
      "Mail me, [@ada.okafor]",
    ])("approval is blocked for %s", async (text) => {
      await sql(`UPDATE "WeeklyReport" SET summary = $2 WHERE id = $1`, [
        reportId,
        text,
      ]);
      const r = await w.api(
        "post",
        `/admin/weekly-reports/${reportId}/approve`,
        w.editor,
        {
          publishAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      );
      expect(r.status).toBe(422);
      expect(r.body.error.details.fields[0].path).toBe("summary");
      const g = await w.api(
        "get",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
      );
      expect(g.body.checks[0].ok).toBe(false);
      await sql(`UPDATE "WeeklyReport" SET summary = $2 WHERE id = $1`, [
        reportId,
        "Most voices said prices hurt. People are split on what to do.",
      ]);
    });

    it("an email address, a year and ordinary numbers are not mistaken for personal data", async () => {
      await sql(`UPDATE "WeeklyReport" SET summary = $2 WHERE id = $1`, [
        reportId,
        "In 2026, 11872 voices spoke; 41% said prices hurt (see wawuafrica.com).",
      ]);
      const g = await w.api(
        "get",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
      );
      expect(g.body.checks[0].ok).toBe(true);
      await sql(`UPDATE "WeeklyReport" SET summary = $2 WHERE id = $1`, [
        reportId,
        "Most voices said prices hurt. People are split on what to do.",
      ]);
    });

    it("approval is blocked while the report shows an @handle or a phone number, and nothing changes", async () => {
      await sql(
        `UPDATE "WeeklyReport" SET summary = 'Message @ada.okafor on 08031234567' WHERE id = $1`,
        [reportId],
      );
      const publishAt = new Date(Date.now() + 3_600_000).toISOString();
      const r = await w.api(
        "post",
        `/admin/weekly-reports/${reportId}/approve`,
        w.editor,
        { publishAt },
      );
      expect(r.status).toBe(422);
      expect(r.body.error.details.fields[0].path).toBe("summary");
      expect(
        (
          await sql<{ status: string }>(
            `SELECT status FROM "WeeklyReport" WHERE id = $1`,
            [reportId],
          )
        )[0].status,
      ).toBe("DRAFT");
      const fixed = await wr(
        "patch",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
        { summary: draft.summary, editorNote: "Removed the contact details." },
      );
      expect(fixed.status).toBe(200);
      expect(fixed.body.summary).toBe(draft.summary);
      expect(fixed.body.editorNote).toBe("Removed the contact details.");
    });

    it("editing: quotes need consent and a published post, one quote per voice; themes are checked; emotions and card title save", async () => {
      const q = (i: number, over: object = {}) => ({
        answerId: answers[i],
        excerpt: `Quote ${i} text`,
        placeLabel: "A voice from Abuja",
        consent: true,
        ...over,
      });
      const noConsent = await w.api(
        "patch",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
        { quotes: [q(1, { consent: false })] },
      );
      expect(noConsent.status).toBe(422);
      expect(noConsent.body.error.details.fields[0].path).toBe(
        "quotes.0.consent",
      );
      const dup = await w.api(
        "patch",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
        { quotes: [q(1), q(1)] },
      );
      expect(dup.status).toBe(422);
      const ghost = await w.api(
        "patch",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
        { quotes: [q(1, { answerId: uuid })] },
      );
      expect(ghost.status).toBe(422);
      expect(ghost.body.error.details.fields[0].path).toBe("quotes.0.answerId");
      expect(
        (
          await w.api("patch", `/admin/weekly-reports/${reportId}`, w.editor, {
            themes: [{ label: "x" }],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api("patch", `/admin/weekly-reports/${reportId}`, w.editor, {
            themes: "lots",
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api("patch", `/admin/weekly-reports/${reportId}`, w.editor, {
            emotions: [{ name: "Angry", share: 140, change: 0 }],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api("patch", `/admin/weekly-reports/${reportId}`, w.editor, {
            unknown: 1,
          })
        ).status,
      ).toBe(422);
      expect(
        await sql(`SELECT 1 FROM "WeeklyQuote" WHERE "reportId" = $1`, [
          reportId,
        ]),
      ).toHaveLength(1);

      const before = (
        await sql<{ consentAt: Date }>(
          `SELECT "consentAt" FROM "WeeklyQuote" WHERE "reportId" = $1 AND "answerId" = $2`,
          [reportId, answers[0]],
        )
      )[0].consentAt;
      const ok = await wr(
        "patch",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
        {
          quotes: [q(0, { excerpt: "Rice is too dear" }), q(1)],
          cardTitle: "What Nigerians said",
          emotions: [{ name: "Worried", share: 44.5, change: -2 }],
          themes: draft.themes,
          mood: "Tired but talking.",
        },
      );
      expect(ok.status).toBe(200);
      expect(ok.body.quotes.map((x: any) => x.answerId)).toEqual([
        answers[0],
        answers[1],
      ]);
      expect(ok.body).toMatchObject({
        cardTitle: "What Nigerians said",
        mood: "Tired but talking.",
        emotions: [{ name: "Worried", share: 44.5, change: -2 }],
      });
      // an existing quote keeps its original consent time
      expect(
        (
          await sql<{ consentAt: Date }>(
            `SELECT "consentAt" FROM "WeeklyQuote" WHERE "reportId" = $1 AND "answerId" = $2`,
            [reportId, answers[0]],
          )
        )[0].consentAt,
      ).toEqual(before);
      const a = await sql<{ before: any; after: any }>(
        `SELECT before, after FROM "AuditLog" WHERE action = 'weekly.edit' AND "targetId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [reportId],
      );
      expect(a[0].before.mood).toBe("Not fine, but still talking.");
      expect(a[0].after.mood).toBe("Tired but talking.");
    });

    it("a quote whose post was removed blocks approval", async () => {
      await sql(`UPDATE "Answer" SET status = 'REMOVED' WHERE id = $1`, [
        answers[1],
      ]);
      const r = await w.api(
        "post",
        `/admin/weekly-reports/${reportId}/approve`,
        w.editor,
        { publishAt: new Date(Date.now() + 3_600_000).toISOString() },
      );
      expect(r.status).toBe(422);
      expect(r.body.error.details.fields[0].path).toBe("quotes");
      const gets = await w.api(
        "get",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
      );
      expect(
        gets.body.checks.find((c: any) => c.text.startsWith("Quotes")).text,
      ).toBe("Quotes: 1 of 2 with the speaker's consent");
      expect(
        gets.body.checks.find((c: any) => c.text.startsWith("Quotes")).ok,
      ).toBe(false);
      await sql(`UPDATE "Answer" SET status = 'PUBLISHED' WHERE id = $1`, [
        answers[1],
      ]);
    });

    it("approve: publish time in the past is 422; a good approval sets APPROVED, who, when and the time, and hands publishing to the weekly job", async () => {
      expect(
        (
          await w.api(
            "post",
            `/admin/weekly-reports/${reportId}/approve`,
            w.editor,
            { publishAt: new Date(Date.now() - 3_600_000).toISOString() },
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await w.api(
            "post",
            `/admin/weekly-reports/${reportId}/approve`,
            w.editor,
            {},
          )
        ).status,
      ).toBe(422);
      const publishAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
      const r = await wr(
        "post",
        `/admin/weekly-reports/${reportId}/approve`,
        w.editor,
        { publishAt },
      );
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: "APPROVED", publishAt });
      const row = (
        await sql<{
          status: string;
          approvedById: string;
          approvedAt: Date;
          humanReviewed: boolean;
          publishAt: Date;
          publishedAt: Date | null;
        }>(
          `SELECT status, "approvedById", "approvedAt", "humanReviewed", "publishAt", "publishedAt" FROM "WeeklyReport" WHERE id = $1`,
          [reportId],
        )
      )[0];
      expect(row).toMatchObject({
        status: "APPROVED",
        approvedById: w.editor.id,
        humanReviewed: true,
        publishedAt: null,
      });
      expect(row.publishAt.toISOString()).toBe(publishAt);
      expect(
        (
          await w.api(
            "post",
            `/admin/weekly-reports/${reportId}/approve`,
            w.editor,
            { publishAt },
          )
        ).status,
      ).toBe(409);
      // an approved report cannot be edited until it is held
      const edit = await w.api(
        "patch",
        `/admin/weekly-reports/${reportId}`,
        w.editor,
        { mood: "Changed after approval" },
      );
      expect(edit.status).toBe(409);
      // the reach module's job then publishes it when due: Today lists it
      const today = await w.api("get", "/admin/today", w.editor);
      expect(
        (today.body.schedule as any[]).every(
          (s) => s.title !== "Week 20 report publishes, once approved",
        ),
      ).toBe(true);
    });

    it("hold: needs a reason, stops an approved report, can be approved again; a published report cannot be held or edited", async () => {
      expect(
        (
          await w.api(
            "post",
            `/admin/weekly-reports/${reportId}/hold`,
            w.editor,
            {},
          )
        ).status,
      ).toBe(422);
      const h = await wr(
        "post",
        `/admin/weekly-reports/${reportId}/hold`,
        w.editor,
        { reason: "Waiting for a fact check" },
      );
      expect(h.status).toBe(200);
      expect(h.body.status).toBe("HELD");
      const row = (
        await sql<{
          heldNote: string;
          approvedById: string | null;
          humanReviewed: boolean;
        }>(
          `SELECT "heldNote", "approvedById", "humanReviewed" FROM "WeeklyReport" WHERE id = $1`,
          [reportId],
        )
      )[0];
      expect(row).toEqual({
        heldNote: "Waiting for a fact check",
        approvedById: null,
        humanReviewed: false,
      });
      expect(
        (
          await w.api(
            "post",
            `/admin/weekly-reports/${reportId}/hold`,
            w.editor,
            { reason: "Again please" },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await wr("patch", `/admin/weekly-reports/${reportId}`, w.editor, {
            editorNote: "Fact checked.",
          })
        ).status,
      ).toBe(200);
      const again = await wr(
        "post",
        `/admin/weekly-reports/${reportId}/approve`,
        w.admin,
        { publishAt: new Date(Date.now() + 3_600_000).toISOString() },
      );
      expect(again.status).toBe(200);
      expect(
        (
          await sql<{ heldNote: string | null }>(
            `SELECT "heldNote" FROM "WeeklyReport" WHERE id = $1`,
            [reportId],
          )
        )[0].heldNote,
      ).toBeNull();
      await sql(
        `UPDATE "WeeklyReport" SET status = 'PUBLISHED', "publishedAt" = now() WHERE id = $1`,
        [reportId],
      );
      expect(
        (
          await w.api(
            "post",
            `/admin/weekly-reports/${reportId}/hold`,
            w.editor,
            { reason: "Too late now" },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await w.api(
            "post",
            `/admin/weekly-reports/${reportId}/approve`,
            w.editor,
            { publishAt: new Date(Date.now() + 3_600_000).toISOString() },
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await w.api("patch", `/admin/weekly-reports/${reportId}`, w.editor, {
            mood: "Nope",
          })
        ).status,
      ).toBe(409);
    });

    it("30 parallel approvals approve once; approve racing hold leaves one consistent state and one audit row per success", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 21,
        startsOn: plusDays(T, -40),
        status: "CLOSED",
        poll: false,
      });
      const rep = await w.prisma.weeklyReport.create({
        data: {
          topicId: wk.topic.id,
          headline: "Race",
          summary: "Prices hurt most voices.",
          themes: draft.themes,
          languagesRead: ["English"],
        },
      });
      const publishAt = new Date(Date.now() + 3_600_000).toISOString();
      const many = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          wr(
            "post",
            `/admin/weekly-reports/${rep.id}/approve`,
            i % 2 ? w.editor : w.admin,
            { publishAt },
          ),
        ),
      );
      expect(many.filter((r) => r.status === 200)).toHaveLength(1);
      expect(many.filter((r) => r.status === 409)).toHaveLength(29);
      expect(
        await sql(
          `SELECT 1 FROM "AuditLog" WHERE action = 'weekly.approve' AND "targetId" = $1`,
          [rep.id],
        ),
      ).toHaveLength(1);

      const rep2 = await w.prisma.weeklyReport.create({
        data: {
          topicId: (
            await makeWeek(w.prisma, {
              weekNumber: 22,
              startsOn: plusDays(T, -50),
              status: "CLOSED",
              poll: false,
            })
          ).topic.id,
          headline: "Race two",
          summary: "Prices hurt most voices.",
          themes: draft.themes,
          languagesRead: ["English"],
        },
      });
      const mix = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          i % 2
            ? wr("post", `/admin/weekly-reports/${rep2.id}/approve`, w.editor, {
                publishAt,
              })
            : wr("post", `/admin/weekly-reports/${rep2.id}/hold`, w.admin, {
                reason: "Holding it",
              }),
        ),
      );
      const ok = mix.filter((r) => r.status === 200).length;
      expect(ok).toBeGreaterThanOrEqual(1);
      expect(mix.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      const st = (
        await sql<{ status: string }>(
          `SELECT status FROM "WeeklyReport" WHERE id = $1`,
          [rep2.id],
        )
      )[0].status;
      expect(["APPROVED", "HELD"]).toContain(st);
      expect(
        await sql(
          `SELECT 1 FROM "AuditLog" WHERE action IN ('weekly.approve', 'weekly.hold') AND "targetId" = $1`,
          [rep2.id],
        ),
      ).toHaveLength(ok);
    });
  });

  // ---------------------------------------------------------------- config

  describe("config", () => {
    it("lists every price, cost, allowance and limit with a default row for each (placeholders marked)", async () => {
      const r = await w.api("get", "/admin/config", w.admin);
      expect(r.status).toBe(200);
      const items = r.body.items as {
        key: string;
        value: unknown;
        placeholder: boolean;
        version: number;
        updatedBy: string | null;
        description: string;
      }[];
      expect(items.map((i) => i.key)).toEqual(
        CONFIG_CATALOGUE.map((c) => c.key).sort(),
      );
      const get = (k: string) => items.find((i) => i.key === k)!;
      expect(get("cost.vote_milli")).toMatchObject({
        value: 200,
        placeholder: true,
        version: 1,
        updatedBy: null,
      });
      expect(get("units.min_purchase_kobo").value).toBe(13800);
      expect(get("ads.price.flat_per_day_kobo").value).toBeNull();
      expect(get("units.tiers").value).toHaveLength(6);
      expect(get("cost.vote_milli").description).toEqual(expect.any(String));
      // the rows are real: other modules read them from the table
      const row = (
        await sql<{ valueJson: number }>(
          `SELECT "valueJson" FROM "ConfigEntry" WHERE key = 'cost.vote_milli'`,
        )
      )[0];
      expect(row.valueJson).toBe(200);
      expect(items.find((i) => i.value === undefined)).toBeUndefined();
      expect(get("payment.reconcile_window_hours").value).toBe(72);
      expect(get("voice.token_reserve_expiry_minutes").value).toBe(60);
    });

    it("changes a value at once with a reason: the row, the change log and the audit log agree; the owner confirming clears the placeholder flag", async () => {
      const r = await wr("put", "/admin/config/cost.vote_milli", w.admin, {
        value: 300,
        reason: "Raise vote price for the election",
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        key: "cost.vote_milli",
        value: 300,
        version: 2,
        updatedBy: "ada.admin",
        placeholder: false,
      });
      const row = (
        await sql<{ valueJson: number; version: number; updatedById: string }>(
          `SELECT "valueJson", version, "updatedById" FROM "ConfigEntry" WHERE key = 'cost.vote_milli'`,
        )
      )[0];
      expect(row).toEqual({
        valueJson: 300,
        version: 2,
        updatedById: w.admin.id,
      });
      const ch = await w.api(
        "get",
        "/admin/config/changes?key=cost.vote_milli",
        w.admin,
      );
      expect(ch.body.items).toHaveLength(1);
      expect(ch.body.items[0]).toMatchObject({
        key: "cost.vote_milli",
        oldValue: 200,
        newValue: 300,
        reason: "Raise vote price for the election",
        by: "ada.admin",
        rollbackOfId: null,
      });
      const a = await sql<{ reason: string; before: any; after: any }>(
        `SELECT reason, before, after FROM "AuditLog" WHERE action = 'config.update' AND "targetId" = 'cost.vote_milli'`,
      );
      expect(a).toHaveLength(1);
      expect(a[0].before.value).toBe(200);
      expect(a[0].after.value).toBe(300);
      const list = await w.api("get", "/admin/config", w.admin);
      expect(
        list.body.items.find((i: any) => i.key === "cost.vote_milli").value,
      ).toBe(300);
    });

    it("checks the key and the value: unknown 404, wrong kind or range 422, fixed keys 422, reason required; nothing is logged", async () => {
      const n = (await sql(`SELECT 1 FROM "ConfigChange"`)).length;
      const put = (
        key: string,
        value: unknown,
        reason: string | null = "Testing a change",
      ) =>
        w.api(
          "put",
          `/admin/config/${key}`,
          w.admin,
          reason === null ? { value } : { value, reason },
        );
      expect((await put("not.a.key", 1)).status).toBe(404);
      expect(
        (
          await w.api("put", "/admin/config/BAD KEY", w.admin, {
            value: 1,
            reason: "Testing it",
          })
        ).status,
      ).toBe(404);
      expect((await put("cost.vote_milli", -1)).status).toBe(422);
      expect((await put("cost.vote_milli", 1.5)).status).toBe(422);
      expect((await put("cost.vote_milli", "200")).status).toBe(422);
      expect((await put("cost.vote_milli", 2_000_000_001)).status).toBe(422);
      expect((await put("cost.vote_milli", null)).status).toBe(422);
      expect((await put("poll.show_live_results", "yes")).status).toBe(422);
      expect((await put("payment.provider", "paystack")).status).toBe(422);
      expect((await put("ads.blocked_categories", [1, 2])).status).toBe(422);
      expect((await put("units.cashable", true)).status).toBe(422);
      expect((await put("cost.result_post_milli", 100)).status).toBe(422);
      expect((await put("cost.reaction_remove_milli", 1)).status).toBe(422);
      expect(
        (
          await put("units.tiers", [
            {
              slug: "x",
              name: "X",
              priceKobo: 0,
              unitsMilli: 1,
              bonusMilli: 0,
            },
          ])
        ).status,
      ).toBe(422);
      expect((await put("ratelimit.events_mode_factor", 2)).status).toBe(422);
      expect((await put("cost.vote_milli", 100, null)).status).toBe(422);
      expect((await put("cost.vote_milli", 100, "no")).status).toBe(422);
      const none = await w.api(
        "put",
        "/admin/config/cost.vote_milli",
        w.admin,
        { reason: "No value at all" },
      );
      expect(none.status).toBe(422);
      expect((await sql(`SELECT 1 FROM "ConfigChange"`)).length).toBe(n);
      expect(
        (
          await sql<{ valueJson: number }>(
            `SELECT "valueJson" FROM "ConfigEntry" WHERE key = 'cost.vote_milli'`,
          )
        )[0].valueJson,
      ).toBe(300);
    });

    it("accepts the other kinds: bool, list, null price, tiers; a repeat of the same value changes nothing", async () => {
      expect(
        (
          await wr("put", "/admin/config/poll.show_live_results", w.admin, {
            value: false,
            reason: "Hide live results",
          })
        ).body.value,
      ).toBe(false);
      expect(
        (
          await wr("put", "/admin/config/ads.blocked_categories", w.admin, {
            value: ["betting", "alcohol"],
            reason: "Add alcohol",
          })
        ).body.value,
      ).toEqual(["betting", "alcohol"]);
      expect(
        (
          await wr(
            "put",
            "/admin/config/ads.price.flat_per_day_kobo",
            w.admin,
            { value: 2500000, reason: "Owner gave the price" },
          )
        ).body.value,
      ).toBe(2500000);
      expect(
        (
          await wr(
            "put",
            "/admin/config/ads.price.flat_per_day_kobo",
            w.admin,
            { value: null, reason: "Price withdrawn" },
          )
        ).body.value,
      ).toBeNull();
      const tiers = (
        await w.api("get", "/admin/config", w.admin)
      ).body.items.find((i: any) => i.key === "units.tiers").value as any[];
      tiers[0].priceKobo = 15000;
      expect(
        (
          await wr("put", "/admin/config/units.tiers", w.admin, {
            value: tiers,
            reason: "Spark is now 150 naira",
          })
        ).body.value[0].priceKobo,
      ).toBe(15000);
      const before = (await sql(`SELECT 1 FROM "ConfigChange"`)).length;
      const same = await w.api(
        "put",
        "/admin/config/poll.show_live_results",
        w.admin,
        { value: false, reason: "Same again" },
      );
      expect(same.status).toBe(200);
      expect(same.body.version).toBe(2);
      expect((await sql(`SELECT 1 FROM "ConfigChange"`)).length).toBe(before);
    });

    it("rolls a change back with a reason: the old value returns as a new logged change; a second rollback, or one after a later change, is 409", async () => {
      const k = "cost.proposal_milli";
      await wr("put", `/admin/config/${k}`, w.admin, {
        value: 50,
        reason: "First change",
      });
      await wr("put", `/admin/config/${k}`, w.admin, {
        value: 80,
        reason: "Second change",
      });
      const changes = (
        await w.api("get", `/admin/config/changes?key=${k}`, w.admin)
      ).body.items as any[];
      expect(changes).toHaveLength(2);
      const first = changes.find((c) => c.newValue === 50);
      const second = changes.find((c) => c.newValue === 80);
      const stale = await w.api(
        "post",
        `/admin/config/changes/${first.id}/rollback`,
        w.admin,
        { reason: "Undo the first" },
      );
      expect(stale.status).toBe(409);
      expect(
        (
          await w.api(
            "post",
            `/admin/config/changes/${second.id}/rollback`,
            w.admin,
            {},
          )
        ).status,
      ).toBe(422);
      const ok = await wr(
        "post",
        `/admin/config/changes/${second.id}/rollback`,
        w.admin2,
        { reason: "Eighty was a typo" },
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        key: k,
        value: 50,
        version: 4,
        updatedBy: "bola.admin",
      });
      const log = (
        await w.api("get", `/admin/config/changes?key=${k}`, w.admin)
      ).body.items as any[];
      expect(log).toHaveLength(3);
      expect(log[0]).toMatchObject({
        oldValue: 80,
        newValue: 50,
        rollbackOfId: second.id,
        by: "bola.admin",
        reason: "Eighty was a typo",
      });
      expect(
        (
          await w.api(
            "post",
            `/admin/config/changes/${second.id}/rollback`,
            w.admin,
            { reason: "Twice" },
          )
        ).status,
      ).toBe(409);
      // the first change can now be rolled back (the value is back at its new value)
      const undoFirst = await wr(
        "post",
        `/admin/config/changes/${first.id}/rollback`,
        w.admin,
        { reason: "Undo the first too" },
      );
      expect(undoFirst.status).toBe(200);
      expect(undoFirst.body.value).toBe(0);
      expect(
        (
          await sql<{ valueJson: number }>(
            `SELECT "valueJson" FROM "ConfigEntry" WHERE key = $1`,
            [k],
          )
        )[0].valueJson,
      ).toBe(0);
      expect(
        (
          await w.api(
            "post",
            `/admin/config/changes/${uuid}/rollback`,
            w.admin,
            { reason: "Nobody" },
          )
        ).status,
      ).toBe(404);
      const a = await sql(
        `SELECT 1 FROM "AuditLog" WHERE action = 'config.rollback' AND "targetId" = $1`,
        [k],
      );
      expect(a).toHaveLength(2);
    });

    it("the change log pages newest first and filters by key", async () => {
      const all = await w.api("get", "/admin/config/changes?limit=2", w.admin);
      expect(all.body.items).toHaveLength(2);
      expect(all.body.nextCursor).toEqual(expect.any(String));
      const next = await w.api(
        "get",
        `/admin/config/changes?limit=2&cursor=${all.body.nextCursor}`,
        w.admin,
      );
      expect(next.body.items[0].id).not.toBe(all.body.items[0].id);
      expect(
        new Date(all.body.items[1].createdAt).getTime(),
      ).toBeGreaterThanOrEqual(
        new Date(next.body.items[0].createdAt).getTime(),
      );
      expect(
        (await w.api("get", "/admin/config/changes?key=nothing.here", w.admin))
          .body.items,
      ).toEqual([]);
    });

    it("30 parallel changes to one key all land, one after another: versions and the change chain stay whole", async () => {
      const k = "cost.explain_milli";
      const start = (
        await sql<{ version: number; valueJson: number }>(
          `SELECT version, "valueJson" FROM "ConfigEntry" WHERE key = $1`,
          [k],
        )
      )[0];
      const values = Array.from({ length: 30 }, (_, i) => 1000 + i);
      const res = await Promise.all(
        values.map((v, i) =>
          wr("put", `/admin/config/${k}`, i % 2 ? w.admin : w.admin2, {
            value: v,
            reason: `Parallel ${v}`,
          }),
        ),
      );
      expect(res.every((r) => r.status === 200)).toBe(true);
      const row = (
        await sql<{ version: number; valueJson: number }>(
          `SELECT version, "valueJson" FROM "ConfigEntry" WHERE key = $1`,
          [k],
        )
      )[0];
      expect(row.version).toBe(start.version + 30);
      const ch = await sql<{ oldValue: number; newValue: number }>(
        `SELECT "oldValue", "newValue" FROM "ConfigChange" WHERE key = $1 ORDER BY "createdAt", id`,
        [k],
      );
      const next = new Map(ch.map((c) => [c.oldValue, c.newValue]));
      expect(next.size).toBe(30); // no two changes started from the same value
      let cur = start.valueJson;
      for (let i = 0; i < 30; i++) {
        expect(next.has(cur)).toBe(true);
        cur = next.get(cur) as number;
      }
      expect(cur).toBe(row.valueJson);
    });

    it("30 parallel rollbacks of one change roll it back once", async () => {
      const k = "cost.boost_milli";
      await wr("put", `/admin/config/${k}`, w.admin, {
        value: 6000,
        reason: "Raise boost",
      });
      const id = (await w.api("get", `/admin/config/changes?key=${k}`, w.admin))
        .body.items[0].id;
      const res = await Promise.all(
        Array.from({ length: 30 }, () =>
          wr("post", `/admin/config/changes/${id}/rollback`, w.admin2, {
            reason: "Undo it",
          }),
        ),
      );
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      expect(res.filter((r) => r.status === 409)).toHaveLength(29);
      expect(
        (
          await sql<{ valueJson: number }>(
            `SELECT "valueJson" FROM "ConfigEntry" WHERE key = $1`,
            [k],
          )
        )[0].valueJson,
      ).toBe(5000);
    });
  });

  // ---------------------------------------------------------------- audit

  describe("audit log", () => {
    it("is admin only, newest first, with who, what, before and after; filters and pages", async () => {
      expect(
        (await w.api("get", "/admin/audit", w.editor)).body.error.code,
      ).toBe("ROLE_REQUIRED");
      const r = await w.api("get", "/admin/audit?limit=5", w.admin);
      expect(r.status).toBe(200);
      expect(r.body.items).toHaveLength(5);
      const at = (r.body.items as any[]).map((i) => new Date(i.at).getTime());
      expect([...at].sort((a, b) => b - a)).toEqual(at);
      expect(r.body.items[0]).toEqual({
        id: expect.any(String),
        at: expect.any(String),
        actor: expect.any(String),
        action: expect.any(String),
        targetType: expect.any(String),
        targetId: expect.anything(),
        reason: expect.anything(),
        before: expect.anything(),
        after: expect.anything(),
      });
      const cfg = await w.api(
        "get",
        "/admin/audit?action=config.update&targetType=ConfigEntry&targetId=cost.vote_milli",
        w.admin,
      );
      expect(cfg.body.items).toHaveLength(1);
      expect(cfg.body.items[0]).toMatchObject({
        actor: "ada.admin",
        reason: "Raise vote price for the election",
        before: { value: 200 },
        after: { value: 300 },
      });
      const p1 = await w.api("get", "/admin/audit?limit=3", w.admin);
      const p2 = await w.api(
        "get",
        `/admin/audit?limit=3&cursor=${p1.body.nextCursor}`,
        w.admin,
      );
      const ids1 = new Set((p1.body.items as any[]).map((i) => i.id));
      expect((p2.body.items as any[]).some((i) => ids1.has(i.id))).toBe(false);
      expect(
        (await w.api("get", "/admin/audit?action=nothing.like.this", w.admin))
          .body.items,
      ).toEqual([]);
      expect(
        (await w.api("get", "/admin/audit?action=a&action=b", w.admin)).status,
      ).toBe(422);
    });

    it("every successful admin write made by these tests left exactly one audit row", async () => {
      const n = Number(
        (await sql<{ n: string }>(`SELECT count(*) AS n FROM "AuditLog"`))[0].n,
      );
      expect(written).toBeGreaterThan(30);
      // the 30 racing writers each wrote one row too; refused or repeated writes wrote none
      expect(n - auditStart).toBe(written);
    });

    it("the audit log is append-only: an UPDATE or DELETE is refused by the database", async () => {
      await expect(
        sql(`UPDATE "AuditLog" SET reason = 'edited'`),
      ).rejects.toThrow();
      await expect(sql(`DELETE FROM "AuditLog"`)).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------- limits

  describe("admin write limit", () => {
    it("answers 429 RATE_LIMITED with Retry-After and the limit headers after the configured writes per minute, per account", async () => {
      const guard = w.h.moduleRef.get(AdminWriteLimitGuard, { strict: false });
      await sql(
        `UPDATE "ConfigEntry" SET "valueJson" = '5'::jsonb WHERE key = 'ratelimit.admin_write_per_min'`,
      );
      guard.resetCache();
      guard.resetWindows();
      const first = await w.api("post", "/admin/questions", w.editor, {
        kind: "FLASH",
        text: "Flash question 1",
      });
      expect(first.status).toBe(201);
      expect(first.headers["ratelimit-limit"]).toBe("5");
      expect(first.headers["ratelimit-remaining"]).toBe("4");
      const rest = [];
      for (let i = 2; i <= 6; i++)
        rest.push(
          await w.api("post", "/admin/questions", w.editor, {
            kind: "FLASH",
            text: `Flash question ${i}`,
          }),
        );
      expect(rest.slice(0, 4).every((r) => r.status === 201)).toBe(true);
      const blocked = rest[4];
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("RATE_LIMITED");
      expect(blocked.body.error.requestId).toEqual(expect.any(String));
      expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
      expect(blocked.headers["ratelimit-remaining"]).toBe("0");
      expect(
        await sql(
          `SELECT 1 FROM "Question" WHERE text LIKE 'Flash question %'`,
        ),
      ).toHaveLength(5);
      // another person has their own window; reads are not limited
      expect(
        (
          await w.api("post", "/admin/questions", w.moderator, {
            kind: "FLASH",
            text: "Flash from moderator",
          })
        ).status,
      ).toBe(403);
      expect((await w.api("get", "/admin/topics", w.editor)).status).toBe(200);
      const other = await w.api("post", "/admin/questions", w.admin, {
        kind: "FLASH",
        text: "Flash from the admin",
      });
      expect(other.status).toBe(201);
      await sql(
        `UPDATE "ConfigEntry" SET "valueJson" = '120'::jsonb WHERE key = 'ratelimit.admin_write_per_min'`,
      );
      guard.resetCache();
      guard.resetWindows();
    });
  });
});
