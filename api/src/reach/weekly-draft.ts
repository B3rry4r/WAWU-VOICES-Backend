import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";
import { PrismaService } from "../common/prisma/prisma.service";
import { MailEvents } from "../mail/mail-events";
import { Prisma } from "../generated/prisma/client";
import { addDays, dateOnly, lagosDay, lagosDayStart } from "../feed/lagos";

export const WEEKLY_DRAFTER = Symbol("WEEKLY_DRAFTER");

/** What the drafter reads: the week's text answers and transcripts, numbered, with handles and phone numbers already removed. */
export interface DraftInput {
  weekNumber: number;
  topicTitle: string;
  pollTitle: string;
  voices: { n: number; text: string }[];
}

/** What the drafter gives back. A theme names the voices behind it by number, so its count is counted here, never written by the model. */
export interface DraftOutput {
  headline: string;
  mood: string;
  summary: string;
  themes: { label: string; complaints: string[]; voices: number[] }[];
}

export interface WeeklyDrafter {
  draft(input: DraftInput): Promise<DraftOutput>;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  pcm: "Pidgin",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
};

const HANDLE_IN_TEXT = /@[a-z0-9._]{3,}/gi;
const PHONE_IN_TEXT = /\+?\d[\d\s\-().]{8,}\d/g;
const MAX_VOICES = 300;
const MAX_CHARS = 400;
const POLL_WINDOW_DAYS = 14;

/** Gemini behind the drafter port. Built only when GEMINI_API_KEY is set; with no key nothing is drafted and the team writes the text. */
export function makeGeminiWeeklyDrafter(env = process.env): WeeklyDrafter {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
  return {
    async draft(input) {
      const prompt =
        `You draft the weekly report of VOICES, a Nigerian public-opinion app. Week ${input.weekNumber}, topic "${input.topicTitle}". ` +
        `The week's poll asked: "${input.pollTitle}". Below are numbered voices (English, Pidgin, Yoruba, Igbo, Hausa). ` +
        `Write plain, calm English. Say "most voices", never "everyone". Never name, quote or describe any person, never give a handle or a phone number. ` +
        `Show the leading view and the main opposing view. It is a summary, not a consensus. ` +
        `Reply as JSON: {"headline": string, "mood": string (one short line), "summary": string (2 to 4 sentences), ` +
        `"themes": [{"label": string, "complaints": string[] (up to 3 short paraphrases), "voices": number[] (the numbers of the voices behind this theme)}]} with 2 to 6 themes.\n\n` +
        input.voices.map((v) => `${v.n}. ${v.text}`).join("\n");
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      });
      return JSON.parse(res.text ?? "{}") as DraftOutput;
    },
  };
}

