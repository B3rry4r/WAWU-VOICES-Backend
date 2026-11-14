import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { CALENDAR_LOCK } from "../admin/support";
import { LAUNCH_QUESTION } from "./launch-question";
import { addDays, dateOnly, lagosDayEnd, lagosDayStart, toDay } from "./lagos";
import type { SeedFile } from "./seed";

/**
 * V-CAL-LAUNCH (owner, 14 Nov 2026, replaces the date in V-14): nothing from the question bank is open before Sun 15 Nov,
 * 15 Nov carries only the launch question, and week 1 starts Mon 16 Nov as the sheet says. Every week of the bank, with its
 * daily questions, poll and What Next, moves forward by the same four days (week N: 16 Nov + 7 * (N - 1)).
 *
 * The rules are the calendar's own ("move a week", TopicsAdminService.update): a week moves with its dated, not-yet-started
 * questions and its polls that have not opened, by whole days; the Lagos day helpers decide the windows (V-27); the same
 * advisory lock keeps an editor's calendar edit out while it runs. The admin service itself cannot be used: it moves one week
 * per transaction, checks overlap week by week (so it cannot shift a run of adjacent weeks), needs an actor, and would drag the
 * launch question (dated 15 Nov, in week 1) four days along with its week.
 */
export const SHIFT = {
  oldWeek1: "2026-11-12",
  newWeek1: "2026-11-16",
  days: 4,
} as const;

const DAY_MS = 86_400_000;
type Db = PrismaClient | Prisma.TransactionClient;

export type Kind = "topic" | "question" | "poll" | "launch" | "restore";
export interface Change {
  kind: Kind;
  id: string;
  /** What a person reads: "Week 3 ...", "question q12 ...". */
  label: string;
  from: string;
  to: string;
  data: Record<string, unknown>;
  table: "topic" | "question" | "poll";
}
export interface Plan {
  changes: Change[];
  /** Why apply must refuse: the database does not look like the seeded bank. */
  refusals: string[];
  /** Found but not moved, or a place the plan could not fill. Apply goes ahead; a person looks at these. */
  unplaced: string[];
  counts: Record<Kind, number>;
  weeks: number;
  weeksAlreadyShifted: number;
}

const win = (s: Date | null, e: Date | null): string => {
  const day = (d: Date) =>
    new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
  return `${s ? day(s) : "no start"} to ${e ? day(new Date(e.getTime() - 1)) : "no end"}`;
};
const plus = (d: Date | null): Date | null =>
  d ? new Date(d.getTime() + SHIFT.days * DAY_MS) : null;
const sameT = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);
const short = (t: string) => (t.length > 48 ? `${t.slice(0, 45)}...` : t);

