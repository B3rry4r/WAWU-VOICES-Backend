import { countChars } from "../units/text-price";
import { COMMON_WORDS } from "./common-words";

/** One change shown to the person: the words that were there, the words that replace them, where they start. */
export interface FixChange {
  from: string;
  to: string;
  /** Position of `from` in the original text, in characters (countChars). */
  start: number;
}

/** lead ruling LF, 9 Nov: the meaning guard rules, written down so the test set can check each one. */
const NEG_WORDS = new Set([
  "not",
  "no",
  "never",
  "none",
  "nobody",
  "nothing",
  "nowhere",
  "neither",
  "nor",
  "without",
  "cannot",
  "neva",
  "dont",
  "doesnt",
  "didnt",
  "cant",
  "wont",
  "isnt",
  "arent",
  "wasnt",
  "werent",
  "couldnt",
  "wouldnt",
  "shouldnt",
  "havent",
  "hasnt",
  "hadnt",
  "aint",
  "mustnt",
  "neednt",
]);
const NEG_PREFIXES = ["un", "in", "il", "im", "ir", "dis", "non"];
/** Grammar pairs a fix may make (either way). Apostrophes are ignored when comparing. */
const GRAMMAR: [string, string][] = [
  ["was", "were"],
  ["is", "are"],
  ["has", "have"],
  ["does", "do"],
  ["a", "an"],
  ["there", "their"],
  ["there", "theyre"],
  ["their", "theyre"],
  ["your", "youre"],
  ["its", "its"],
  ["to", "too"],
  ["then", "than"],
  ["dont", "doesnt"],
  ["am", "is"],
  ["am", "are"],
];
const GRAMMAR_SET = new Set(
  GRAMMAR.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
);
/** One person: a case form of the same pronoun may change (him to he, me to I); another person may not. */
const PRONOUNS: string[][] = [
  ["i", "me", "my", "mine", "myself"],
  ["you", "your", "yours", "yourself"],
  ["he", "him", "his", "himself"],
  ["she", "her", "hers", "herself"],
  ["it", "its", "itself"],
  ["we", "us", "our", "ours", "ourselves"],
  ["they", "them", "their", "theirs", "themselves"],
];
const PRONOUN_OF = new Map<string, number>();
PRONOUNS.forEach((g, n) => g.forEach((w) => PRONOUN_OF.set(w, n)));
/** Small words that may be added or removed on their own (a missing "am", "the", "to"). */
const SMALL = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "do",
  "does",
  "has",
  "have",
  "in",
  "on",
  "at",
]);

