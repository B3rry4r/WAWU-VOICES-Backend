/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- response bodies are read as loose JSON */
import { randomUUID } from "node:crypto";
import { sql } from "../me/helpers";
import { bootAdmin, type Admin } from "./helpers";
import { respondentKey } from "../../src/surveys/survey-rules";
import { DeletionService } from "../../src/me/deletion.service";

/**
 * V-SURVEY-LIST-FLOOR (owner, 15 Nov 2026: "Hide a list under 5"): a released list left under the floor by a purge is
 * hidden everywhere it is served; `answered` and every other number stay as released.
 */
const api = "/api/v1";

describe("V-SURVEY-LIST-FLOOR: a released list under the floor is hidden", () => {
  let a: Admin;
  const day = (n: number) =>
    new Date(Date.now() + n * 86_400_000 + 3_600_000)
      .toISOString()
      .slice(0, 10);
  const post = (path: string, who: string, data?: object) =>
    a.h
      .http()
      .post(`${api}${path}`)
      .set(a.auth(who))
      .send(data ?? {});
  const get = (path: string, who: string) =>
    a.h.http().get(`${api}${path}`).set(a.auth(who));
  const setMin = (n: number) =>
    a.prisma.configEntry.upsert({
      where: { key: "weekly.min_group_size" },
      create: { key: "weekly.min_group_size", valueJson: n },
      update: { valueJson: n },
    });
  const live = async () => {
    const c = await post("/admin/surveys", "adman", {
      brandName: "List Floor Foods",
      contactEmail: "lf@brand.test",
      title: "What do you cook?",
      questions: [
        {
          kind: "SINGLE_CHOICE",
          prompt: "Which do you cook most?",
          options: ["Rice", "Beans", "Yam"],
        },
        { kind: "TEXT", prompt: "What would make cooking easier?" },
        { kind: "VOICE", prompt: "Say it" },
      ],
      startsOn: day(-3),
      endsOn: day(10),
      frequencyCapPerDay: 1,
      priceKobo: 5_000_000,
    }).expect(201);
    await post(`/admin/surveys/${c.body.id}/submit`, "adman").expect(200);
    await post(`/admin/surveys/${c.body.id}/decision`, "admin", {
      decision: "APPROVE",
    }).expect(200);
    return c.body.id as string;
  };
  interface P {
    text?: string;
    voice?: string | null; // null: a clip with no transcript yet; undefined: no voice answer
  }
  /** One person with a choice, an optional text and an optional voice answer. Returns the person's name and clip id. */
  const person = async (
    id: string,
    name: string,
    p: P,
    qs: any[],
  ): Promise<{ clipId: string | null }> => {
    await a.person(name);
    const r = await a.prisma.surveyResponse.create({
      data: {
        surveyId: id,
        respondentKey: respondentKey(id, a.people[name].id),
      },
    });
    await a.prisma.surveyAnswer.create({
      data: {
        responseId: r.id,
        questionId: qs[0].id,
        optionId: qs[0].options[0].id,
      },
    });
    if (p.text != null)
      await a.prisma.surveyAnswer.create({
        data: { responseId: r.id, questionId: qs[1].id, text: p.text },
      });
    let clipId: string | null = null;
    if (p.voice !== undefined) {
      const c = await a.prisma.voiceClip.create({
        data: {
          ownerId: a.people[name].id,
          purpose: "SURVEY_ANSWER",
          status: "READY",
          rawKey: `raw/${randomUUID()}`,
          rawMime: "audio/webm",
          maxDurationMs: 60_000,
          durationMs: 5_000,
        },
      });
      clipId = c.id;
      if (p.voice !== null)
        await a.prisma.transcript.create({
          data: { clipId: c.id, status: "READY", text: p.voice } as never,
        });
      await a.prisma.surveyAnswer.create({
        data: { responseId: r.id, questionId: qs[2].id, clipId: c.id },
      });
    }
    const day0 = new Date(`${day(0)}T00:00:00Z`);
    await a.prisma.surveyEvent.createMany({
      data: [
        { surveyId: id, kind: "VIEW", userId: a.people[name].id, day: day0 },
        { surveyId: id, kind: "START", userId: a.people[name].id, day: day0 },
        { surveyId: id, kind: "COMPLETE", day: day0 },
      ],
    });
    return { clipId };
  };
  const questions = (id: string) =>
    a.prisma.surveyQuestion.findMany({
      where: { surveyId: id },
      orderBy: { position: "asc" },
      include: { options: { orderBy: { position: "asc" } } },
    });
  /** The survey is over and the whole review list has been read, ready to release. */
  const finish = async (id: string) => {
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
  const release = (id: string) => post(`/admin/surveys/${id}/release`, "admin");
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
  const stored = async (id: string) =>
    (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
      .releasedReport as any;
  /** Every route that serves the released report or its items, as each role that can reach it. */
  const serve = async (id: string) => {
    const out: Record<string, any> = {};
    for (const who of ["admin", "adman"]) {
      out[`${who}:report`] = (
        await get(`/admin/surveys/${id}/report`, who).expect(200)
      ).body;
      out[`${who}:free`] = (
        await get(`/admin/surveys/${id}/free-answers`, who).expect(200)
      ).body;
      out[`${who}:detail`] = (
        await get(`/admin/surveys/${id}`, who).expect(200)
      ).body;
      out[`${who}:list`] = (await get(`/admin/surveys`, who).expect(200)).body;
    }
    return out;
  };
  const numbers = (r: any) => {
    const c = JSON.parse(JSON.stringify(r));
    for (const q of c.questions) {
      q.texts = [];
      q.voices = [];
    }
    return JSON.stringify(c);
  };

  beforeAll(async () => {
    a = await bootAdmin();
    await sql(
      `TRUNCATE "SponsoredSurvey", "Brand", "SurveyResponse", "MailLog", "Ad", "UserSettings" RESTART IDENTITY CASCADE`,
    );
    await a.person("admin", ["ADMIN"]);
    await a.person("adman", ["AD_MANAGER"]);
    await setMin(5);
  });
  afterAll(async () => {
    // leave nothing for the specs that run after this one on the shared database
    await sql(
      `TRUNCATE "SponsoredSurvey", "Brand", "SurveyResponse", "MailLog", "Ad" RESTART IDENTITY CASCADE`,
    );
    await sql(`DELETE FROM "ConfigEntry" WHERE key = 'weekly.min_group_size'`);
    await a.close();
  });

  it("7 written and 6 voice answers at floor 5: purges one by one; lists go empty at 4, answered stays, nothing serves the 4", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = Array.from({ length: 13 }, (_, i) => `lf${i}`);
    // 13 people: 7 wrote, 6 spoke (the gap rule needs the people without an item to be at least the floor)
    for (let i = 0; i < 13; i++)
      await person(
        id,
        names[i],
        {
          text: i < 7 ? `written ${i}` : undefined,
          voice: i < 6 ? `spoken ${i}` : undefined,
        },
        qs,
      );
    await finish(id);
    await release(id).expect(200);
    const before = (await serve(id))["admin:report"];
    expect(before.questions[1].texts).toHaveLength(7);
    expect(before.questions[2].voices).toHaveLength(6);
    // purge person 0 (has both): 6 written, 5 voice: both shown
    await purge(names[0]);
    let all = await serve(id);
    for (const w of ["admin", "adman"]) {
      expect(all[`${w}:report`].questions[1].texts).toHaveLength(6);
      expect(all[`${w}:report`].questions[2].voices).toHaveLength(5);
    }
    // purge 1 more: written 5 (stays), voice 4 (hidden)
    await purge(names[1]);
    all = await serve(id);
    for (const w of ["admin", "adman"]) {
      expect(all[`${w}:report`].questions[1].texts).toHaveLength(5);
      expect(all[`${w}:report`].questions[2].voices).toEqual([]);
      expect(all[`${w}:report`].questions[2].answered).toBe(6);
      expect(
        all[`${w}:free`].items.filter((x: any) => x.kind === "VOICE"),
      ).toEqual([]);
    }
    // purge 2 more: written 3 (hidden)
    await purge(names[2]);
    all = await serve(id);
    const rep = all["admin:report"];
    expect(rep.questions[1].texts).toEqual([]);
    expect(rep.questions[1].answered).toBe(7);
    expect(rep.questions[2].answered).toBe(6);
    expect(numbers(rep)).toBe(numbers({ ...before, released: true }));
    for (const [k, v] of Object.entries(all)) {
      const j = JSON.stringify(v);
      for (const i of [3, 4, 5, 6])
        expect([k, j]).not.toEqual([
          k,
          expect.stringContaining(`written ${i}"`),
        ]);
      for (const i of [3, 4, 5]) expect(j).not.toContain(`spoken ${i}"`);
      expect(j).not.toMatch(/textIds|voiceIds/);
    }
    const s = await stored(id);
    expect(s.questions[1].texts).toEqual([]);
    expect(s.questions[1].textIds).toEqual([]);
    expect(s.questions[2].voices).toEqual([]);
    expect({
      ...s.questions[0],
      textIds: undefined,
      voiceIds: undefined,
    }).toEqual(
      JSON.parse(
        JSON.stringify({
          ...before.questions[0],
          textIds: undefined,
          voiceIds: undefined,
        }),
      ),
    );
  });

  it("a report stored before this change with 3 listed items is served empty to ADMIN and AD_MANAGER", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = Array.from({ length: 6 }, (_, i) => `lfo${i}`);
    for (let i = 0; i < 6; i++)
      await person(id, names[i], { text: `old ${i}` }, qs);
    await finish(id);
    await release(id).expect(200);
    const s = await stored(id);
    const t = s.questions[1];
    t.texts = t.texts.slice(0, 3);
    t.textIds = t.textIds.slice(0, 3);
    await a.prisma.sponsoredSurvey.update({
      where: { id },
      data: { releasedReport: s },
    });
    const all = await serve(id);
    for (const w of ["admin", "adman"]) {
      expect(all[`${w}:report`].questions[1].texts).toEqual([]);
      expect(all[`${w}:report`].questions[1].answered).toBe(6);
    }
    expect(JSON.stringify(all)).not.toMatch(/"old [0-9]"/);
  });

  it("a purge and a second purge at the same moment, 20 rounds: no half state, no 5xx", async () => {
    for (let round = 0; round < 20; round++) {
      const id = await live();
      const qs = await questions(id);
      const names = Array.from({ length: 6 }, (_, i) => `lfr${round}x${i}`);
      for (let i = 0; i < 6; i++)
        await person(
          id,
          names[i],
          { text: `r ${round} ${i}`, voice: `v ${round} ${i}` },
          qs,
        );
      await finish(id);
      await release(id).expect(200);
      await Promise.all([purge(names[0]), purge(names[1])]);
      const rep = (
        await get(`/admin/surveys/${id}/report`, "admin").expect(200)
      ).body;
      // 6 - 2 = 4 left in each list: under the floor of 5, so both are empty; answered stays 6
      expect(rep.questions[1].texts).toEqual([]);
      expect(rep.questions[2].voices).toEqual([]);
      expect(rep.questions[1].answered).toBe(6);
      expect(rep.questions[2].answered).toBe(6);
      const s = await stored(id);
      expect(s.questions[1].texts).toEqual([]);
      expect(s.questions[2].voices).toEqual([]);
      expect(s.questions[1].textIds).toEqual([]);
      const rest = await get(`/admin/surveys/${id}/free-answers`, "adman");
      expect(rest.status).toBe(200);
      expect(rest.body.items).toEqual([]);
    }
  }, 300_000);
});
