/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- tests read untyped JSON bodies */
import { checkedLineFor } from "../../src/results/results.service";
import {
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type Staff,
  type World,
} from "./harness";

const HOUR = 3_600_000;

/** lead ruling WF-6: RESTORE finality (T2), appealedKind, the accepted-suspension notice (RX2), RX3 override end, RX4 one unit rate. */
describe("WF-6a: appeals are final, one display rate, the override's own end", () => {
  let w: World;
  const T = lagosToday();
  let n = 0;

  beforeAll(async () => {
    w = await world();
    await w.prisma.configEntry.upsert({
      where: { key: "ratelimit.appeal_per_10min" },
      create: { key: "ratelimit.appeal_per_10min", valueJson: 1000 },
      update: { valueJson: 1000 },
    });
  });
  afterAll(() => w.close());

  const act = (who: Staff, id: string, action: string, reason = "Reason.") =>
    w.api("post", `/admin/moderation/items/${id}/action`, who, {
      action,
      reason,
    });
  const notices = async () =>
    (await w.api("get", "/notifications", w.plain)).body.items as any[];

  async function question() {
    return w.prisma.question.create({
      data: {
        text: `Q${++n}?`,
        status: "LIVE",
        kind: "DAILY",
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    });
  }
  /** A post by `plain`, reported, then REMOVE_AND_WARN by the moderator, then appealed: returns the OPEN APPEAL item. */
  async function appealedRemoval() {
    await sql(
      `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification" CASCADE`,
    );
    const q = await question();
    const ans = await w.prisma.answer.create({
      data: {
        questionId: q.id,
        authorId: w.plain.id,
        kind: "TEXT",
        body: "hello there",
      },
    });
    await w.prisma.report.create({
      data: {
        reporterId: w.admin2.id,
        targetType: "ANSWER",
        targetId: ans.id,
        reason: "THREAT_OR_VIOLENCE",
      },
    });
    const reported = await w.prisma.moderationItem.create({
      data: {
        targetType: "ANSWER",
        targetId: ans.id,
        queue: "REPORTED",
        reasons: ["THREAT_OR_VIOLENCE"],
        reportCount: 1,
      },
    });
    expect(
      (await act(w.moderator, reported.id, "REMOVE_AND_WARN", "First.")).status,
    ).toBe(200);
    const ap = await w.api("post", "/appeals", w.plain, {
      targetType: "ANSWER",
      targetId: ans.id,
      note: "I think you got this wrong.",
    });
    expect(ap.status).toBe(201);
    const item = await w.prisma.moderationItem.findFirstOrThrow({
      where: { targetType: "ANSWER", targetId: ans.id, queue: "APPEAL" },
    });
    return { ans, item, reported };
  }
  const accepted = async () =>
    (await notices()).filter((x) => /^Your appeal was accepted/.test(x.title));
  const backUp = async () =>
    (await notices()).filter((x) => x.title === "A post of yours is back up");

  describe("T2: a decided appeal is final", () => {
    it("two parallel RESTOREs on one appeal item: one 200, one 409, one notice, one strike removal", async () => {
      const { ans, item } = await appealedRemoval();
      const [a, b] = await Promise.all([
        act(w.admin, item.id, "RESTORE", "Our mistake."),
        act(w.admin2, item.id, "RESTORE", "Our mistake too."),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const lost = a.status === 409 ? a : b;
      expect(JSON.stringify(lost.body)).toContain(
        "Someone has already decided this item.",
      );
      expect(await accepted()).toHaveLength(1);
      expect(await backUp()).toHaveLength(0);
      expect(
        await w.prisma.moderationAction.count({
          where: { itemId: item.id, action: "RESTORE" },
        }),
      ).toBe(1);
      expect(
        (await w.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
          .status,
      ).toBe("PUBLISHED");
    });

    it("after a decision (KEEP or RESTORE) every action on the appeal item is 409, RESTORE included, and nothing changes", async () => {
      for (const first of ["KEEP", "RESTORE"]) {
        const { ans, item } = await appealedRemoval();
        expect((await act(w.admin, item.id, first)).status).toBe(200);
        const status = (
          await w.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } })
        ).status;
        const notes = (await notices()).length;
        const actions = await w.prisma.moderationAction.count();
        for (const action of [
          "RESTORE",
          "KEEP",
          "REMOVE",
          "REMOVE_AND_WARN",
          "WARN",
        ]) {
          const r = await act(w.admin2, item.id, action);
          expect([first, action, r.status]).toEqual([first, action, 409]);
        }
        expect(
          (await w.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
            .status,
        ).toBe(status);
        expect((await notices()).length).toBe(notes);
        expect(await w.prisma.moderationAction.count()).toBe(actions);
      }
    });

    it("the older REPORTED item of the same post cannot RESTORE what the appeal decided (a Keep stays kept)", async () => {
      const { ans, item, reported } = await appealedRemoval();
      expect(
        (await act(w.admin, item.id, "KEEP", "It stays down.")).status,
      ).toBe(200);
      const r = await act(w.admin2, reported.id, "RESTORE", "Put it back.");
      expect(r.status).toBe(409);
      expect(
        (await w.prisma.answer.findUniqueOrThrow({ where: { id: ans.id } }))
          .status,
      ).toBe("REMOVED");
      expect(await backUp()).toHaveLength(0);
    });

    it("a resolved ordinary item can still be corrected by one RESTORE, and a second RESTORE is refused (one notice)", async () => {
      await sql(
        `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification" CASCADE`,
      );
      const q = await question();
      const ans = await w.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: w.plain.id,
          kind: "TEXT",
          body: "hello",
        },
      });
      const item = await w.prisma.moderationItem.create({
        data: {
          targetType: "ANSWER",
          targetId: ans.id,
          queue: "REPORTED",
          reasons: ["THREAT_OR_VIOLENCE"],
          reportCount: 1,
        },
      });
      expect((await act(w.moderator, item.id, "REMOVE")).status).toBe(200);
      const [a, b] = await Promise.all([
        act(w.admin, item.id, "RESTORE", "Mistake."),
        act(w.admin2, item.id, "RESTORE", "Mistake."),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await backUp()).toHaveLength(1);
    });
  });

  describe("appealedKind for a removed-then-restored post", () => {
    const at = (m: number) => new Date(Date.now() - 3_600_000 + m * 60_000);
    async function history(appealAtMin: number | null) {
      await sql(
        `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification" CASCADE`,
      );
      const q = await question();
      const ans = await w.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: w.plain.id,
          kind: "TEXT",
          body: "hello",
        },
      });
      const reported = await w.prisma.moderationItem.create({
        data: {
          targetType: "ANSWER",
          targetId: ans.id,
          queue: "REPORTED",
          reasons: ["THREAT_OR_VIOLENCE"],
          reportCount: 1,
          status: "RESOLVED",
          createdAt: at(0),
        },
      });
      const decide = (action: "REMOVE_AND_WARN" | "RESTORE", m: number) =>
        w.prisma.moderationAction.create({
          data: {
            itemId: reported.id,
            moderatorId: w.moderator.id,
            action,
            reason: "x",
            createdAt: at(m),
          },
        });
      await decide("REMOVE_AND_WARN", 1);
      await decide("RESTORE", 2); // the post is back up, the strike stays
      const when = appealAtMin === null ? at(3) : at(appealAtMin);
      const item = await w.prisma.moderationItem.create({
        data: {
          targetType: "ANSWER",
          targetId: ans.id,
          queue: "APPEAL",
          reasons: ["APPEAL"],
          reportCount: 1,
          createdAt: when,
        },
      });
      await w.prisma.appeal.create({
        data: {
          userId: w.plain.id,
          targetType: "ANSWER",
          targetId: ans.id,
          note: "Please look again.",
          itemId: item.id,
          createdAt: when,
        },
      });
      return item;
    }
    const kind = async (id: string) =>
      (await w.api("get", `/admin/moderation/items/${id}`, w.admin2)).body
        .appealKind;

    it("a post removed and then put back reads WARNING (the strike stays), not REMOVAL", async () => {
      expect(await kind((await history(null)).id)).toBe("WARNING");
    });

    it("an appeal sent while the post was still down reads REMOVAL even after it was put back", async () => {
      expect(await kind((await history(1.5)).id)).toBe("REMOVAL");
    });

    it("a post still down reads REMOVAL", async () => {
      const { item } = await appealedRemoval();
      expect(await kind(item.id)).toBe("REMOVAL");
    });
  });

  describe("RX2: an accepted suspension appeal", () => {
    async function suspendedAndAppealed() {
      await sql(
        `TRUNCATE "Strike", "ModerationAction", "ModerationItem", "Appeal", "Report", "Notification" CASCADE`,
      );
      await sql(
        `UPDATE "User" SET status = 'ACTIVE', "suspendedUntil" = NULL WHERE id = $1`,
        [w.plain.id],
      );
      const q = await question();
      const ans = await w.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: w.plain.id,
          kind: "TEXT",
          body: "hello",
        },
      });
      const item = await w.prisma.moderationItem.create({
        data: {
          targetType: "ANSWER",
          targetId: ans.id,
          queue: "REPORTED",
          reasons: ["THREAT_OR_VIOLENCE"],
          reportCount: 1,
        },
      });
      expect(
        (await act(w.moderator, item.id, "SUSPEND", "Twice.")).status,
      ).toBe(200);
      expect(
        (
          await w.api("post", "/appeals", w.plain, {
            targetType: "USER",
            targetId: w.plain.id,
            note: "Please look again.",
          })
        ).status,
      ).toBe(201);
      return w.prisma.moderationItem.findFirstOrThrow({
        where: { targetType: "USER", targetId: w.plain.id, queue: "APPEAL" },
      });
    }

    it("the notice says the account is active again; the earlier notice is marked resolved and has no Appeal action", async () => {
      const ap = await suspendedAndAppealed();
      let before = (await notices()).find((x) =>
        /suspended until/.test(x.title),
      );
      expect(before.appeal.state).toBe("SENT");
      expect(before.resolved).toBe(false);
      expect(
        (await act(w.admin, ap.id, "RESTORE", "Our mistake.")).status,
      ).toBe(200);
      const rows = await notices();
      expect(rows.map((x) => x.title)).toContain(
        "Your appeal was accepted. Your account is active again.",
      );
      before = rows.find((x) => /suspended until/.test(x.title));
      expect(before.appeal).toBeNull();
      expect(before.resolved).toBe(true);
      // every other row is not resolved
      expect(rows.filter((x) => x.resolved).map((x) => x.title)).toHaveLength(
        1,
      );
    });

    it("a declined suspension appeal also marks the old notice resolved, with its own words", async () => {
      const ap = await suspendedAndAppealed();
      expect((await act(w.admin, ap.id, "KEEP", "Stays.")).status).toBe(200);
      const rows = await notices();
      expect(rows.map((x) => x.title)).toContain("Your appeal was declined");
      expect(rows.find((x) => /suspended until/.test(x.title)).resolved).toBe(
        true,
      );
    });

    it("a removal appeal accepted keeps the strike words", async () => {
      const { item } = await appealedRemoval();
      await act(w.admin, item.id, "RESTORE", "Our mistake.");
      expect((await accepted())[0].title).toBe(
        "Your appeal was accepted and the strike was removed",
      );
    });
  });

  describe("RX3: every closing time for an override is the override's own end", () => {
    it("questions/today, home, the question, the lists and the share card all say the override's end while it runs", async () => {
      await sql(`TRUNCATE "Question", "Topic" CASCADE`);
      await makeWeek(w.prisma, {
        weekNumber: 1,
        startsOn: plusDays(T, -2),
        status: "LIVE",
      });
      const endsAt = new Date(Date.now() + 30 * HOUR).toISOString();
      const created = await w.api("post", "/admin/overrides", w.editor, {
        headline: "Lagos floods: are you safe?",
        contentKind: "TEXT",
        body: "Tell us where you are.",
        emergency: true,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt,
      });
      expect(created.status).toBe(201);
      const qid = created.body.questionId ?? created.body.question?.id;
      const row = await w.prisma.override.findFirstOrThrow({});
      const want = new Date(row.endsAt).toISOString();
      expect(want).toBe(endsAt);
      // the override runs past the end of today's Lagos day, which is what used to be shown
      expect(
        new Date(want).getTime() >
          new Date(`${plusDays(T, 1)}T00:00:00+01:00`).getTime(),
      ).toBe(true);

      const today = await w.api("get", "/questions/today");
      expect(today.body.id).toBe(row.questionId);
      expect(today.body.endsAt).toBe(want);
      expect(today.body.override.endsAt).toBe(want);
      const home = await w.api("get", "/home");
      expect(home.body.dailyQuestion.id).toBe(row.questionId);
      expect(home.body.dailyQuestion.endsAt).toBe(want);
      const one = await w.api("get", `/questions/${row.questionId}`);
      expect(one.body.endsAt).toBe(want);
      const list = await w.api("get", "/questions?kind=OVERRIDE");
      expect(list.body.items.map((i: any) => i.endsAt)).toEqual([want]);
      const fresh = await w.api("get", "/feed/new");
      for (const i of fresh.body.items.filter(
        (x: any) => x.id === row.questionId,
      ))
        expect(i.endsAt).toBe(want);
      void qid;

      // a person who is signed in sees the same
      const authed = await w.api("get", "/questions/today", w.plain);
      expect(authed.body.endsAt).toBe(want);
    });

    it("cancelled early: the question closes at the moment it was cancelled, not later", async () => {
      const row = await w.prisma.override.findFirstOrThrow({});
      const c = await w.api(
        "post",
        `/admin/overrides/${row.id}/cancel`,
        w.editor,
        {
          reason: "Over.",
        },
      );
      expect(c.status).toBe(200);
      const q = await w.api("get", `/questions/${row.questionId}`);
      expect(new Date(q.body.endsAt).getTime()).toBeLessThanOrEqual(Date.now());
      expect(q.body.status).toBe("CLOSED");
    });

    it("a daily question still closes at the end of its Lagos day", async () => {
      const today = await w.api("get", "/questions/today");
      expect(today.status).toBe(200);
      expect(today.body.override).toBeNull();
      expect(new Date(today.body.endsAt).getTime()).toBe(
        new Date(`${plusDays(T, 1)}T00:00:00+01:00`).getTime(),
      );
    });
  });

  describe("RX4: one source for the naira value beside a unit cost", () => {
    const costsEverywhere = async (): Promise<Record<string, number>> => ({
      publicBase: (await w.api("get", "/config/public")).body.costs
        .baseKoboPerUnit,
      publicUnitBase: (await w.api("get", "/config/public")).body.unitBaseKobo,
      tiers: (await w.api("get", "/units/tiers", w.plain)).body.costs
        .baseKoboPerUnit,
      allowance: (await w.api("get", "/me/allowance", w.plain)).body.costs
        .baseKoboPerUnit,
      me: (await w.api("get", "/me", w.plain)).body.allowances.costs
        .baseKoboPerUnit,
    });
    const putTiers = async (value: unknown) =>
      w.api("put", "/admin/config/units.tiers", w.admin, {
        value,
        reason: "Change the smallest pack.",
      });
    const tiersNow = async () =>
      (await w.api("get", "/admin/config", w.admin)).body.items.find(
        (i: any) => i.key === "units.tiers",
      ).value as any[];

    it("is the per-unit price of the smallest pack, and every response agrees after an admin changes that pack's price", async () => {
      const tiers = await tiersNow();
      const rate = (price: number, units: number) =>
        Math.round((price * 1000) / units);
      const spark = tiers.find((t) => t.slug === "spark");
      // a different price first, so the packs table is rewritten whatever an earlier suite left in it
      const first = tiers.map((t) =>
        t.slug === "spark" ? { ...t, priceKobo: 14000 } : t,
      );
      expect((await putTiers(first)).status).toBe(200);
      expect(Object.values(await costsEverywhere())).toEqual(
        Array(5).fill(rate(14000, spark.unitsMilli)),
      );

      // change the price, with the packs listed biggest first so list order cannot be what decides it
      const changed = tiers
        .map((t) => (t.slug === "spark" ? { ...t, priceKobo: 15000 } : t))
        .reverse();
      expect((await putTiers(changed)).status).toBe(200);
      const want = rate(15000, spark.unitsMilli);
      expect(Object.values(await costsEverywhere())).toEqual(
        Array(5).fill(want),
      );
      // the per-pack rate on the buy screen is the same number for that pack
      const pub = (await w.api("get", "/config/public")).body;
      expect(pub.tiers.find((t: any) => t.slug === "spark")).toMatchObject({
        effectiveKoboPerUnit: want,
        baseKoboPerUnit: want,
      });
      // every other pack keeps its own per-pack figure, never the display rate
      const chat = pub.tiers.find((t: any) => t.slug === "chat");
      expect(chat.effectiveKoboPerUnit).toBe(
        rate(chat.priceKobo, chat.unitsMilli),
      );
      expect(chat.effectiveKoboPerUnit).not.toBe(want);
      const tiersRoute = (await w.api("get", "/units/tiers", w.plain)).body;
      for (const t of tiersRoute.tiers) {
        const p = pub.tiers.find((x: any) => x.slug === t.slug);
        expect(p.effectiveKoboPerUnit).toBe(t.effectiveKoboPerUnit);
        expect(p.baseKoboPerUnit).toBe(t.baseKoboPerUnit);
      }
    });

    it("units.base_rate_kobo is not read for display any more", async () => {
      const r = await w.api(
        "put",
        "/admin/config/units.base_rate_kobo",
        w.admin,
        {
          value: 9999,
          reason: "Not for display.",
        },
      );
      expect(r.status).toBe(200);
      const v = await costsEverywhere();
      expect(Object.values(v)).toEqual(Array(5).fill(1500));
    });

    it("the smallest pack is by units, not by list position or by lowest price", async () => {
      const tiers = await tiersNow();
      const odd = [
        {
          slug: "big",
          name: "Big",
          priceKobo: 140000,
          unitsMilli: 200000,
          bonusMilli: 0,
        },
        {
          slug: "mid",
          name: "Mid",
          priceKobo: 14000,
          unitsMilli: 9000,
          bonusMilli: 0,
        },
        {
          slug: "tiny",
          name: "Tiny",
          priceKobo: 20000,
          unitsMilli: 7000,
          bonusMilli: 0,
        },
      ];
      expect((await putTiers(odd)).status).toBe(200);
      expect(Object.values(await costsEverywhere())).toEqual(
        Array(5).fill(Math.round((20000 * 1000) / 7000)),
      );
      expect((await putTiers(tiers)).status).toBe(200);
    });
  });

  describe("weekly checks (L-9, L-10) and the one time form on a checked result (C-N7)", () => {
    let wn = 100;
    async function weekly(over: Record<string, unknown>) {
      const topic = await w.prisma.topic.create({
        data: {
          weekNumber: ++wn,
          title: `Week ${wn}`,
          startsOn: new Date(`${plusDays(T, -20)}T00:00:00.000Z`),
          endsOn: new Date(`${plusDays(T, -14)}T00:00:00.000Z`),
          status: "CLOSED",
          questionCount: 0,
        },
      });
      const r = await w.prisma.weeklyReport.create({
        data: {
          topicId: topic.id,
          status: "DRAFT",
          basedOnVoices: 8,
          basedOnVotes: 0,
          ...over,
        } as never,
      });
      return (await w.api("get", `/admin/weekly-reports/${r.id}`, w.editor))
        .body.checks as { text: string; ok: boolean }[];
    }
    const find = (c: { text: string; ok: boolean }[], start: string) =>
      c.find((x) => x.text.startsWith(start));

    it("a small week that dropped its groups says why instead of warning", async () => {
      const c = await weekly({
        headline: "Tired but steady",
        summary: "Most voices say plans are made around the light.",
        themes: [],
      });
      expect(find(c, "Leading and opposing views")).toEqual({
        text: expect.stringContaining("too few voices"),
        ok: true,
      });
      expect(
        find(c, "Leading view and the main opposing view"),
      ).toBeUndefined();
    });

    it("a big week with fewer than two groups still warns", async () => {
      const c = await weekly({
        basedOnVoices: 5000,
        headline: "h",
        summary: "s",
        themes: [{ label: "Prices", count: 400 }],
      });
      expect(find(c, "Leading view and the main opposing view")?.ok).toBe(
        false,
      );
    });

    it("languages read counts real drafting: written answers read, then no warning", async () => {
      const drafted = await weekly({
        headline: "Tired but steady",
        summary: "Most voices say plans are made around the light.",
        languagesRead: [],
      });
      expect(find(drafted, "Languages read")).toEqual({
        text: "Languages read: written answers only, no spoken language to detect",
        ok: true,
      });
      const nothing = await weekly({ languagesRead: [] });
      expect(find(nothing, "Languages read")).toEqual({
        text: "Languages read: none yet",
        ok: false,
      });
      const spoken = await weekly({
        languagesRead: ["English", "Pidgin"],
        headline: "h",
      });
      expect(find(spoken, "Languages read")).toEqual({
        text: "Languages read: English, Pidgin",
        ok: true,
      });
    });

    it("languages read also reads the transcripts of voice answers and spoken replies, live (WF-7)", async () => {
      const topic = await w.prisma.topic.create({
        data: {
          weekNumber: ++wn,
          title: `Week ${wn}`,
          startsOn: new Date(`${plusDays(T, -20)}T00:00:00.000Z`),
          endsOn: new Date(`${plusDays(T, -14)}T00:00:00.000Z`),
          status: "CLOSED",
          questionCount: 0,
        },
      });
      const q = await w.prisma.question.create({
        data: { text: `Q${++n}?`, status: "CLOSED", topicId: topic.id },
      });
      const a = await w.prisma.answer.create({
        data: {
          questionId: q.id,
          authorId: w.plain.id,
          kind: "TEXT",
          body: "Written.",
        },
      });
      const clip = await w.prisma.voiceClip.create({
        data: {
          ownerId: w.plain.id,
          purpose: "REPLY",
          status: "READY",
          rawKey: "raw/w7",
          rawMime: "audio/webm",
          maxDurationMs: 10000,
        },
      });
      await w.prisma.transcript.create({
        data: {
          clipId: clip.id,
          status: "READY",
          language: "yo",
          text: "Mo gba",
        },
      });
      await w.prisma.reply.create({
        data: {
          answerId: a.id,
          authorId: w.plain.id,
          stance: "EXPERIENCE",
          kind: "VOICE",
          clipId: clip.id,
        },
      });
      const r = await w.prisma.weeklyReport.create({
        data: {
          topicId: topic.id,
          status: "DRAFT",
          basedOnVoices: 1,
          basedOnVotes: 0,
          languagesRead: [],
        } as never,
      });
      const checks = (
        await w.api("get", `/admin/weekly-reports/${r.id}`, w.editor)
      ).body.checks as { text: string; ok: boolean }[];
      expect(find(checks, "Languages read")).toEqual({
        text: "Languages read: Yoruba",
        ok: true,
      });
    });

    it("the checked line uses one time form: 1:02pm, with the day only when it is not today", () => {
      const now = new Date("2026-11-06T12:30:00Z");
      expect(
        checkedLineFor(
          { status: "VERIFIED", checkedAt: new Date("2026-11-06T12:02:00Z") },
          now,
        ),
      ).toBe("Checked by the WAWU team, 1:02pm");
      expect(
        checkedLineFor(
          { status: "VERIFIED", checkedAt: new Date("2026-11-05T09:05:00Z") },
          now,
        ),
      ).toBe("Checked by the WAWU team, 5 Nov, 10:05am");
      expect(
        checkedLineFor(
          {
            status: "NOT_VERIFIED",
            checkedAt: new Date("2026-11-06T12:02:00Z"),
          },
          now,
        ),
      ).toBe(
        "Checked by the WAWU team, 1:02pm. The numbers could not be confirmed.",
      );
      expect(
        checkedLineFor({ status: "NOT_VERIFIED", checkedAt: null }, now),
      ).toBe("Not checked yet. The WAWU team is on it.");
    });
  });
});