const lc = (s: string) => s.toLowerCase();
/** The letters of a token, lower case, without apostrophes or punctuation at the edges. */
const core = (w: string) =>
  lc(w)
    .replace(/['\u2019]/g, "")
    .replace(/^[^\p{L}\p{N}@#]+|[^\p{L}\p{N}]+$/gu, "");
const rawCore = (w: string) =>
  w.replace(/^[^\p{L}\p{N}@#']+|[^\p{L}\p{N}']+$/gu, "");
const wordsOf = (s: string) => s.split(/\s+/).filter((t) => core(t) !== "");

/** Damerau edit distance: a swap of two neighbouring letters is one edit. */
function dist(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => {
    const row: number[] = new Array<number>(y.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[x.length][y.length];
}

const isNeg = (w: string) => NEG_WORDS.has(core(w));
const maxDist = (len: number) => (len <= 4 ? 1 : len >= 10 ? 3 : 2);

/** Word-by-word difference (longest common run), as hunks of tokens. Whitespace is a token of its own. */
export function diffTokens(a: string, b: string): FixChange[] {
  const ta = a.match(/\s+|[^\s]+/gu) ?? [];
  const tb = b.match(/\s+|[^\s]+/gu) ?? [];
  const n = ta.length;
  const m = tb.length;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] =
        ta[i] === tb[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out: FixChange[] = [];
  let i = 0;
  let j = 0;
  let pos = 0; // characters of `a` consumed so far
  let from = "";
  let to = "";
  let start = 0;
  const flush = () => {
    if (from || to) out.push({ from, to, start });
    from = "";
    to = "";
  };
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) {
      flush();
      pos += countChars(ta[i]);
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      if (!from && !to) start = pos;
      to += tb[j++];
    } else {
      if (!from && !to) start = pos;
      from += ta[i];
      pos += countChars(ta[i]);
      i++;
    }
  }
  flush();
  return out;
}

export type FixCheck =
  { ok: true; changes: FixChange[] } | { ok: false; reason: string };

/** Is the word at this character position the first of a sentence? */
function startsSentence(chars: string[], at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    if (/\s/.test(chars[i])) {
      if (chars[i] === "\n") return true;
      continue;
    }
    return /[.!?]/.test(chars[i]);
  }
  return true;
}

/** One replaced word. Returns a reason when the change could change what the person means. */
function wordChange(
  from: string,
  to: string,
  sentenceStart: boolean,
  prevWord: string,
): string | null {
  const a = core(from);
  const b = core(to);
  if (a === b) return null; // capitals, punctuation and apostrophes only
  if (/\p{N}/u.test(from) || /\p{N}/u.test(to)) return "a number changed";
  if (/^[@#]/.test(from) || /^[@#]/.test(to)) return "a handle or tag changed";
  const r = rawCore(from);
  if (!sentenceStart && /^\p{Lu}/u.test(r) && lc(r) !== "i" && !/^i'/i.test(r))
    return "a name changed";
  const rt = rawCore(to);
  if (
    /^\p{Lu}/u.test(rt) &&
    !/^\p{Lu}/u.test(r) &&
    !sentenceStart &&
    lc(rt) !== "i"
  )
    return "a name was added";
  if (GRAMMAR_SET.has(`${a}|${b}`)) return null;
  const pa = PRONOUN_OF.get(a);
  const pb = PRONOUN_OF.get(b);
  if (pa !== undefined || pb !== undefined)
    return pa === pb ? null : "a person changed";
  // "i dont no": the typo for "know" after a negation is the one place "no" may go
  if (a === "no" && b === "know" && isNeg(prevWord)) return null;
  if (isNeg(from) !== isNeg(to)) return "a negation changed";
  for (const p of NEG_PREFIXES)
    if (a === p + b || b === p + a) return "a negation changed";
  if (COMMON_WORDS.has(a)) return "a word was swapped for a different word";
  if (dist(a, b) > maxDist(Math.max(a.length, b.length)))
    return "a word was replaced by a different one";
  return null;
}

/**
 * lead ruling LF, 9 Nov: the meaning guard. The AI is asked to fix spelling and grammar only, and the answer is checked
 * here because a model can be wrong or be talked into more. Every changed word is judged on its own:
 * - numbers, names (a capital letter inside a sentence) and handles never change;
 * - nothing adds or removes a negation (not, no, never, n't, and the prefixes un- in- il- im- ir- dis- non-);
 * - a real word (in the common word list) is never swapped for a different one, except the grammar pairs
 *   was/were, is/are, has/have, does/do, a/an, there/their/they're, your/you're, its/it's, to/too, then/than;
 * - a person never changes (him to her), a case form of the same one may (him to he, me to I);
 * - a misspelt word becomes a word within a small edit distance; capitals, apostrophes and punctuation are free;
 * - a few small words may be added or removed, and a split or join of words (alot, a lot) is allowed;
 * - the whole fix touches a small part of the text.
 */
export function checkFix(original: string, fixed: string): FixCheck {
  if (fixed === original) return { ok: true, changes: [] };
  const changes = diffTokens(original, fixed);
  const chars = [...original];
  let edits = 0;
  for (const c of changes) {
    const fw = wordsOf(c.from);
    const tw = wordsOf(c.to);
    if (fw.length === 0 && tw.length === 0) {
      edits += 1; // only spaces moved
      continue;
    }
    const prev = wordsOf(chars.slice(0, c.start).join(""));
    const prevWord = prev[prev.length - 1] ?? "";
    let reason: string | null = null;
    if (fw.length === tw.length) {
      fw.forEach((f, k) => {
        if (reason) return;
        const at = k === 0 ? c.start : c.start + [...c.from].length; // later words are never at a sentence start
        reason = wordChange(
          f,
          tw[k],
          k === 0 && startsSentence(chars, at),
          k === 0 ? prevWord : core(fw[k - 1]),
        );
      });
    } else if (core(fw.join("")) === core(tw.join(""))) {
      reason = null; // alot / a lot
    } else if (fw.length === 0 || tw.length === 0) {
      const only = fw.length ? fw : tw;
      const w = core(only[0]);
      if (only.length > 1 || (!SMALL.has(w) && w.length > 0))
        reason = "words added or removed";
      else if (isNeg(only[0])) reason = "a negation changed";
    } else {
      reason = "words were rewritten";
    }
    if (reason) return { ok: false, reason };
    edits += dist(c.from, c.to);
  }
  if (edits > Math.max(10, countChars(original) * 0.35))
    return { ok: false, reason: "too much of the text changed" };
  return { ok: true, changes };
}
