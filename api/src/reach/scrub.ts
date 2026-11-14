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
  "com|net|org|ng|co|io|me|app|ly|gov|edu|info|biz|xyz|online|store|link|ee|ca|dev|uk|us|africa|site|shop|live|tv|cc|to|gg|page|blog|club|top|pro|tech|ai|gh|ke|za|tk|ru|cn|fr|vip|icu|xxx|click|cloud";
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
  String.raw`\b${LABEL}(?:\.${LABEL}){0,5}\.(?:${ENDINGS})\b|\b${LABEL}(?:${DOT}${LABEL}){0,3}${DOT}(?:${ENDINGS})\b`,
  "gi",
);

// With spaces around the dot ("evil . com", "evil .com", "evil. com", a line break inside) it is a link only when the
// ending is typed in lower case and is one of a few: an ordinary sentence ("Rice is dear. Shop owners cry.") never is.
const SPACED_LINK =
  /\b[A-Za-z0-9-]{1,63}(?:\s{1,3}\.\s{0,3}|\.\s{1,3})(?:com|net|org|ng|info|biz|xyz|io)\b/g;
// "jane @ example . com": an email when it ends in a listed ending
const EMAIL_SPACED = new RegExp(
  String.raw`${LOCAL}\s{1,3}@\s{0,3}${LABEL}(?:(?:${DOT}|\s{1,3}\.\s{0,3}|\.\s{1,3})${LABEL}){0,3}(?:${DOT}|\s{1,3}\.\s{0,3}|\.\s{1,3})(?:${ENDINGS})\b`,
  "gi",
);
// a scheme or "www" typed with spaces between its letters: "w w w . evil . com", "h t t p s : / / evil . com"
const SPACED_WWW =
  /\bw\s{0,2}w\s{0,2}w\s{0,2}\.\s{0,2}[a-z0-9-]{1,63}(?:\s{0,2}\.\s{0,2}[a-z0-9-]{1,63}){0,5}/gi;
