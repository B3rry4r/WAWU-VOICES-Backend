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

const NUM_WORDS =
  "zero|oh|o|one|two|three|four|five|six|seven|eight|nine|double|triple";
const TLDS =
  "com|ng|org|net|io|co|me|app|ly|tv|info|biz|xyz|africa|uk|us|gov|edu|ai|dev|shop|store|online|site|link|page|ke|gh|za";

/**
 * Lets a free-text answer go to a brand without the personal details people sometimes type: emails (also spelt "name
 * at provider dot com"), phone numbers (also spelt in words), @handles and handles given after "insta", "ig",
 * "twitter", "x", "tiktok" or "snap", links (https, www, bare domains, t.me and wa.me). The brand sees what was said,
 * never who said it or how to reach them. A name or an address typed in plain words is not found by pattern: a person
 * reads every free answer before it goes to a brand.
 */
export function scrubText(t: string): string {
  return (
    t
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[removed]")
      .replace(
        /[\w.+-]+\s+(?:at|\(at\)|\[at\])\s+[\w-]+(?:\s+(?:dot|\(dot\)|\[dot\])\s+\w+)+/gi,
        "[removed]",
      )
      .replace(/https?:\/\/\S+|www\.\S+/gi, "[removed]")
      .replace(
        new RegExp(
          `\\b(?:t|wa)\\.me\\/\\S*|\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?:\\/\\S*)?`,
          "gi",
        ),
        "[removed]",
      )
      .replace(/(^|[\s(])@[\w.]{2,}/g, "$1[removed]")
      .replace(
        /\b(insta(?:gram)?|ig|twitter|x|tiktok|snap(?:chat)?)\b((?:\s+(?:is|handle|name|id|account|page|at|on|me|us|add|follow|find|my)){0,2}\s*[:=-]?\s*)@?[\w.]{3,}/gi,
        "$1$2[removed]",
      )
      .replace(/\+?\d(?:[\s().-]?\d){6,}/g, "[removed]")
      // A number said in words: six or more number words in a row.
      .replace(
        new RegExp(
          `\\b(?:(?:${NUM_WORDS})[\\s,.-]+){5,}(?:${NUM_WORDS})\\b`,
          "gi",
        ),
        "[removed]",
      )
      .trim()
  );
}

/** A share as a whole percent. */
export function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}
