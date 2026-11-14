/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- tests read untyped JSON bodies */
import { randomUUID } from "node:crypto";
import { instagramSvgs } from "../../src/reach/weekly-insta";
import { WeeklyDraftService } from "../../src/reach/weekly-draft";
import {
  SummaryDraftService,
  type SummaryDrafter,
} from "../../src/admin/summary-draft";
import { signUp } from "../me/helpers";
import {
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type World,
} from "./harness";

/** V-FIX-C: the summary draft and screen routes, the grouping lists, weekly emotions and regions, and roles from the page. */
describe("V-FIX-C", () => {
  let w: World;
  const T = lagosToday();
  const people: { id: string }[] = [];
  const mk = async (n: number, state: string | null = null) => {
    const { me } = await signUp(
      w.h,
      `fixc-${n}-${randomUUID()}`,
      `fixc.user${n}`,
      w.cats,
    );
    if (state)
      await sql(`UPDATE "User" SET state = $1 WHERE id = $2`, [state, me.id]);
    return { id: me.id as string };
  };

  beforeAll(async () => {
    w = await world();
    for (let i = 0; i < 6; i++)
      people.push(await mk(i, i < 4 ? "Lagos" : i === 4 ? "Kano" : null));
  });
  afterAll(() => w.close());

  describe("topic summary: draft and screen routes", () => {
    let topicId: string;
    let questionId: string;
    beforeAll(async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 810,
        startsOn: plusDays(T, 700),
        status: "DRAFT",
        poll: true,
        categoryId: w.cats[0],
      });
      topicId = wk.topic.id;
      const q = await w.prisma.question.findFirstOrThrow({
        where: { topicId, slotIndex: 1 },
      });
      questionId = q.id;
      await sql(
        `UPDATE "Question" SET "answerCount" = 40, status = 'LIVE', "startsAt" = now() - interval '1 day', "endsAt" = now() + interval '5 days' WHERE id = $1`,
        [questionId],
      );
      const poll = await w.prisma.poll.findFirstOrThrow({
        where: { topicId, kind: "WEEKLY" },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });
      await sql(`UPDATE "PollOption" SET "voteCount" = $1 WHERE id = $2`, [
        60,
        poll.options[0].id,
      ]);
      await sql(`UPDATE "PollOption" SET "voteCount" = $1 WHERE id = $2`, [
        25,
        poll.options[1].id,
      ]);
      await sql(`UPDATE "Poll" SET "totalVotes" = 100 WHERE id = $1`, [
        poll.id,
      ]);
      // two published answers with reactions, one with a handle and a phone number in it
      const a1 = await w.prisma.answer.create({
        data: {
          questionId,
          authorId: people[0].id,
          kind: "TEXT",
          body: "Salary is gone in a day. Call 0803 123 4567 or @fixc.user0",
          mood: "ANGRY",
          reactionCount: 9,
        },
      });
      await w.prisma.answer.create({
        data: {
          questionId,
          authorId: people[1].id,
          kind: "TEXT",
          body: "I save first, then spend.",
          mood: "HOPEFUL",
          reactionCount: 3,
        },
      });
      await w.prisma.answer.create({
        data: {
          questionId,
          authorId: people[2].id,
          kind: "TEXT",
          body: "Nobody reacted to this",
          mood: "ANGRY",
          reactionCount: 0,
        },
      });
      expect(a1.id).toBeTruthy();
      // proposals
      await w.prisma.proposal.create({
        data: {
          questionId,
          authorId: people[0].id,
          body: "Put the pay date in every offer letter",
          supportCount: 7,
        },
      });
    });

    it("GET saved summary: none yet, AI off without a key", async () => {
      const r = await w.api(
        "get",
        `/admin/topics/${topicId}/summary`,
        w.editor,
      );
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ aiAvailable: false, summary: null });
    });

    it("the data draft needs no AI: positions from the poll, counted lines, moods, categories, most-reacted quotes without handles or phones", async () => {
      const r = await w.api(
        "post",
        `/admin/topics/${topicId}/summary/draft`,
        w.editor,
        {},
      );
      expect(r.status).toBe(200);
      expect(r.body.source).toBe("DATA");
      expect(r.body.aiAvailable).toBe(false);
      expect(r.body.draft.mainViewVoices).toBe(60);
      expect(r.body.draft.opposingViewVoices).toBe(25);
      expect(r.body.draft.mainView.length).toBeGreaterThan(2);
      expect(r.body.draft.pollLine).toMatch(/leads with 60% of 100 votes/);
      expect(r.body.draft.nextStepsLine).toMatch(
        /1 proposal in 0 groups\. Most supported so far: Put the pay date/,
      );
      expect(r.body.basedOnVoices).toBe(40);
      expect(r.body.basedOnVotes).toBe(100);
      expect(r.body.moods).toEqual([
        { mood: "ANGRY", count: 2, percent: 67 },
        { mood: "HOPEFUL", count: 1, percent: 33 },
      ]);
      expect(r.body.categories).toEqual([
        { name: expect.any(String), voices: 40 },
      ]);
      expect(
        r.body.quotes.map((q: { reactions: number }) => q.reactions),
      ).toEqual([9, 3]);
      const text = JSON.stringify(r.body.quotes);
      expect(text).not.toMatch(/0803|@fixc/);
      expect(text).not.toMatch(/—/);
    });

    it("asking for the AI with no key still answers with the data draft and says AI is off", async () => {
      const r = await w.api(
        "post",
        `/admin/topics/${topicId}/summary/draft`,
        w.editor,
        { ai: true },
      );
      expect(r.status).toBe(200);
      expect(r.body.source).toBe("DATA");
      expect(r.body.aiNote).toMatch(/AI drafting is off/);
    });

    it("with a drafter set: AI words, counts from the cited voices, never an 'everyone agrees' line", async () => {
      const calls: number[] = [];
      const fake: SummaryDrafter = {
        draft: (input) => {
          calls.push(input.voices.length);
          return Promise.resolve({
            mainView: "paying people on the day promised",
            mainVoices: [1, 2, 2, 99],
            opposingView: "saving first",
            opposingVoices: [3],
          });
        },
      };
      const svc = new SummaryDraftService(w.prisma, fake);
      expect(svc.aiAvailable()).toBe(true);
      const out = (await svc.draft(topicId, true)) as any;
      expect(out.source).toBe("AI");
      expect(out.draft.mainView).toBe("paying people on the day promised");
      // 2 distinct valid voices of 3 read, scaled to the 40 who spoke: 27, never above 40
      expect(out.draft.mainViewVoices).toBe(27);
      expect(out.draft.opposingViewVoices).toBe(13);
      expect(calls).toEqual([3]);
      // data lines stay the counted ones
      expect(out.draft.pollLine).toMatch(/60%/);
      const bad = new SummaryDraftService(w.prisma, {
        draft: () =>
          Promise.resolve({
            mainView: "Everyone agrees on this",
            mainVoices: [1],
            opposingView: "",
            opposingVoices: [],
          }),
      });
      const o2 = (await bad.draft(topicId, true)) as any;
      expect(o2.source).toBe("DATA");
      expect(o2.aiNote).toMatch(/not usable/);
      const boom = new SummaryDraftService(w.prisma, {
        draft: () => Promise.reject(new Error("quota")),
      });
      const o3 = (await boom.draft(topicId, true)) as any;
      expect(o3.source).toBe("DATA");
      expect(o3.aiNote).toMatch(/did not work/);
    });

    it("an editor saves and approves it (aiDrafted kept); the saved row comes back; what next shows only the approved one", async () => {
      const body = {
        mainView: "paying on time",
        mainViewVoices: 60,
        opposingView: "saving first",
        opposingViewVoices: 25,
        pollLine: "The poll is split.",
        nextStepsLine: "One proposal so far.",
        approve: false,
        aiDrafted: true,
      };
      const s = await w.api(
        "put",
        `/admin/topics/${topicId}/summary`,
        w.editor,
        body,
      );
      expect(s.status).toBe(200);
      const g = await w.api(
        "get",
        `/admin/topics/${topicId}/summary`,
        w.editor,
      );
      expect(g.body.summary).toMatchObject({
        mainView: "paying on time",
        reviewedByEditor: false,
        aiDrafted: true,
        basedOnVoices: 40,
        basedOnVotes: 100,
      });
      const wn1 = await w.api(
        "get",
        `/questions/${questionId}/what-next`,
        w.plain,
      );
      expect(wn1.body.summary).toBeNull();
      await w.api("put", `/admin/topics/${topicId}/summary`, w.editor, {
        ...body,
        approve: true,
      });
      const wn2 = await w.api(
        "get",
        `/questions/${questionId}/what-next`,
        w.plain,
      );
      expect(wn2.body.summary).toMatchObject({
        mainView: "paying on time",
        opposingView: "saving first",
        basedOnVoices: 40,
        reviewedByEditor: true,
      });
    });

    it("the share subject now carries the argument chips and Based on N voices", async () => {
      const link = await w.api("post", "/share/links", w.plain, {
        objectType: "QUESTION",
        objectId: questionId,
      });
      expect([200, 201]).toContain(link.status);
      const code = link.body.code as string;
      const sub = await w.api("get", `/share/${code}`, null);
      expect(sub.status).toBe(200);
      const arg = JSON.stringify(sub.body);
      expect(arg).toMatch(/paying on time/);
      expect(arg).toMatch(/saving first/);
    });

    it("only an editor or admin: a moderator, an ad manager, a plain person and a guest are refused", async () => {
      for (const who of [w.moderator, w.adManager, w.plain, null]) {
        const a = await w.api("get", `/admin/topics/${topicId}/summary`, who);
        const b = await w.api(
          "post",
          `/admin/topics/${topicId}/summary/draft`,
          who,
          {},
        );
        expect([401, 403]).toContain(a.status);
        expect([401, 403]).toContain(b.status);
      }
      expect(
        (
          await w.api(
            "post",
            `/admin/topics/${randomUUID()}/summary/draft`,
            w.editor,
            {},
          )
        ).status,
      ).toBe(404);
    });
  });

  describe("grouping ideas: lists, suggestions, confirm", () => {
    let questionId: string;
    const ids: string[] = [];
    beforeAll(async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 811,
        startsOn: plusDays(T, 720),
        status: "DRAFT",
      });
      const q = await w.prisma.question.findFirstOrThrow({
        where: { topicId: wk.topic.id, slotIndex: 1 },
      });
      questionId = q.id;
      await sql(
        `UPDATE "Question" SET status = 'LIVE', "startsAt" = now() - interval '1 day', "endsAt" = now() + interval '5 days' WHERE id = $1`,
        [questionId],
      );
      const texts = [
        [
          "Put the salary date and a late payment penalty in every offer letter",
          9,
        ],
        ["Salary date in the offer letter with a penalty for late payment", 4],
        [
          "Offer letters should state the salary date and late payment penalty",
          2,
        ],
        ["Build more public libraries", 1],
      ] as const;
      for (const [body, support] of texts) {
        const p = await w.prisma.proposal.create({
          data: {
            questionId,
            authorId: people[0].id,
            body,
            supportCount: support,
          },
        });
        ids.push(p.id);
      }
    });

    it("lists the questions that have proposals, and one question's proposals with automatic suggestions", async () => {
      const qs = await w.api("get", "/admin/proposal-questions", w.moderator);
      expect(qs.status).toBe(200);
      expect(
        qs.body.items.find((x: any) => x.questionId === questionId),
      ).toMatchObject({ proposalCount: 4, groupCount: 0, ungroupedCount: 4 });
      const r = await w.api(
        "get",
        `/admin/proposals?questionId=${questionId}`,
        w.moderator,
      );
      expect(r.status).toBe(200);
      expect(r.body.items).toHaveLength(4);
      expect(r.body.items[0].supportCount).toBe(9);
      expect(r.body.suggestions).toHaveLength(1);
      expect(r.body.suggestions[0].proposalIds.sort()).toEqual(
        ids.slice(0, 3).sort(),
      );
      expect(r.body.groups).toEqual([]);
    });

    it("a moderator confirms the suggestion; the page then lists the group and proposals show it; the audit row is written", async () => {
      const r0 = await w.api(
        "get",
        `/admin/proposals?questionId=${questionId}`,
        w.moderator,
      );
      const sug = r0.body.suggestions[0];
      const c = await w.api("post", "/admin/proposal-groups", w.moderator, {
        title: "Pay date in the offer letter",
        proposalIds: sug.proposalIds,
      });
      expect(c.status).toBe(201);
      expect(c.body).toMatchObject({ confirmed: true, proposalCount: 3 });
      const r = await w.api(
        "get",
        `/admin/proposals?questionId=${questionId}`,
        w.moderator,
      );
      expect(r.body.groups).toEqual([
        {
          id: c.body.id,
          title: "Pay date in the offer letter",
          confirmed: true,
          proposalCount: 3,
        },
      ]);
      expect(r.body.suggestions).toEqual([]);
      expect(
        r.body.items.filter((x: any) => x.groupId === c.body.id),
      ).toHaveLength(3);
      const wn = await w.api(
        "get",
        `/questions/${questionId}/what-next`,
        w.plain,
      );
      expect(wn.body.groupTotal).toBe(1);
      const a = await sql(
        `SELECT 1 FROM "AuditLog" WHERE action = 'proposal_group.confirm' AND "targetId" = $1`,
        [c.body.id],
      );
      expect(a).toHaveLength(1);
    });

    it("moderators and admins only; a bad question id is 422, an unknown one 404", async () => {
      for (const who of [w.editor, w.adManager, w.plain, null]) {
        expect([401, 403]).toContain(
          (await w.api("get", "/admin/proposal-questions", who)).status,
        );
        expect([401, 403]).toContain(
          (await w.api("get", `/admin/proposals?questionId=${questionId}`, who))
            .status,
        );
      }
      expect((await w.api("get", "/admin/proposals", w.admin)).status).toBe(
        422,
      );
      expect(
        (
          await w.api(
            "get",
            `/admin/proposals?questionId=${randomUUID()}`,
            w.admin,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe("weekly report: emotions and regions in the auto draft", () => {
    async function closedWeek(
      weekNumber: number,
      startsOn: string,
      moods: (string | null)[],
      voters = 6,
    ) {
      const topic = await w.prisma.topic.create({
        data: {
          weekNumber,
          title: `Week ${weekNumber}`,
          startsOn: new Date(`${startsOn}T00:00:00Z`),
          endsOn: new Date(`${plusDays(startsOn, 6)}T00:00:00Z`),
          status: "CLOSED",
          questionCount: 1,
        },
      });
      const q = await w.prisma.question.create({
        data: {
          topicId: topic.id,
          kind: "DAILY",
          status: "CLOSED",
          text: `Mood question ${weekNumber}`,
          slotIndex: 1,
          moodOptions: ["ANGRY", "TIRED", "PROUD", "HOPEFUL"],
          startsAt: new Date(Date.now() - 9 * 86_400_000),
          endsAt: new Date(Date.now() - 8 * 86_400_000),
        },
      });
      for (let i = 0; i < moods.length; i++)
        if (moods[i])
          await w.prisma.answer.create({
            data: {
              questionId: q.id,
              authorId: people[i].id,
              kind: "TEXT",
              body: `answer ${i}`,
              mood: moods[i] as never,
            },
          });
      const poll = await w.prisma.poll.create({
        data: {
          topicId: topic.id,
          kind: "WEEKLY",
          title: "What first?",
          status: "CLOSED",
          startsAt: new Date(Date.now() - 7 * 86_400_000),
          endsAt: new Date(Date.now() - 3_600_000),
          options: {
            create: [
              { label: "A stable naira", sortOrder: 0 },
              { label: "Cheaper fuel", sortOrder: 1 },
            ],
          },
          totalVotes: 6,
        },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      });
      for (let i = 0; i < voters; i++)
        await w.prisma.vote.create({
          data: {
            pollId: poll.id,
            userId: people[i].id,
            phoneHash: `ph-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            choices: {
              create: [{ optionId: poll.options[i % 3 === 0 ? 1 : 0].id }],
            },
          },
        });
      return { topic, poll };
    }
    const draft = () => w.h.app.get(WeeklyDraftService);

    beforeAll(async () => {
      await w.prisma.configEntry.upsert({
        where: { key: "weekly.min_group_size" },
        create: {
          key: "weekly.min_group_size",
          valueJson: 3,
          description: "x",
        } as never,
        update: { valueJson: 3 },
      });
    });

    it("fills emotions from the week's real mood answers, with movement on last week, and regions above the floor", async () => {
      // last week: 4 people, 2 angry 2 hopeful. This week: 6 people, 3 angry 2 tired 1 hopeful.
      await closedWeek(901, "2026-10-05", [
        "ANGRY",
        "ANGRY",
        "HOPEFUL",
        "HOPEFUL",
      ]);
      const cur = await closedWeek(902, "2026-10-12", [
        "ANGRY",
        "ANGRY",
        "ANGRY",
        "TIRED",
        "TIRED",
        "HOPEFUL",
      ]);
      expect(await draft().draftTopic(cur.poll.id)).toBe(true);
      const r = await w.prisma.weeklyReport.findUniqueOrThrow({
        where: { topicId: cur.topic.id },
      });
      expect(r.emotions).toEqual([
        { name: "Angry", share: 50, change: 0 },
        { name: "Tired", share: 33, change: 33 },
        { name: "Hopeful", share: 17, change: -33 },
      ]);
      // by state: Lagos has 4 votes (>= floor 3), Kano 1 and the person with no state are left out
      expect(r.regionBreakdown).toEqual([
        { state: "Lagos", votes: 4, leading: "A stable naira", percent: 50 },
      ]);
      const ad = await w.api("get", `/admin/weekly-reports/${r.id}`, w.editor);
      expect(ad.body.emotions).toHaveLength(3);
      expect(ad.body.regions).toEqual([
        { state: "Lagos", votes: 4, leading: "A stable naira", percent: 50 },
      ]);
    });

    it("under the floor nothing is invented: no emotions, no regions", async () => {
      const t = await closedWeek(903, "2026-10-19", ["ANGRY", "TIRED"], 2);
      await draft().draftTopic(t.poll.id);
      const r = await w.prisma.weeklyReport.findUniqueOrThrow({
        where: { topicId: t.topic.id },
      });
      expect(r.emotions).toEqual([]);
      expect(r.regionBreakdown).toBeNull();
    });

    it("the admin edit sends emotions and they save; published, the public page and the Instagram pictures read them", async () => {
      const r = await w.prisma.weeklyReport.findFirstOrThrow({
        where: { topic: { weekNumber: 902 } },
      });
      const edit = await w.api(
        "patch",
        `/admin/weekly-reports/${r.id}`,
        w.editor,
        {
          emotions: [
            { name: "Angry", share: 55, change: 5 },
            { name: "Tired", share: 30, change: 2 },
          ],
        },
      );
      expect(edit.status).toBe(200);
      expect(edit.body.emotions).toEqual([
        { name: "Angry", share: 55, change: 5 },
        { name: "Tired", share: 30, change: 2 },
      ]);
      await w.prisma.weeklyReport.update({
        where: { id: r.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          headline: "Angry, tired, still talking",
          mood: "Angry and tired",
          humanReviewed: true,
        },
      });
      const pub = await w.api("get", `/weekly-reports/${r.id}`, null);
      expect(pub.status).toBe(200);
      expect(pub.body.emotions).toEqual([
        { name: "Angry", share: 55, change: 5 },
        { name: "Tired", share: 30, change: 2 },
      ]);
      expect(pub.body.regions).toEqual([
        { state: "Lagos", votes: 4, leading: "A stable naira", percent: 50 },
      ]);
      // the Instagram cover draws the mood bar from the same field: with emotions the SVG has bar rects, without it has none
      const base = {
        weekNumber: 2,
        topicTitle: "T",
        headline: "Angry, tired, still talking",
        mood: "Angry and tired",
        themes: [],
        poll: null,
        quotes: [],
        basedOnVoices: 10,
        basedOnVotes: 10,
        host: "usevoices.com",
      };
      const withBars = JSON.stringify(
        await Promise.resolve(
          instagramSvgs({ ...base, emotions: pub.body.emotions }),
        ),
      );
      const without = JSON.stringify(
        await Promise.resolve(instagramSvgs({ ...base, emotions: [] })),
      );
      expect(withBars).not.toEqual(without);
      expect(withBars).toContain("Angry");
      const zip = await w.h
        .http()
        .get(`/api/v1/admin/weekly-reports/${r.id}/instagram`)
        .set(w.editor.auth)
        .expect(200);
      expect(zip.headers["content-type"]).toMatch(/zip/);
    });
  });

  describe("roles from the page", () => {
    it("finds a person by handle, grants and removes EDITOR with a reason, writes AuditLog, admin only", async () => {
      const found = await w.api("get", "/admin/users?q=fixc.user5", w.admin);
      expect(found.status).toBe(200);
      const u = found.body.items[0];
      expect(u.profile.handle).toBe("fixc.user5");
      expect(u.roles).toEqual([]);
      const g = await w.api(
        "put",
        `/admin/users/${u.profile.id}/roles`,
        w.admin,
        { roles: ["EDITOR", "MODERATOR"], reason: "New on the desk" },
      );
      expect(g.status).toBe(200);
      expect(g.body.roles).toEqual(["EDITOR", "MODERATOR"]);
      const rm = await w.api(
        "put",
        `/admin/users/${u.profile.id}/roles`,
        w.admin,
        { roles: ["MODERATOR"], reason: "Moved to moderation" },
      );
      expect(rm.body.roles).toEqual(["MODERATOR"]);
      const rows = await sql<{ reason: string; after: any }>(
        `SELECT reason, after FROM "AuditLog" WHERE action = 'role.set' AND "targetId" = $1 ORDER BY "createdAt"`,
        [u.profile.id],
      );
      expect(rows.map((x) => x.reason)).toEqual([
        "New on the desk",
        "Moved to moderation",
      ]);
      for (const who of [w.editor, w.moderator, w.adManager, w.plain, null]) {
        expect([401, 403]).toContain(
          (await w.api("get", "/admin/users?q=fixc", who)).status,
        );
        expect([401, 403]).toContain(
          (
            await w.api("put", `/admin/users/${u.profile.id}/roles`, who, {
              roles: ["ADMIN"],
              reason: "no way",
            })
          ).status,
        );
      }
      const own = await w.api(
        "put",
        `/admin/users/${w.admin.id}/roles`,
        w.admin,
        { roles: [], reason: "drop myself" },
      );
      expect(own.status).toBe(422);
    });
  });
});
