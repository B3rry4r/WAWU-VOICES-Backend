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
// An email is removed whatever script its name or domain is in (letters of any script, punycode is ASCII already).
const ULABEL = "[\\p{L}\\p{N}-]{1,63}";
const ULOCAL = "[\\p{L}\\p{N}._%+'-]{1,64}";
const BR_OPEN = String.raw`[\[({<]`;
const BR_CLOSE = String.raw`[\])}>]`;
/** A written or symbol dot between labels: ".", "[dot]", "(.)", " dot ". */
const DOT = String.raw`(?:\.|\s{0,3}${BR_OPEN}\s{0,3}(?:dot|\.)\s{0,3}${BR_CLOSE}\s{0,3}|\s{1,3}dot\s{1,3})`;
const AT_SYM = String.raw`(?:\s{0,3}@{1,2}\s{0,3}|\s{0,3}${BR_OPEN}\s{0,3}at\s{0,3}${BR_CLOSE}\s{0,3})`;

// An email is removed whole, local part and all.
const EMAIL_SYMBOL = new RegExp(
  `${ULOCAL}${AT_SYM}${ULABEL}(?:${DOT}${ULABEL}){1,5}`,
  "giu",
);
// "jane at example dot com", "jane at x . com": the bare word "at" counts only in the shape
// word, at-word, word, dot-word, known ending.
const EMAIL_WORD = new RegExp(
  String.raw`[a-z0-9._-]{1,40}\s{1,3}at\s{1,3}${LABEL}(?:(?:${DOT}|\s{1,3}\.\s{1,3})${LABEL}){0,3}(?:${DOT}|\s{1,3}\.\s{1,3})(?:${ENDINGS})\b`,
  "gi",
);
const SCHEME_LINK =
  /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s<>"')]{1,2000}|\b(?:https?|ftp):[\\/]{1,3}[^\s<>"')]{1,2000}/gi;
