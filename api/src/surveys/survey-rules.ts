import { createHmac } from "node:crypto";
import { phonePepper } from "../me/phone";

/** The most questions one survey may carry (addendum 3A task: 1 to 5). */
export const MAX_QUESTIONS = 5;
export const MAX_OPTIONS = 6;
export const MIN_OPTIONS = 2;
export const TEXT_ANSWER_MAX = 500;

/** Age bands a person may choose to share. VOICES keeps no age on file, so the band is given with the answer or not at all. */
export const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/**
 * A keyed hash of (survey, person): enough to stop a second answer, useless for finding the person. The survey answer
 * tables hold this and never the person's id. Domain-separated from the phone hash that shares the server secret.
 */
export function respondentKey(surveyId: string, userId: string): string {
  return createHmac("sha256", phonePepper())
    .update(`survey-respondent|${surveyId}|${userId}`)
    .digest("hex");
}

/**
 * Lets a free-text answer go to a brand without the personal details people sometimes type: emails, phone numbers,
 * @handles and links. The brand sees what was said, never who said it or how to reach them.
 */
export function scrubText(t: string): string {
  return t
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[removed]")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[removed]")
    .replace(/(^|[\s(])@[\w.]{2,}/g, "$1[removed]")
    .replace(/(?:\+?\d[\s().-]?){7,}/g, "[removed]")
    .trim();
}

/** A share as a whole percent. */
export function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}