/** Reads the database and says what the shift would change and what it cannot. Writes nothing. */
export async function planShift(db: Db, seed: SeedFile): Promise<Plan> {
  const changes: Change[] = [];
  const refusals: string[] = [];
  const unplaced: string[] = [];
  const bankWeeks = seed.weeks.map((w) => w.week);
  const topics = await db.topic.findMany({ orderBy: { weekNumber: "asc" } });
  const byNum = new Map(topics.map((t) => [t.weekNumber, t]));

  // ---- the weeks
  type State = "old" | "new";
  const state = new Map<string, State>();
  const missing: number[] = [];
  const wrong: string[] = [];
  for (const n of bankWeeks) {
    const t = byNum.get(n);
    if (!t) {
      missing.push(n);
      continue;
    }
    const oldS = addDays(SHIFT.oldWeek1, 7 * (n - 1));
    const newS = addDays(SHIFT.newWeek1, 7 * (n - 1));
    const s = toDay(t.startsOn);
    const e = toDay(t.endsOn);
    if (s === oldS && e === addDays(oldS, 6)) state.set(t.id, "old");
    else if (s === newS && e === addDays(newS, 6)) state.set(t.id, "new");
    else
      wrong.push(
        `week ${n} runs ${s} to ${e}; expected ${oldS} to ${addDays(oldS, 6)} (seeded) or ${newS} to ${addDays(newS, 6)} (already shifted). Moved by hand?`,
      );
    if (t.status === "LIVE" || t.status === "CLOSED")
      refusals.push(
        `week ${n} is ${t.status}: a week that has started cannot move.`,
      );
  }
  if (missing.length)
    refusals.push(
      `${missing.length} of the ${bankWeeks.length} seeded weeks are missing (week ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", ..." : ""}): run seed:questions first.`,
    );
  refusals.push(...wrong);
  const nOld = [...state.values()].filter((v) => v === "old").length;
  const nNew = state.size - nOld;
  if (nOld && nNew)
    refusals.push(
      `${nNew} weeks are already on the new dates and ${nOld} are on the old ones: a half-done shift. Nothing is guessed.`,
    );
  const bankTopics = topics.filter((t) => state.has(t.id));
  const topicOf = new Map(bankTopics.map((t) => [t.id, t]));
  const old = (t: { weekNumber: number }) =>
    addDays(SHIFT.oldWeek1, 7 * (t.weekNumber - 1));

  for (const t of bankTopics) {
    if (state.get(t.id) !== "old") continue;
    const s = addDays(toDay(t.startsOn)!, SHIFT.days);
    changes.push({
      kind: "topic",
      id: t.id,
      table: "topic",
      label: `week ${t.weekNumber} "${short(t.title)}" (its What Next question moves with it)`,
      from: `${toDay(t.startsOn)} to ${toDay(t.endsOn)}`,
      to: `${s} to ${addDays(s, 6)}`,
      data: { startsOn: dateOnly(s), endsOn: dateOnly(addDays(s, 6)) },
    });
  }
  // after the shift no two weeks may overlap, hand-made weeks included
  const after = topics.map((t) => ({
    n: t.weekNumber,
    s:
      state.get(t.id) === "old"
        ? addDays(toDay(t.startsOn)!, SHIFT.days)
        : toDay(t.startsOn)!,
    e:
      state.get(t.id) === "old"
        ? addDays(toDay(t.endsOn)!, SHIFT.days)
        : toDay(t.endsOn)!,
  }));
  for (const a of after)
    for (const b of after)
      if (a.n < b.n && a.s <= b.e && b.s <= a.e)
        refusals.push(
          `after the shift week ${a.n} and week ${b.n} would overlap.`,
        );

  // ---- the launch question and the question it displaced
  const launch = await db.question.findUnique({
    where: { seedKey: LAUNCH_QUESTION.seedKey },
  });
  const week1 = byNum.get(1);
  let launchOld = false;
  if (!launch) {
    refusals.push(
      `the launch question (${LAUNCH_QUESTION.seedKey}) is missing: run seed:launch first.`,
    );
  } else if (week1) {
    const day = dateOnly(LAUNCH_QUESTION.day);
    const newEnd = lagosDayEnd(addDays(SHIFT.newWeek1, 6));
    const oldEnd = lagosDayEnd(addDays(SHIFT.oldWeek1, 6));
    const sound =
      launch.topicId === week1.id &&
      sameT(launch.scheduledFor, day) &&
      sameT(launch.startsAt, lagosDayStart(LAUNCH_QUESTION.day)) &&
      !launch.isSpare;
    if (!sound)
      refusals.push(
        `the launch question is not where seed:launch put it (week 1, ${LAUNCH_QUESTION.day}, starts at the start of that Lagos day).`,
      );
    else if (launch.slotIndex !== null && sameT(launch.endsAt, oldEnd))
      launchOld = true;
    else if (launch.slotIndex === null && sameT(launch.endsAt, newEnd))
      launchOld = false;
    else
      refusals.push(
        `the launch question has an end date (${launch.endsAt?.toISOString() ?? "none"}) that is neither the seeded one nor the shifted one.`,
      );
    if (sound && launchOld) {
      changes.push({
        kind: "launch",
        id: launch.id,
        table: "question",
        label: `LAUNCH question "${short(launch.text)}" stays on 15 Nov, only thing that day; leaves day-slot ${launch.slotIndex}, stays open to the end of week 1`,
        from: `${LAUNCH_QUESTION.day}, slot ${launch.slotIndex}, ${win(launch.startsAt, launch.endsAt)}`,
        to: `${LAUNCH_QUESTION.day}, no slot, ${win(launch.startsAt, newEnd)}`,
        data: { slotIndex: null, endsAt: newEnd },
      });
      // the question the launch question displaced goes back into week 1's own run, on the day its slot now has
      const q4 = seed.questions.find(
        (q) => q.week === 1 && q.qInWeek === launch.slotIndex,
      );
      const held = q4
        ? await db.question.findUnique({ where: { seedKey: `q${q4.n}` } })
        : null;
      if (
        !q4 ||
        !held ||
        held.topicId !== week1.id ||
        !held.isSpare ||
        held.scheduledFor ||
        held.slotIndex !== null
      ) {
        unplaced.push(
          `the question the launch question displaced is not in week 1's held bank (${q4 ? `q${q4.n}` : "not found"}): week 1's day ${launch.slotIndex} (${addDays(SHIFT.newWeek1, (launch.slotIndex ?? 1) - 1)}) will have no question until an editor puts one there.`,
        );
      } else {
        const d = addDays(SHIFT.newWeek1, (launch.slotIndex ?? 1) - 1);
        changes.push({
          kind: "restore",
          id: held.id,
          table: "question",
          label: `question q${q4.n} "${short(held.text)}" (displaced by the launch question) goes back into week 1, day ${launch.slotIndex}`,
          from: "held bank (no day)",
          to: `${d}, slot ${launch.slotIndex}, ${win(lagosDayStart(d), newEnd)}`,
          data: {
            isSpare: false,
            slotIndex: launch.slotIndex,
            scheduledFor: dateOnly(d),
            startsAt: lagosDayStart(d),
            endsAt: newEnd,
          },
        });
      }
    }
  }

  // ---- every other dated question of a bank week
  const shiftedQ = new Set<string>();
  const questions = await db.question.findMany({
    where: {
      topicId: { in: bankTopics.map((t) => t.id) },
      scheduledFor: { not: null },
    },
    orderBy: [{ scheduledFor: "asc" }, { slotIndex: "asc" }],
  });
  for (const q of questions) {
    if (launch && q.id === launch.id) continue;
    const t = topicOf.get(q.topicId!)!;
    const oldS = old(t);
    const d = toDay(q.scheduledFor)!;
    const inOld = d >= oldS && d <= addDays(oldS, 6);
    const inNew =
      d >= addDays(oldS, SHIFT.days) && d <= addDays(oldS, SHIFT.days + 6);
    const tag = `question ${q.seedKey ?? q.id} "${short(q.text)}"`;
    if (q.kind === "OVERRIDE") {
      unplaced.push(
        `${tag} is an override on ${d}: overrides are not moved with a week. Check it.`,
      );
      continue;
    }
    if (state.get(t.id) === "new") {
      if (!inNew)
        refusals.push(
          `${tag} is dated ${d}, outside week ${t.weekNumber}'s new dates.`,
        );
      continue;
    }
    if (!inOld) {
      refusals.push(
        `${tag} is dated ${d}, outside week ${t.weekNumber}'s seeded dates. Moved by hand?`,
      );
      continue;
    }
    if (q.status !== "SCHEDULED" && q.status !== "DRAFT") {
      refusals.push(
        `${tag} is ${q.status}: a question that has started cannot move.`,
      );
      continue;
    }
    shiftedQ.add(q.id);
    const nd = addDays(d, SHIFT.days);
    changes.push({
      kind: "question",
      id: q.id,
      table: "question",
      label: `week ${t.weekNumber} ${tag}`,
      from: `${d}, ${win(q.startsAt, q.endsAt)}`,
      to: `${nd}, ${win(plus(q.startsAt), plus(q.endsAt))}`,
      data: {
        scheduledFor: dateOnly(nd),
        startsAt: plus(q.startsAt),
        endsAt: plus(q.endsAt),
      },
    });
  }

  // ---- the polls of a bank week (and polls on a question that moves)
  const polls = await db.poll.findMany({
    where: {
      OR: [
        { topicId: { in: bankTopics.map((t) => t.id) } },
        { questionId: { in: [...shiftedQ] } },
      ],
    },
    orderBy: { startsAt: "asc" },
  });
  const qTopic = new Map(questions.map((q) => [q.id, q.topicId]));
  for (const p of polls) {
    const t = topicOf.get(p.topicId ?? qTopic.get(p.questionId ?? "") ?? "");
    if (!t) continue;
    const oldS = old(t);
    const tag = `${p.kind.toLowerCase()} poll "${short(p.title)}"`;
    const s = p.startsAt;
    const inRange = (from: string) =>
      s >= lagosDayStart(from) && p.endsAt <= lagosDayEnd(addDays(from, 6));
    if (state.get(t.id) === "new") {
      if (!inRange(addDays(oldS, SHIFT.days)))
        refusals.push(
          `${tag} (week ${t.weekNumber}) is outside the week's new dates.`,
        );
      continue;
    }
    if (!inRange(oldS)) {
      refusals.push(
        `${tag} (week ${t.weekNumber}) is outside the week's seeded dates. Moved by hand?`,
      );
      continue;
    }
    if (p.status !== "SCHEDULED") {
      refusals.push(
        `${tag} (week ${t.weekNumber}) is ${p.status}: a poll that has opened cannot move.`,
      );
      continue;
    }
    changes.push({
      kind: "poll",
      id: p.id,
      table: "poll",
      label: `week ${t.weekNumber} ${tag}`,
      from: win(p.startsAt, p.endsAt),
      to: win(plus(p.startsAt), plus(p.endsAt)),
      data: { startsAt: plus(p.startsAt), endsAt: plus(p.endsAt) },
    });
  }

  // ---- anything else that is open before the 16th and is not ours to move
  const cut = lagosDayStart(SHIFT.newWeek1);
  const touched = new Set(changes.map((c) => c.id));
  const stray = await db.question.findMany({
    where: {
      id: { notIn: [...touched, ...(launch ? [launch.id] : [])] },
      status: { in: ["SCHEDULED", "LIVE"] },
      OR: [{ startsAt: { lt: cut } }, { startsAt: null, status: "LIVE" }],
      isSpare: false,
    },
    take: 20,
  });
  for (const q of stray)
    unplaced.push(
      `question "${short(q.text)}" (${q.kind}, ${q.seedKey ?? "not from the bank"}) is open or opens before ${SHIFT.newWeek1} and is not part of the bank shift: left as it is.`,
    );

  const counts = {
    topic: 0,
    question: 0,
    poll: 0,
    launch: 0,
    restore: 0,
  } as Record<Kind, number>;
  for (const c of changes) counts[c.kind]++;
  return {
    changes,
    refusals,
    unplaced,
    counts,
    weeks: bankTopics.length,
    weeksAlreadyShifted: nNew,
  };
}

