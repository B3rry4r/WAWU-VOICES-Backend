import { countChars } from "../units/text-price";

/** One change shown to the person: the words that were there, the words that replace them, where they start. */
export interface FixChange {
  from: string;
  to: string;
  /** Position of `from` in the original text, in characters (countChars). */
  start: number;
}

const NEGATIONS = new Set([
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
  "dont",
  "doesnt",
  "didnt",
  "wont",
  "wouldnt",
  "cant",
  "couldnt",
  "isnt",
  "arent",
  "wasnt",
  "werent",
  "shouldnt",
  "havent",
  "hasnt",
  "hadnt",
  "aint",
  "neva",
]);

const lc = (s: string) => s.toLowerCase();
const words = (s: string) => s.match(/[\p{L}\p{N}']+/gu) ?? [];
const plain = (w: string) => lc(w).replace(/'/g, "");

function lev(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[y.length];
}

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

/**
 * The meaning guard. The AI is asked to fix spelling and grammar only, and then the answer is checked here, because a
 * model can be wrong or be talked into more. A fix is kept only if: every change is typo-sized (a few letters in a word,
 * a small word added or removed, punctuation or capital letters), no negation word appears or disappears, no digit
 * changes, and the whole fix touches a small part of the text. Anything else is refused and costs nothing.
 */
export function checkFix(original: string, fixed: string): FixCheck {
  if (fixed === original) return { ok: true, changes: [] };
  const changes = diffTokens(original, fixed);
  const digits = (s: string) => (s.match(/\p{N}/gu) ?? []).join("");
  if (digits(original) !== digits(fixed))
    return { ok: false, reason: "digits changed" };
  const neg = (s: string) =>
    words(s).filter((w) => NEGATIONS.has(plain(w))).length;
  if (neg(original) !== neg(fixed))
    return { ok: false, reason: "a negation changed" };
  let edits = 0;
  for (const c of changes) {
    const f = c.from.trim();
    const t = c.to.trim();
    if (!f && !t) {
      edits += 1; // only spaces moved
      continue;
    }
    const fw = words(f);
    const tw = words(t);
    if (fw.length === 0 || tw.length === 0) {
      // something added or removed on its own: punctuation, or one small word (a, an, the, to, is, am)
      const only = fw.length ? fw : tw;
      if (only.length > 1 || (only[0] && [...only[0]].length > 3))
        return { ok: false, reason: "words added or removed" };
      edits += [...(f || t)].length;
      continue;
    }
    if (fw.length > 3 || tw.length > 3)
      return { ok: false, reason: "too many words changed at once" };
    const d = lev(lc(f), lc(t));
    const longest = Math.max([...f].length, [...t].length);
    if (d > Math.max(2, Math.ceil(longest * 0.5)))
      return { ok: false, reason: "a word was replaced by a different one" };
    edits += d;
  }
  if (edits > Math.max(6, countChars(original) * 0.35))
    return { ok: false, reason: "too much of the text changed" };
  return { ok: true, changes };
}
