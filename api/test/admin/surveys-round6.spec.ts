/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- response bodies are read as loose JSON */
import { randomUUID } from "node:crypto";
import { sql } from "../me/helpers";
import { bootAdmin, type Admin } from "./helpers";
import { respondentKey } from "../../src/surveys/survey-rules";
import { DeletionService } from "../../src/me/deletion.service";

/**
 * V-SURVEYS round 6. H1: a response target is never under the floor, and an old row under it behaves as the floor.
 * M1: after an account purge the totals fall together. L4: the review list answers a page quickly on a big survey.
 */
const api = "/api/v1";

describe("V-SURVEYS round 6", () => {
  let a: Admin;
  const day = (n: number) =>
    new Date(Date.now() + n * 86_400_000 + 3_600_000)
      .toISOString()
      .slice(0, 10);
  const body = (over: Record<string, unknown> = {}) => ({
    brandName: "Round Six Foods",
    contactEmail: "r6@brand.test",
    title: "What do you cook?",
    questions: [
      {
        kind: "SINGLE_CHOICE",
        prompt: "Which do you cook most?",
        options: ["Rice", "Beans", "Yam"],
      },
      { kind: "TEXT", prompt: "What would make cooking easier?" },
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
  const patch = (path: string, who: string, data: object) =>
    a.h.http().patch(`${api}${path}`).set(a.auth(who)).send(data);
  const get = (path: string, who: string | null) => {
    const r = a.h.http().get(`${api}${path}`);
    return who ? r.set(a.auth(who)) : r;
  };
  const setMin = (n: number) =>
    a.prisma.configEntry.upsert({
      where: { key: "weekly.min_group_size" },
      create: { key: "weekly.min_group_size", valueJson: n },
      update: { valueJson: n },
    });
  const live = async (over: Record<string, unknown> = {}) => {
    const c = await post("/admin/surveys", "adman", body(over)).expect(201);
    await post(`/admin/surveys/${c.body.id}/submit`, "adman").expect(200);
    await post(`/admin/surveys/${c.body.id}/decision`, "admin", {
      decision: "APPROVE",
    }).expect(200);
    return c.body.id as string;
  };
  /** n anonymous answer sets (random keys), each with a choice, plus matching events, for a count. */
  const fill = async (
    id: string,
    n: number,
    textOf?: (i: number) => string,
  ) => {
    const s = await a.prisma.sponsoredSurvey.findUniqueOrThrow({
      where: { id },
      include: {
        questions: { include: { options: true }, orderBy: { position: "asc" } },
      },
    });
    const rows = Array.from({ length: n }, () => ({
      id: randomUUID(),
      surveyId: id,
      respondentKey: randomUUID(),
    }));
    await a.prisma.surveyResponse.createMany({ data: rows });
    await a.prisma.surveyAnswer.createMany({
      data: rows.map((r, i) => ({
        responseId: r.id,
        questionId: s.questions[0].id,
        optionId: s.questions[0].options[i % 3].id,
      })),
    });
    if (textOf)
      await a.prisma.surveyAnswer.createMany({
        data: rows.map((r, i) => ({
          responseId: r.id,
          questionId: s.questions[1].id,
          text: textOf(i),
        })),
      });
  };
  const nPlaced = async (who: string) =>
    (await get("/surveys/placement", who).expect(200)).body.survey;
  const brandList = async (slug: string) =>
    (await get(`/brands/${slug}`, null).expect(200)).body.surveys.length;

  beforeAll(async () => {
    a = await bootAdmin();
    await sql(
      `TRUNCATE "SponsoredSurvey", "Brand", "SurveyResponse", "MailLog", "Ad", "UserSettings" RESTART IDENTITY CASCADE`,
    );
    await a.person("admin", ["ADMIN"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("lagos");
    await setMin(20);
  });
  afterAll(async () => {
    await a.close();
  });

  describe("H1: the target is never under the floor", () => {
    it("floor 20, target 3: refused on create, edit and approve with a plain message", async () => {
      const r = await post(
        "/admin/surveys",
        "adman",
        body({ responseTarget: 3 }),
      ).expect(422);
      expect(JSON.stringify(r.body)).toContain(
        "The target must be at least 20 answers.",
      );
      await post(
        "/admin/surveys",
        "adman",
        body({ responseTarget: 20 }),
      ).expect(201);
      const c = await post("/admin/surveys", "adman", body()).expect(201);
      const e = await patch(`/admin/surveys/${c.body.id}`, "adman", {
        responseTarget: 3,
      }).expect(422);
      expect(JSON.stringify(e.body)).toContain("at least 20 answers");
      await patch(`/admin/surveys/${c.body.id}`, "adman", {
        responseTarget: 25,
      }).expect(200);
      // an old row: a target of 3 written straight to the database; approval refuses it
      const old = await post("/admin/surveys", "adman", body()).expect(201);
      await post(`/admin/surveys/${old.body.id}/submit`, "adman").expect(200);
      await a.prisma.sponsoredSurvey.update({
        where: { id: old.body.id },
        data: { responseTarget: 3 },
      });
      const d = await post(`/admin/surveys/${old.body.id}/decision`, "admin", {
        decision: "APPROVE",
      }).expect(422);
      expect(JSON.stringify(d.body)).toContain(
        "The target must be at least 20 answers.",
      );
    });

    it("an old row with target 3 stays listed at 3 to 19 answers and goes at 20", async () => {
      const brand = await a.prisma.brand.create({
        data: { name: "B Six", slug: "b-six", createdById: a.people.admin.id },
      });
      const id = await live({ brandId: brand.id });
      await a.prisma.sponsoredSurvey.update({
        where: { id },
        data: { responseTarget: 3 },
      });
      let have = 0;
      for (const n of [3, 4, 10, 19]) {
        await fill(id, n - have);
        have = n;
        expect(await brandList("b-six")).toBe(1);
        expect((await nPlaced("lagos"))?.id).toBe(id);
        const st = (
          await get(`/admin/surveys/${id}/report`, "admin").expect(200)
        ).body;
        expect(st.stage).toBe("RUNNING");
      }
      await fill(id, 1);
      expect(await brandList("b-six")).toBe(0);
      expect(await nPlaced("lagos")).toBeNull();
      expect(
        (await get(`/admin/surveys/${id}/report`, "admin").expect(200)).body
          .stage,
      ).toBe("REVIEW");
    });

    it("the floor raised after approval: the same", async () => {
      await setMin(5);
      const brand = await a.prisma.brand.create({
        data: {
          name: "B Six2",
          slug: "b-six2",
          createdById: a.people.admin.id,
        },
      });
      const id = await live({ brandId: brand.id, responseTarget: 5 });
      await fill(id, 4);
      await setMin(10);
      for (const n of [4, 9]) {
        if (n === 9) await fill(id, 5);
        expect(await brandList("b-six2")).toBe(1);
      }
      await fill(id, 1);
      expect(await brandList("b-six2")).toBe(0);
      await setMin(20);
    });
  });

  describe("M1: the totals fall together after a purge", () => {
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
    /** n real people each with a VIEW, START, COMPLETE and a response (floor 5 for these). */
    const people = async (id: string, n: number, tag: string) => {
      const q = await a.prisma.surveyQuestion.findMany({
        where: { surveyId: id },
        include: { options: true },
        orderBy: { position: "asc" },
      });
      const names: string[] = [];
      for (let i = 0; i < n; i++) {
        const w = `${tag}${i}`;
        await a.person(w);
        names.push(w);
        const r = await a.prisma.surveyResponse.create({
          data: {
            surveyId: id,
            respondentKey: respondentKey(id, a.people[w].id),
          },
        });
        await a.prisma.surveyAnswer.create({
          data: {
            responseId: r.id,
            questionId: q[0].id,
            optionId: q[0].options[i % 3].id,
          },
        });
        const day0 = new Date(`${day(0)}T00:00:00Z`);
        await a.prisma.surveyEvent.createMany({
          data: [
            { surveyId: id, kind: "VIEW", userId: a.people[w].id, day: day0 },
            { surveyId: id, kind: "START", userId: a.people[w].id, day: day0 },
            { surveyId: id, kind: "COMPLETE", day: day0 },
          ],
        });
      }
      return names;
    };
    const detail = async (id: string) => {
      const d = (await get(`/admin/surveys/${id}`, "adman").expect(200)).body;
      return [d.responses, d.starts, d.completes];
    };
    const finish = (id: string) =>
      a.prisma.sponsoredSurvey.update({
        where: { id },
        data: { endsOn: new Date(`${day(-1)}T00:00:00Z`) },
      });

    it.each([
      [6, 1, [5, 5, 5]],
      [7, 3, [4, 4, 4]],
      [51, 1, [50, 50, 50]],
    ])("%i answers, %i purged: staff totals stay level", async (n, k, want) => {
      await setMin(5);
      const id = await live();
      const names = await people(id, n, `m${n}x`);
      expect(await detail(id)).toEqual([n, n, n]);
      await finish(id);
      await get(`/admin/surveys/${id}/report`, "admin").expect(200);
      for (let i = 0; i < k; i++) await purge(names[i]);
      expect(await detail(id)).toEqual(want);
      expect(
        await a.prisma.surveyEvent.count({
          where: { surveyId: id, userId: { not: null } },
        }),
      ).toBe(n - k > 0 ? (n - k) * 2 : 0);
      const list = (
        await get(`/admin/surveys?limit=50`, "adman").expect(200)
      ).body.items.find((x: any) => x.id === id);
      expect([list.responses, list.starts, list.completes]).toEqual(want);
    });

    it("from exactly 5: the brand report never shows starts while responses are hidden", async () => {
      await setMin(5);
      const id = await live();
      const names = await people(id, 5, "e5x");
      await finish(id);
      await purge(names[0]);
      await post(`/admin/surveys/${id}/release`, "admin").catch(
        () => undefined,
      );
      const snap = (
        await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } })
      ).reportSnapshot as any;
      expect(snap.totals.responses).toBeNull();
      expect(snap.totals.starts).toBeNull();
      await setMin(20);
    });
  });

  describe("M2: a released report keeps its numbers after a purge (owner: 'Numbers stay')", () => {
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
    const day0 = () => new Date(`${day(0)}T00:00:00Z`);
    /** `choice(i)` is the option index and `state(i)` the shared state of person i; each also has a text answer. */
    const crowd = async (
      id: string,
      n: number,
      tag: string,
      choice: (i: number) => number,
      state: (i: number) => string | null,
    ) => {
      const q = await a.prisma.surveyQuestion.findMany({
        where: { surveyId: id },
        include: { options: { orderBy: { position: "asc" } } },
        orderBy: { position: "asc" },
      });
      const names: string[] = [];
      for (let i = 0; i < n; i++) {
        const w = `${tag}${i}`;
        await a.person(w);
        names.push(w);
        const st = state(i);
        const r = await a.prisma.surveyResponse.create({
          data: {
            surveyId: id,
            respondentKey: respondentKey(id, a.people[w].id),
            shareDemo: st != null,
            state: st,
          },
        });
        await a.prisma.surveyAnswer.create({
          data: {
            responseId: r.id,
            questionId: q[0].id,
            optionId: q[0].options[choice(i)].id,
          },
        });
        await a.prisma.surveyAnswer.create({
          data: {
            responseId: r.id,
            questionId: q[1].id,
            text: `secret text of ${w}`,
          },
        });
        await a.prisma.surveyEvent.createMany({
          data: [
            { surveyId: id, kind: "VIEW", userId: a.people[w].id, day: day0() },
            {
              surveyId: id,
              kind: "START",
              userId: a.people[w].id,
              day: day0(),
            },
            { surveyId: id, kind: "COMPLETE", day: day0() },
          ],
        });
      }
      return names;
    };
    const release = async (id: string) => {
      await a.prisma.sponsoredSurvey.update({
        where: { id },
        data: { endsOn: new Date(`${day(-1)}T00:00:00Z`) },
      });
      await get(`/admin/surveys/${id}/report`, "admin").expect(200);
      let cursor: string | null = null;
      do {
        const pg: any = await get(
          `/admin/surveys/${id}/free-answers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
          "admin",
        ).expect(200);
        cursor = pg.body.nextCursor;
      } while (cursor);
    };
    const rep = async (id: string) =>
      (await get(`/admin/surveys/${id}/report`, "admin").expect(200)).body;
    const staff = async (id: string) => {
      const d = (await get(`/admin/surveys/${id}`, "adman").expect(200)).body;
      return [d.responses, d.starts, d.completes, d.views, d.skips];
    };
    /** The report with the text lists and the text question's own `answered` taken out: what must never change. */
    const numbers = (r: any) => {
      const c = JSON.parse(JSON.stringify(r));
      for (const q of c.questions)
        if (q.kind !== "SINGLE_CHOICE") {
          q.texts = [];
          q.voices = [];
          q.answered = null;
        }
      return JSON.stringify(c);
    };

    it("51 answers released (Rice 45, Other 6, Oyo 25, Lagos 26, 51 texts), one purge: every number identical, one text gone", async () => {
      await setMin(5);
      const id = await live();
      const names = await crowd(
        id,
        51,
        "rel51p",
        (i) => (i < 45 ? 0 : 1),
        (i) => (i < 25 ? "Oyo" : "Lagos"),
      );
      await release(id);
      await post(`/admin/surveys/${id}/release`, "admin").expect(200);
      const before = await rep(id);
      const q = before.questions[0];
      expect(q.options.find((o: any) => o.label === "Rice").count).toBe(45);
      expect(q.other.count).toBe(6);
      expect(before.questions[1].texts).toHaveLength(51);
      const staffBefore = await staff(id);
      await purge(names[3]);
      const after = await rep(id);
      expect(numbers(after)).toBe(numbers(before));
      expect(after.questions[1].texts).toHaveLength(50);
      expect(after.questions[1].texts).not.toContain(
        `secret text of ${names[3]}`,
      );
      // Round 7 (lead ruling, "Numbers stay"): was 50. `answered` is frozen at release, so it stays 51 while 50 items are listed.
      expect(after.questions[1].answered).toBe(51);
      expect(await staff(id)).toEqual(staffBefore); // staff totals: no visible change
      expect(await staff(id)).toEqual([51, 51, 51, 51, 0]);
      // nothing of the person stays in any table
      expect(
        await a.prisma.surveyResponse.count({
          where: { respondentKey: respondentKey(id, a.people[names[3]].id) },
        }),
      ).toBe(0);
      expect(
        await a.prisma.surveyEvent.count({
          where: { userId: a.people[names[3]].id },
        }),
      ).toBe(0);
      const dump = await a.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT (SELECT count(*) FROM "SurveyAnswer" WHERE "text" = 'secret text of ${names[3]}')
              + (SELECT count(*) FROM "SponsoredSurvey" WHERE "releasedReport"::text LIKE '%of ${names[3]}"%' OR "reportSnapshot"::text LIKE '%of ${names[3]}"%')  AS n`,
      );
      expect(Number(dump[0].n)).toBe(0);
      // a second release is refused: a released report is rebuilt by nothing
      await post(`/admin/surveys/${id}/release`, "admin").expect(409);
      expect(numbers(await rep(id))).toBe(numbers(before));
    });

    it("24 answers, 12 Lagos and 12 Oyo, one purge: still 12 and 12; three purges in a row change no number", async () => {
      await setMin(5);
      const id = await live();
      const names = await crowd(
        id,
        24,
        "s24x",
        (i) => i % 2,
        (i) => (i < 12 ? "Lagos" : "Oyo"),
      );
      await release(id);
      await post(`/admin/surveys/${id}/release`, "admin").expect(200);
      const before = await rep(id);
      const states = before.byState.map((x: any) => [x.state, x.responses]);
      expect(states).toEqual(
        expect.arrayContaining([
          ["Lagos", 12],
          ["Oyo", 12],
        ]),
      );
      await purge(names[0]);
      expect(
        (await rep(id)).byState.map((x: any) => [x.state, x.responses]),
      ).toEqual(states);
      await purge(names[1]);
      await purge(names[13]);
      const after = await rep(id);
      expect(numbers(after)).toBe(numbers(before));
      expect(after.questions[1].texts).toHaveLength(21);
      expect(await staff(id)).toEqual([24, 24, 24, 24, 0]);
    });

    it.each([5, 6])(
      "exactly %i released, then one purge: numbers stay, the person's text is gone",
      async (n) => {
        await setMin(5);
        const id = await live();
        const names = await crowd(
          id,
          n,
          `e${n}x`,
          () => 0,
          () => null,
        );
        await release(id);
        await post(`/admin/surveys/${id}/release`, "admin").expect(200);
        const before = await rep(id);
        await purge(names[0]);
        const after = await rep(id);
        expect(numbers(after)).toBe(numbers(before));
        expect(JSON.stringify(after)).not.toContain(`of ${names[0]}"`);
        expect(after.questions[1].texts).toHaveLength(
          before.questions[1].texts.length - 1,
        );
      },
    );

    it("before release nothing changes from round 6 M1: the totals fall together", async () => {
      await setMin(5);
      const id = await live();
      const names = await crowd(
        id,
        7,
        "pre7x",
        () => 0,
        () => null,
      );
      await release(id);
      await purge(names[0]);
      expect(await staff(id)).toEqual(
        [6, 6, 6, 7, 0].map((v, i) => (i === 3 ? 6 : v)),
      );
    });

    it("a purge and the release at the same moment: the person is in the numbers and their text is gone, or in neither", async () => {
      await setMin(5);
      for (const round of [0, 1, 2]) {
        const id = await live();
        const names = await crowd(
          id,
          8,
          `race${round}x`,
          () => 0,
          () => null,
        );
        await release(id);
        const [, rel] = await Promise.all([
          purge(names[2]),
          post(`/admin/surveys/${id}/release`, "admin"),
        ]);
        expect([200, 409]).toContain(rel.status);
        const r = await rep(id);
        expect(JSON.stringify(r)).not.toContain(`of ${names[2]}"`);
        const texts = r.questions[1].texts.length;
        expect(texts).toBe(7);
        expect([7, 8]).toContain(r.totals.responses);
        // Round 7: was 7. `answered` is as released: 8 if the release came first, 7 if the purge did.
        expect(r.questions[1].answered).toBe(r.totals.responses);
      }
    });
  });

  describe("L4: the review list pages quickly", () => {
    it("a page of 50 from a survey with many answers (timing printed; R6_N sets the size)", async () => {
      await setMin(5);
      const id = await live();
      await fill(
        id,
        Number(process.env.R6_N ?? 5000),
        (i) => `answer number ${i} about jollof rice and plantain`,
      );
      await a.prisma.sponsoredSurvey.update({
        where: { id },
        data: { endsOn: new Date(`${day(-1)}T00:00:00Z`) },
      });
      await get(`/admin/surveys/${id}/report`, "admin").expect(200);
      const t0 = Date.now();
      const first = await get(
        `/admin/surveys/${id}/free-answers`,
        "admin",
      ).expect(200);
      const cold = Date.now() - t0;
      const t1 = Date.now();
      const second = await get(
        `/admin/surveys/${id}/free-answers?cursor=${encodeURIComponent(first.body.nextCursor)}`,
        "admin",
      ).expect(200);
      const warm = Date.now() - t1;
      console.log(`free-answers: cold ${cold} ms, next page ${warm} ms`);
      expect(first.body.items).toHaveLength(50);
      expect(first.body.total).toBe(Number(process.env.R6_N ?? 5000));
      expect(second.body.items).toHaveLength(50);
      expect(warm).toBeLessThan(500);
      await setMin(20);
    }, 600_000);
  });
});
