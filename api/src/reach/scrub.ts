/**
 * What may leave this server in a post's text (V-FIX-C). Contact details may not: emails, links, phone numbers and
 * handles, in plain, broken or written-out forms. Names and street addresses typed in a public post may go (lead ruling:
 * the post is already public). A bare name after "whatsapp me on" with no mark is left.
 *
 * Every pattern has bounded repeats and no nested or overlapping repeats, so its work is linear in the text; and the
 * text is cut to MAX_SCRUB_CHARS before any pattern runs on it.
 */

/** No text is scrubbed beyond this many characters (a post's own maximum is far lower). */
export const MAX_SCRUB_CHARS = 5000;

const ENDINGS =
  "com|net|org|ng|co|io|me|app|ly|gov|edu|info|biz|xyz|online|store|link|ee|ca|dev|uk|us|africa|site|shop|live|tv|cc|to|gg|page|blog|club|top|pro|tech|ai";
/** The endings accepted after a full stop and a space ("example. com"): the ones an ordinary sentence rarely starts with. */
const COMMON_ENDINGS =
  "com|net|org|ng|info|biz|xyz|online|store|link|dev|uk|africa|site|shop|club|tech";
const LABEL = "[a-z0-9-]{1,63}";
const LOCAL = "[a-z0-9._%+'-]{1,64}";
const BR_OPEN = String.raw`[\[({<]`;
const BR_CLOSE = String.raw`[\])}>]`;
/** A written or symbol dot between labels: ".", "[dot]", "(.)", " dot ". */
const DOT = String.raw`(?:\.|\s{0,3}${BR_OPEN}\s{0,3}(?:dot|\.)\s{0,3}${BR_CLOSE}\s{0,3}|\s{1,3}dot\s{1,3})`;
const AT_SYM = String.raw`(?:\s{0,3}@\s{0,3}|\s{0,3}${BR_OPEN}\s{0,3}at\s{0,3}${BR_CLOSE}\s{0,3})`;

// An email is removed whole, local part and all.
const EMAIL_SYMBOL = new RegExp(
  `${LOCAL}${AT_SYM}${LABEL}(?:${DOT}${LABEL}){1,5}`,
  "gi",
);
// "jane at example dot com", "jane at x . com": the bare word "at" counts only in the shape
// word, at-word, word, dot-word, known ending.
const EMAIL_WORD = new RegExp(
  String.raw`[a-z0-9._-]{1,40}\s{1,3}at\s{1,3}${LABEL}(?:(?:${DOT}|\s{1,3}\.\s{1,3})${LABEL}){0,3}(?:${DOT}|\s{1,3}\.\s{1,3})(?:${ENDINGS})\b`,
  "gi",
);
const SCHEME_LINK = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s<>"')]{1,2000}/gi;
const SCRIPT_LINK = /\b(?:javascript|vbscript|data):[^\s<>"']{0,500}/gi;
const WWW_LINK = /\bwww\.[^\s<>"')]{1,2000}/gi;
// label.label/path
const PATH_LINK =
  /\b[a-z][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63}){1,5}\/[^\s<>"')]{0,500}/gi;
// label.ending, and the written-out "evil dot com", "example [dot] com", "example. com"
const ENDING_LINK = new RegExp(
  String.raw`\b${LABEL}(?:\.${LABEL}){0,5}\.(?:${ENDINGS})\b|\b${LABEL}(?:${DOT}${LABEL}){0,3}${DOT}(?:${ENDINGS})\b|\b${LABEL}\.\s{1,2}(?:${COMMON_ENDINGS})\b`,
  "gi",
);

const PLATFORMS =
  "fb|facebook|tg|telegram|wa|whatsapp|ig|insta|instagram|twitter|x|tiktok|snap|snapchat|threads|linkedin|yt|youtube|discord|handle";
const HANDLE_AT = /@[\w.]{2,30}/g;
const HANDLE_TAG = /\b\w{2,32}#\d{3,8}\b/g;
// a platform word, ":" and a token: "ig: jane.doe", "FB: jane"
const HANDLE_COLON = new RegExp(
  String.raw`\b(?:${PLATFORMS})\b\s{0,2}:\s{0,3}[\w.]{2,30}`,
  "gi",
);
// a platform word and a token that has a letter and a digit, "_" or ".": "insta jane_doe". Bare words are left alone.
const HANDLE_TOKEN = new RegExp(
  String.raw`\b(?:${PLATFORMS})\b[\s-]{1,3}(?:(?:is|na)\b[\s-]{1,3})?(?=[\w.]{3,30}\b)(?=[\w.]{0,29}[a-z])(?=[\w.]{0,29}[\d_.])[\w.]{3,30}`,
  "gi",
);

const NUM_WORD =
  "zero|oh|nought|one|two|three|four|five|six|seven|eight|nine|double|triple";
const SEP = String.raw`[\s,.\-/_:|()]{1,3}`;
// digits with separators; the letter O between digits counts as 0
const D = String.raw`(?:\d|(?<=\d)[Oo](?=\d)|(?<![a-z\d])[Oo](?=\d))`;
const PHONE_DIGITS = new RegExp(
  String.raw`\+?${D}(?:[\s\-./_,:|()]{0,3}${D}){9,24}`,
  "g",
);
// digits and number words
const PHONE_MIXED = new RegExp(
  String.raw`\b(?:(?:\d{1,11}|${NUM_WORD})${SEP}){1,24}(?:\d{1,11}|${NUM_WORD})\b`,
  "gi",
);
const THOUSANDS = /^\d{1,3}(?:,\d{3})+$/;
const DATE_START = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})\b/;

const NUMBER_WORD = new RegExp(`^(?:${NUM_WORD})$`, "i");

/** Digits and number words in a match: each word counts one. */
function units(m: string): { digits: number; words: number } {
  let digits = 0;
  let words = 0;
  for (const t of m.split(/[^a-z0-9]+/i)) {
    if (t === "") continue;
    if (NUMBER_WORD.test(t)) words++;
    else if (/^\d+$/.test(t)) digits += t.length;
  }
  return { digits, words };
}

function phoneDigits(m: string): string {
  if (THOUSANDS.test(m.trim()) || DATE_START.test(m.trim())) return m;
  const real = (m.match(/\d/g) ?? []).length;
  return real >= 6 ? "" : m;
}

function phoneMixed(m: string): string {
  const { digits, words } = units(m);
  if (words === 0) return m; // pure digits are the other pattern's
  if (digits === 0) return words >= 7 ? "" : m;
  return digits + words >= 10 ? "" : m;
}

export function scrub(text: string, max = MAX_SCRUB_CHARS): string {
  return text
    .slice(0, max)
    .normalize("NFKC")
    .replace(/[٠-٩۰-۹]/g, (d) =>
      String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)),
    )
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, "")
    .replace(/\s{0,2}[[({]\s{0,2}\.\s{0,2}[\])}]\s{0,2}/g, ".")
    .replace(EMAIL_SYMBOL, "")
    .replace(EMAIL_WORD, "")
    .replace(SCHEME_LINK, "")
    .replace(SCRIPT_LINK, "")
    .replace(WWW_LINK, "")
    .replace(PATH_LINK, "")
    .replace(ENDING_LINK, "")
    .replace(HANDLE_COLON, "")
    .replace(HANDLE_TOKEN, "")
    .replace(HANDLE_AT, "")
    .replace(HANDLE_TAG, "")
    .replace(PHONE_MIXED, phoneMixed)
    .replace(PHONE_DIGITS, phoneDigits)
    .replace(/\s+/g, " ")
    .trim();
}
