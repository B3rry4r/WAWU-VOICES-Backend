import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";
import { PrismaService } from "../common/prisma/prisma.service";
import { Prisma } from "../generated/prisma/client";
import { scrub } from "../reach/weekly-draft";
import { notFound, type Json } from "./support";

export const SUMMARY_DRAFTER = Symbol("SUMMARY_DRAFTER");

/** What the AI reads: the week's voices, numbered, with handles and phone numbers already removed, and the poll. */
export interface SummaryDraftInput {
  weekNumber: number;
  topicTitle: string;
  pollTitle: string | null;
  pollOptions: { label: string; votes: number }[];
  voices: { n: number; text: string }[];
}

/** What it gives back: two positions, each with the numbers of the voices behind it (counted here, never trusted). */
export interface SummaryDraftOutput {
  mainView: string;
  mainVoices: number[];
  opposingView: string;
  opposingVoices: number[];
}

export interface SummaryDrafter {
  draft(input: SummaryDraftInput): Promise<SummaryDraftOutput>;
}

/** The shared wording guard: the summary never says that everyone agrees. */
export const NO_BAD_WORDS =
  /\b(everyone agrees|everybody agrees|all agree|unanimous(ly)?|we all agree|everyone is)\b/i;

/** Gemini behind the drafter port. Built only when GEMINI_API_KEY is set. */
export function makeGeminiSummaryDrafter(env = process.env): SummaryDrafter {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
  const model = env.GEMINI_MODEL ?? "gemini-2.5-flash";
  return {
    async draft(input) {
      const prompt =
        `You draft the What Next? summary of VOICES, a Nigerian public-opinion app. Week ${input.weekNumber}, topic "${input.topicTitle}". ` +
        (input.pollTitle
          ? `The week's poll asked "${input.pollTitle}": ${input.pollOptions.map((o) => `${o.label} (${o.votes} votes)`).join("; ")}. `
          : "") +
        `Below are numbered voices (English, Pidgin, Yoruba, Igbo, Hausa). Name the leading view and the main opposing view, each as one short clause in plain English that finishes the sentence "Most voices so far lean towards: ...". ` +
        `Be balanced. Never say everyone agrees. Never name, quote or describe any person, never give a handle or a phone number, never repeat a threat or abuse. ` +
        `Reply as JSON: {"mainView": string, "mainVoices": number[] (numbers of the voices behind it), "opposingView": string, "opposingVoices": number[]}.\n\n` +
        input.voices.map((v) => `${v.n}. ${v.text}`).join("\n");
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      });
      return JSON.parse(res.text ?? "{}") as SummaryDraftOutput;
    },
  };
}

const MAX_VOICES = 200;
const MAX_CHARS = 300;

const clause = (label: string): string =>
  /^[A-Z][a-z]/.test(label)
    ? label.charAt(0).toLowerCase() + label.slice(1)
    : label;

/**
 * The What Next? summary draft (V-FIX-C). The data draft needs no AI: the weekly poll's two leading choices are the two
 * positions, the poll line and the next-steps line are counted from the poll and the proposals, and the editor is shown the
 * mood counts, the busiest categories and the most-reacted voices as material to write from. The AI draft (only with
 * GEMINI_API_KEY) writes the two positions from the voices. Nothing is saved here: the editor saves, and approves, on PUT.
 */
@Injectable()
export class SummaryDraftService {
  private readonly logger = new Logger(SummaryDraftService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(SUMMARY_DRAFTER)
    private readonly drafter: SummaryDrafter | null,
  ) {}

  aiAvailable(): boolean {
    return !!this.drafter;
  }

