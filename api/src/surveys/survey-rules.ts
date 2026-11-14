import { createHmac } from "node:crypto";
import { phonePepper } from "../me/phone";

/** The most questions one survey may carry (addendum 3A task: 1 to 5). */
export const MAX_QUESTIONS = 5;
export const MAX_OPTIONS = 6;
export const MIN_OPTIONS = 2;
export const TEXT_ANSWER_MAX = 500;

/**
 * The number of answers at which a survey stops: its response target, but never under the floor (`weekly.min_group_size`).
 * A stop under the floor would show anyone watching the brand page or the feed exactly how many people had answered,
 * so a target lower than the floor (an old row, or the floor raised later) behaves as if it were the floor.
 */
export function effectiveTarget(
  target: number | null | undefined,
  floor: number,
): number | null {
  return target == null ? null : Math.max(target, Math.max(1, floor));
}

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
 * The handle staff use for one free answer in the review list and in the hide route. An HMAC of the answer's id under
 * the server's phone pepper (the secret `respondentKey` already uses; no new environment variable), domain-separated,
 * so it is not ordered by time and cannot be turned back into the answer's own id (which is a time-ordered uuid).
 */
export function reviewHandle(surveyId: string, answerId: string): string {
  return createHmac("sha256", phonePepper())
    .update(`survey-review-handle|${surveyId}|${answerId}`)
    .digest("hex")
    .slice(0, 32);
}

/** A page link of the review list: the next offset, signed for this survey and this admin, so pages can only be walked in order. */
export function reviewCursor(
  surveyId: string,
  actorId: string,
  offset: number,
): string {
  const mac = createHmac("sha256", phonePepper())
    .update(`survey-review-page|${surveyId}|${actorId}|${offset}`)
    .digest("hex")
    .slice(0, 24);
  return `${offset}.${mac}`;
}

export function readReviewCursor(
  surveyId: string,
  actorId: string,
  raw: string,
): number | null {
  const m = /^(\d{1,7})\.([0-9a-f]{24})$/.exec(raw);
  if (!m) return null;
  const offset = Number(m[1]);
  return reviewCursor(surveyId, actorId, offset) === raw ? offset : null;
}

/** A share as a whole percent. */
export function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}
