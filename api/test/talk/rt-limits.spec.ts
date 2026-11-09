import {
  makePerson,
  makeQuestion,
  startHarness,
  type Harness,
} from "./harness";

/**
 * Lead rulings RT2 and RT3 (6 Nov), at the app's own default global limit (THROTTLE_LIMIT unset, 600 a minute per
 * address). RT2: the web server forwards the visitor's X-Forwarded-For, so visitors are counted by their own address.
 */
const CODE = Date.now().toString(36).slice(-7).padStart(7, "a");

describe("per-address limits behind the web server and mobile carriers", () => {
  let h: Harness;
  let q: { id: string };
  beforeAll(async () => {
    h = await startHarness({ throttleLimit: "default" });
    q = await makeQuestion(h);
    await h.prisma.question.update({
      where: { id: q.id },
      data: { startsAt: new Date(Date.now() - 86_400_000) },
    });
    await h.prisma.shortLink.create({
      data: { code: CODE, objectType: "QUESTION", objectId: q.id },
    });
  });
  afterAll(() => h.close());

  it("RT2: 200 share-page renders in one minute from 200 addresses all succeed", async () => {
    for (let i = 0; i < 200; i++) {
      const r = await h
        .http()
        .get(`/api/v1/share/${CODE}`)
        .set(
          "X-Forwarded-For",
          `192.0.2.${i % 250}, 198.51.${Math.floor(i / 250)}.${i % 250}`,
        );
      expect(r.status).toBe(200);
    }
  });

  it("RT2: from one address the normal limit applies (900 a minute on the share page, LCH-09)", async () => {
    const get = () =>
      h
        .http()
        .get(`/api/v1/share/${CODE}`)
        .set("X-Forwarded-For", "203.0.113.200");
    let ok = 0;
    let first429 = 0;
    for (let i = 1; i <= 905; i++) {
      const r = await get();
      if (r.status === 200) ok++;
      else if (r.status === 429 && !first429) first429 = i;
    }
    expect(ok).toBe(900);
    expect(first429).toBe(901);
    // without a forwarded address every caller is the web server itself: one bucket, the thing RT2 prevents
  });

  it("RT3: 50 signed-in people behind one address, each loading Home and a question, get no 429", async () => {
    const people = await Promise.all(
      Array.from({ length: 50 }, () => makePerson(h)),
    );
    let total = 0;
    for (const p of people) {
      for (const path of [
        "/api/v1/home",
        `/api/v1/questions/${q.id}`,
        `/api/v1/questions/${q.id}/answers`,
      ]) {
        const r = await h
          .http()
          .get(path)
          .set("Authorization", p.auth)
          .set("X-Forwarded-For", "198.51.100.50");
        total++;
        // Home has no content in this empty test database (404); what matters is that nothing is limited
        expect([path, r.status === 429]).toEqual([path, false]);
        if (path !== "/api/v1/home") expect(r.status).toBe(200);
      }
    }
    expect(total).toBe(150); // more than the old 120 a minute, inside the new 600
  });
});
