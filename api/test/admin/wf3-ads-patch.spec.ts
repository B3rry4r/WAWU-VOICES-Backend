/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- tests read untyped JSON bodies */
import { world, type World } from "./harness";

/** lead ruling WF, 6 Nov (C-M8): the advert PATCH takes any subset of fields. */
describe("WF-4: advert PATCH is field by field", () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  const ad = {
    brand: "Zobo Co",
    kind: "FEED_CARD",
    headline: "Cold zobo",
    linkUrl: "https://example.com/zobo",
    ctaLabel: "Visit page",
    startsOn: "2099-01-01",
    endsOn: "2099-02-01",
    frequencyCapPerDay: 3,
    priceKobo: 5000000,
  };
  const paused = async () => {
    const c = await w.api("post", "/admin/ads", w.adManager, ad);
    expect(c.status).toBe(201);
    for (const decision of ["APPROVE", "PAUSE"])
      expect(
        (
          await w.api("post", `/admin/ads/${c.body.id}/decision`, w.adManager, {
            decision,
          })
        ).status,
      ).toBe(200);
    return c.body.id as string;
  };
  const status = async (id: string) =>
    (await w.prisma.ad.findUniqueOrThrow({ where: { id } })).status;

  it("create still needs brand, kind and headline", async () => {
    const r = await w.api("post", "/admin/ads", w.adManager, {
      startsOn: "2099-01-01",
    });
    expect(r.status).toBe(422);
  });
  it("a dates-only PATCH on a paused advert is 200 and the advert stays paused", async () => {
    const id = await paused();
    const r = await w.api("patch", `/admin/ads/${id}`, w.adManager, {
      startsOn: "2099-01-05",
      endsOn: "2099-03-01",
    });
    expect(r.status).toBe(200);
    expect(await status(id)).toBe("PAUSED");
    const row = await w.prisma.ad.findUniqueOrThrow({ where: { id } });
    expect(row.startsOn?.toISOString().slice(0, 10)).toBe("2099-01-05");
    expect(row.headline).toBe("Cold zobo");
  });
  it("a headline change sends it back to approval", async () => {
    const id = await paused();
    const r = await w.api("patch", `/admin/ads/${id}`, w.adManager, {
      headline: "Colder zobo",
    });
    expect(r.status).toBe(200);
    expect(await status(id)).toBe("AWAITING_APPROVAL");
  });
  it("a start date after the saved end date is refused, and a bad field still 422s", async () => {
    const id = await paused();
    expect(
      (
        await w.api("patch", `/admin/ads/${id}`, w.adManager, {
          startsOn: "2099-06-01",
        })
      ).status,
    ).toBe(422);
    expect(
      (await w.api("patch", `/admin/ads/${id}`, w.adManager, { headline: "" }))
        .status,
    ).toBe(422);
    expect(await status(id)).toBe("PAUSED");
  });
});
