/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- tests read untyped JSON bodies */
import { TopicsAdminService } from "../../src/admin/topics.service";
import {
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type World,
} from "./harness";

const HOUR = 3_600_000;

describe("WF-1 fix round 1: F2 override fallback is for the log only, F3 flash poll producer", () => {
  let w: World;
  const T = lagosToday();
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  const rows = (topicId: string) =>
    sql<Record<string, unknown>>(
      `SELECT id, "slotIndex", "scheduledFor", "startsAt", "endsAt", "isSpare", pinned, status FROM "Question" WHERE "topicId" = $1 AND kind <> 'OVERRIDE' ORDER BY id`,
      [topicId],
    );
  const planned = (dayOffset: number) => ({
    headline: "A planned message",
    contentKind: "TEXT",
    body: "Hello.",
    startsAt: new Date(Date.now() + dayOffset * 24 * HOUR).toISOString(),
    endsAt: new Date(Date.now() + (dayOffset * 24 + 20) * HOUR).toISOString(),
  });

  describe("F2", () => {
    it("a planned override on an empty day changes no other question and names nothing; the preview agrees", async () => {
      const wk = await makeWeek(w.prisma, {
        weekNumber: 70,
        startsOn: plusDays(T, -2),
        status: "LIVE",
      });
      // yesterday's question is LIVE and its window is still open; tomorrow (day 4) has no question
      await sql(`UPDATE "Question" SET status = 'LIVE' WHERE id = $1`, [
        wk.qs[1].id,
      ]);
      await sql(`DELETE FROM "Question" WHERE id = $1`, [wk.qs[3].id]);
      const before = await rows(wk.topic.id);
      const prev = await w.api(
        "post",
        "/admin/overrides/preview",
        w.editor,
        planned(1),
      );
      expect(prev.status).toBe(200);
      expect(prev.body.replaced).toBeNull();
      const made = await w.api(
        "post",
        "/admin/overrides",
        w.editor,
        planned(1),
      );
      expect(made.status).toBe(201);
      expect(made.body.replaced).toBeNull();
      expect(await rows(wk.topic.id)).toEqual(before);
      // a planned override while a question is LIVE at its start (starts now-ish) may name it, and still moves nothing it should not
      await sql(`TRUNCATE "Override" CASCADE`);
    });

    it("an emergency override still names the live question", async () => {
      await sql(`TRUNCATE "Question", "Topic" CASCADE`);
      const wk = await makeWeek(w.prisma, {
        weekNumber: 71,
        startsOn: plusDays(T, -3),
        status: "LIVE",
      });
      await sql(`UPDATE "Question" SET status = 'LIVE' WHERE id = $1`, [
        wk.qs[2].id,
      ]);
      await sql(`DELETE FROM "Question" WHERE id = $1`, [wk.qs[3].id]); // today has none
      const before = (await rows(wk.topic.id)).filter(
        (r) => r.id !== wk.qs[3].id,
      );
      const r = await w.api("post", "/admin/overrides", w.editor, {
        ...planned(0),
        emergency: true,
        endsAt: new Date(Date.now() + 20 * HOUR).toISOString(),
      });
      expect(r.status).toBe(201);
      expect(r.body.replaced?.id).toBe(wk.qs[2].id);
      expect(await rows(wk.topic.id)).toEqual(before);
    });
  });

  describe("F3: the flash poll producer", () => {
    const flash = (title: string) => ({
      kind: "FLASH",
      title,
      choiceMode: "SINGLE",
      options: ["Yes", "No"],
      startsAt: new Date(Date.now() - 1000)
        .toISOString()
        .replace(/\.\d+Z$/, "Z"),
      endsAt: new Date(Date.now() + 3 * HOUR).toISOString(),
    });
    const flashCount = (pollId: string) =>
      sql<{ n: string }>(
        `SELECT count(*)::text n FROM "Notification" WHERE type = 'FLASH_POLL' AND "targetId" = $1`,
        [pollId],
      ).then((r) => Number(r[0].n));
    const settle = async (pollId: string, want: number) => {
      for (let i = 0; i < 100; i++) {
        if ((await flashCount(pollId)) >= want) return;
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    it("alerts on: exactly one notification; alerts off, suspended, deleting: none; a rerun adds nothing", async () => {
      await sql(`TRUNCATE "Poll" CASCADE`);
      await sql(`UPDATE "UserSettings" SET "notifyFlashPolls" = false`);
      await sql(
        `UPDATE "UserSettings" SET "notifyFlashPolls" = true WHERE "userId" IN ($1, $2, $3, $4)`,
        [w.plain.id, w.editor.id, w.admin.id, w.moderator.id],
      );
      await sql(`UPDATE "User" SET status = 'SUSPENDED' WHERE id = $1`, [
        w.moderator.id,
      ]);
      await sql(
        `UPDATE "User" SET status = 'DELETION_PENDING', "deletionRequestedAt" = now() WHERE id = $1`,
        [w.admin.id],
      );
      const r = await w.api(
        "post",
        "/admin/polls",
        w.editor,
        flash("Should fuel cost less?"),
      );
      expect(r.status).toBe(201);
      await settle(r.body.id, 2);
      await new Promise((x) => setTimeout(x, 300));
      const got = await sql<{ userId: string; body: string; groupKey: string }>(
        `SELECT "userId", body, "groupKey" FROM "Notification" WHERE type = 'FLASH_POLL' AND "targetId" = $1`,
        [r.body.id],
      );
      expect(got.map((g) => g.userId).sort()).toEqual(
        [w.plain.id, w.editor.id].sort(),
      );
      expect(got[0].body).toBe("Should fuel cost less?");
      expect(got[0].groupKey).toBe(`flash:${r.body.id}`);
      // the person with alerts on sees it in their list; the one with alerts off does not
      const list = await w.api("get", "/notifications", w.plain);
      expect(
        list.body.items.filter((n: any) => n.type === "FLASH_POLL"),
      ).toHaveLength(1);
      // idempotent
      const again = await w.h.moduleRef
        .get(TopicsAdminService, { strict: false })
        .announceFlash(r.body.id);
      expect(again).toBe(0);
      expect(await flashCount(r.body.id)).toBe(2);
      await sql(
        `UPDATE "User" SET status = 'ACTIVE', "deletionRequestedAt" = NULL`,
      );
    });

    it("only one flash poll may be open: 2 parallel opens make 1 poll, the other is 409; /polls/current serves the one", async () => {
      await sql(`TRUNCATE "Poll" CASCADE`);
      const [a, b] = await Promise.all([
        w.api("post", "/admin/polls", w.editor, flash("First?")),
        w.api("post", "/admin/polls", w.admin2, flash("Second?")),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      const winner = a.status === 201 ? a : b;
      expect(loser.body.error.message).toBe("A flash poll is already open.");
      expect(
        await sql(`SELECT 1 FROM "Poll" WHERE kind = 'FLASH'`),
      ).toHaveLength(1);
      const cur = await w.h.http().get("/api/v1/polls/current").expect(200);
      expect(cur.body.id).toBe(winner.body.id);
      // after it ends a new one may open
      await sql(
        `UPDATE "Poll" SET "endsAt" = now() - interval '1 minute', status = 'CLOSED'`,
      );
      expect(
        (await w.api("post", "/admin/polls", w.editor, flash("Third?"))).status,
      ).toBe(201);
    });

    it("1,000 people: the admin request returns fast and every one of them is notified once", async () => {
      await sql(`TRUNCATE "Poll" CASCADE`);
      await sql(`DELETE FROM "Notification"`);
      await sql(`UPDATE "UserSettings" SET "notifyFlashPolls" = false`);
      await sql(
        `INSERT INTO "User"(id, "wawuId", handle, "referralCode", "countryCode", "updatedAt")
         SELECT gen_random_uuid(), 'bulk-' || g, 'bulk.' || g, 'BULK' || g, 'NG', now() FROM generate_series(1, 1000) g`,
      );
      await sql(
        `INSERT INTO "UserSettings"("userId", "notifyFlashPolls", "updatedAt") SELECT id, true, now() FROM "User" WHERE handle LIKE 'bulk.%'`,
      );
      const t0 = Date.now();
      const r = await w.api(
        "post",
        "/admin/polls",
        w.editor,
        flash("A thousand?"),
      );
      const took = Date.now() - t0;
      expect(r.status).toBe(201);
      expect(took).toBeLessThan(3000);
      await settle(r.body.id, 1000);
      expect(await flashCount(r.body.id)).toBe(1000);
      await settle(r.body.id, 1000);
      expect(
        (
          await sql<{ n: string }>(
            `SELECT count(DISTINCT "userId")::text n FROM "Notification" WHERE type = 'FLASH_POLL'`,
          )
        )[0].n,
      ).toBe("1000");
    });
  });
});
