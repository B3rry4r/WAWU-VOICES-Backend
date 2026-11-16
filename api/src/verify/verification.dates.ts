/** The Africa/Lagos calendar day as "YYYY-MM-DD" (Lagos is UTC+1 all year). Same format as Subscription.startDay and endDay. */
export function lagosDayString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The instant a plan ending on `endDay` stops: the start of that Lagos day. */
export function endOfPlan(endDay: string): Date {
  return new Date(`${endDay}T00:00:00+01:00`);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** "14 Feb 2027" for a "YYYY-MM-DD" day. */
export function prettyDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