const SCRIPT_LINK = /\b(?:javascript|vbscript|data):[^\s<>"']{0,500}/gi;
const WWW_LINK = /\bwww\.[^\s<>"')]{1,2000}/gi;
// label.label/path. The first label is two or more letters with no digit, and is not a title (Dr.Ade/Dr.Bola): a price per
// unit ("N617.50/litre", "USD1.50/kg", "N1.5m/month") and a version ("v1.2/final") are never a link.
const PATH_LINK = new RegExp(
  String.raw`\b(?!(?:dr|mr|mrs|ms|prof|st|engr|rev|hon|capt|alh|mal|chief|barr|sir)\.)[a-z][a-z-]{1,62}(?:\.[a-z0-9-]{1,63}){1,5}\/[^\s<>"')]{0,500}|\b[a-z]\.(?:${ENDINGS})\/[^\s<>"')]{0,500}`,
  "gi",
);
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
  String.raw`${ULOCAL}\s{1,3}@\s{0,3}${ULABEL}(?:(?:${DOT}|\s{1,3}\.\s{0,3}|\.\s{1,3})${ULABEL}){0,3}(?:${DOT}|\s{1,3}\.\s{0,3}|\.\s{1,3})(?:${ENDINGS})\b`,
  "giu",
);
// a scheme or "www" typed with spaces between its letters: "w w w . evil . com", "h t t p s : / / evil . com"
const SPACED_WWW =
  /\bw\s{0,2}w\s{0,2}w\s{0,2}\.\s{0,2}[a-z0-9-]{1,63}(?:\s{0,2}\.\s{0,2}[a-z0-9-]{1,63}){0,5}/gi;
const SPACED_SCHEME =
  /\bh\s{0,2}t\s{0,2}t\s{0,2}p\s{0,2}s?\s{0,2}:\s{0,2}\/\s{0,2}\/\s{0,2}[a-z0-9-]{1,63}(?:\s{0,2}\.\s{0,2}[a-z0-9-]{1,63}){0,5}(?:\s{0,2}\/\s{0,2}[^\s<>"')]{0,500})?/gi;
const IPV4 =
  /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/[^\s<>"')]{0,500})?/g;

const PLATFORMS =
  "fb|facebook|tg|telegram|wa|whatsapp|ig|insta|instagram|twitter|x|tiktok|snap|snapchat|threads|linkedin|yt|youtube|discord|handle|handles|sc";
const HANDLE_AT = /@[\p{L}\p{N}_.]{2,30}/gu;
const HANDLE_TAG = /\b\w{2,32}#\d{3,8}\b/g;
// a platform word, ":" or "@" and a token: "ig: jane.doe", "FB: jane", "tiktok @ jane", "discord: jane#1234". A dot ends no token.
const HANDLE_COLON = new RegExp(
  String.raw`\b(?:${PLATFORMS})\b\s{0,2}[:@]\s{0,3}@?\s{0,3}\w{2,30}(?:\.\w{1,30}){0,3}(?:#\d{3,8})?`,
  "gi",
);
// a platform word, any mark, and a token that holds "_", or a dot BETWEEN two word characters ("jane.doe"), or three or more
// letters and then a digit ("janedoe99"). A number with a unit ("handle 10k users"), a currency tag ("handle N5,000") and bare
// words are left alone, and so is a full stop at the end of a sentence.
const HANDLE_TOKEN = new RegExp(
  String.raw`\b(?:${PLATFORMS})\b[^\p{L}\d]{1,4}(?:(?:is|na)\b[^\p{L}\d]{1,4})?(?=[\w.]{0,60}[a-z])(?:\w{1,30}(?:\.\w{1,30}){1,3}|\w{0,29}_\w{0,29}(?:\.\w{1,30}){0,3}|[a-z]{3,20}\w{0,9}\d\w{0,9}(?:\.\w{1,30}){0,3})`,
  "giu",
);

// ---- phones, by shape. A run of digit groups (and single number words) with up to 5 non-letter, non-digit characters
// between the groups; inside it a phone number is a stretch of groups whose digits, joined, are one of:
//   a. "+" and 10 to 15 digits;  b. a Nigerian mobile, 11 digits 0[789][01]xxxxxxxx;
//   c. 234[789][01]xxxxxxxx (13 digits, or with a leading 0 or 00);  d. one unbroken group of 10 to 15 digits;
//   e. ddd-ddd-dddd, ddd.ddd.dddd or (ddd) ddd-dddd.
// A spoken or mixed stretch must start with zero, oh, 0 or "+" and fit a, b or c. Nothing else is a phone, so times, scores,
// dates, decimals, prices and lists stay. Every phone in a run is removed. A landline or a foreign number written in spaced
// groups with no "+" is left.
const NUM_WORD = "zero|oh|one|two|three|four|five|six|seven|eight|nine";
const WORD_DIGIT: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
const GROUP = String.raw`(?:\d{1,30}|\b(?:${NUM_WORD})\b)`;
const PHONE_CHAIN = new RegExp(
  String.raw`[+(]?(?<![\d])${GROUP}(?:[^\p{L}\d]{1,5}${GROUP}){1,20}`,
  "giu",
);
const PHONE_SINGLE = /(?<!\d)\+?\d{10,15}(?!\d)/g;

interface Tok {
  text: string;
  start: number;
  end: number;
  word: boolean;
  digits: string;
}

function fits(joined: string, plus: boolean): boolean {
  if (plus && joined.length >= 10 && joined.length <= 15) return true; // a
  if (/^0[789][01]\d{8}$/.test(joined)) return true; // b
  return /^0{0,2}234[789][01]\d{8}$/.test(joined); // c
}

/** The start of the phone number that begins at token i and ends at token j-1, or -1 when the stretch is not one. */
function phoneStart(t: Tok[], i: number, j: number, m: string): number {
  const sub = t.slice(i, j);
  const plus = m[sub[0].start - 1] === "+";
  const joined = sub.map((x) => x.digits).join("");
  const mixed = sub.some((x) => x.word);
  const from = sub[0].start - (plus ? 1 : 0);
  if (mixed) {
    const f = sub[0];
    const startsRight =
      plus || (f.word ? /^(?:zero|oh)$/i.test(f.text) : f.text.startsWith("0"));
    return startsRight && fits(joined, plus) ? from : -1;
  }
  if (fits(joined, plus)) return from;
  if (sub.length === 1 && joined.length >= 10 && joined.length <= 15)
    return from; // d
  const paren = m[sub[0].start - 1] === "(" ? sub[0].start - 1 : sub[0].start;
  const raw = m.slice(paren, sub[sub.length - 1].end);
  return /^(?:\d{3}-\d{3}-\d{4}|\d{3}\.\d{3}\.\d{4}|\(\d{3}\) ?\d{3}-\d{4})$/.test(
    raw,
  )
    ? paren
    : -1;
}

function phoneChain(m: string, mark: string): string {
  const toks: Tok[] = [...m.matchAll(/\d+|[a-z]+/gi)].map((x) => {
    const word = /[a-z]/i.test(x[0]);
    return {
      text: x[0],
      start: x.index,
      end: x.index + x[0].length,
      word,
      digits: word ? (WORD_DIGIT[x[0].toLowerCase()] ?? "") : x[0],
    };
  });
  let out = "";
  let cursor = 0;
  let i = 0;
  while (i < toks.length) {
    // a group after a bare comma is a thousands group ("10,000, 20,000"), never the start of a number
    const thousands =
      i > 0 &&
      !toks[i].word &&
      toks[i].text.length === 3 &&
      m.slice(toks[i - 1].end, toks[i].start) === ",";
    let hit = -1;
    let end = i;
    // a number with a "+" never runs on into the next "+" number
    let top = toks.length;
    for (let k = i + 1; k < toks.length; k++)
      if (
        m[toks[k].start - 1] === "+" &&
        /[\s,;/&|(]/.test(m[toks[k].start - 2] ?? "")
      ) {
        top = k;
        break;
      }
    if (!thousands) {
      // every phone shape holds 10 to 15 digits, so only those stretches are looked at
      let count = 0;
      for (let j = i + 1; j <= top; j++) {
        count += toks[j - 1].digits.length;
        if (count > 15) break;
        if (count < 10) continue;
        const from = phoneStart(toks, i, j, m);
        if (from >= 0) {
          hit = from;
          end = j;
        }
      }
    }
    if (hit >= 0) {
      out += m.slice(cursor, hit) + mark;
      cursor = toks[end - 1].end;
      i = end;
    } else i++;
  }
  return out + m.slice(cursor);
}

/** The visible mark the model path puts where something was taken out. */
export const REMOVED_MARK = "[removed]";

/**
 * `mark` is what each match is replaced by: "" deletes it (the posts on their way to the provider: nobody reads that text),
 * and REMOVED_MARK shows it (the model's answer for the editor: a wrong cut is seen, never silent).
 */
export function scrub(text: string, max = MAX_SCRUB_CHARS, mark = ""): string {
  const R = mark ? ` ${mark} ` : "";
  // "Dinner @ home. Net later.": a capitalised ending after a full stop and a space starts a sentence, it is not an email's
  const spacedEmail = (m: string): string => {
    const last = /[A-Za-z]+$/.exec(m)?.[0] ?? "";
    return /^[A-Z]/.test(last) && /\.\s+[A-Za-z]+$/.test(m) ? m : R;
  };
  let out = text
    .slice(0, max)
    .normalize("NFKC")
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) =>
      String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)),
    )
    .replace(/\p{Cf}/gu, "")
    .replace(/[\u3002\uFF61]/g, ".")
    .replace(/(?<=\d)[oO](?=\d)|(?<![\p{L}\d])[oO](?=\d)/gu, "0")
    .replace(/\s{0,2}[[({]\s{0,2}\.\s{0,2}[\])}]\s{0,2}/g, ".");
  // The e-mail patterns are not anchored, so they run only when the text could hold an at sign or a spoken "at".
  if (/@|\bat\b/i.test(out))
    out = out.replace(EMAIL_SYMBOL, R).replace(EMAIL_SPACED, spacedEmail);
  if (/\sat\s/i.test(out)) out = out.replace(EMAIL_WORD, R);
  out = out
    .replace(SCHEME_LINK, R)
    .replace(SPACED_SCHEME, R)
    .replace(SCRIPT_LINK, R)
    .replace(WWW_LINK, R)
    .replace(SPACED_WWW, R)
    .replace(IPV4, R)
    .replace(PHONE_CHAIN, (m) => phoneChain(m, R))
    .replace(PHONE_SINGLE, R)
    .replace(PATH_LINK, R)
    .replace(ENDING_LINK, R)
    .replace(SPACED_LINK, R)
    .replace(HANDLE_COLON, R)
    .replace(HANDLE_TOKEN, R)
    .replace(HANDLE_AT, R)
    .replace(HANDLE_TAG, R)
    .replace(/\s+/g, " ")
    .trim();
  return mark ? out.replace(/\s+([.,;:!?)])/g, "$1") : out;
}

// Run every pattern once at load: V8 compiles a Unicode, case-insensitive pattern on its first use, which costs about 100 ms
// and would otherwise land on the first post scrubbed.
scrub("Ж@ж.рф 0803 123 4567 t.me/x ig: a_1 www.a.com", 200, REMOVED_MARK);
