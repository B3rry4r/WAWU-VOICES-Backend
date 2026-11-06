import type { RankingConfig } from "./ranking.config";

/** What the job counts for one answer: people, never events. Each count is a number of different people. */
export interface AnswerSignals {
  id: string;
  createdAt: Date;
  likers: number;
  reactors: number;
  /** People with a meaningful reply (20+ characters of text, or a voice clip). */
  repliers: number;
  sharers: number;
  /** Signed-in people (never the author) who played the voice to at least 90% (LISTEN-1). */
  listeners?: number;
  /** Lead ruling LS, 6 Nov (LS9): guest finishers are recorded but the guest share of the listen weight is 0 by default, so they never move the ranking. */
  guestListeners?: number;
  /** People with a meaningful AGREE reply, and with a meaningful DISAGREE reply. */
  agreeRepliers: number;
  disagreeRepliers: number;
}

const HOUR_MS = 3_600_000;

export function ageHours(createdAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - createdAt.getTime()) / HOUR_MS);
}

/**
 * rankScore before the fair-chance floor: (1.0 likers + 1.5 reactors + 2.0 meaningful repliers + 1.0 sharers + 0.5 finished listeners)
 * / (ageHours + 2) ^ 1.5. Every reaction kind counts the same way, Disagree included, so disagreement only ever
 * raises the score. Follower count is not an input.
 */
export function baseRank(
  s: AnswerSignals,
  now: Date,
  c: RankingConfig,
): number {
  const weighted =
    (c.likeWeight * s.likers +
      c.reactionWeight * s.reactors +
      c.replyWeight * s.repliers +
      c.shareWeight * s.sharers +
      c.listenWeight * (s.listeners ?? 0) +
      (c.listenWeight * c.guestListenWeight * (s.guestListeners ?? 0)) / 100) /
    100;
  return (
    weighted /
    Math.pow(ageHours(s.createdAt, now) + c.ageOffsetHours, c.rankDecay / 100)
  );
}

/** debateScore = (2 min(agree, disagree) + 1 meaningful repliers) / (ageHours + 2) ^ 1.2. */
export function debate(s: AnswerSignals, now: Date, c: RankingConfig): number {
  const weighted =
    (c.debatePairWeight * Math.min(s.agreeRepliers, s.disagreeRepliers) +
      c.debateReplyWeight * s.repliers) /
    100;
  return (
    weighted /
    Math.pow(ageHours(s.createdAt, now) + c.ageOffsetHours, c.debateDecay / 100)
  );
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const v = values.slice().sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Scores every answer of ONE question. The fair-chance floor is that question's median base score. */
export function scoreQuestion(
  answers: AnswerSignals[],
  now: Date,
  c: RankingConfig,
): { id: string; rankScore: number; debateScore: number }[] {
  const base = answers.map((a) => baseRank(a, now, c));
  const floor = median(base);
  return answers.map((a, i) => ({
    id: a.id,
    rankScore:
      ageHours(a.createdAt, now) < c.fairChanceHours
        ? Math.max(base[i], floor)
        : base[i],
    debateScore: debate(a, now, c),
  }));
}
