import type { PrismaService } from "../common/prisma/prisma.service";
import { isQuestionOpen, isQuestionOver } from "../feed/question-window";
import type { Prisma, ShareObjectType } from "../generated/prisma/client";
import { reportCard } from "./weekly.service";

type Json = Record<string, unknown>;

/** Everything a share page and a card need about one shared thing, read fresh from the database. */
export interface Subject {
  topicLine: string;
  countryAndTheme: string;
  arguments: { text: string; voices: number }[];
  leanLine: string | null;
  poll: Json | null;
  proposalCount: number | null;
  topProposal: Json | null;
  news: Json | null;
  basedOnVoices: number;
  summaryUpdatedAt: Date;
  summaryLabel: string;
  featuredVoice: Json | null;
  transcript: string | null;
  question: Json | null;
  report: Json | null;
  /** A flagged post: the page and card show the topic and the call to action only. */
  fallback: boolean;
  /** "A voice from Lagos", for the voice card. */
  place: string | null;
  /** The text a voice card quotes (the transcript, or the written answer). */
  quote: string | null;
  /** Card only: top-right label (after "Nigeria · "), headline override, bars, bold footer line, poll state. */
  cardLabel: string;
  cardHeadline: string | null;
  cardRows: { label: string; pct: number }[];
  cardSummary: string | null;
  pollOpen: boolean;
  cardVoices: number | null;
  newsTagKey: "verified" | "unverified" | "gossip" | null;
}

const EDITOR_LABEL = "AI summary, checked by an editor";
const OPEN_LABEL = "Based on the voices so far";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function theme(topic: { weekNumber: number; title: string } | null): string {
  return topic
    ? `Nigeria · Week ${topic.weekNumber}: ${topic.title}`
    : "Nigeria";
}

function empty(topicLine: string, countryAndTheme: string, at: Date): Subject {
  return {
    topicLine,
    countryAndTheme,
    arguments: [],
    leanLine: null,
    poll: null,
    proposalCount: null,
    topProposal: null,
    news: null,
    basedOnVoices: 0,
    summaryUpdatedAt: at,
    summaryLabel: OPEN_LABEL,
    featuredVoice: null,
    transcript: null,
    question: null,
    report: null,
    fallback: false,
    place: null,
    quote: null,
    cardLabel: "VOICES",
    cardHeadline: null,
    cardRows: [],
    cardSummary: null,
    pollOpen: false,
    cardVoices: null,
    newsTagKey: null,
  };
}

function lagosToday(): string {
  return new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
}

const TAG_KEY = {
  VERIFIED_NEWS: "verified",
  UNVERIFIED_NEWS: "unverified",
  GOSSIP: "gossip",
} as const;

/** Load what is shared. Returns null when it does not exist or may not be shown (the route answers 404). */
export async function loadSubject(
  prisma: PrismaService,
  type: ShareObjectType,
  id: string,
): Promise<Subject | null> {
  switch (type) {
    case "QUESTION":
      return forQuestion(prisma, id);
    case "ANSWER":
      return forAnswer(prisma, id);
    case "POLL_RESULT":
      return forPoll(prisma, id);
    case "WEEKLY_REPORT":
      return forReport(prisma, id);
    case "PROFILE": {
      const u = await prisma.user.findUnique({ where: { id } });
      if (
        !u ||
        u.status === "BANNED" ||
        u.status === "DELETED" ||
        u.deletionRequestedAt
      )
        return null;
      const s = empty(`@${u.handle} on VOICES`, "Nigeria", u.updatedAt);
      s.summaryLabel = "";
      s.cardLabel = "Profile";
      return s;
    }
    case "CATEGORY": {
      const c = await prisma.category.findUnique({ where: { id } });
      if (!c || !c.active) return null;
      const s = empty(c.name, "Nigeria", new Date());
      s.cardLabel = "Category";
      return s;
    }
    case "RESULT_THREAD": {
      const t = await prisma.resultThread.findUnique({ where: { id } });
      if (!t || t.status === "SCHEDULED") return null;
      const s = empty(t.title, "Nigeria", new Date());
      s.cardLabel = "Results";
      return s;
    }
    case "WHAT_NEXT_SUMMARY":
      return forWhatNext(prisma, id);
  }
}

async function openReports(
  prisma: PrismaService,
  answerId: string,
): Promise<boolean> {
  return (
    (await prisma.report.count({
      where: { targetType: "ANSWER", targetId: answerId, status: "OPEN" },
    })) > 0
  );
}

async function summaryFor(prisma: PrismaService, topicId: string | null) {
  if (!topicId) return null;
  const s = await prisma.editorialSummary.findUnique({ where: { topicId } });
  return s && s.reviewedById ? s : null; // not reviewed means not shown
}