export function formatPlan(plan: Plan, mode: "dry-run" | "apply"): string {
  const L: string[] = [];
  const order: Kind[] = ["topic", "launch", "restore", "question", "poll"];
  L.push(
    `calendar:launch-shift (${mode}). Week 1 ${SHIFT.oldWeek1} -> ${SHIFT.newWeek1}, every week +${SHIFT.days} days.`,
  );
  for (const k of order) {
    const rows = plan.changes.filter((c) => c.kind === k);
    if (!rows.length) continue;
    L.push(
      "",
      `-- ${k === "topic" ? "weeks (with their What Next)" : k === "launch" ? "launch question" : k === "restore" ? "displaced question" : k + "s"} (${rows.length})`,
    );
    for (const c of rows)
      L.push(`${c.label}\n    from ${c.from}\n    to   ${c.to}`);
  }
  L.push("", "-- summary");
  L.push(
    `weeks ${plan.counts.topic} (${plan.weeksAlreadyShifted} were already shifted), questions ${plan.counts.question}, polls ${plan.counts.poll}, launch question ${plan.counts.launch}, displaced question put back ${plan.counts.restore}. Total changes ${plan.changes.length}.`,
  );
  if (!plan.changes.length && !plan.refusals.length)
    L.push("Nothing to change: the calendar is already shifted.");
  if (plan.unplaced.length) {
    L.push("", `-- could not place or left alone (${plan.unplaced.length})`);
    for (const u of plan.unplaced) L.push(`  ${u}`);
  }
  if (plan.refusals.length) {
    L.push(
      "",
      `-- REFUSED: this does not look like the seeded bank (${plan.refusals.length})`,
    );
    for (const r of plan.refusals.slice(0, 40)) L.push(`  ${r}`);
    if (plan.refusals.length > 40)
      L.push(`  ... and ${plan.refusals.length - 40} more`);
    L.push("Nothing was changed.");
  }
  return L.join("\n");
}

