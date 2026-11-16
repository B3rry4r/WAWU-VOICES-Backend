import { closesInFor } from "../../src/mail/topic-mail.service";
import {
  presentQuestion,
  questionEndsAt,
  type QuestionRow,
} from "../../src/feed/present";

/** V-MAIL-CLOSES-TODAY: pure unit spec, no database. The mail and the website read one end-time rule. */
const D = (s: string) => new Date(s);
const MON = D("2026-11-16T00:00:00.000Z"); // the day's slot (a @db.Date)
const WEEK_END = D("2026-11-22T23:00:00.000Z"); // 6 days after Mon 06:00 UTC, end of the week
const AT_0600 = D("2026-11-16T06:00:00.000Z");
const AT_2230 = D("2026-11-16T22:30:00.000Z");

/** The rule as it stood on origin/main (5a00d54), copied here as the oracle for "presentQuestion is unchanged". */
function oldRule(
  q: {
    endsAt: Date | null;
    scheduledFor: Date | null;
    overrideQuestion?: { endsAt: Date } | null;
  },
  now: Date,
): Date | null {
  const lagosDay = new Date(now.getTime() + 3_600_000)
    .toISOString()
    .slice(0, 10);
  const next = new Date(`${lagosDay}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const dayEnd = new Date(next.getTime() - 3_600_000);
  const isToday = q.scheduledFor
    ? q.scheduledFor.toISOString().slice(0, 10) === lagosDay
    : false;
  const ov = q.overrideQuestion;
  return ov
    ? q.endsAt && q.endsAt < ov.endsAt
      ? q.endsAt
      : ov.endsAt
    : isToday && q.endsAt
      ? new Date(Math.min(q.endsAt.getTime(), dayEnd.getTime()))
      : q.endsAt;
}

const daily = { scheduledFor: MON, endsAt: WEEK_END, overrideQuestion: null };
const override = {
  scheduledFor: null,
  endsAt: D("2026-11-17T12:00:00.000Z"),
  overrideQuestion: { endsAt: D("2026-11-16T15:00:00.000Z") },
};
const launch = {
  scheduledFor: D("2026-11-14T00:00:00.000Z"), // not today's slot
  endsAt: WEEK_END,
  overrideQuestion: null,
};
const cancelled = {
  scheduledFor: MON,
  endsAt: D("2026-11-16T10:00:00.000Z"),
  overrideQuestion: { endsAt: D("2026-11-16T15:00:00.000Z") },
};
const noEnd = { scheduledFor: MON, endsAt: null, overrideQuestion: null };

function shown(q: object, now: Date): string | null {
  const row = {
    ...q,
    id: "q1",
    kind: "DAILY",
    status: "LIVE",
    text: "t",
    hint: null,
    moodOptions: [],
    category: null,
    topicId: null,
    topic: null,
    startsAt: D("2026-11-16T00:00:00.000Z"),
    pinned: false,
    sensitive: false,
    voiceCount: 1,
    answerCount: 1,
    polls: [],
    _count: { proposals: 0 },
  } as unknown as QuestionRow;
  return presentQuestion(row, {
    now,
    saved: new Set(),
    catStats: new Map(),
    faces: new Map(),
    pictures: new Map() as never,
  }).endsAt;
}

describe("C01 closes_in follows the website", () => {
  it("today's daily question, stored end 6 days away, at 06:00 UTC: 17 hours", () => {
    expect(closesInFor(daily, AT_0600)).toBe("17 hours");
  });
  it("at 22:30 UTC: 30 minutes", () => {
    expect(closesInFor(daily, AT_2230)).toBe("30 minutes");
  });
  it("a question with an override says the override's end", () => {
    expect(closesInFor(override, AT_0600)).toBe("9 hours");
  });
  it("an override cancelled early says the moment the question was closed", () => {
    expect(closesInFor(cancelled, AT_0600)).toBe("4 hours");
  });
  it("the launch question (not today's slot) keeps its own end: 6 days", () => {
    expect(closesInFor(launch, AT_0600)).toBe("6 days");
  });
  it("no end stored: a day, as before", () => {
    expect(closesInFor(noEnd, AT_0600)).toBe("a day");
  });
});

describe("presentQuestion endsAt is the same as before", () => {
  it.each([
    ["daily 06:00", daily, AT_0600],
    ["daily 22:30", daily, AT_2230],
    ["override", override, AT_0600],
    ["cancelled override", cancelled, AT_0600],
    ["launch", launch, AT_0600],
    ["no end", noEnd, AT_0600],
    ["daily, tomorrow's clock", daily, D("2026-11-17T06:00:00.000Z")],
  ])("%s", (_n, q, now) => {
    const was = oldRule(q, now)?.toISOString() ?? null;
    expect(shown(q, now)).toBe(was);
    expect(questionEndsAt(q, now)?.toISOString() ?? null).toBe(was);
  });
  it("the website's own value for today's daily question is the end of the Lagos day", () => {
    expect(shown(daily, AT_0600)).toBe("2026-11-16T23:00:00.000Z");
  });
});