async function pollResults(
  prisma: PrismaService,
  where: Prisma.PollWhereInput,
): Promise<{ view: Json; total: number; lead: number } | null> {
  const poll = await prisma.poll.findFirst({
    where: { ...where, status: { in: ["OPEN", "CLOSED"] } },
    include: { options: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ status: "asc" }, { startsAt: "desc" }],
  });
  if (!poll) return null;
  const show = poll.status !== "OPEN" || poll.showLiveResults;
  const total = poll.options.reduce((n, o) => n + o.voteCount, 0);
  const top = [...poll.options].sort((a, b) => b.voteCount - a.voteCount)[0];
  const leadPct = total > 0 && top ? (top.voteCount / total) * 100 : 0;
  return {
    total,
    lead: leadPct,
    view: {
      pollId: poll.id,
      status: poll.status,
      totalVotes: show ? total : 0,
      options: poll.options.map((o) =>
        show
          ? {
              id: o.id,
              label: o.label,
              votes: o.voteCount,
              percent: total > 0 ? round1((o.voteCount / total) * 100) : 0,
            }
          : { id: o.id, label: o.label },
      ),
      leadingOptionId: show && total > 0 && top ? top.id : null,
      asOf: new Date().toISOString(),
      myVote: null,
      _title: poll.title,
    },
  };
}

function stripPrivate(poll: Json): Json {
  const { _title, ...rest } = poll;
  void _title;
  return rest;
}

function leanFromPoll(poll: Json, lead: number, total: number): string | null {
  if (total === 0) return null;
  if (lead < 50) return "People are split so far.";
  const options = poll.options as { id: string; label: string }[];
  const top = options.find((o) => o.id === poll.leadingOptionId);
  return top ? `So far, ${top.label} is ahead.` : "People are split so far.";
}

function questionView(
  q: Prisma.QuestionGetPayload<{
    include: { topic: true; category: true; polls: true };
  }>,
): Json {
  return {
    iSaved: false,
    recentVoices: [],
    id: q.id,
    kind: q.kind,
    status: q.status,
    text: q.text,
    hint: q.hint,
    category: q.category
      ? {
          id: q.category.id,
          slug: q.category.slug,
          name: q.category.name,
          blurb: q.category.blurb,
          voicesThisWeek: 0,
          questionCount: 0,
        }
      : null,
    topicId: q.topicId,
    topicTitle: q.topic?.title ?? null,
    weekNumber: q.topic?.weekNumber ?? null,
    scheduledFor: q.scheduledFor
      ? q.scheduledFor.toISOString().slice(0, 10)
      : null,
    startsAt: q.startsAt?.toISOString() ?? null,
    endsAt: q.endsAt?.toISOString() ?? null,
    pinned: q.pinned,
    sensitive: q.sensitive,
    voiceCount: q.voiceCount,
    answerCount: q.answerCount,
    hasOpenPoll: q.polls.some((p) => p.status === "OPEN"),
    proposalCount: 0,
    override: null,
  };
}

type AnswerFull = Prisma.AnswerGetPayload<{
  include: {
    author: true;
    clip: { include: { transcript: true } };
    tagChanges: true;
  };
}>;

function newsLabel(a: AnswerFull): Json | null {
  if (!a.isNews || !a.newsTag) return null;
  const last = [...a.tagChanges].sort(
    (x, y) => y.createdAt.getTime() - x.createdAt.getTime(),
  )[0];
  return {
    tag: a.newsTag,
    sourceName: a.newsSourceName,
    sourceUrl: a.newsSourceUrl,
    chosenBy: last && last.byUserId !== a.authorId ? "WAWU editor" : "Poster",
    chosenAt: (last?.createdAt ?? a.createdAt).toISOString(),
  };
}

function answerView(a: AnswerFull): Json {
  const t = a.clip?.transcript;
  return {
    categoryName: null,
    id: a.id,
    questionId: a.questionId,
    author: a.anonymous
      ? null
      : {
          id: a.author.id,
          handle: a.author.handle,
          displayName: a.author.displayName,
          state: a.author.state,
          avatarUrl: null,
        },
    kind: a.kind,
    body: a.body,
    clip: a.clip
      ? {
          id: a.clip.id,
          status: a.clip.status,
          durationMs: a.clip.durationMs,
          maxDurationMs: a.clip.maxDurationMs,
          peaks: Array.isArray(a.clip.peaks) ? a.clip.peaks : null,
          transcript: t
            ? { status: t.status, language: t.language, text: t.text }
            : null,
        }
      : null,
    createdAt: a.createdAt.toISOString(),
    editedAt: a.editedAt?.toISOString() ?? null,
    status: a.status,
    news: newsLabel(a),
    likeCount: a.likeCount,
    replyCount: a.replyCount,
    agreeCount: a.agreeCount,
    disagreeCount: a.disagreeCount,
    reactionCount: a.reactionCount,
    reactionBreakdown: [],
    myReaction: null,
    iLiked: false,
    iSaved: false,
    isMine: false,
    labels: [],
    questionText: null,
    explainsVote: a.explainsVoteId !== null,
  };
}