/**
 * Plans and applies in ONE transaction, under the calendar lock. Throws (rolling everything back) if the plan refuses or if,
 * after the writes, any bank question or poll would still open before 16 Nov or the launch question is not alone on 15 Nov.
 */
export async function applyShift(
  db: PrismaClient,
  seed: SeedFile,
): Promise<Plan> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK})`;
      const plan = await planShift(tx, seed);
      if (plan.refusals.length) return plan;
      for (const c of plan.changes) {
        if (c.table === "topic")
          await tx.topic.update({ where: { id: c.id }, data: c.data });
        else if (c.table === "question")
          await tx.question.update({ where: { id: c.id }, data: c.data });
        else await tx.poll.update({ where: { id: c.id }, data: c.data });
      }
      if (plan.changes.length) {
        const again = await planShift(tx, seed);
        if (again.refusals.length || again.changes.length)
          throw new Error(
            `after the shift the calendar still has ${again.changes.length} changes and ${again.refusals.length} problems: rolled back.`,
          );
        const cut = lagosDayStart(SHIFT.newWeek1);
        const day = dateOnly(LAUNCH_QUESTION.day);
        const early = await tx.question.count({
          where: {
            seedKey: { not: LAUNCH_QUESTION.seedKey },
            NOT: { seedKey: null },
            startsAt: { lt: cut },
          },
        });
        const earlyPoll = await tx.poll.count({
          where: {
            topic: { weekNumber: { in: seed.weeks.map((w) => w.week) } },
            startsAt: { lt: cut },
          },
        });
        const onDay = await tx.question.count({
          where: {
            scheduledFor: day,
            kind: "DAILY",
            isSpare: false,
            status: { in: ["SCHEDULED", "LIVE"] },
          },
        });
        if (early || earlyPoll || onDay !== 1)
          throw new Error(
            `after the shift ${early} bank questions and ${earlyPoll} polls still open before ${SHIFT.newWeek1}, and ${onDay} questions are on ${LAUNCH_QUESTION.day}: rolled back.`,
          );
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: "calendar.launch_shift",
            targetType: "Topic",
            reason:
              "V-CAL-LAUNCH: week 1 moves from 12 Nov to 16 Nov (owner, 14 Nov 2026)",
            after: { counts: plan.counts },
          },
        });
      }
      return plan;
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
}
