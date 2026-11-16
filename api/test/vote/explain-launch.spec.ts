/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest bodies are untyped JSON */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importQuestions } from "../../src/feed/seed";
import type { SeedFile, WeekCategory } from "../../src/feed/seed";
import { seedLaunchQuestion } from "../../src/feed/launch-question";
import { boot } from "../results/harness";

type H = Awaited<ReturnType<typeof boot>>;

/** H2: a weekly poll has no question of its own; Explain my vote posts under the question the voter was shown. */
describe("explain my vote on seed:launch data (H2)", () => {
  let h: H;
  let launchId: string;
  let slot1Id: string;
  let pollId: string;
  let optionId: string;

  beforeAll(async () => {
    h = await boot();
    await h.prisma.$executeRawUnsafe(
      `TRUNCATE "User","Topic","Question","Poll","Answer","IdempotencyRecord","Charge","UsageCounter","Wallet" CASCADE`,
    );
    const dir = join(__dirname, "../../../docs/seed");
    const data = JSON.parse(
      readFileSync(join(dir, "questions.json"), "utf8"),
    ) as SeedFile;
    const cats = JSON.parse(
      readFileSync(join(dir, "week-categories.json"), "utf8"),
    ) as WeekCategory[];
    await importQuestions(h.prisma, data, cats);
    await seedLaunchQuestion(h.prisma);
    const launch = await h.prisma.question.findFirstOrThrow({
      where: { seedKey: "launch-mood-1" },
    });
    launchId = launch.id;
    // the launch week as the walk moved it to today: the poll open, slot 1 and the launch question live
    const window = {
      status: "LIVE" as const,
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 86_400_000),
    };
    const slot1 = await h.prisma.question.findFirstOrThrow({
      where: { topicId: launch.topicId, slotIndex: 1, isSpare: false },
    });
    slot1Id = slot1.id;
    await h.prisma.question.updateMany({
      where: { id: { in: [launchId, slot1Id] } },
      data: window,
    });
    const poll = await h.prisma.poll.findFirstOrThrow({
      where: { topicId: launch.topicId, kind: "WEEKLY" },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    expect(poll.questionId).toBeNull();
    pollId = poll.id;
    optionId = poll.options[0].id;
    await h.prisma.poll.update({
      where: { id: poll.id },
      data: {
        status: "OPEN",
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      },
    });
  });
  afterAll(async () => {
    await h.close();
  });

  async function voter() {
    const wawuId = `wawu-${randomUUID()}`;
    const user = await h.prisma.user.create({
      data: {
        wawuId,
        phoneHash: `phone-${randomUUID()}`,
        handle: `v${randomUUID().slice(0, 8)}`,
        referralCode: randomUUID().slice(0, 8),
      },
    });
    const auth = h.bearer(wawuId);
    await h
      .http()
      .post(`/api/v1/polls/${pollId}/votes`)
      .set("Authorization", auth)
      .set("Idempotency-Key", randomUUID())
      .send({ optionIds: [optionId] })
      .expect(201);
    return { user, auth };
  }
  const explain = (auth: string, body: object) =>
    h
      .http()
      .post(`/api/v1/polls/${pollId}/explanation`)
      .set("Authorization", auth)
      .set("Idempotency-Key", randomUUID())
      .send(body);

  it("posts the reason with a word under the launch question the voter was shown (red on main: 422)", async () => {
    const v = await voter();
    const res = await explain(v.auth, {
      kind: "TEXT",
      body: "Because prices keep rising.",
      mood: "TIRED",
      questionId: launchId,
    }).expect(201);
    expect(res.body.answer.questionId).toBe(launchId);
    expect(res.body.answer.mood).toBe("TIRED");
    const row = await h.prisma.answer.findFirstOrThrow({
      where: { authorId: v.user.id },
    });
    expect(row.questionId).toBe(launchId);
    expect(row.explainsVoteId).not.toBeNull();
  });

  it("a voter who has their own answer already can explain the same way", async () => {
    const v = await voter();
    await h.prisma.answer.create({
      data: {
        questionId: launchId,
        authorId: v.user.id,
        kind: "TEXT",
        body: "Tired.",
        mood: "ANGRY",
      },
    });
    const res = await explain(v.auth, {
      kind: "TEXT",
      body: "Light goes every night.",
      mood: "ANGRY",
      questionId: launchId,
    }).expect(201);
    expect(res.body.answer.questionId).toBe(launchId);
  });

  it("a question from another week is refused, and the question must be in the poll's conversation", async () => {
    const v = await voter();
    const other = await h.prisma.question.findFirstOrThrow({
      where: {
        topicId: {
          not: (
            await h.prisma.poll.findUniqueOrThrow({ where: { id: pollId } })
          ).topicId!,
        },
      },
    });
    const res = await explain(v.auth, {
      kind: "TEXT",
      body: "x",
      questionId: other.id,
    }).expect(422);
    expect(res.body.error.details.fields[0].path).toBe("questionId");
    await explain(v.auth, {
      kind: "TEXT",
      body: "x",
      questionId: randomUUID(),
    }).expect(422);
    expect(
      await h.prisma.answer.count({ where: { authorId: v.user.id } }),
    ).toBe(0);
  });

  it("without a questionId the reason goes to the topic's open question in slot order, as it always did for slot 1", async () => {
    const v = await voter();
    // Owner's order, 16 Nov 2026 ("Same 4 words daily"): a daily question asks for a word.
    const res = await explain(v.auth, {
      kind: "TEXT",
      body: "Because.",
      mood: "HOPEFUL",
    }).expect(201);
    expect(res.body.answer.questionId).toBe(slot1Id);
    expect(res.body.answer.mood).toBe("HOPEFUL");
  });

  it("without a word the reason is refused on a daily question, nothing is stored and the vote stays", async () => {
    const v = await voter();
    const res = await explain(v.auth, {
      kind: "TEXT",
      body: "Because.",
    }).expect(422);
    expect(res.body.error.details.fields[0]).toEqual({
      path: "mood",
      message: "Pick one word before you post.",
    });
    expect(
      await h.prisma.answer.count({ where: { authorId: v.user.id } }),
    ).toBe(0);
    expect(
      await h.prisma.vote.count({ where: { userId: v.user.id, pollId } }),
    ).toBe(1);
  });
});
