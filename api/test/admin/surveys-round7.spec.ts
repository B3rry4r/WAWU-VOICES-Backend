/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- response bodies are read as loose JSON */
import { randomUUID } from "node:crypto";
import { sql } from "../me/helpers";
import { bootAdmin, type Admin } from "./helpers";
import { respondentKey } from "../../src/surveys/survey-rules";
import { DeletionService } from "../../src/me/deletion.service";

/**
 * V-SURVEYS round 7, M3: a purge takes out exactly the purged person's own listed items (by the answer id kept in the
 * stored report), `answered` stays as released, and no answer id is ever served.
 */
const api = "/api/v1";

describe("V-SURVEYS round 7: purge by answer id", () => {
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
      brandName: "Round Seven Foods",
      contactEmail: "r7@brand.test",
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
  const rep = async (id: string) =>
    (await get(`/admin/surveys/${id}/report`, "admin").expect(200)).body;
  const stored = async (id: string) =>
    (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
      .releasedReport as any;
  /** Every number of a report, with the two lists taken out. */
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
    await a.close();
  });

  it("13 people, floor 5, two say 'same voice', C's transcript lands after release: purging C changes nothing in the report", async () => {
    const id = await live();
    const qs = await questions(id);
    const names: string[] = [];
    for (let i = 0; i < 13; i++) {
      const n = `r7a${i}`;
      names.push(n);
    }
    // C is names[12]: no transcript at release. Two others say "same voice".
    const clips: Record<string, string | null> = {};
    for (let i = 0; i < 13; i++) {
      const voice =
        i === 12
          ? null
          : i >= 7
            ? undefined // no voice answer: 6 of the 13 have no item, so the list of 7 is not hidden by the gap rule
            : i === 0 || i === 1
              ? "same voice"
              : `voice ${i}`;
      clips[names[i]] = (
        await person(id, names[i], { text: `text ${i}`, voice }, qs)
      ).clipId;
    }
    await finish(id);
    await release(id).expect(200);
    const before = await rep(id);
    expect(before.questions[2].voices).toHaveLength(7);
    expect(before.questions[2].answered).toBe(7);
    // C's transcript lands after the release
    await a.prisma.transcript.create({
      data: {
        clipId: clips[names[12]] as string,
        status: "READY",
        text: "same voice",
      } as never,
    });
    await purge(names[12]);
    const after = await rep(id);
    expect(after.questions[2].voices).toEqual(before.questions[2].voices);
    expect(after.questions[2].answered).toBe(7);
    expect(after.questions[1].texts).toHaveLength(12); // C's own text was listed: it goes
    expect(after.questions[1].answered).toBe(13);
    expect(numbers(after)).toBe(numbers(before));
  });

  it("the same text twice, purge one: exactly that person's item goes, the other's stays", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = ["r7b0", "r7b1", "r7b2", "r7b3", "r7b4", "r7b5"];
    for (let i = 0; i < 6; i++)
      await person(
        id,
        names[i],
        { text: i < 2 ? "same words" : `own words ${i}` },
        qs,
      );
    await finish(id);
    await release(id).expect(200);
    const s0 = await stored(id);
    expect(
      s0.questions[1].texts.filter((t: string) => t === "same words"),
    ).toHaveLength(2);
    await purge(names[0]);
    const s1 = await stored(id);
    expect(
      s1.questions[1].texts.filter((t: string) => t === "same words"),
    ).toHaveLength(1);
    expect(s1.questions[1].texts).toHaveLength(5);
    // the item left is the other person's: its id is that person's answer row
    const left = await a.prisma.surveyAnswer.findMany({
      where: { id: { in: s1.questions[1].textIds }, text: "same words" },
      include: { response: true },
    });
    expect(left).toHaveLength(1);
    expect(left[0].response.respondentKey).toBe(
      respondentKey(id, a.people[names[1]].id),
    );
  });

  it("14 released, 10 purges: every number as released, 4 items left, answered 14", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = Array.from({ length: 14 }, (_, i) => `r7c${i}`);
    for (let i = 0; i < 14; i++)
      await person(
        id,
        names[i],
        { text: `text ${i}`, voice: `voice ${i}` },
        qs,
      );
    await finish(id);
    await release(id).expect(200);
    const before = await rep(id);
    for (let i = 0; i < 10; i++) await purge(names[i]);
    const after = await rep(id);
    expect(numbers(after)).toBe(numbers(before));
    expect(after.questions[1].texts).toHaveLength(4);
    expect(after.questions[2].voices).toHaveLength(4);
    expect(after.questions[1].answered).toBe(14);
    expect(after.questions[2].answered).toBe(14);
    expect(JSON.stringify(after)).not.toMatch(/text [0-9]"|voice [0-9]"/); // 0 to 9 are gone; 10 to 13 stay
    expect(after.questions[1].texts.sort()).toEqual([
      "text 10",
      "text 11",
      "text 12",
      "text 13",
    ]);
  });

  it("a scrub change between release and purge: the right item still goes", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = Array.from({ length: 6 }, (_, i) => `r7d${i}`);
    for (let i = 0; i < 6; i++)
      await person(id, names[i], { text: `Thanks.Us too ${i}.` }, qs);
    await finish(id);
    await release(id).expect(200);
    // simulate a changed scrub: the stored text of person 2 differs from what the scrub gives today
    const s = await stored(id);
    const row = await a.prisma.surveyAnswer.findFirstOrThrow({
      where: {
        text: "Thanks.Us too 2.",
        response: { surveyId: id },
      },
    });
    const at = s.questions[1].textIds.indexOf(row.id);
    expect(at).toBeGreaterThanOrEqual(0);
    s.questions[1].texts[at] = "[removed] too 2.";
    await a.prisma.sponsoredSurvey.update({
      where: { id },
      data: { releasedReport: s },
    });
    await purge(names[2]);
    const after = await stored(id);
    expect(after.questions[1].texts).toHaveLength(5);
    expect(after.questions[1].texts).not.toContain("[removed] too 2.");
    expect(after.questions[1].textIds).not.toContain(row.id);
  });

  it("a purge of a person with no item in the list takes out nothing", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = Array.from({ length: 6 }, (_, i) => `r7e${i}`);
    for (let i = 0; i < 5; i++)
      await person(id, names[i], { text: `t ${i}` }, qs);
    await person(id, names[5], { text: "t 0" }, qs);
    await a.prisma.surveyAnswer.updateMany({
      where: {
        response: { respondentKey: respondentKey(id, a.people[names[5]].id) },
        text: "t 0",
      },
      data: { hidden: true },
    });
    await finish(id);
    await release(id).expect(200);
    const before = await rep(id);
    await purge(names[5]); // hidden by staff: not in the list; the equal text of names[0] must stay
    const after = await rep(id);
    expect(after).toEqual(before);
  });

  it("a stored report without ids (none exists live): numbers stay; an item goes only on an exact match and only if answered before release", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = Array.from({ length: 6 }, (_, i) => `r7f${i}`);
    for (let i = 0; i < 6; i++)
      await person(id, names[i], { text: `old ${i}` }, qs);
    await finish(id);
    await release(id).expect(200);
    const s = await stored(id);
    for (const q of s.questions) {
      delete q.textIds;
      delete q.voiceIds;
    }
    await a.prisma.sponsoredSurvey.update({
      where: { id },
      data: { releasedReport: s },
    });
    // names[1] answered after the release (its time is moved forward): its text is not taken out
    await a.prisma.surveyAnswer.updateMany({
      where: {
        text: "old 1",
        response: { surveyId: id },
      },
      data: { createdAt: new Date(Date.now() + 3_600_000) },
    });
    const before = await rep(id);
    await purge(names[0]);
    await purge(names[1]);
    const after = await rep(id);
    expect(numbers(after)).toBe(numbers(before));
    expect(after.questions[1].texts).not.toContain("old 0");
    expect(after.questions[1].texts).toContain("old 1");
    expect(after.questions[1].texts).toHaveLength(5);
  });

  it("a purge and the release at the same moment, 20 rounds: the purged person is in no list, no half state", async () => {
    for (let round = 0; round < 20; round++) {
      const id = await live();
      const qs = await questions(id);
      const names = Array.from({ length: 8 }, (_, i) => `r7g${round}x${i}`);
      for (let i = 0; i < 8; i++)
        await person(
          id,
          names[i],
          { text: `race ${round} ${i}`, voice: `vrace ${round} ${i}` },
          qs,
        );
      await finish(id);
      const [, rel] = await Promise.all([purge(names[2]), release(id)]);
      expect([200, 409]).toContain(rel.status);
      const r = await rep(id);
      const j = JSON.stringify(r);
      expect(j).not.toContain(`race ${round} 2"`);
      expect(j).not.toContain(`vrace ${round} 2"`);
      expect(r.questions[1].texts).toHaveLength(7);
      expect(r.questions[2].voices).toHaveLength(7);
      expect([7, 8]).toContain(r.totals.responses);
      expect(r.questions[1].answered).toBe(r.totals.responses);
    }
  });

  it("no route returns an answer id: not the report, the detail, the list, the review list", async () => {
    const id = await live();
    const qs = await questions(id);
    const names = Array.from({ length: 6 }, (_, i) => `r7h${i}`);
    for (let i = 0; i < 6; i++)
      await person(id, names[i], { text: `see ${i}`, voice: `hear ${i}` }, qs);
    await finish(id);
    const free: any = await get(
      `/admin/surveys/${id}/free-answers`,
      "admin",
    ).expect(200);
    await release(id).expect(200);
    const ids = (
      await a.prisma.surveyAnswer.findMany({
        where: { response: { surveyId: id } },
      })
    ).map((x) => x.id);
    expect(ids.length).toBeGreaterThan(10);
    const bodies = [
      JSON.stringify(
        (await get(`/admin/surveys/${id}/report`, "admin").expect(200)).body,
      ),
      JSON.stringify(
        (await get(`/admin/surveys/${id}/report`, "adman").expect(200)).body,
      ),
      JSON.stringify(
        (await get(`/admin/surveys/${id}`, "adman").expect(200)).body,
      ),
      JSON.stringify((await get(`/admin/surveys`, "adman").expect(200)).body),
      JSON.stringify(free.body),
      JSON.stringify(
        (await get(`/admin/surveys/${id}/free-answers`, "admin").expect(200))
          .body,
      ),
    ];
    for (const b of bodies) {
      expect(b).not.toMatch(/textIds|voiceIds|answerId/);
      for (const x of ids) expect(b).not.toContain(x);
    }
    // the stored report does hold them (that is the point), and holds nothing else about a person
    const s = await stored(id);
    expect(s.questions[1].textIds).toHaveLength(6);
    expect(JSON.stringify(s)).not.toContain(a.people[names[0]].id);
  });
});