/** Remove @handles and phone numbers before any text leaves this server. */
export function scrub(text: string): string {
  return text
    .replace(HANDLE_IN_TEXT, "")
    .replace(PHONE_IN_TEXT, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The default publish moment: the next configured weekday (0 Sunday to 6 Saturday) at the configured Lagos hour, after the poll closed. */
export function defaultPublishAt(
  pollEndsAt: Date,
  weekday: number,
  hour: number,
): Date {
  let day = lagosDay(pollEndsAt);
  for (let i = 0; i < 8; i++) {
    const at = new Date(lagosDayStart(day).getTime() + hour * 3_600_000);
    const dow = dateOnly(day).getUTCDay();
    if (dow === weekday && at.getTime() > pollEndsAt.getTime()) return at;
    day = addDays(day, 1);
  }
  return new Date(pollEndsAt.getTime() + 18 * 3_600_000);
}

const MOOD_NAMES: Record<string, string> = {
  ANGRY: "Angry",
  TIRED: "Tired",
  PROUD: "Proud",
  HOPEFUL: "Hopeful",
};

/** One person counts once per week: their latest mood answer on that week's mood questions. */
async function moodCounts(
  prisma: PrismaService,
  topicId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ mood: string; n: bigint }[]>`
    SELECT l.mood::text AS mood, count(*) AS n
    FROM (
      SELECT DISTINCT ON (a."authorId") a."authorId", a.mood
      FROM "Answer" a
      JOIN "Question" q ON q.id = a."questionId"
      JOIN "User" u ON u.id = a."authorId"
      WHERE q."topicId" = ${topicId}
        AND a.mood IS NOT NULL
        AND a.status = 'PUBLISHED'
        AND a."deletedAt" IS NULL
        AND u.status NOT IN ('BANNED', 'DELETED', 'DELETION_PENDING')
      ORDER BY a."authorId", a."createdAt" DESC, a.id DESC
    ) l
    GROUP BY l.mood`;
  return new Map(rows.map((r) => [r.mood, Number(r.n)]));
}

export type EmotionRow = { name: string; share: number; change: number };

/**
 * The week's leading emotions from the real mood answers (the mood question's four words), most common first. Each share
 * is the whole percent of the people who gave a word that week; change is the move in percentage points since the week
 * before, or 0 when that week had too few mood answers to compare. Under the anonymity floor nothing is returned: no
 * share is ever made up from a handful of people.
 */
export async function weekEmotions(
  prisma: PrismaService,
  topicId: string,
  weekNumber: number,
  floor: number,
): Promise<EmotionRow[]> {
  const now = await moodCounts(prisma, topicId);
  const total = [...now.values()].reduce((a, b) => a + b, 0);
  if (total === 0 || total < floor) return [];
  const prevTopic = await prisma.topic.findFirst({
    where: { weekNumber: { lt: weekNumber } },
    orderBy: { weekNumber: "desc" },
    select: { id: true },
  });
  const before = prevTopic
    ? await moodCounts(prisma, prevTopic.id)
    : new Map<string, number>();
  const prevTotal = [...before.values()].reduce((a, b) => a + b, 0);
  const pct = (n: number, t: number) => Math.round((n / t) * 100);
  return [...now.entries()]
    .map(([mood, n]) => ({
      name: MOOD_NAMES[mood] ?? mood,
      share: pct(n, total),
      change:
        prevTotal >= floor
          ? pct(n, total) - pct(before.get(mood) ?? 0, prevTotal)
          : 0,
      n,
    }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map(({ name, share, change }) => ({ name, share, change }));
}

export type RegionRow = {
  state: string;
  votes: number;
  leading: string;
  percent: number;
};

/**
 * The poll by state, from the state each voter keeps on their profile (optional, so a person with none is simply not in
 * it). A state with fewer votes than the anonymity floor is left out, and so is a week where no state reaches it.
 */
export async function pollByState(
  prisma: PrismaService,
  pollId: string,
  floor: number,
): Promise<RegionRow[]> {
  const rows = await prisma.$queryRaw<
    { state: string; label: string; n: bigint }[]
  >`
    SELECT u.state AS state, o.label AS label, count(*) AS n
    FROM "VoteChoice" vc
    JOIN "PollOption" o ON o.id = vc."optionId"
    JOIN "Vote" v ON v.id = vc."voteId"
    JOIN "User" u ON u.id = v."userId"
    WHERE o."pollId" = ${pollId}
      AND u.state IS NOT NULL AND btrim(u.state) <> ''
      AND u.status NOT IN ('BANNED', 'DELETED', 'DELETION_PENDING')
    GROUP BY u.state, o.label`;
  const by = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = r.state.trim();
    const m = by.get(k) ?? new Map<string, number>();
    m.set(r.label, (m.get(r.label) ?? 0) + Number(r.n));
    by.set(k, m);
  }
  return [...by.entries()]
    .map(([state, m]) => {
      const votes = [...m.values()].reduce((a, b) => a + b, 0);
      const [label, n] = [...m.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0];
      return {
        state,
        votes,
        leading: label,
        percent: Math.round((n / votes) * 100),
      };
    })
    .filter((r) => r.votes >= floor)
    .sort((a, b) => b.votes - a.votes || a.state.localeCompare(b.state))
    .slice(0, 12);
}

/**
 * The weekly report draft (V-19). When a week's weekly poll has closed (by its window) plus the configured minutes, ONE
 * DRAFT WeeklyReport is made for that week. WeeklyReport.topicId is unique, so a restart or two servers never make two.
 * Counts, poll numbers, reaction shares and languages come from the database. The headline, mood, summary and themes are
 * drafted by Gemini only when a key is set, and stay empty otherwise: no text is ever made up. Quotes stay empty: no
 * speaker consent is recorded anywhere yet, and a quote without it cannot exist (WeeklyQuote.consentAt).
 */
@Injectable()
export class WeeklyDraftService {
  private readonly logger = new Logger(WeeklyDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(WEEKLY_DRAFTER)
    private readonly drafter: WeeklyDrafter | null,
    @Optional() private readonly mails?: MailEvents,
  ) {}

  private async num(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.configEntry.findUnique({ where: { key } });
    return typeof row?.valueJson === "number" ? row.valueJson : fallback;
  }

  /** Drafts every week whose poll has closed and has no report yet. Returns how many drafts THIS call made. */
  async draftDue(now = new Date()): Promise<number> {
    const afterMin = await this.num(
      "weekly.draft_after_poll_close_minutes",
      10,
    );
    const polls = await this.prisma.poll.findMany({
      where: {
        kind: "WEEKLY",
        topicId: { not: null },
        endsAt: {
          lte: new Date(now.getTime() - afterMin * 60_000),
          gte: new Date(now.getTime() - POLL_WINDOW_DAYS * 86_400_000),
        },
        topic: { report: null },
      },
      select: { id: true, topicId: true },
      orderBy: [{ endsAt: "asc" }, { id: "asc" }],
    });
    const seen = new Set<string>();
    let made = 0;
    for (const p of polls) {
      if (!p.topicId || seen.has(p.topicId)) continue;
      seen.add(p.topicId);
      try {
        if (await this.draftTopic(p.id)) made++;
      } catch (e) {
        this.logger.error(`weekly draft failed for poll ${p.id}: ${String(e)}`);
      }
    }
    return made;
  }

  /** One week. True when this call made the draft; false when another already had. */
  async draftTopic(pollId: string): Promise<boolean> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      include: { topic: true, options: { orderBy: { sortOrder: "asc" } } },
    });
    if (!poll?.topic) return false;
    const topic = poll.topic;
    if (
      await this.prisma.weeklyReport.findUnique({
        where: { topicId: topic.id },
        select: { id: true },
      })
    )
      return false;

    const answerWhere: Prisma.AnswerWhereInput = {
      question: { topicId: topic.id },
      status: "PUBLISHED",
      deletedAt: null,
    };
    const [voices, votes, byOption, reactions, langs, weekday, hour] =
      await Promise.all([
        this.prisma.answer.count({ where: answerWhere }),
        this.prisma.vote.count({ where: { pollId } }),
        this.prisma.voteChoice.groupBy({
          by: ["optionId"],
          where: { option: { pollId } },
          _count: { _all: true },
        }),
        this.prisma.reaction.groupBy({
          by: ["kind"],
          where: { answer: answerWhere },
          _count: { _all: true },
        }),
        this.prisma.transcript.findMany({
          where: {
            language: { not: null },
            text: { not: null },
            // lead ruling WF-7: spoken replies count too, not only voice answers.
            clip: {
              OR: [{ answer: answerWhere }, { reply: { answer: answerWhere } }],
            },
          },
          distinct: ["language"],
          select: { language: true },
        }),
        this.num("weekly.default_publish_weekday", 1),
        this.num("weekly.default_publish_hour", 18),
      ]);

    const counts = new Map(byOption.map((g) => [g.optionId, g._count._all]));
    const options = poll.options.map((o) => ({
      label: o.label,
      votes: counts.get(o.id) ?? 0,
      percent:
        votes > 0 ? Math.round(((counts.get(o.id) ?? 0) / votes) * 100) : 0,
    }));
    const lead = [...options].sort((a, b) => b.votes - a.votes)[0];
    const pollSummary = {
      title: poll.title,
      totalVotes: votes,
      line: lead && lead.votes > 0 ? `${lead.percent}% ${lead.label}` : null,
      options,
    };
    const reactionTotal = reactions.reduce((s, r) => s + r._count._all, 0);
    const sentiment = {
      reactionTotal,
      reactions: reactions
        .map((r) => ({
          kind: r.kind,
          count: r._count._all,
          share:
            reactionTotal > 0
              ? Math.round((r._count._all / reactionTotal) * 100)
              : 0,
        }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    };
    const floor = await this.num("weekly.min_group_size", 20);
    const emotions = await weekEmotions(
      this.prisma,
      topic.id,
      topic.weekNumber,
      floor,
    );
    const regions = await pollByState(this.prisma, pollId, floor);
    const languagesRead = langs
      .map(
        (l) => LANGUAGE_NAMES[l.language as string] ?? (l.language as string),
      )
      .sort();

    // The insert is the only claim: the unique topicId lets exactly one caller through.
    const created = await this.prisma.$transaction(async (tx) => {
      const r = await tx.weeklyReport.createMany({
        data: [
          {
            topicId: topic.id,
            status: "DRAFT",
            basedOnVoices: voices,
            basedOnVotes: votes,
            pollSummary: pollSummary,
            sentiment: sentiment,
            emotions: emotions,
            regionBreakdown: regions.length ? regions : Prisma.DbNull,
            languagesRead,
            publishAt: defaultPublishAt(poll.endsAt, weekday, hour),
            aiAssisted: true,
            humanReviewed: false,
          },
        ],
        skipDuplicates: true,
      });
      return r.count === 1;
    });
    if (!created) return false;

    if (this.drafter) {
      const filled = await this.fillText(
        topic.id,
        topic,
        poll.title,
        answerWhere,
      );
      // V-44 (M-b, G01): the team hears once the AI text is really there (not for an empty shell).
      if (filled)
        void this.mails?.draftReady(topic.id, topic.title, voices, votes);
    }
    return true;
  }

  /** The Gemini step. Any failure leaves the text empty for the team; nothing is invented. */
  private async fillText(
    topicId: string,
    topic: { weekNumber: number; title: string },
    pollTitle: string,
    answerWhere: Prisma.AnswerWhereInput,
  ): Promise<boolean> {
    try {
      const rows = await this.prisma.answer.findMany({
        where: answerWhere,
        select: {
          id: true,
          body: true,
          clip: { select: { transcript: { select: { text: true } } } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_VOICES * 2,
      });
      const voices = rows
        .map((r) => scrub(r.body ?? r.clip?.transcript?.text ?? ""))
        .filter((t) => t.length > 0)
        .slice(0, MAX_VOICES)
        .map((t, i) => ({ n: i + 1, text: t.slice(0, MAX_CHARS) }));
      if (voices.length === 0) return false;
      const out = await (this.drafter as WeeklyDrafter).draft({
        weekNumber: topic.weekNumber,
        topicTitle: topic.title,
        pollTitle,
        voices,
      });
      const minGroup = await this.num("weekly.min_group_size", 20);
      const str = (v: unknown, max: number): string | null =>
        typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
      // A theme's count is the number of distinct voices it cites; a group under the anonymity floor is left out.
      const themes = (Array.isArray(out.themes) ? out.themes : [])
        .map((t) => {
          const cited = new Set(
            (Array.isArray(t.voices) ? t.voices : []).filter(
              (n) => Number.isInteger(n) && n >= 1 && n <= voices.length,
            ),
          );
          return {
            label: str(t.label, 120),
            count: cited.size,
            complaints: (Array.isArray(t.complaints) ? t.complaints : [])
              .map((c) => str(c, 300))
              .filter((c): c is string => c !== null)
              .slice(0, 3),
          };
        })
        .filter(
          (t): t is { label: string; count: number; complaints: string[] } =>
            t.label !== null && t.count >= minGroup,
        )
        .slice(0, 6);
      const wrote = await this.prisma.weeklyReport.updateMany({
        // Only an untouched draft: the team's own edits are never overwritten.
        where: {
          topicId,
          status: "DRAFT",
          headline: null,
          mood: null,
          summary: null,
          themes: { equals: Prisma.DbNull },
        },
        data: {
          headline: str(out.headline, 160),
          mood: str(out.mood, 120),
          summary: str(out.summary, 2000),
          themes: themes,
        },
      });
      return wrote.count === 1;
    } catch (e) {
      this.logger.error(
        `weekly draft text failed for ${topicId}: ${String(e)}`,
      );
      return false;
    }
  }
}