const ANSWER_INCLUDE = {
  author: true,
  clip: { include: { transcript: true } },
  tagChanges: true,
} as const;

function proposalView(
  p: Prisma.ProposalGetPayload<{ include: { author: true } }>,
): Json {
  return {
    id: p.id,
    questionId: p.questionId,
    author: {
      id: p.author.id,
      handle: p.author.handle,
      displayName: p.author.displayName,
      state: p.author.state,
      avatarUrl: null,
    },
    kind: p.kind,
    body: p.body,
    clip: null,
    label: "PROPOSED",
    supportCount: p.supportCount,
    challengeCount: p.challengeCount,
    improveCount: p.improveCount,
    groupId: p.groupId,
    improvesId: p.improvesId,
    myStance: null,
    createdAt: p.createdAt.toISOString(),
    isMine: false,
  };
}

async function proposalsFor(
  prisma: PrismaService,
  where: Prisma.ProposalWhereInput,
): Promise<{ count: number | null; top: Json | null }> {
  const w = { ...where, status: "PUBLISHED" as const };
  const count = await prisma.proposal.count({ where: w });
  if (count === 0) return { count: null, top: null };
  const top = await prisma.proposal.findFirst({
    where: w,
    include: { author: true },
    orderBy: [{ supportCount: "desc" }, { id: "asc" }],
  });
  return { count, top: top ? proposalView(top) : null };
}

async function forQuestion(
  prisma: PrismaService,
  id: string,
): Promise<Subject | null> {
  const q = await prisma.question.findUnique({
    where: { id },
    include: { topic: true, category: true, polls: true },
  });
  const now = new Date();
  if (!q || !(isQuestionOpen(q, now) || isQuestionOver(q, now))) return null;
  const sum = await summaryFor(prisma, q.topicId);
  const s = empty(q.text, theme(q.topic), sum?.updatedAt ?? q.updatedAt);
  s.question = questionView(q);
  s.cardLabel =
    q.scheduledFor && q.scheduledFor.toISOString().slice(0, 10) === lagosToday()
      ? "Today’s question"
      : q.topic
        ? `Week ${q.topic.weekNumber}`
        : "Question";
  if (sum) {
    s.arguments = [
      { text: sum.mainView, voices: sum.mainViewVoices },
      { text: sum.opposingView, voices: sum.opposingViewVoices },
    ];
    s.leanLine = `Most voices so far lean towards: ${sum.mainView}`;
    s.cardSummary = `${s.leanLine}.`;
    s.summaryLabel = EDITOR_LABEL;
  }
  s.basedOnVoices = sum?.basedOnVoices ?? q.answerCount;
  s.cardVoices = s.basedOnVoices;
  const pr = await pollResults(prisma, {
    OR: [{ questionId: q.id }, ...(q.topicId ? [{ topicId: q.topicId }] : [])],
  });
  if (pr) s.poll = stripPrivate(pr.view);
  const props = await proposalsFor(prisma, { questionId: q.id });
  s.proposalCount = props.count;
  s.topProposal = props.top;
  if (s.question) s.question.proposalCount = props.count ?? 0;

  const candidates = await prisma.answer.findMany({
    where: { questionId: q.id, status: "PUBLISHED", deletedAt: null },
    include: ANSWER_INCLUDE,
    orderBy: [{ rankScore: "desc" }, { id: "asc" }],
    take: 5,
  });
  for (const a of candidates) {
    if (await openReports(prisma, a.id)) continue;
    s.featuredVoice = answerView(a);
    s.transcript = a.clip?.transcript?.text ?? null;
    break;
  }
  return s;
}

