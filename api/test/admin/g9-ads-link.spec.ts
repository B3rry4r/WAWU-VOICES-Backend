/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- tests read untyped JSON bodies */
import { bootAdmin, type Admin } from "./helpers";

/** G9 (walk C, L3): the Ads form hint says "starting with https://", so an http:// link is not a working link. */
describe("G9: an advert link must start with https://", () => {
  let a: Admin;
  const base = "/api/v1/admin/ads";
  const body = (over: Record<string, unknown> = {}) => ({
    brand: "Mama Nkechi's Kitchen",
    kind: "AUDIO_SLOT",
    headline: "Hear this week's soup of the day",
    linkUrl: "https://example.com/soup",
    ctaLabel: "Visit page",
    states: ["Lagos"],
    startsOn: "2026-12-02",
    endsOn: "2026-12-15",
    frequencyCapPerDay: 3,
    priceKobo: 5000000,
    ...over,
  });
  beforeAll(async () => {
    a = await bootAdmin();
    await a.person("adman", ["AD_MANAGER"]);
  });
  afterAll(async () => a.close());

  it("refuses an http:// link on create and on edit; an https:// link passes the working-link check", async () => {
    const bad = await a.h
      .http()
      .post(base)
      .set(a.auth("adman"))
      .send(body({ linkUrl: "http://example.com/soup" }))
      .expect(422);
    expect(JSON.stringify(bad.body)).toContain("https://");
    const ok = await a.h
      .http()
      .post(base)
      .set(a.auth("adman"))
      .send(body())
      .expect(201);
    await a.h
      .http()
      .patch(`${base}/${ok.body.id}`)
      .set(a.auth("adman"))
      .send({ linkUrl: "http://example.com/soup" })
      .expect(422);
    const checks = async () =>
      (
        (
          await a.h.http().get(base).set(a.auth("adman")).expect(200)
        ).body.items.find((x: any) => x.id === ok.body.id).checks as {
          text: string;
          ok: boolean;
        }[]
      ).find((c) => /working link/.test(c.text))!.ok;
    expect(await checks()).toBe(true);
    // a row that already holds an http:// link (made before this fix) fails the check
    await a.prisma.ad.update({
      where: { id: ok.body.id },
      data: { linkUrl: "http://example.com/soup" },
    });
    expect(await checks()).toBe(false);
  });
});
