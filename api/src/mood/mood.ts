import type { Mood } from "../generated/prisma/client";

/** LCH-02 (V-31): the launch question's four words, in the order the boards draw them. */
export const MOODS: readonly Mood[] = ["ANGRY", "TIRED", "PROUD", "HOPEFUL"];

/** LCH-04: a percentage is shown only when a group holds at least this many valid answers. */
export const MIN_GROUP = 50;

export type Scope = "NIGERIA" | "WORLD";

export const isMood = (v: unknown): v is Mood =>
  typeof v === "string" && (MOODS as readonly string[]).includes(v);

/** Counts per word, every word present. */
export type MoodCounts = Record<Mood, number>;

export const emptyCounts = (): MoodCounts => ({
  ANGRY: 0,
  TIRED: 0,
  PROUD: 0,
  HOPEFUL: 0,
});

export const totalOf = (c: MoodCounts): number =>
  MOODS.reduce((n, m) => n + c[m], 0);

/** "Hopeful" for a heading or a chip, "hopeful" in a sentence. */
export const wordOf = (m: Mood): string =>
  m.charAt(0) + m.slice(1).toLowerCase();

/** A whole percent of the people in the group, or null before the group reaches MIN_GROUP (LCH-04). */
export function percentOf(c: MoodCounts, m: Mood): number | null {
  const total = totalOf(c);
  if (total < MIN_GROUP) return null;
  return Math.round((100 * c[m]) / total);
}

/** The line under the Posted headline, on the card and in the share message (curly apostrophe, as drawn). */
export function sitLine(
  percent: number | null,
  mood: Mood,
  style: "upper" | "lower",
): string {
  if (percent === null) return "You’re one of the first.";
  return `You’re with the ${percent}% who feel ${style === "upper" ? mood : wordOf(mood).toLowerCase()}.`;
}
