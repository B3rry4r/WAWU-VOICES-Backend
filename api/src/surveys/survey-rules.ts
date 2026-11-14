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

/** The longest text the scrub looks at. A written answer is at most 500 characters; a 30 second transcript is far under this. */
export const SCRUB_MAX = 2000;

/** Endings of a web address that are found without a scheme ("label.ending"). Never every "word.Word". */
const ENDINGS =
  "com|ng|org|net|io|co|me|app|ly|tv|info|biz|xyz|africa|uk|us|gov|edu|ai|dev|shop|store|online|site|link|page|ke|gh|za|ee|ca|live|cc|to|gg|blog|club|top|pro|tech|studio";
const DOT = String.raw`(?:\(dot\)|\[dot\]|\{dot\}|\bdot\b)`;
const AT_SYM = String.raw`(?:\(at\)|\[at\]|\{at\}|@)`;
/** Up to two earlier parts of a local part spelt "chidi dot okafor". */
const LOCAL = String.raw`(?:[\w+-]{1,32}\s{1,3}${DOT}\s{1,3}){0,2}[\w.+-]{1,64}`;
const LABEL = String.raw`[\w-]{1,63}`;
const PLATFORMS =
  "fb|facebook|tg|telegram|wa|whatsapp|ig|insta|instagram|twitter|x|tiktok|snap|snapchat|threads|linkedin|yt|youtube|discord";
const FILLER = "is|handle|name|id|account|page|at|on|me|us|add|follow|find|my";
const NUM_WORD = new RegExp(
  "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple|o)(?![\\p{L}\\p{Nd}])",
  "iyu",
);
const ND = /^\p{Nd}$/u;
const LETTER = /^\p{L}$/u;
const OI = /^[OoIi]$/;

const REMOVED = "[removed]";

/**
 * Finds a run of digits and number words of weight 10 or more, with up to six non-letter characters between its parts,
 * and replaces it. The letters O and I between digits count as 0 and 1 ("08O3I234567"). One pass, no backtracking.
 */
function stripPhones(s: string): string {
  const n = s.length;
  const isDig = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (ND.test(s[i])) isDig[i] = 1;
  // O and I wedged between digits.
  for (let i = 1; i < n; i++) {
    if (!OI.test(s[i]) || isDig[i] || !isDig[i - 1]) continue;
    let j = i;
    while (j < n && OI.test(s[j]) && !isDig[j]) j++;
    if (j < n && isDig[j]) for (let k = i; k < j; k++) isDig[k] = 1;
    i = j;
  }
  const token = (i: number): { len: number; w: number } | null => {
    if (isDig[i]) return { len: 1, w: 1 };
    if (i > 0 && LETTER.test(s[i - 1])) return null;
    NUM_WORD.lastIndex = i;
    const m = NUM_WORD.exec(s);
    if (!m) return null;
    const word = m[0].toLowerCase();
    return { len: word.length, w: word === "triple" ? 2 : 1 };
  };
  const isSep = (i: number) => !isDig[i] && !LETTER.test(s[i]);
  let out = "";
  let last = 0;
  let i = 0;
  while (i < n) {
    const t = token(i);
    if (!t) {
      i++;
      continue;
    }
    const start = i;
    let end = i + t.len;
    let weight = t.w;
    for (;;) {
      let j = end;
      let gap = 0;
      while (j < n && gap < 6 && isSep(j)) {
        j++;
        gap++;
      }
      const t2 = j < n ? token(j) : null;
      if (!t2) break;
      weight += t2.w;
      end = j + t2.len;
    }
    if (weight >= 10) {
      const from = start > 0 && s[start - 1] === "+" ? start - 1 : start;
      out += s.slice(last, from) + REMOVED;
      last = end;
    }
    i = end;
  }
  return out + s.slice(last);
}

/**
 * Lets a free-text answer go to a brand without the personal details people sometimes type. The text is cut to
 * SCRUB_MAX characters and put through NFKC first (full-width digits, "＠", "。"), and every expression is bounded, so the
 * work is linear. Removed: emails (also "chidi(at)gmail(dot)com", "chidi @ gmail . com", "chidi at gmail.com"), links
 * (any scheme, "www.", "label.label/path", "label.ending" for a list of endings, "word dot ending", IPv4), phone numbers
 * (10 or more digits with any non-letter separators, digits mixed with number words, O and I between digits), and
 * handles ("@name", and after a platform word with ":" or "@" or a token holding a digit, "_" or "."). Plain-word names
 * and street addresses are not found by pattern: a person reads every free answer before it goes to a brand.
 */
export function scrubText(input: string): string {
  let t = input
    .slice(0, SCRUB_MAX)
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[。｡]/g, ".");
  t = t
    // email: symbol form, then "at" in words (which needs a known ending at the end)
    .replace(
      new RegExp(
        String.raw`${LOCAL}\s{0,3}${AT_SYM}\s{0,3}${LABEL}(?:\s{0,3}(?:${DOT}|\.)\s{0,3}${LABEL}){1,4}`,
        "gi",
      ),
      REMOVED,
    )
    .replace(
      new RegExp(
        String.raw`${LOCAL}\s{1,3}\bat\b\s{1,3}${LABEL}(?:\s{0,3}(?:${DOT}|\.)\s{0,3}${LABEL}){0,3}\s{0,3}(?:${DOT}|\.)\s{0,3}(?:${ENDINGS})\b`,
        "gi",
      ),
      REMOVED,
    )
    // links
    .replace(/\b[a-z][a-z0-9+.-]{1,20}:\/\/\S{1,300}/gi, REMOVED)
    .replace(/\bwww\.\S{1,300}/gi, REMOVED)
    .replace(
      /(?<![\w.-])(?:[\w-]{1,63}\.){1,5}[\w-]{1,63}\/\S{0,300}/g,
      REMOVED,
    )
    .replace(
      new RegExp(
        String.raw`\b(?:[a-z0-9-]{1,63}\.){1,4}(?:${ENDINGS})\b(?:\/\S{0,300})?`,
        "gi",
      ),
      REMOVED,
    )
    .replace(
      new RegExp(
        String.raw`(?:[\w-]{1,63}\s{0,3}${DOT}\s{0,3}){1,4}(?:${ENDINGS})\b`,
        "gi",
      ),
      REMOVED,
    )
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, REMOVED);
  t = stripPhones(t);
  t = t
    .replace(/@\w{2,64}(?:\.\w{1,64}){0,4}/g, REMOVED)
    .replace(
      new RegExp(
        String.raw`\b(?:${PLATFORMS})\b(?:\s{1,3}(?:${FILLER})){0,2}\s{0,3}[:@]\s{0,3}\w{1,64}(?:\.\w{1,64}){0,4}`,
        "gi",
      ),
      REMOVED,
    )
    .replace(
      new RegExp(
        String.raw`\b(?:${PLATFORMS})\b(?:\s{1,3}(?:${FILLER})){0,2}\s{1,3}(?=\w{0,64}[\d_]|\w{1,64}\.\w)\w{1,64}(?:\.\w{1,64}){0,4}`,
        "gi",
      ),
      REMOVED,
    );
  return t.trim();
}

/** A share as a whole percent. */
export function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}
