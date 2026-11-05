/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- tests read untyped JSON bodies */
import { OverridesAdminService } from "../../src/admin/overrides.service";
import {
  dateOf,
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  uuid,
  world,
  type World,
} from "./harness";

const HOUR = 3_600_000;

describe("admin: override the day", () => {
  let w: World;
  const T = lagosToday();
  let week: Awaited<ReturnType<typeof makeWeek>>;
  let svc: OverridesAdminService;

  const weekRows = (topicId: string) =>
    sql<Record<string, unknown>>(
      `SELECT id, "slotIndex", "scheduledFor", "startsAt", "endsAt", "isSpare", pinned, status FROM "Question" WHERE "topicId" = $1 AND kind <> 'OVERRIDE' ORDER BY id`,
      [topicId],
    );

  beforeAll(async () => {
    w = await world();
    svc = w.h.moduleRef.get(OverridesAdminService, { strict: false });
    // today is day 3 of a live week: it began two days ago
    week = await makeWeek(w.prisma, {
      weekNumber: 1,
      startsOn: plusDays(T, -2),
      status: "LIVE",
    });
    await sql(`UPDATE "Question" SET pinned = true WHERE id = $1`, [
      week.qs[6].id,
    ]);
    await makeWeek(w.prisma, {
      weekNumber: 2,
      startsOn: plusDays(T, 5),
      status: "SCHEDULED",
    });
  });
  afterAll(() => w.close());

  const at = (day: string, hh: number, mm = 0) =>
    new Date(dateOf(day).getTime() + (hh * 60 + mm) * 60_000 - HOUR);
  const body = (over: Record<string, unknown> = {}) => ({
    headline: "Lagos floods: are you and your family safe?",
    contentKind: "TEXT",
    body: "Tell us where you are and what you see.",
    startsAt: at(plusDays(T, 1), 10, 30).toISOString(),
    endsAt: at(plusDays(T, 2), 10, 30).toISOString(),
    keepWeeklyTheme: true,
    ...over,
  });

  it("preview shows the week after the override and writes nothing", async () => {
    const before = await weekRows(week.topic.id);
    const r = await w.api("post", "/admin/overrides/preview", w.editor, body());
    expect(r.status).toBe(200);
    expect(r.body.replaced.id).toBe(week.qs[3].id); // tomorrow is day 4 of the week
    expect(r.body.replaced.kind).toBe("DAILY");
    const sched = r.body.schedule as {
      id: string;
      slotIndex: number | null;
      day: string | null;
      isSpare: boolean;
    }[];
    expect(sched.map((s) => s.slotIndex)).toEqual([5, 6, 7, null]);
    expect(sched[0].id).toBe(week.qs[3].id);
    expect(sched[0].day).toBe(plusDays(T, 2));
    expect(sched[3]).toMatchObject({
      id: week.qs[6].id,
      isSpare: true,
      day: null,
    });
    expect(await weekRows(week.topic.id)).toEqual(before);
    expect(await sql(`SELECT 1 FROM "Override"`)).toHaveLength(0);
    expect(
      await sql(`SELECT 1 FROM "AuditLog" WHERE action LIKE 'override.%'`),
    ).toHaveLength(0);
  });

  it("schedules an override: the replaced question moves a day, the rest follow, the last becomes a spare; other weeks untouched; audited", async () => {
    const other = await sql(
      `SELECT id, "scheduledFor", "slotIndex" FROM "Question" WHERE "topicId" <> $1 ORDER BY id`,
      [week.topic.id],
    );
    const r = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({ notifyAlert: true, reason: "Flood warning" }),
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      headline: "Lagos floods: are you and your family safe?",
      status: "SCHEDULED",
      contentKind: "TEXT",
      body: "Tell us where you are and what you see.",
      emergency: false,
      notifyAlert: true,
      keepWeeklyTheme: true,
      dropReplaced: false,
      by: "ed.editor",
      result: null,
    });
    expect(r.body.replaced.id).toBe(week.qs[3].id);
    expect(r.body.replaced.slotIndex).toBeUndefined();
    const rows = await sql<{
      id: string;
      slotIndex: number | null;
      scheduledFor: Date | null;
      isSpare: boolean;
      pinned: boolean;
      startsAt: Date | null;
    }>(
      `SELECT id, "slotIndex", "scheduledFor", "isSpare", pinned, "startsAt" FROM "Question" WHERE "topicId" = $1 AND kind = 'DAILY' ORDER BY "slotIndex" NULLS LAST, id`,
      [week.topic.id],
    );
    const by = new Map(rows.map((x) => [x.id, x]));
    expect(by.get(week.qs[3].id)).toMatchObject({ slotIndex: 5 });
    expect(by.get(week.qs[3].id)!.scheduledFor).toEqual(dateOf(plusDays(T, 2)));
    expect(by.get(week.qs[3].id)!.startsAt!.getTime()).toBe(
      dateOf(plusDays(T, 2)).getTime() - HOUR,
    );
    expect(by.get(week.qs[4].id)).toMatchObject({ slotIndex: 6 });
    expect(by.get(week.qs[5].id)).toMatchObject({ slotIndex: 7 });
    expect(by.get(week.qs[6].id)).toMatchObject({
      slotIndex: null,
      isSpare: true,
      pinned: false,
      scheduledFor: null,
    });
    // days before the override are untouched
    expect(by.get(week.qs[2].id)).toMatchObject({ slotIndex: 3 });
    expect(
      await sql(
        `SELECT id, "scheduledFor", "slotIndex" FROM "Question" WHERE "topicId" <> $1 AND kind <> 'OVERRIDE' ORDER BY id`,
        [week.topic.id],
      ),
    ).toEqual(other);
    const oq = (
      await sql<{
        kind: string;
        status: string;
        text: string;
        topicId: string;
        startsAt: Date;
        endsAt: Date;
      }>(
        `SELECT q.kind, q.status, q.text, q."topicId", q."startsAt", q."endsAt" FROM "Question" q JOIN "Override" o ON o."questionId" = q.id WHERE o.id = $1`,
        [r.body.id],
      )
    )[0];
    expect(oq).toMatchObject({
      kind: "OVERRIDE",
      status: "SCHEDULED",
      text: "Lagos floods: are you and your family safe?",
      topicId: week.topic.id,
    });
    expect(oq.endsAt.getTime() - oq.startsAt.getTime()).toBe(24 * HOUR);
    const a = await sql<{
      actorId: string;
      reason: string;
      before: any;
      after: any;
    }>(
      `SELECT "actorId", reason, before, after FROM "AuditLog" WHERE action = 'override.create' AND "targetId" = $1`,
      [r.body.id],
    );
    expect(a).toHaveLength(1);
    expect(a[0].actorId).toBe(w.editor.id);
    expect(a[0].reason).toBe("Flood warning");
    expect(a[0].before.replacedQuestionId).toBe(week.qs[3].id);
    expect(a[0].after.moves).toHaveLength(4);
    // a scheduled override has not started: no alert yet
    expect(
      await sql(`SELECT 1 FROM "Notification" WHERE type = 'OVERRIDE_ALERT'`),
    ).toHaveLength(0);
    // the week editor shows the same thing the preview promised
    const detail = await w.api(
      "get",
      `/admin/topics/${week.topic.id}`,
      w.editor,
    );
    expect(detail.body.questions.map((q: any) => q.slotIndex)).toEqual([
      1, 2, 3, 5, 6, 7,
    ]);
    expect(detail.body.spare.map((q: any) => q.id)).toContain(week.qs[6].id);
  });

  it("cancelling before it starts puts the whole week back exactly as it was", async () => {
    const list = await w.api("get", "/admin/overrides", w.editor);
    const id = list.body.items[0].id;
    expect(list.body.items[0].status).toBe("SCHEDULED");
    const none = await w.api(
      "post",
      `/admin/overrides/${id}/cancel`,
      w.editor,
      {},
    );
    expect(none.status).toBe(422);
    const r = await w.api("post", `/admin/overrides/${id}/cancel`, w.editor, {
      reason: "Flooding eased",
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      id,
      status: "CANCELLED",
      result: "Cancelled before it went live",
    });
    const rows = await weekRows(week.topic.id);
    const by = new Map(rows.map((x) => [x.id as string, x]));
    for (const [i, q] of week.qs.entries()) {
      expect(by.get(q.id)).toMatchObject({
        slotIndex: q.slotIndex,
        scheduledFor: q.scheduledFor,
        startsAt: q.startsAt,
        endsAt: q.endsAt,
        isSpare: false,
        status: "SCHEDULED",
        pinned: i === 6,
      });
    }
    const oq = (
      await sql<{ status: string }>(
        `SELECT q.status FROM "Question" q JOIN "Override" o ON o."questionId" = q.id WHERE o.id = $1`,
        [id],
      )
    )[0];
    expect(oq.status).toBe("CLOSED");
    const a = await sql<{ reason: string; after: any }>(
      `SELECT reason, after FROM "AuditLog" WHERE action = 'override.cancel' AND "targetId" = $1`,
      [id],
    );
    expect(a[0].reason).toBe("Flooding eased");
    expect(a[0].after.restoredQuestionIds).toHaveLength(4);
    const again = await w.api(
      "post",
      `/admin/overrides/${id}/cancel`,
      w.editor,
      { reason: "Once more" },
    );
    expect(again.status).toBe(409);
    expect(
      (
        await w.api("post", `/admin/overrides/${uuid}/cancel`, w.editor, {
          reason: "Nobody",
        })
      ).status,
    ).toBe(404);
  });

  it("an emergency override goes live at once: Today shows OVERRIDE_LIVE, the in-app alert goes out once, an overlapping override is 409", async () => {
    const nUsers = (
      await sql<{ n: string }>(
        `SELECT count(*) AS n FROM "User" WHERE status = 'ACTIVE'`,
      )
    )[0].n;
    const r = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({
        emergency: true,
        notifyAlert: true,
        startsAt: new Date(Date.now() + 5 * HOUR).toISOString(),
        endsAt: new Date(Date.now() + 25 * HOUR).toISOString(),
      }),
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "LIVE", emergency: true });
    expect(new Date(r.body.startsAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(r.body.replaced.id).toBe(week.qs[2].id); // today is day 3
    const oq = (
      await sql<{ status: string }>(
        `SELECT q.status FROM "Question" q JOIN "Override" o ON o."questionId" = q.id WHERE o.id = $1`,
        [r.body.id],
      )
    )[0];
    expect(oq.status).toBe("LIVE");
    expect(
      await sql(`SELECT 1 FROM "Notification" WHERE type = 'OVERRIDE_ALERT'`),
    ).toHaveLength(Number(nUsers));
    const today = await w.api("get", "/admin/today", w.editor);
    expect(today.status).toBe(200);
    expect(today.body.flowState).toBe("OVERRIDE_LIVE");
    expect(today.body.todaysQuestion).toMatchObject({
      kind: "OVERRIDE",
      text: "Lagos floods: are you and your family safe?",
    });
    expect(today.body.todaysQuestion.override).toMatchObject({
      contentKind: "TEXT",
      body: "Tell us where you are and what you see.",
    });
    expect(
      today.body.schedule.some((s: any) => s.title.startsWith("Override:")),
    ).toBe(true);
    expect(await svc.announce(r.body.id)).toBe(0); // a second send reaches nobody twice
    const clash = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({
        startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
        endsAt: new Date(Date.now() + 8 * HOUR).toISOString(),
      }),
    );
    expect(clash.status).toBe(409);
    expect(
      await sql(
        `SELECT 1 FROM "Override" WHERE status IN ('LIVE','SCHEDULED')`,
      ),
    ).toHaveLength(1);
  });

  it("cancelling a live override ends it now and gives the replaced question its day back", async () => {
    const id = (
      await sql<{ id: string }>(
        `SELECT id FROM "Override" WHERE status = 'LIVE'`,
      )
    )[0].id;
    const r = await w.api("post", `/admin/overrides/${id}/cancel`, w.admin, {
      reason: "Not needed after all",
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("CANCELLED");
    expect(r.body.result).toMatch(/^Ended early at /);
    const rows = await weekRows(week.topic.id);
    const by = new Map(rows.map((x) => [x.id as string, x]));
    expect(by.get(week.qs[2].id)).toMatchObject({
      slotIndex: 3,
      scheduledFor: week.qs[2].scheduledFor,
    });
    expect(by.get(week.qs[6].id)).toMatchObject({
      slotIndex: 7,
      isSpare: false,
      pinned: true,
    });
    const today = await w.api("get", "/admin/today", w.editor);
    expect(today.body.flowState).toBe("NORMAL");
    expect(today.body.todaysQuestion.id).toBe(week.qs[2].id);
  });

  it("drop the replaced question: it goes to the spares and nothing else moves", async () => {
    const before = await weekRows(week.topic.id);
    const r = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({
        dropReplaced: true,
        startsAt: at(plusDays(T, 3), 9).toISOString(),
        endsAt: at(plusDays(T, 4), 9).toISOString(),
      }),
    );
    expect(r.status).toBe(201);
    expect(r.body.dropReplaced).toBe(true);
    const after = await weekRows(week.topic.id);
    const changed = after.filter(
      (a, i) => JSON.stringify(a) !== JSON.stringify(before[i]),
    );
    expect(changed.map((c) => c.id)).toEqual([week.qs[5].id]); // the week began two days ago: T+3 is day 6
    expect(changed[0]).toMatchObject({
      isSpare: true,
      slotIndex: null,
      scheduledFor: null,
    });
  });

  it("refuses bad overrides in the one error shape and writes nothing", async () => {
    const n = (await sql(`SELECT 1 FROM "Override"`)).length;
    const f = async (over: Record<string, unknown>) =>
      await w.api("post", "/admin/overrides", w.editor, body(over));
    const field = (r: { body: any }) =>
      r.body.error.details.fields.map((x: any) => x.path);
    expect(
      field(
        await f({ startsAt: new Date(Date.now() - 3 * HOUR).toISOString() }),
      ),
    ).toContain("startsAt");
    expect(
      field(await f({ endsAt: at(plusDays(T, 1), 10, 0).toISOString() })),
    ).toContain("endsAt");
    expect(
      field(await f({ endsAt: at(plusDays(T, 1), 10, 35).toISOString() })),
    ).toContain("endsAt");
    expect(
      field(await f({ endsAt: at(plusDays(T, 12), 10, 30).toISOString() })),
    ).toContain("endsAt");
    expect(field(await f({ headline: undefined, body: undefined }))).toContain(
      "headline",
    );
    expect(field(await f({ contentKind: "VOICE" }))).toContain("voiceClipId");
    expect(
      field(await f({ contentKind: "VOICE", voiceClipId: uuid })),
    ).toContain("voiceClipId");
    expect(field(await f({ contentKind: "IMAGE" }))).toContain("imageFileId");
    expect(
      field(await f({ contentKind: "IMAGE", imageFileId: uuid })),
    ).toContain("imageFileId");
    expect(field(await f({ contentKind: "LINK" }))).toContain("linkUrl");
    expect(
      field(await f({ contentKind: "LINK", linkUrl: "http://example.com/a" })),
    ).toContain("linkUrl");
    expect(
      field(await f({ contentKind: "LINK", linkUrl: "javascript:alert(1)" })),
    ).toContain("linkUrl");
    expect(field(await f({ voiceClipId: uuid }))).toContain("voiceClipId");
    expect((await f({ headline: "x".repeat(121) })).status).toBe(422);
    expect((await f({ contentKind: "POSTER" })).status).toBe(422);
    expect((await f({ startsAt: "tomorrow" })).status).toBe(422);
    expect(await sql(`SELECT 1 FROM "Override"`)).toHaveLength(n);
  });

  it("a voice note must be a ready editor note; an image must be an uploaded override image; a link must be https", async () => {
    const clip = await w.prisma.voiceClip.create({
      data: {
        ownerId: w.editor.id,
        purpose: "OVERRIDE_NOTE",
        status: "READY",
        rawKey: "r/1",
        rawMime: "audio/webm",
        maxDurationMs: 30000,
        durationMs: 14000,
      },
    });
    const answerClip = await w.prisma.voiceClip.create({
      data: {
        ownerId: w.editor.id,
        purpose: "ANSWER",
        status: "READY",
        rawKey: "r/2",
        rawMime: "audio/webm",
        maxDurationMs: 10000,
      },
    });
    const file = await w.prisma.storedFile.create({
      data: {
        ownerId: w.editor.id,
        kind: "OVERRIDE_IMAGE",
        key: "o/1.png",
        mime: "image/png",
        confirmedAt: new Date(),
      },
    });
    const pending = await w.prisma.storedFile.create({
      data: {
        ownerId: w.editor.id,
        kind: "OVERRIDE_IMAGE",
        key: "o/2.png",
        mime: "image/png",
      },
    });
    const slot = {
      startsAt: at(plusDays(T, 6), 9).toISOString(),
      endsAt: at(plusDays(T, 7), 9).toISOString(),
    };
    expect(
      (
        await w.api(
          "post",
          "/admin/overrides/preview",
          w.editor,
          body({ ...slot, contentKind: "VOICE", voiceClipId: answerClip.id }),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await w.api(
          "post",
          "/admin/overrides/preview",
          w.editor,
          body({ ...slot, contentKind: "IMAGE", imageFileId: pending.id }),
        )
      ).status,
    ).toBe(422);
    const v = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({ ...slot, contentKind: "VOICE", voiceClipId: clip.id }),
    );
    expect(v.status).toBe(201);
    expect(
      (
        await sql<{ voiceClipId: string }>(
          `SELECT "voiceClipId" FROM "Override" WHERE id = $1`,
          [v.body.id],
        )
      )[0].voiceClipId,
    ).toBe(clip.id);
    await w.api("post", `/admin/overrides/${v.body.id}/cancel`, w.editor, {
      reason: "Test finished",
    });
    const i = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({ ...slot, contentKind: "IMAGE", imageFileId: file.id }),
    );
    expect(i.status).toBe(201);
    await w.api("post", `/admin/overrides/${i.body.id}/cancel`, w.editor, {
      reason: "Test finished",
    });
    const l = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({
        ...slot,
        contentKind: "LINK",
        linkUrl: "https://wawuafrica.com/help",
      }),
    );
    expect(l.status).toBe(201);
    expect(l.body.linkUrl).toBe("https://wawuafrica.com/help");
    await w.api("post", `/admin/overrides/${l.body.id}/cancel`, w.editor, {
      reason: "Test finished",
    });
  });

  it("the clock starts a due override once (with its alert) and ends it on time; the log reads Ran 24 hours", async () => {
    await sql(`TRUNCATE "Override", "Notification" CASCADE`);
    const r = await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({
        startsAt: at(plusDays(T, 6), 9).toISOString(),
        endsAt: at(plusDays(T, 7), 9).toISOString(),
        notifyAlert: true,
      }),
    );
    expect(r.status).toBe(201);
    expect((await svc.tick()).started).toBe(0);
    await sql(
      `UPDATE "Override" SET "startsAt" = now() - interval '1 hour', "endsAt" = now() + interval '23 hours' WHERE id = $1`,
      [r.body.id],
    );
    const t1 = await svc.tick();
    expect(t1.started).toBe(1);
    const nUsers = Number(
      (
        await sql<{ n: string }>(
          `SELECT count(*) AS n FROM "User" WHERE status = 'ACTIVE'`,
        )
      )[0].n,
    );
    expect(
      await sql(`SELECT 1 FROM "Notification" WHERE type = 'OVERRIDE_ALERT'`),
    ).toHaveLength(nUsers);
    expect((await svc.tick()).started).toBe(0);
    expect(
      await sql(`SELECT 1 FROM "Notification" WHERE type = 'OVERRIDE_ALERT'`),
    ).toHaveLength(nUsers);
    const live = await w.api("get", "/admin/overrides", w.editor);
    expect(live.body.items[0].status).toBe("LIVE");
    await sql(
      `UPDATE "Override" SET "startsAt" = now() - interval '25 hours', "endsAt" = now() - interval '1 hour' WHERE id = $1`,
      [r.body.id],
    );
    expect((await svc.tick()).ended).toBe(1);
    const q = (
      await sql<{ status: string }>(
        `SELECT q.status FROM "Question" q JOIN "Override" o ON o."questionId" = q.id WHERE o.id = $1`,
        [r.body.id],
      )
    )[0];
    expect(q.status).toBe("CLOSED");
    const log = await w.api("get", "/admin/overrides", w.editor);
    expect(log.body.items[0]).toMatchObject({
      id: r.body.id,
      status: "ENDED",
      result: "Ran 24 hours",
    });
    const cancel = await w.api(
      "post",
      `/admin/overrides/${r.body.id}/cancel`,
      w.editor,
      { reason: "Too late" },
    );
    expect(cancel.status).toBe(409);
  });

  it("the override log pages newest first", async () => {
    const all = await w.api("get", "/admin/overrides?limit=1", w.editor);
    expect(all.body.items).toHaveLength(1);
    const n = (await sql(`SELECT 1 FROM "Override"`)).length;
    expect(n).toBeGreaterThanOrEqual(1);
    await w.api(
      "post",
      "/admin/overrides",
      w.editor,
      body({
        startsAt: at(plusDays(T, 9), 9).toISOString(),
        endsAt: at(plusDays(T, 10), 9).toISOString(),
      }),
    );
    const p1 = await w.api("get", "/admin/overrides?limit=1", w.editor);
    const p2 = await w.api(
      "get",
      `/admin/overrides?limit=1&cursor=${p1.body.nextCursor}`,
      w.editor,
    );
    expect(p1.body.items[0].id).not.toBe(p2.body.items[0].id);
    expect(
      new Date(p1.body.items[0].createdAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(p2.body.items[0].createdAt).getTime());
  });

  it("30 parallel overrides for one window make exactly one", async () => {
    await sql(`TRUNCATE "Override" CASCADE`);
    const slot = {
      startsAt: at(plusDays(T, 3), 12).toISOString(),
      endsAt: at(plusDays(T, 4), 12).toISOString(),
    };
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        w.api(
          "post",
          "/admin/overrides",
          i % 2 ? w.editor : w.admin,
          body({ ...slot, headline: `Race ${i}` }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(29);
    expect(await sql(`SELECT 1 FROM "Override"`)).toHaveLength(1);
    // the week shifted once, not 30 times
    const slots = await sql<{ slotIndex: number | null }>(
      `SELECT "slotIndex" FROM "Question" WHERE "topicId" = $1 AND kind = 'DAILY' AND NOT "isSpare" ORDER BY "slotIndex"`,
      [week.topic.id],
    );
    expect(new Set(slots.map((s) => s.slotIndex)).size).toBe(slots.length);
  });
});
