/** Lagos calendar helpers. "Today" is the Africa/Lagos day (CONVENTIONS.md); Lagos is UTC+1 all year (no DST). */
export const LAGOS_OFFSET_HOURS = 1;

/** V-14: week 1 starts Thursday 12 Nov 2026; every later week starts 7 days after the one before. */
export const LAUNCH_WEEK1_START = "2026-11-12";

const DAY_MS = 86_400_000;

/** YYYY-MM-DD of an instant in Africa/Lagos. */
export function lagosDay(at: Date = new Date()): string {
  return new Date(at.getTime() + LAGOS_OFFSET_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

/** A YYYY-MM-DD as the UTC-midnight Date that Prisma stores for a @db.Date column. */
export function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDays(day: string, n: number): string {
  return new Date(dateOnly(day).getTime() + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The instant a Lagos day starts (00:00 Lagos = 23:00 UTC the evening before). */
export function lagosDayStart(day: string): Date {
  return new Date(dateOnly(day).getTime() - LAGOS_OFFSET_HOURS * 3_600_000);
}

/** The instant a Lagos day ends (exclusive): the start of the next Lagos day. */
export function lagosDayEnd(day: string): Date {
  return lagosDayStart(addDays(day, 1));
}

export function weekStart(weekNumber: number): string {
  return addDays(LAUNCH_WEEK1_START, 7 * (weekNumber - 1));
}

export function toDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
