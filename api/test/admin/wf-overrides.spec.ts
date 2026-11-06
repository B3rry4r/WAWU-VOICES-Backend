/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- tests read untyped JSON bodies */
import {
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type World,
} from "./harness";

const HOUR = 3_600_000;

describe("WF-1 override log: names (C-M7)", () => {
  let w: World;
  const T = lagosToday();
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  const emergency = () => ({
    headline: "Lagos floods: are you and your family safe?",
    contentKind: "TEXT",
    body: "Tell us where you are.",
    emergency: true,
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 25 * HOUR).toISOString(),
  });

  it("an emergency override made while the day's question is LIVE names that question, and byName is First L.", async () => {
    const week = await makeWeek(w.prisma, {
      weekNumber: 1,
      startsOn: plusDays(T, -2),
      status: "LIVE",
    });
    await sql(`UPDATE "Question" SET status = 'LIVE' WHERE id = $1`, [
      week.qs[2].id,
    ]);
    await sql(`UPDATE "User" SET "displayName" = 'Ngozi Eze' WHERE id = $1`, [
      w.editor.id,
    ]);
    const r = await w.api("post", "/admin/overrides", w.editor, emergency());
    expect(r.status).toBe(201);
    expect(r.body.replaced).not.toBeNull();
    expect(r.body.replaced.id).toBe(week.qs[2].id);
    expect(r.body.replaced.text).toBe("Week 1 day 3 question");
    expect(r.body.by).toBe("ed.editor");
    expect(r.body.byName).toBe("Ngozi E.");
    const list = await w.api("get", "/admin/overrides", w.editor);
    expect(list.body.items[0].replaced.id).toBe(week.qs[2].id);
    expect(list.body.items[0].byName).toBe("Ngozi E.");
  });

  it("a live question whose own day is not today (window still open) is still named", async () => {
    await w.api(
      "post",
      "/admin/overrides/" +
        (await sql<{ id: string }>(`SELECT id FROM "Override"`))[0].id +
        "/cancel",
      w.editor,
      { reason: "reset" },
    );
    await sql(`TRUNCATE "Question", "Topic" CASCADE`);
    const week = await makeWeek(w.prisma, {
      weekNumber: 5,
      startsOn: plusDays(T, -3),
      status: "LIVE",
    });
    // no question for today: the day-3 slot is moved away, yesterday's (day 3) stays live
    await sql(`UPDATE "Question" SET status = 'LIVE' WHERE id = $1`, [
      week.qs[2].id,
    ]);
    await sql(`DELETE FROM "Question" WHERE id = $1`, [week.qs[3].id]);
    const r = await w.api("post", "/admin/overrides", w.editor, emergency());
    expect(r.status).toBe(201);
    expect(r.body.replaced?.id).toBe(week.qs[2].id);
  });

  it("no display name falls back to the handle", async () => {
    await sql(`UPDATE "User" SET "displayName" = NULL WHERE id = $1`, [
      w.admin.id,
    ]);
    const r = await w.api("post", "/admin/overrides", w.admin, {
      ...emergency(),
      emergency: false,
      startsAt: new Date(Date.now() + 40 * HOUR).toISOString(),
      endsAt: new Date(Date.now() + 60 * HOUR).toISOString(),
    });
    expect(r.status).toBe(201);
    expect(r.body.byName).toBe("ada.admin");
  });
});