const SPACED_SCHEME =
  /\bh\s{0,2}t\s{0,2}t\s{0,2}p\s{0,2}s?\s{0,2}:\s{0,2}\/\s{0,2}\/\s{0,2}[a-z0-9-]{1,63}(?:\s{0,2}\.\s{0,2}[a-z0-9-]{1,63}){0,5}(?:\s{0,2}\/\s{0,2}[^\s<>"')]{0,500})?/gi;
const IPV4 =
  /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/[^\s<>"')]{0,500})?/g;

const PLATFORMS =
  "fb|facebook|tg|telegram|wa|whatsapp|ig|insta|instagram|twitter|x|tiktok|snap|snapchat|threads|linkedin|yt|youtube|discord|handle";
const HANDLE_AT = /@[\w.]{2,30}/g;
const HANDLE_TAG = /\b\w{2,32}#\d{3,8}\b/g;
// a platform word, ":" and a token: "ig: jane.doe", "FB: jane", "discord: jane#1234". A dot ends no token.
const HANDLE_COLON = new RegExp(
  String.raw`\b(?:${PLATFORMS})\b\s{0,2}:\s{0,3}\w{2,30}(?:\.\w{1,30}){0,3}(?:#\d{3,8})?`,
  "gi",
);
// a platform word and a token that holds a digit or "_", or a dot BETWEEN two word characters ("jane.doe"), and a letter.
// Bare words, and a full stop at the end of a sentence, are left alone.
const HANDLE_TOKEN = new RegExp(
  String.raw`\b(?:${PLATFORMS})\b[\s-]{1,3}(?:(?:is|na)\b[\s-]{1,3})?(?=[\w.]{0,60}[a-z])(?:\w{1,30}(?:\.\w{1,30}){1,3}|\w{0,29}[\d_]\w{0,29}(?:\.\w{1,30}){0,3})`,
  "gi",
);

// ---- phones. A run of digit groups (and single number words) with up to 5 non-letter, non-digit characters between
// the groups; it is a phone number only by one of the rules in isPhone, so prices, ranges, years and counting stay.
const NUM_WORD = "zero|oh|one|two|three|four|five|six|seven|eight|nine";
const GROUP = String.raw`(?:\d{1,30}|\b(?:${NUM_WORD})\b)`;
const PHONE_CHAIN = new RegExp(
  String.raw`\+?(?<![\d])${GROUP}(?:[^\p{L}\d]{1,5}${GROUP}){1,20}`,
  "giu",
);
const PHONE_SINGLE = /(?<!\d)\+?\d{10,15}(?!\d)/g;

interface Tok {
  text: string;
  start: number;
  end: number;
  word: boolean;
}

function isPhone(t: Tok[], plus: boolean, full: string): boolean {
  const words = t.some((x) => x.word);
  const digits = t.reduce((n, x) => n + (x.word ? 1 : x.text.length), 0);
  const first = t[0];
  if (words)
    return (plus || /^(?:zero|oh|0)/i.test(first.text)) && digits >= 10;
  if (plus && digits >= 10 && digits <= 15) return true; // a. starts with +
  if (
    (first.text.startsWith("0") || first.text === "234") &&
    digits >= 10 &&
    digits <= 14
  )
    return true; // b.
  if (t.length === 3) {
    // d. exactly three groups 3-3-4, 4-3-4 or 3-4-4, one space, dash or dot between
    const sizes = t.map((x) => x.text.length).join("-");
    const seps = [
      full.slice(t[0].end, t[1].start),
      full.slice(t[1].end, t[2].start),
    ];
    if (
      ["3-3-4", "4-3-4", "3-4-4"].includes(sizes) &&
      seps.every((x) => x.length === 1 && " -.".includes(x))
    )
      return true;
  }
  return false;
}

function phoneChain(m: string): string {
  const plus = m.startsWith("+");
  const toks: Tok[] = [...m.matchAll(/\d+|[a-z]+/gi)].map((x) => ({
    text: x[0],
    start: x.index,
    end: x.index + x[0].length,
    word: /[a-z]/i.test(x[0]),
  }));
  for (let i = 0; i < toks.length; i++) {
    // a group after a bare comma is a thousands group ("10,000, 20,000"), never the start of a number
    if (
      i > 0 &&
      !toks[i].word &&
      m.slice(toks[i - 1].end, toks[i].start) === ","
    )
      continue;
    for (let j = toks.length; j > i; j--)
      if (isPhone(toks.slice(i, j), plus && i === 0, m))
        return (
          m.slice(0, toks[i].start - (plus && i === 0 ? 1 : 0)) +
          " " +
          m.slice(toks[j - 1].end)
        );
  }
  return m;
}

export function scrub(text: string, max = MAX_SCRUB_CHARS): string {
  return text
    .slice(0, max)
    .normalize("NFKC")
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) =>
      String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)),
    )
    .replace(/\p{Cf}/gu, "")
    .replace(/[\u3002\uFF61]/g, ".")
    .replace(/(?<=\d)[oO](?=\d)|(?<![\p{L}\d])[oO](?=\d)/gu, "0")
    .replace(/\s{0,2}[[({]\s{0,2}\.\s{0,2}[\])}]\s{0,2}/g, ".")
    .replace(EMAIL_SYMBOL, "")
    .replace(EMAIL_SPACED, "")
    .replace(EMAIL_WORD, "")
    .replace(SCHEME_LINK, "")
    .replace(SPACED_SCHEME, "")
    .replace(SCRIPT_LINK, "")
    .replace(WWW_LINK, "")
    .replace(SPACED_WWW, "")
    .replace(IPV4, "")
    .replace(PHONE_CHAIN, phoneChain)
    .replace(PHONE_SINGLE, "")
    .replace(PATH_LINK, "")
    .replace(ENDING_LINK, "")
    .replace(SPACED_LINK, "")
    .replace(HANDLE_COLON, "")
    .replace(HANDLE_TOKEN, "")
    .replace(HANDLE_AT, "")
    .replace(HANDLE_TAG, "")
    .replace(/\s+/g, " ")
    .trim();
}
