/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- response bodies are read as loose JSON */
import { randomUUID } from "node:crypto";
import { sql } from "../me/helpers";
import { bootAdmin, type Admin } from "./helpers";

/**
 * V-SURVEYS round 3: review handles, the paged review list that release needs, answered counts that give no small
 * difference, control characters refused, closed surveys, one clip one answer, brand page and brand names.
 */
const api = "/api/v1";

describe("V-SURVEYS round 3", () => {
  let a: Admin;
  const day = (n: number) =>
    new Date(Date.now() + n * 86_400_000 + 3_600_000)
      .toISOString()
      .slice(0, 10);
  const body = (over: Record<string, unknown> = {}) => ({
    brandName: "Round Three Foods",
    contactEmail: "r3@brand.test",
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
  const get = (path: string, who: string | null) => {
    const r = a.h.http().get(`${api}${path}`);
    return who ? r.set(a.auth(who)) : r;
  };
  const patch = (path: string, who: string, data: object) =>
    a.h.http().patch(`${api}${path}`).set(a.auth(who)).send(data);
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
  /** `n` responses: the first `texts.length` carry a written answer, each also picks an option. */
  const store = async (id: string, n: number, texts: string[] = []) => {
    const q = await questions(id);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await a.prisma.surveyResponse.create({
        data: { surveyId: id, respondentKey: randomUUID() },
      });
      await a.prisma.surveyAnswer.create({
        data: {
          responseId: r.id,
          questionId: q[0].id,
          optionId: q[0].options[i % 3].id,
        },
      });
      if (texts[i]) {
        const t = await a.prisma.surveyAnswer.create({
          data: { responseId: r.id, questionId: q[1].id, text: texts[i] },
        });
        ids.push(t.id);
      }
    }
    return ids;
  };
  const finish = (id: string) =>
    a.prisma.sponsoredSurvey.update({
      where: { id },
      data: { endsOn: new Date(`${day(-1)}T00:00:00Z`) },
    });
  const report = async (id: string) =>
    (await get(`/admin/surveys/${id}/report`, "adman").expect(200)).body;
  const setMin = (n: number) =>
    a.prisma.configEntry.upsert({
      where: { key: "weekly.min_group_size" },
      create: { key: "weekly.min_group_size", valueJson: n },
      update: { valueJson: n },
    });

  beforeAll(async () => {
    a = await bootAdmin();
    await sql(
      `TRUNCATE "SponsoredSurvey", "Brand", "SurveyResponse", "MailLog", "Ad", "UserSettings" RESTART IDENTITY CASCADE`,
    );
    await a.person("admin", ["ADMIN"]);
    await a.person("adman", ["AD_MANAGER"]);
    await a.person("mod", ["MODERATOR"]);
    await a.person("lagos");
    await a.person("plain");
    await setMin(3);
  });
  afterAll(async () => {
    await a.close();
  });

  describe("M-C and M-D: review handles, the paged list, release needs the read", () => {
    it("items carry a handle, never the answer's id; hide takes the handle; the list stays alphabetical", async () => {
      const id = await live();
      const dbIds = await store(id, 6, [
        "zeta",
        "alpha",
        "mike",
        "bravo",
        "yank",
        "kilo",
      ]);
      await finish(id);
      const list = (
        await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200)
      ).body;
      expect(list.total).toBe(6);
      expect(list.items.map((x: any) => x.text)).toEqual([
        "alpha",
        "bravo",
        "kilo",
        "mike",
        "yank",
        "zeta",
      ]);
      for (const it of list.items) {
        expect(it.id).toMatch(/^[0-9a-f]{32}$/);
        expect(dbIds).not.toContain(it.id);
      }
      expect(JSON.stringify(list)).not.toMatch(new RegExp(dbIds.join("|")));
      // the route does not take the answer's own id, nor an unknown handle
      await patch(`/admin/surveys/${id}/free-answers/${dbIds[0]}`, "adman", {
        hidden: true,
      }).expect(404);
      await patch(
        `/admin/surveys/${id}/free-answers/${"0".repeat(32)}`,
        "adman",
        { hidden: true },
      ).expect(404);
      const first = list.items[0];
      expect(
        (
          await patch(
            `/admin/surveys/${id}/free-answers/${first.id}`,
            "adman",
            { hidden: true },
          ).expect(200)
        ).body,
      ).toEqual({ id: first.id, hidden: true });
      const audit = await a.prisma.auditLog.findMany({
        where: { targetId: id, action: "survey.free.hide" },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].after).toEqual({ handle: first.id });
      // a handle of another survey is not found here
      const other = await live();
      await store(other, 3, ["x1", "x2", "x3"]);
      await finish(other);
      const ol = (
        await get(`/admin/surveys/${other}/free-answers`, "adman").expect(200)
      ).body;
      await patch(
        `/admin/surveys/${id}/free-answers/${ol.items[0].id}`,
        "adman",
        { hidden: true },
      ).expect(404);
    });

    it("release is refused until the last page of the list was served; later hide and show clear nothing", async () => {
      const id = await live();
      await store(id, 5, ["a1", "b2", "c3", "d4", "e5"]);
      await finish(id);
      const rel = () => post(`/admin/surveys/${id}/release`, "adman");
      // before any read
      expect((await rel().expect(409)).body.error.message).toBe(
        "Read the written answers before releasing the results.",
      );
      const p1 = (
        await get(`/admin/surveys/${id}/free-answers?limit=2`, "adman").expect(
          200,
        )
      ).body;
      expect(p1.items).toHaveLength(2);
      expect(p1.nextCursor).toEqual(expect.any(String));
      expect(
        (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
          .reviewedAt,
      ).toBeNull();
      await rel().expect(409);
      // a page link cannot be forged or moved to another admin
      await get(
        `/admin/surveys/${id}/free-answers?limit=2&cursor=4.${"a".repeat(24)}`,
        "adman",
      ).expect(422);
      await get(
        `/admin/surveys/${id}/free-answers?limit=2&cursor=${p1.nextCursor}`,
        "admin",
      ).expect(422);
      const p2 = (
        await get(
          `/admin/surveys/${id}/free-answers?limit=2&cursor=${p1.nextCursor}`,
          "adman",
        ).expect(200)
      ).body;
      expect(p2.items).toHaveLength(2);
      expect(p2.nextCursor).toEqual(expect.any(String));
      await rel().expect(409);
      const p3 = (
        await get(
          `/admin/surveys/${id}/free-answers?limit=2&cursor=${p2.nextCursor}`,
          "adman",
        ).expect(200)
      ).body;
      expect(p3.items).toHaveLength(1);
      expect(p3.nextCursor).toBeNull();
      const all = [...p1.items, ...p2.items, ...p3.items].map(
        (x: any) => x.text,
      );
      expect(all).toEqual(["a1", "b2", "c3", "d4", "e5"]);
      const row = await a.prisma.sponsoredSurvey.findUniqueOrThrow({
        where: { id },
      });
      expect(row.reviewedAt).not.toBeNull();
      expect(row.reviewedById).toBe(a.people.adman.id);
      // hide and show again: nothing is cleared
      await patch(
        `/admin/surveys/${id}/free-answers/${p1.items[0].id}`,
        "admin",
        { hidden: true },
      ).expect(200);
      await patch(
        `/admin/surveys/${id}/free-answers/${p1.items[0].id}`,
        "admin",
        { hidden: false },
      ).expect(200);
      expect(
        (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
          .reviewedAt,
      ).toEqual(row.reviewedAt);
      await post(`/admin/surveys/${id}/release`, "admin").expect(200);
    });

    it("a survey with no written or voice answers releases without a read, as before", async () => {
      const id = await live();
      await store(id, 4);
      await finish(id);
      await post(`/admin/surveys/${id}/release`, "adman").expect(200);
    });

    it("the list of a survey that is still running is 409, and a first page that is also the last stores the read", async () => {
      const id = await live();
      await get(`/admin/surveys/${id}/free-answers`, "adman").expect(409);
      await store(id, 3, ["one", "two", "three"]);
      await finish(id);
      const l = (
        await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200)
      ).body;
      expect(l.nextCursor).toBeNull();
      expect(
        (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
          .reviewedById,
      ).toBe(a.people.adman.id);
    });
  });

  describe("M-A and M-B through the API", () => {
    it("hiding enough answers that the rest is not a small gap keeps the list, and answered is the list length", async () => {
      await setMin(3);
      const id = await live();
      const texts = Array.from({ length: 9 }, (_, i) => `note number ${i}`);
      await store(id, 9, texts);
      await finish(id);
      const list = (
        await get(`/admin/surveys/${id}/free-answers`, "adman").expect(200)
      ).body;
      for (const it of list.items.slice(0, 3))
        await patch(`/admin/surveys/${id}/free-answers/${it.id}`, "adman", {
          hidden: true,
        }).expect(200);
      await post(`/admin/surveys/${id}/release`, "adman").expect(200);
      const r = await report(id);
      const q = r.questions[1];
      expect(q.texts).toHaveLength(6);
      expect(q.answered).toBe(6);
      // 9 responses, 6 listed: a gap of 3 is the floor: shown. A gap of 2 would not be (unit specs).
      expect(r.totals.responses).toBe(9);
      expect(r.questions[0].answered).toBe(9);
    });
  });

  describe("L-C: control characters are refused with 422", () => {
    it("on every new text input", async () => {
      const nul = "bad\u0000name";
      await post("/admin/brands", "adman", { name: nul }).expect(422);
      await post("/admin/brands", "adman", {
        name: "Fine Brand C",
        tagline: nul,
      }).expect(422);
      await post("/admin/brands", "adman", {
        name: "Fine Brand C",
        website: `https://x.test/${nul}`,
      }).expect(422);
      await post("/admin/brands", "adman", {
        name: "Fine Brand C",
        contactEmail: `a${nul}@b.test`,
      }).expect(422);
      await post("/admin/surveys", "adman", body({ title: nul })).expect(422);
      await post("/admin/surveys", "adman", body({ brandName: nul })).expect(
        422,
      );
      await post("/admin/surveys", "adman", body({ states: [nul] })).expect(
        422,
      );
      await post(
        "/admin/surveys",
        "adman",
        body({ questions: [{ kind: "TEXT", prompt: nul }] }),
      ).expect(422);
      await post(
        "/admin/surveys",
        "adman",
        body({
          questions: [
            { kind: "SINGLE_CHOICE", prompt: "ok?", options: ["A", nul] },
          ],
        }),
      ).expect(422);
      await post(
        "/admin/surveys",
        "adman",
        body({ title: "bell\u0007" }),
      ).expect(422);
      const id = (await post("/admin/surveys", "adman", body()).expect(201))
        .body.id;
      await post(`/admin/surveys/${id}/submit`, "adman").expect(200);
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "REJECT",
        reason: nul,
      }).expect(422);
      // a person's written answer
      const sid = await live();
      const q = await questions(sid);
      const res = await post(`/surveys/${sid}/responses`, "lagos", {
        answers: [{ questionId: q[1].id, text: `hello${nul}` }],
      }).expect(422);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
      // a tab and a new line are fine in a written answer
      await post(`/surveys/${sid}/responses`, "lagos", {
        answers: [{ questionId: q[1].id, text: "line one\nline two\tend" }],
      }).expect(201);
    });
  });

  describe("L-F, L-G, L-L: brand names, the mail limit, the brand page", () => {
    it("a zero-width space does not make a new brand name", async () => {
      await post("/admin/brands", "adman", { name: "Zero Width Co" }).expect(
        201,
      );
      await post("/admin/brands", "adman", { name: "Zero​Width Co" }).expect(
        409,
      );
      await post("/admin/brands", "adman", { name: "ZERO⁠WIDTH﻿CO" }).expect(
        409,
      );
      await post("/admin/brands", "adman", {
        name: "Zero Width Company",
      }).expect(201);
    });

    it("an empty BRAND_MAIL_DAILY_MAX is unset (50); a number is used", async () => {
      const { MailService } = await import("../../src/mail/mail.service.js");
      const svc = a.h.app.get(MailService);
      try {
        for (const v of ["", "  "]) {
          process.env.BRAND_MAIL_DAILY_MAX = v;
          expect([v, svc.brandDailyMax()]).toEqual([v, 50]);
        }
        process.env.BRAND_MAIL_DAILY_MAX = "7";
        expect(svc.brandDailyMax()).toBe(7);
        process.env.BRAND_MAIL_DAILY_MAX = "0";
        expect(svc.brandDailyMax()).toBe(0);
        process.env.BRAND_MAIL_DAILY_MAX = "abc";
        expect(svc.brandDailyMax()).toBe(50);
      } finally {
        delete process.env.BRAND_MAIL_DAILY_MAX;
      }
    });

    it("a brand page lists only surveys that are live now", async () => {
      const b = (
        await post("/admin/brands", "adman", {
          name: "Page Live Foods",
        }).expect(201)
      ).body;
      const runningId = await live({ brandId: b.id, title: "Running one" });
      const endedId = await live({ brandId: b.id, title: "Ended one" });
      const fixedId = await live({ brandId: b.id, title: "Fixed one" });
      await finish(endedId);
      await a.prisma.sponsoredSurvey.update({
        where: { id: fixedId },
        data: { snapshotAt: new Date(), reportSnapshot: {} },
      });
      const page = (await get(`/brands/${b.slug}`, null).expect(200)).body;
      expect(page.surveys.map((s: any) => s.id)).toEqual([runningId]);
    });
  });

  describe("L-H, L-I, L-J: over is over, closed, one clip one answer", () => {
    it("a paused survey past its end date cannot be reopened by a date edit or a resume: the snapshot is taken in that request", async () => {
      const id = await live();
      await store(id, 4);
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(200);
      await finish(id);
      expect(
        (await a.prisma.sponsoredSurvey.findUniqueOrThrow({ where: { id } }))
          .snapshotAt,
      ).toBeNull();
      await patch(`/admin/surveys/${id}`, "adman", { endsOn: day(30) }).expect(
        409,
      );
      const row = await a.prisma.sponsoredSurvey.findUniqueOrThrow({
        where: { id },
      });
      expect(row.snapshotAt).not.toBeNull();
      expect(row.endsOn?.toISOString().slice(0, 10)).toBe(day(-1));
      await post(`/admin/surveys/${id}/decision`, "admin", {
        decision: "RESUME",
      }).expect(409);
      // and a resume on its own, on another one
      const id2 = await live();
      await post(`/admin/surveys/${id2}/decision`, "admin", {
        decision: "PAUSE",
      }).expect(200);
      await finish(id2);
      await post(`/admin/surveys/${id2}/decision`, "admin", {
        decision: "RESUME",
      }).expect(409);
      expect(
        (
          await a.prisma.sponsoredSurvey.findUniqueOrThrow({
            where: { id: id2 },
          })
        ).snapshotAt,
      ).not.toBeNull();
    });

    it("answers that arrive after the target is reached get 409 'closed' (four at once, target 2)", async () => {
      const id = await live({ responseTarget: 2 });
      const q = await questions(id);
      const results = await Promise.all(
        ["lagos", "plain", "mod", "adman"].map((who) =>
          post(`/surveys/${id}/responses`, who, {
            answers: [{ questionId: q[0].id, optionId: q[0].options[0].id }],
          }),
        ),
      );
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 201, 409, 409]);
      for (const r of results.filter((x) => x.status === 409))
        expect(r.body.error.message).toBe("This survey has closed.");
      expect(
        await a.prisma.surveyResponse.count({ where: { surveyId: id } }),
      ).toBe(2);
    });

    it("one clip cannot answer two questions in one request", async () => {
      const id = await live({
        questions: [
          { kind: "VOICE", prompt: "First?" },
          { kind: "VOICE", prompt: "Second?" },
        ],
      });
      const q = await questions(id);
      const mk = () =>
        a.prisma.voiceClip.create({
          data: {
            ownerId: a.people.lagos.id,
            purpose: "SURVEY_ANSWER",
            status: "READY",
            rawKey: `raw/${randomUUID()}`,
            rawMime: "audio/webm",
            maxDurationMs: 60_000,
            durationMs: 5_000,
          },
        });
      const one = await mk();
      await post(`/surveys/${id}/responses`, "lagos", {
        answers: [
          { questionId: q[0].id, clipId: one.id },
          { questionId: q[1].id, clipId: one.id },
        ],
      }).expect(422);
      expect(
        await a.prisma.surveyAnswer.count({ where: { clipId: one.id } }),
      ).toBe(0);
      const two = await mk();
      await post(`/surveys/${id}/responses`, "lagos", {
        answers: [
          { questionId: q[0].id, clipId: one.id },
          { questionId: q[1].id, clipId: two.id },
        ],
      }).expect(201);
    });
  });

  describe("M-F: a survey clip is refused on every attach route that takes a clip", () => {
    it("answers, replies (forPublish), voice card and advert audio", async () => {
      const { ClipsService } = await import("../../src/media/clips.service.js");
      const clips = a.h.app.get(ClipsService);
      const c = await a.prisma.voiceClip.create({
        data: {
          ownerId: a.people.lagos.id,
          purpose: "SURVEY_ANSWER",
          status: "READY",
          rawKey: `raw/${randomUUID()}`,
          rawMime: "audio/webm",
          maxDurationMs: 60_000,
          durationMs: 5_000,
        },
      });
      const me = { id: a.people.lagos.id } as never;
      for (const purpose of ["ANSWER", "REPLY"] as const)
        await expect(clips.forPublish(me, c.id, purpose)).rejects.toBeDefined();
      await patch("/me/profile", "lagos", { voiceCardClipId: c.id }).expect(
        422,
      );
      await post("/admin/ads", "adman", {
        brand: "Clip Brand",
        kind: "FEED_CARD",
        headline: "With a survey clip",
        audioClipId: c.id,
      }).expect(422);
    });
  });
});
