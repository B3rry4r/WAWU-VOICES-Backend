/* eslint-disable @typescript-eslint/no-unsafe-member-access -- tests read untyped JSON bodies */
import { lagosToday, plusDays, world, type World } from "./harness";
import { WeeklyService } from "../../src/reach/weekly.service";

/** H5: a group under weekly.min_group_size is never approved, and never published. */
describe("H5 weekly report anonymity floor", () => {
  let w: World;
  const T = lagosToday();
  let wn = 700;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  async function report(themes: { label: string; count: number }[]) {
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
    return w.prisma.weeklyReport.create({
      data: {
        topicId: topic.id,
        status: "DRAFT",
        basedOnVoices: 80,
        basedOnVotes: 0,
        headline: "Tired but steady",
        summary: "Most voices say plans are made around the light.",
        themes,
      } as never,
    });
  }
  const approve = (id: string) =>
    w.api("post", `/admin/weekly-reports/${id}/approve`, w.editor, {
      publishAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

  it("approve is refused with the reason while any group is under the minimum, and nothing changes", async () => {
    const r = await report([
      { label: "Prices", count: 40 },
      { label: "Power", count: 5 },
    ]);
    const res = await approve(r.id);
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields[0].path).toBe("themes");
    expect(res.body.error.details.fields[0].message).toBe(
      "A group has fewer than 20 voices, so it could identify people. Take it out before approving.",
    );
    expect(
      (await w.prisma.weeklyReport.findUniqueOrThrow({ where: { id: r.id } }))
        .status,
    ).toBe("DRAFT");
    // the editor takes the small group out: approval goes through
    const fixed = await w.api(
      "patch",
      `/admin/weekly-reports/${r.id}`,
      w.editor,
      { themes: [{ label: "Prices", count: 40 }] },
    );
    expect(fixed.status).toBe(200);
    expect((await approve(r.id)).status).toBe(200);
  });

  it("the floor is the config value, exactly at it is allowed", async () => {
    const ok = await report([{ label: "Prices", count: 20 }]);
    expect((await approve(ok.id)).status).toBe(200);
  });

  it("publish skips a report whose group is under the floor (the floor was raised after approval) and holds it with the reason", async () => {
    const r = await report([{ label: "Prices", count: 25 }]);
    expect((await approve(r.id)).status).toBe(200);
    await w.prisma.weeklyReport.update({
      where: { id: r.id },
      data: { publishAt: new Date(Date.now() - 1000) },
    });
    await w.prisma.configEntry.upsert({
      where: { key: "weekly.min_group_size" },
      create: { key: "weekly.min_group_size", valueJson: 30 },
      update: { valueJson: 30 },
    });
    try {
      const weekly = w.h.app.get(WeeklyService, { strict: false });
      await weekly.publishDue();
      const after = await w.prisma.weeklyReport.findUniqueOrThrow({
        where: { id: r.id },
      });
      expect(after.status).toBe("HELD");
      expect(after.publishedAt).toBeNull();
      expect(after.heldNote).toContain("fewer than 30 voices");
    } finally {
      await w.prisma.configEntry.delete({
        where: { key: "weekly.min_group_size" },
      });
    }
  });
});
