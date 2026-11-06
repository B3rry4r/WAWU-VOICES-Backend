/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  dateOf,
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type World,
} from "../admin/harness";

const HOUR = 3_600_000;

describe("privacy P2-2: an override image that was purged before the claim is refused with 422", () => {
  let w: World;
  const T = lagosToday();
  beforeAll(async () => {
    w = await world();
    await makeWeek(w.prisma, {
      weekNumber: 1,
      startsOn: plusDays(T, -2),
      status: "LIVE",
    });
  });
  afterAll(() => w.close());

  const at = (day: string, hh: number) =>
    new Date(dateOf(day).getTime() + hh * HOUR - HOUR);
  const img = (name: string, over: object) =>
    w.prisma.storedFile.create({
      data: {
        ownerId: w.editor.id,
        kind: "OVERRIDE_IMAGE",
        key: `o/${name}.png`,
        mime: "image/png",
        confirmedAt: new Date(),
        ...over,
      },
    });
  const post = (imageFileId: string) =>
    w.api("post", "/admin/overrides", w.editor, {
      headline: "Lagos floods",
      contentKind: "IMAGE",
      imageFileId,
      startsAt: at(plusDays(T, 6), 9).toISOString(),
      endsAt: at(plusDays(T, 7), 9).toISOString(),
      keepWeeklyTheme: true,
    });

  it("a purged file gives 422 and writes no override or question; a live file still works", async () => {
    await sql(`TRUNCATE "Override" CASCADE`);
    const purged = await img("purged", { purgedAt: new Date() });
    const qBefore = await sql<{ n: string }>(
      `SELECT count(*) n FROM "Question" WHERE kind = 'OVERRIDE'`,
    );
    const r = await post(purged.id);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("VALIDATION_FAILED");
    expect(r.body.error.details.fields[0].path).toBe("imageFileId");
    expect((await sql(`SELECT 1 FROM "Override"`)).length).toBe(0);
    const qAfter = await sql<{ n: string }>(
      `SELECT count(*) n FROM "Question" WHERE kind = 'OVERRIDE'`,
    );
    expect(qAfter[0].n).toBe(qBefore[0].n);

    const live = await img("live", { purgeRequestedAt: new Date() });
    const ok = await post(live.id);
    expect(ok.status).toBe(201);
    const row = await w.prisma.storedFile.findUniqueOrThrow({
      where: { id: live.id },
    });
    expect(row.purgeRequestedAt).toBeNull();
  });
});