async function forAnswer(
  prisma: PrismaService,
  id: string,
): Promise<Subject | null> {
  const a = await prisma.answer.findUnique({
    where: { id },
    include: {
      ...ANSWER_INCLUDE,
      question: { include: { topic: true, category: true, polls: true } },
    },
  });
  if (
    !a ||
    a.deletedAt ||
    a.status === "REMOVED" ||
    a.status === "DELETED_BY_AUTHOR"
  )
    return null;
  const s = empty(a.question.text, theme(a.question.topic), a.updatedAt);
  s.question = questionView(a.question);
  s.basedOnVoices = a.question.answerCount;
  s.cardVoices = a.question.answerCount;
  s.cardLabel = a.question.category?.name ?? "A voice";
  s.fallback =
    a.status === "HELD" ||
    a.newsFlagCount > 0 ||
    (await openReports(prisma, a.id));
  if (s.fallback) return s;
  s.featuredVoice = answerView(a);
  s.news = newsLabel(a);
  s.transcript = a.clip?.transcript?.text ?? null;
  s.quote = (s.transcript ?? a.body ?? "").trim() || null;
  s.place = a.anonymous ? null : (a.author.state ?? a.author.city ?? null);
  s.summaryLabel = "A voice, shared with a link";
  s.cardSummary = a.anonymous
    ? "An anonymous voice"
    : `A voice from @${a.author.handle}`;
  s.newsTagKey = a.isNews && a.newsTag ? TAG_KEY[a.newsTag] : null;
  return s;
}

async function forPoll(
  prisma: PrismaService,
  id: string,
): Promise<Subject | null> {
  const pr = await pollResults(prisma, { id });
  if (!pr) return null;
  const poll = await prisma.poll.findUniqueOrThrow({
    where: { id },
    include: { topic: true },
  });
  const s = empty(poll.title, theme(poll.topic), poll.updatedAt);
  s.poll = stripPrivate(pr.view);
  // A live poll that hides its numbers shares none: no count, no lean.
  const shown = Number(pr.view.totalVotes);
  s.basedOnVoices = shown;
  s.leanLine = leanFromPoll(pr.view, pr.lead, shown);
  s.summaryLabel = "Poll so far, not a final result";
  s.cardLabel = poll.topic ? `Week ${poll.topic.weekNumber} poll` : "Poll";
  s.cardSummary = s.leanLine;
  s.pollOpen = poll.status === "OPEN";
  s.cardVoices = shown;
  const opts = (pr.view.options as { label: string; votes?: number }[]) ?? [];
  s.arguments = opts.map((o) => ({ text: o.label, voices: o.votes ?? 0 }));
  const popts =
    (pr.view.options as { label: string; percent?: number }[]) ?? [];
  s.cardRows = popts.map((o) => ({ label: o.label, pct: o.percent ?? 0 }));
  return s;
}

async function forReport(
  prisma: PrismaService,
  id: string,
): Promise<Subject | null> {
  const r = await prisma.weeklyReport.findFirst({
    where: { id, status: "PUBLISHED" },
    include: { topic: true, quotes: true },
  });
  if (!r) return null;
  const card = reportCard(r);
  const s = empty(card.title, theme(r.topic), r.updatedAt);
  s.report = { ...card };
  s.leanLine = r.mood;
  s.basedOnVoices = card.basedOnVoices;
  s.summaryLabel = "AI-assisted and human-reviewed";
  s.cardLabel = `Week ${r.topic.weekNumber} report · AI-assisted · Human-reviewed`;
  s.cardHeadline = `How Nigerians felt in Week ${r.topic.weekNumber}`;
  s.cardSummary = r.mood;
  s.cardVoices = card.basedOnVoices;
  const emotions = Array.isArray(r.emotions) ? (r.emotions as Json[]) : [];
  s.cardRows = emotions
    .map((e) => ({
      label: typeof e.name === "string" ? e.name : "",
      pct: Math.round(Number(e.share ?? 0)) || 0,
    }))
    .filter((e) => e.label)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);
  const themes = Array.isArray(r.themes) ? (r.themes as Json[]) : [];
  s.arguments = themes
    .slice(0, 3)
    .map((t) => ({
      text: typeof t.label === "string" ? t.label : "",
      voices: Number(t.count ?? 0) || 0,
    }))
    .filter((t) => t.text);
  return s;
}

async function forWhatNext(
  prisma: PrismaService,
  id: string,
): Promise<Subject | null> {
  const topic = await prisma.topic.findUnique({ where: { id } });
  if (!topic || (topic.status !== "LIVE" && topic.status !== "CLOSED"))
    return null;
  const props = await proposalsFor(prisma, { question: { topicId: id } });
  if (props.count === null) return null;
  const s = empty(
    topic.whatNextPrompt ?? `What next? ${topic.title}`,
    theme(topic),
    topic.updatedAt,
  );
  s.proposalCount = props.count;
  s.topProposal = props.top;
  s.basedOnVoices = props.count;
  s.summaryLabel = "Proposals so far. Nothing here is accepted.";
  s.cardLabel = "What next?";
  return s;
}
