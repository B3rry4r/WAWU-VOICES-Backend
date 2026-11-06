/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- tests read untyped JSON bodies */
import {
  lagosToday,
  makeWeek,
  plusDays,
  sql,
  world,
  type World,
} from "./harness";

/**
 * C-L8: the pg warning "Calling client.query() when the client is already executing a query" came from reads run in
 * parallel on one transaction's connection (Promise.all over tx). Every admin write that used to do that runs here, and
 * no such warning may be emitted.
 */
describe("WF-1 C-L8: no two queries at once on one transaction connection", () => {
  let w: World;
  const T = lagosToday();
  const seen: string[] = [];
  const onWarning = (e: Error) => seen.push(`${e.name}: ${e.message}`);
  beforeAll(async () => {
    process.on("warning", onWarning);
    w = await world();
  });
  afterAll(async () => {
    process.off("warning", onWarning);
    await w.close();
  });

  it("summary save, topic edits, calendar moves, overrides, ad approval and a moderation decision emit no pg warning", async () => {
    const wk = await makeWeek(w.prisma, {
      weekNumber: 60,
      startsOn: plusDays(T, 30),
      status: "DRAFT",
    });
    const sum = await w.api(
      "put",
      `/admin/topics/${wk.topic.id}/summary`,
      w.editor,
      {
        mainView: "Most voices so far lean towards written promises.",
        mainViewVoices: 5,
        opposingView: "Others say promises are never kept anyway.",
        opposingViewVoices: 2,
        pollLine: "The poll is split.",
        nextStepsLine: "The most supported ideas go to the editors.",
        approve: false,
      },
    );
    expect(sum.status).toBe(200);
    expect(
      (await w.api("get", `/admin/topics/${wk.topic.id}`, w.editor)).status,
    ).toBe(200);
    expect(
      (
        await w.api("patch", `/admin/topics/${wk.topic.id}`, w.editor, {
          title: "A new title for the week",
          blurb: "b",
          countryCode: "NG",
          startsOn: plusDays(T, 30),
          endsOn: plusDays(T, 36),
        })
      ).status,
    ).toBeLessThan(500);
    expect(
      (
        await w.api("post", `/admin/questions/${wk.qs[0].id}/move`, w.editor, {
          day: plusDays(T, 32),
        })
      ).status,
    ).toBe(200);
    const ov = await w.api("post", "/admin/overrides", w.editor, {
      headline: "Lagos floods: are you safe?",
      contentKind: "TEXT",
      body: "Tell us.",
      startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    });
    expect(ov.status).toBe(201);
    expect((await w.api("get", "/admin/overrides", w.editor)).status).toBe(200);
    const ad = await w.api("post", "/admin/ads", w.adManager, {
      brand: "Soup Ltd",
      kind: "FEED_CARD",
      headline: "Soup",
      linkUrl: "https://example.com",
      ctaLabel: "Go",
      states: ["Lagos"],
      startsOn: "2099-01-01",
      endsOn: "2099-02-01",
      frequencyCapPerDay: 2,
      priceKobo: 100000,
    });
    expect(
      (
        await w.api("post", `/admin/ads/${ad.body.id}/decision`, w.adManager, {
          decision: "APPROVE",
        })
      ).status,
    ).toBe(200);
    const q = await w.prisma.question.create({
      data: { text: "Q?", status: "LIVE", kind: "DAILY" },
    });
    const ans = await w.prisma.answer.create({
      data: { questionId: q.id, authorId: w.plain.id, kind: "TEXT", body: "x" },
    });
    const item = await w.prisma.moderationItem.create({
      data: {
        targetType: "ANSWER",
        targetId: ans.id,
        queue: "REPORTED",
        reasons: ["SCAM_OR_SPAM"],
        reportCount: 1,
      },
    });
    expect(
      (
        await w.api(
          "post",
          `/admin/moderation/items/${item.id}/action`,
          w.moderator,
          { action: "WARN", reason: "Careful." },
        )
      ).status,
    ).toBe(200);
    expect(
      (await w.api("get", `/admin/moderation/items/${item.id}`, w.moderator))
        .status,
    ).toBe(200);
    // the people's writes that used to include relations inside a transaction or an update
    await sql(
      `UPDATE "Question" SET "startsAt" = now() - interval '1 hour', "endsAt" = now() + interval '1 day', status = 'LIVE' WHERE id = $1`,
      [q.id],
    );
    const post = await w.h
      .http()
      .post(`/api/v1/questions/${q.id}/answers`)
      .set(w.admin2.auth)
      .set("Idempotency-Key", "wf-warn-1")
      .send({ kind: "TEXT", body: "my words" });
    expect(post.status).toBe(201);
    expect(
      (
        await w.h
          .http()
          .patch(`/api/v1/answers/${post.body.answer.id}`)
          .set(w.admin2.auth)
          .send({ body: "edited words" })
      ).status,
    ).toBe(200);
    const rep = await w.h
      .http()
      .post(`/api/v1/answers/${post.body.answer.id}/replies`)
      .set(w.plain.auth)
      .set("Idempotency-Key", "wf-warn-2")
      .send({ stance: "AGREE", kind: "TEXT", body: "agreed" });
    expect(rep.status).toBe(201);
    await new Promise((r) => setImmediate(r));
    await sql(`SELECT 1`);
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.filter((m) => /already executing a query/.test(m))).toEqual([]);
  });
});