  /** The saved summary (reviewed or not) with whether the AI draft is on. */
  async saved(topicId: string): Promise<Json> {
    const t = await this.prisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });
    if (!t) throw notFound("that week");
    const row = await this.prisma.editorialSummary.findUnique({
      where: { topicId },
    });
    return {
      aiAvailable: this.aiAvailable(),
      summary: row
        ? {
            topicId: row.topicId,
            mainView: row.mainView,
            mainViewVoices: row.mainViewVoices,
            opposingView: row.opposingView,
            opposingViewVoices: row.opposingViewVoices,
            pollLine: row.pollLine,
            nextStepsLine: row.nextStepsLine,
            basedOnVoices: row.basedOnVoices,
            basedOnVotes: row.basedOnVotes,
            updatedAt: row.updatedAt.toISOString(),
            reviewedByEditor: !!row.reviewedById,
            aiDrafted: row.aiDrafted,
          }
        : null,
    };
  }

  async draft(topicId: string, wantAi: boolean): Promise<Json> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
    });
    if (!topic) throw notFound("that week");
    const answerWhere: Prisma.AnswerWhereInput = {
      question: { topicId },
      status: "PUBLISHED",
      deletedAt: null,
    };
    const qids = await this.prisma.question.findMany({
      where: { topicId },
      select: { id: true },
    });
    const [voiceSum, poll, moodRows, cats, reacted, proposals, groups] =
      await Promise.all([
        this.prisma.question.aggregate({
          where: { topicId },
          _sum: { answerCount: true },
        }),
        this.prisma.poll.findFirst({
          where: { topicId, kind: "WEEKLY" },
          include: { options: { orderBy: { sortOrder: "asc" } } },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.answer.groupBy({
          by: ["mood"],
          where: { ...answerWhere, mood: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.question.findMany({
          where: { topicId, categoryId: { not: null } },
          select: { answerCount: true, category: { select: { name: true } } },
        }),
        this.prisma.answer.findMany({
          where: { ...answerWhere, newsFlagCount: 0 },
          select: {
            id: true,
            kind: true,
            body: true,
            reactionCount: true,
            clip: { select: { transcript: { select: { text: true } } } },
          },
          orderBy: [
            { reactionCount: "desc" },
            { likeCount: "desc" },
            { id: "asc" },
          ],
          take: 12,
        }),
        this.prisma.proposal.findMany({
          where: { question: { topicId }, status: "PUBLISHED" },
          select: { body: true, supportCount: true },
          orderBy: [{ supportCount: "desc" }, { id: "asc" }],
          take: 1,
        }),
        this.prisma.proposalGroup.count({
          where: { questionId: { in: qids.map((q) => q.id) } },
        }),
      ]);
    const proposalCount = await this.prisma.proposal.count({
      where: { question: { topicId }, status: "PUBLISHED" },
    });

    const basedOnVoices = voiceSum._sum.answerCount ?? 0;
    const basedOnVotes = poll?.totalVotes ?? 0;

    const moodTotal = moodRows.reduce((s, r) => s + r._count._all, 0);
    const moods = moodRows
      .filter((r) => r.mood !== null)
      .map((r) => ({
        mood: r.mood as string,
        count: r._count._all,
        percent: moodTotal ? Math.round((r._count._all / moodTotal) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.mood.localeCompare(b.mood));

    const byCat = new Map<string, number>();
    for (const q of cats)
      if (q.category && q.answerCount > 0)
        byCat.set(
          q.category.name,
          (byCat.get(q.category.name) ?? 0) + q.answerCount,
        );
    const categories = [...byCat.entries()]
      .map(([name, voices]) => ({ name, voices }))
      .sort((a, b) => b.voices - a.voices || a.name.localeCompare(b.name))
      .slice(0, 3);

    const quotes = reacted
      .map((a) => ({
        answerId: a.id,
        kind: a.kind,
        reactions: a.reactionCount,
        excerpt: scrub(a.body ?? a.clip?.transcript?.text ?? "").slice(0, 220),
      }))
      .filter((q) => q.excerpt.length >= 3 && q.reactions > 0)
      .slice(0, 5);

    // The data draft.
    const options = [...(poll?.options ?? [])].sort(
      (a, b) => b.voteCount - a.voteCount || a.sortOrder - b.sortOrder,
    );
    const lead = options[0];
    const second = options[1];
    const hasVotes =
      !!poll && poll.totalVotes > 0 && !!lead && lead.voteCount > 0;
    const open = !!poll && poll.status !== "CLOSED" && poll.endsAt > new Date();
    const pollLine = !poll
      ? "There is no poll for this week."
      : !hasVotes
        ? "The poll has no votes yet."
        : `“${lead.label}” leads with ${Math.round((lead.voteCount / poll.totalVotes) * 100)}% of ${poll.totalVotes.toLocaleString("en-NG")} ${poll.totalVotes === 1 ? "vote" : "votes"}. The poll is ${open ? "still open" : "closed"}.`;
    const top = proposals[0];
    const nextStepsLine =
      proposalCount === 0
        ? "No next steps have been proposed yet."
        : `${proposalCount.toLocaleString("en-NG")} ${proposalCount === 1 ? "proposal" : "proposals"} in ${groups} ${groups === 1 ? "group" : "groups"}.${top?.body ? ` Most supported so far: ${scrub(top.body).slice(0, 160)}` : ""}`;
    const data = {
      mainView: hasVotes ? clause(lead.label) : "",
      mainViewVoices: hasVotes ? lead.voteCount : 0,
      opposingView:
        hasVotes && second && second.voteCount > 0 ? clause(second.label) : "",
      opposingViewVoices: hasVotes && second ? second.voteCount : 0,
      pollLine,
      nextStepsLine,
    };

    let source: "DATA" | "AI" = "DATA";
    let aiNote: string | null = null;
    let fields = data;
    if (wantAi && !this.drafter) {
      aiNote =
        "AI drafting is off here (no key is set), so this is the draft from the data.";
    } else if (wantAi && this.drafter) {
      try {
        const rows = await this.prisma.answer.findMany({
          where: answerWhere,
          select: {
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
        if (voices.length === 0) {
          aiNote =
            "There are no written or transcribed voices to read yet, so this is the draft from the data.";
        } else {
          const out = await this.drafter.draft({
            weekNumber: topic.weekNumber,
            topicTitle: topic.title,
            pollTitle: poll?.title ?? null,
            pollOptions: options.map((o) => ({
              label: o.label,
              votes: o.voteCount,
            })),
            voices,
          });
          const str = (v: unknown): string =>
            typeof v === "string" ? scrub(v).slice(0, 600) : "";
          const count = (v: unknown): number => {
            const cited = new Set(
              (Array.isArray(v) ? v : []).filter(
                (n): n is number =>
                  Number.isInteger(n) && n >= 1 && n <= voices.length,
              ),
            );
            // Counted from the sample, then scaled to everyone who spoke.
            return Math.min(
              basedOnVoices,
              Math.round(
                (cited.size / voices.length) *
                  Math.max(basedOnVoices, voices.length),
              ),
            );
          };
          const main = str(out.mainView);
          const opp = str(out.opposingView);
          if (
            main.length < 3 ||
            NO_BAD_WORDS.test(main) ||
            NO_BAD_WORDS.test(opp)
          ) {
            aiNote =
              "The AI draft was not usable, so this is the draft from the data.";
          } else {
            fields = {
              ...data,
              mainView: main,
              mainViewVoices: count(out.mainVoices),
              opposingView: opp.length >= 3 ? opp : "",
              opposingViewVoices:
                opp.length >= 3 ? count(out.opposingVoices) : 0,
            };
            source = "AI";
            aiNote =
              voices.length < basedOnVoices
                ? `Read ${voices.length} of ${basedOnVoices.toLocaleString("en-NG")} voices; the counts are scaled up from them. Check them.`
                : null;
          }
        }
      } catch (e) {
        this.logger.error(
          `summary AI draft failed for ${topicId}: ${String(e)}`,
        );
        aiNote =
          "The AI draft did not work, so this is the draft from the data.";
      }
    }

    return {
      topicId,
      source,
      aiAvailable: this.aiAvailable(),
      aiNote,
      draft: fields,
      basedOnVoices,
      basedOnVotes,
      moods,
      categories,
      quotes,
    };
  }
}
