/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- response bodies are read as loose JSON */
import { randomUUID } from "node:crypto";
import { sql } from "../me/helpers";
import { bootAdmin, type Admin } from "./helpers";
import { respondentKey } from "../../src/surveys/survey-rules";
import { DeletionService } from "../../src/me/deletion.service";

/**
 * V-SURVEYS round 5: deleting an account removes the person's survey answers (choice, text and voice together) and
 * rebuilds fixed or released results without them (M1); the daily VIEW cap is exact under parallel requests (L2); no
 * staff route gives a breakdown under the floor (the totals are allowed by the owner's ruling of 14 Nov 2026).
 */
const api = "/api/v1";

describe("V-SURVEYS round 5", () => {
  let a: Admin;
  const day = (n: number) =>
    new Date(Date.now() + n * 86_400_000 + 3_600_000)
      .toISOString()
      .slice(0, 10);
  const body = (over: Record<string, unknown> = {}) => ({
    brandName: "Round Five Foods",
    contactEmail: "r5@brand.test",
    title: "What do you cook?",
    questions: [
      {
        kind: "SINGLE_CHOICE",
        prompt: "Which do you cook most?",
        options: ["Rice", "Beans", "Yam"],
      },
      { kind: "TEXT", prompt: "What would make cooking easier?" },
      { kind: "VOICE", prompt: "Tell us more." },
    ],
    startsOn: day(-3),
    endsOn: day(10),
    frequencyCapPerDay: 1,
    priceKobo: 5_000_000,
    ...over,
  });
  const post = (path: string, who: string | null, data?: object) => {
    const r = a.h.http().post(`${api}${path}`);
    return (who ? r.set(a.auth(who)) : r).send(data ?? {});
  };
  const get = (path: string, who: string | null) => {
    const r = a.h.http().get(`${api}${path}`);
    return who ? r.set(a.auth(who)) : r;
  };
  const live = async (over: Record<string, unknown> = {}) => {
    const c = await post("/admin/surveys", "adman", body(over)).expect(201);
    await post(`/admin/surveys/${c.body.id}/submit`, "adman").expect(200);
    await post(`/admin/surveys/${c.body.id}/decision`, "admin", {
      decision: "APPROVE",
    }).expect(200);
    return c.body.id as string;
  };
  const questions = async (id: string) =>
    (await get(`/admin/surveys/${id}`, "adman").expect(200)).body.questions as {
      id: string;
      kind: string;
      options: { id: string }[];
    }[];
  /** One response by `who` (a real person, so their key can be recomputed): a choice, a text and a voice answer. */
  const answer = async (id: string, who: string, option: number) => {
    const q = await questions(id);
    const r = await a.prisma.surveyResponse.create({
      data: {
        surveyId: id,
        respondentKey: respondentKey(id, a.people[who].id),
      },
    });
    await a.prisma.surveyAnswer.create({
      data: {
        responseId: r.id,
        questionId: q[0].id,
        optionId: q[0].options[option].id,
      },
    });
    await a.prisma.surveyAnswer.create({
      data: { responseId: r.id, questionId: q[1].id, text: `text of ${who}` },
    });
    const c = await a.prisma.voiceClip.create({
      data: {
        ownerId: a.people[who].id,
        purpose: "SURVEY_ANSWER",
        status: "READY",
        rawKey: `raw/${randomUUID()}`,
        rawMime: "audio/webm",
        maxDurationMs: 60_000,
        durationMs: 5_000,
      },
    });
    await a.prisma.transcript.create({
      data: { clipId: c.id, status: "READY", text: `voice of ${who}` } as never,
    });
    await a.prisma.surveyAnswer.create({
      data: { responseId: r.id, questionId: q[2].id, clipId: c.id },
    });
  };
  const finish = (id: string) =>
    a.prisma.sponsoredSurvey.update({
      where: { id },
      data: { endsOn: new Date(`${day(-1)}T00:00:00Z`) },
    });
  const setMin = (n: number) =>
    a.prisma.configEntry.upsert({
      where: { key: "weekly.min_group_size" },
      create: { key: "weekly.min_group_size", valueJson: n },
      update: { valueJson: n },
    });
  const purge = async (who: string) => {
    await a.prisma.user.update({
      where: { id: a.people[who].id },
      data: {
        status: "DELETION_PENDING",
        deletionRequestedAt: new Date(Date.now() - 20 * 86_400_000),
      },
    });
    await a.h.app.get(DeletionService).purge(a.people[who].id);
  };
  const names = Array.from({ length: 12 }, (_, i) => `d${i + 1}`);

  beforeAll(async () => {
    a = await bootAdmin();
    await sql(
      `TRUNCATE "SponsoredSurvey", "Brand", "SurveyResponse", "MailLog", "Ad", "UserSettings" RESTART IDENTITY CASCADE`,
    );
    await a.person("admin", ["ADMIN"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("lagos");
    for (const n of names) await a.person(n);
    await setMin(3);
  });
  afterAll(async () => {
    await a.close();
  });

  describe("M1: deleting an account removes the person's survey answers", () => {
    it("12 people answer; one account is purged; none of that person's choice, text or voice answers remain, and the parts stay level", async () => {
      const id = await live();
      for (const [i, n] of names.entries()) await answer(id, n, i % 3);
      await finish(id);
      const before = (
        await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200)
      ).body;
      expect(before.total).toBe(24);
      expect(before.items.filter((x: any) => x.kind === "VOICE").length).toBe(
        12,
      );
      await purge("d3");
      const key = respondentKey(id, a.people.d3.id);
      expect(
        await a.prisma.surveyResponse.count({ where: { respondentKey: key } }),
      ).toBe(0);
      expect(
        await a.prisma.surveyAnswer.count({
          where: { OR: [{ text: "text of d3" }] },
        }),
      ).toBe(0);
      expect(
        await a.prisma.surveyResponse.count({ where: { surveyId: id } }),
      ).toBe(11);
      const after = (
        await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200)
      ).body;
      const text = after.items.filter((x: any) => x.kind === "TEXT").length;
      const voice = after.items.filter((x: any) => x.kind === "VOICE").length;
      expect(after.total).toBe(22);
      expect(text).toBe(11);
      expect(voice).toBe(11); // all of the person's parts went together: no one-off between them
      expect(JSON.stringify(after)).not.toMatch(/of d3"/);
      // the fixed counts are rebuilt without them, and release gives the brand the same
      await post(`/admin/surveys/${id}/release`, "adman").expect(200);
      const rep = (
        await get(`/admin/surveys/${id}/report`, "adman").expect(200)
      ).body;
      expect(rep.released).toBe(true);
      expect(rep.totals.responses).toBe(11);
      const [choice, txt, voc] = rep.questions;
      expect(choice.answered).toBe(11);
      expect(txt.answered).toBe(11);
      expect(voc.answered).toBe(11);
      expect(JSON.stringify(rep)).not.toContain("text of d3");
      expect(JSON.stringify(rep)).not.toContain("voice of d3");
    });

    it("a report already RELEASED is rebuilt without the person, with the usual hiding rule", async () => {
      const id = await live();
      // Rice 7, Beans 3, Yam 2 (floor 3: a group under 6 folds)
      const split = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2];
      for (const [i, n] of names.entries()) await answer(id, n, split[i]);
      await finish(id);
      await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200);
      await post(`/admin/surveys/${id}/release`, "adman").expect(200);
      const first = (await get(`/admin/surveys/${id}/report`, "adman")).body;
      expect(first.totals.responses).toBe(12);
      await purge("d8"); // a Beans person
      const rep = (
        await get(`/admin/surveys/${id}/report`, "adman").expect(200)
      ).body;
      expect(rep.released).toBe(true);
      expect(rep.totals.responses).toBe(11);
      expect(rep.questions[1].texts).not.toContain("text of d8");
      expect(rep.questions[1].texts).toHaveLength(11);
      expect(rep.questions[2].voices).toHaveLength(11);
      for (const q of rep.questions) {
        if (q.kind !== "SINGLE_CHOICE") continue;
        for (const o of q.options)
          if (!o.hidden) expect(o.count).toBeGreaterThanOrEqual(6);
        const shown = q.options.reduce(
          (s: number, o: any) => s + (o.count ?? 0),
          0,
        );
        // whatever is hidden is given as one total that is at least the floor, or nothing at all
        if (q.options.some((o: any) => o.hidden) && q.answered != null)
          expect(q.other.count).toBe(q.answered - shown);
      }
      expect(
        await a.prisma.surveyResponse.count({
          where: { respondentKey: respondentKey(id, a.people.d8.id) },
        }),
      ).toBe(0);
    });
  });

  describe("L2: the daily VIEW cap holds under parallel requests", () => {
    it("8 views sent together by one person with a cap of 1 store one row", async () => {
      const id = await live({ frequencyCapPerDay: 1 });
      const sends = await Promise.all(
        Array.from({ length: 8 }, () =>
          post(`/surveys/${id}/events`, "lagos", { kind: "VIEW" }),
        ),
      );
      for (const s of sends) expect([200, 201, 204]).toContain(s.status);
      expect(
        await a.prisma.surveyEvent.count({
          where: { surveyId: id, kind: "VIEW" },
        }),
      ).toBe(1);
      const cap2 = await live({ frequencyCapPerDay: 2 });
      await Promise.all(
        Array.from({ length: 8 }, () =>
          post(`/surveys/${cap2}/events`, "lagos", { kind: "VIEW" }),
        ),
      );
      expect(
        await a.prisma.surveyEvent.count({
          where: { surveyId: cap2, kind: "VIEW" },
        }),
      ).toBe(2);
    });
  });

  describe("H1 (owner ruling 14 Nov 2026): staff may see running totals; no staff route gives a breakdown under the floor", () => {
    it("totals at any size, but no breakdown while running or before release, and a small released report shows nothing", async () => {
      await setMin(5);
      const id = await live();
      for (const [i, n] of names.slice(0, 4).entries())
        await answer(id, n, i % 3);
      const run = (
        await get(`/admin/surveys/${id}/report`, "adman").expect(200)
      ).body;
      expect(run.answeredSoFar).toBe(4); // a running total: allowed
      for (const k of ["byState", "byAgeBand", "questions", "options"])
        expect(run).not.toHaveProperty(k);
      const detail = (await get(`/admin/surveys/${id}`, "adman").expect(200))
        .body;
      expect(detail.responses).toBe(4); // allowed
      expect(JSON.stringify(detail)).not.toMatch(/byState|byAgeBand|"count"/);
      await finish(id);
      const rev = (
        await get(`/admin/surveys/${id}/report`, "adman").expect(200)
      ).body;
      expect(rev.stage).toBe("REVIEW");
      for (const k of ["byState", "byAgeBand", "questions", "options"])
        expect(rev).not.toHaveProperty(k);
      await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200);
      await post(`/admin/surveys/${id}/release`, "adman").expect(200);
      const out = (
        await get(`/admin/surveys/${id}/report`, "adman").expect(200)
      ).body;
      expect(out.belowMinimum).toBe(true);
      expect(out.questions).toEqual([]);
      expect(out.byState).toEqual([]);
      expect(out.byAgeBand).toEqual([]);
      await setMin(3);
    });
  });
});
