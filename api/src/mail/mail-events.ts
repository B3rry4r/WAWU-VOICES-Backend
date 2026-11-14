import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { quoteOf } from "../reach/reach-support";
import {
  MailService,
  lagosDate,
  lagosDateTime,
  type MailOutcome,
} from "./mail.service";
import type { VoicesRole } from "../generated/prisma/enums";

/** A short reference a person can quote: RP-1A2B3C4D. Taken from the end of the row id, which is random. */
export function refOf(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/-/g, "").slice(-8).toUpperCase()}`;
}

/** quoteOf wraps in curly quotes; a template that already quotes wants the words alone. */
function bare(q: string | null): string | null {
  return q ? q.replace(/^\u201c|\u201d$/g, "") : null;
}

const REPORT_REASON: Record<string, string> = {
  HATE_OR_HARASSMENT: "Hate or harassment",
  THREAT_OR_VIOLENCE: "Threat or violence",
  SCAM_OR_SPAM: "Scam or spam",
  PERSONAL_DETAILS: "Personal details",
  MISLEADING_NEWS_TAG: "Misleading news tag",
  ABOUT_ME: "This is about me",
  OTHER: "Something else",
};

const NEWS_LABEL: Record<string, string> = {
  VERIFIED_NEWS: "Verified News",
  UNVERIFIED_NEWS: "Unverified News",
  GOSSIP: "Gossip",
};

/** What a moderation decision (ModerationService.act) tells the mail layer, gathered inside its transaction. */
export interface DecisionMailPlan {
  targetType: "ANSWER" | "REPLY" | "PROPOSAL" | "RESULT_POST" | "USER";
  targetId: string;
  actionId: string;
  action:
    | "KEEP"
    | "REMOVE"
    | "WARN"
    | "REMOVE_AND_WARN"
    | "SUSPEND"
    | "BAN"
    | "RESTORE";
  reason: string;
  authorId: string | null;
  /** Appeals this decision settled (the person who appealed, and the appeal). */
  appeals: Array<{ id: string; userId: string }>;
  accepted: boolean;
  strikesRemoved: number;
  suspendedUntil: Date | null;
  accountAfter: string | null;
  /** Open reports this decision settled. */
  reports: Array<{ id: string; reporterId: string; reason: string }>;
  kept: boolean;
  /** The strikes the author has after this decision. */
  strikeCount: number;
}

/**
 * V-44 (M-b): the VOICES events that send mail, each turned into a template and its merge fields. Services call one
 * method here after their own transaction has committed; every method is safe to call and never throws.
 */
@Injectable()
export class MailEvents {
  private readonly logger = new Logger(MailEvents.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private web(): string {
    return this.mail.webBase();
  }

  private async guard(
    what: string,
    work: () => void | Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (e) {
      this.logger.warn(`mail event ${what}: ${String(e)}`);
    }
  }

  /** A short quote of what the target said, or a plain name when it has no text (a voice message). */
  private async excerpt(type: string, id: string): Promise<string> {
    let body: string | null | undefined;
    if (type === "ANSWER")
      body = (
        await this.prisma.answer.findUnique({
          where: { id },
          select: { body: true },
        })
      )?.body;
    else if (type === "REPLY")
      body = (
        await this.prisma.reply.findUnique({
          where: { id },
          select: { body: true },
        })
      )?.body;
    else if (type === "PROPOSAL")
      body = (
        await this.prisma.proposal.findUnique({
          where: { id },
          select: { body: true },
        })
      )?.body;
    return quoteOf(body) ?? "A voice message";
  }

  /** Where a person opens the post: the answer, or the question it hangs off. */
  private async postUrl(type: string, id: string): Promise<string> {
    const web = this.web();
    if (type === "ANSWER") {
      const a = await this.prisma.answer.findUnique({
        where: { id },
        select: { questionId: true },
      });
      if (a) return `${web}/q/${a.questionId}/a/${id}`;
    } else if (type === "REPLY") {
      const r = await this.prisma.reply.findUnique({
        where: { id },
        select: { answerId: true, answer: { select: { questionId: true } } },
      });
      if (r) return `${web}/q/${r.answer.questionId}/a/${r.answerId}`;
    } else if (type === "PROPOSAL") {
      const p = await this.prisma.proposal.findUnique({
        where: { id },
        select: { questionId: true },
      });
      if (p) return `${web}/q/${p.questionId}`;
    }
    return `${web}/notifications`;
  }

  // ------------------------------------------------------------------ moderation

  /** E01, E02, E04, E05 to the person acted on; E05, E07, E08 to the people who appealed; E10 to the reporters. */
  async decision(plan: DecisionMailPlan): Promise<void> {
    await this.guard("decision", async () => {
      const web = this.web();
      const notices = `${web}/notifications`;
      const rules = `${web}/settings/legal/rules`;
      const key = plan.actionId;
      const date = lagosDate(new Date());

      for (const ap of plan.appeals) {
        const ref = refOf("AP", ap.id);
        if (plan.accepted) {
          if (plan.targetType === "USER") {
            this.mail.notify({
              template: "E05",
              userId: ap.userId,
              eventKey: `decision:${key}`,
              vars: {},
            });
          } else {
            this.mail.notify({
              template: "E07",
              userId: ap.userId,
              eventKey: `decision:${key}`,
              vars: {
                appeal_ref: ref,
                post_url: await this.postUrl(plan.targetType, plan.targetId),
                strike_note:
                  plan.strikesRemoved > 0
                    ? " The strike linked to it has been removed."
                    : "",
              },
            });
          }
        } else {
          this.mail.notify({
            template: "E08",
            userId: ap.userId,
            eventKey: `decision:${key}`,
            vars: {
              appeal_ref: ref,
              decision_reason: plan.reason,
              rules_url: rules,
            },
          });
        }
      }

      const author = plan.authorId;
      if (
        author &&
        plan.action !== "KEEP" &&
        !plan.appeals.some((a) => a.userId === author)
      ) {
        const eventKey = `decision:${key}`;
        if (plan.action === "REMOVE" || plan.action === "REMOVE_AND_WARN") {
          this.mail.notify({
            template: "E01",
            userId: author,
            eventKey,
            vars: {
              post_excerpt: await this.excerpt(plan.targetType, plan.targetId),
              rule_name: plan.reason,
              date,
              appeal_url: notices,
              rules_url: rules,
            },
          });
        } else if (plan.action === "WARN") {
          this.mail.notify({
            template: "E02",
            userId: author,
            eventKey,
            vars: {
              rule_name: plan.reason,
              warning_count: plan.strikeCount,
              action_url: notices,
              appeal_url: notices,
            },
          });
        } else if (plan.action === "SUSPEND" || plan.action === "BAN") {
          this.accountHeld(
            author,
            eventKey,
            plan.action === "BAN",
            plan.suspendedUntil,
            plan.reason,
          );
        } else if (
          plan.action === "RESTORE" &&
          plan.targetType === "USER" &&
          plan.accountAfter === "ACTIVE"
        ) {
          this.mail.notify({
            template: "E05",
            userId: author,
            eventKey,
            vars: {},
          });
        }
      }

      for (const r of plan.reports) {
        if (r.reason === "MISLEADING_NEWS_TAG") continue; // a news flag is not a report: it got no thank-you mail
        this.mail.notify({
          template: "E10",
          userId: r.reporterId,
          eventKey: `report:${r.id}:decided`,
          vars: {
            report_ref: refOf("RP", r.id),
            outcome: plan.kept
              ? "We reviewed it and it did not break our rules."
              : "We took action on it.",
            rules_url: rules,
          },
        });
      }
    });
  }

  /** E04: a suspension or a ban, from a moderation decision or from the people screen. */
  accountHeld(
    userId: string,
    eventKey: string,
    ban: boolean,
    until: Date | null,
    reason: string,
  ): void {
    const web = this.web();
    this.mail.notify({
      template: "E04",
      userId,
      eventKey,
      vars: {
        status_word: ban ? "closed" : "suspended",
        status_verb: ban ? "closed" : "suspended",
        rule_name: reason,
        start_date: lagosDate(new Date()),
        end_date: ban || !until ? "No end date" : lagosDate(until),
        can_do: ban ? "Nothing, the account is closed" : "Listen and read",
        appeal_url: `${web}/notifications`,
        rules_url: `${web}/settings/legal/rules`,
      },
    });
  }

  /** E13 (V-46): an admin approved the person's ID and utility bill. */
  verificationApproved(userId: string, requestId: string, until: Date): void {
    void this.guard("verification approved", () => {
      this.mail.notify({
        template: "E13",
        userId,
        eventKey: `verification:${requestId}`,
        vars: {
          until_date: lagosDate(until),
          verify_url: `${this.web()}/verify`,
        },
      });
    });
  }

  /** E14 (V-46): an admin could not approve the documents; `reason` is the plain words the person also sees on /verify. */
  verificationRejected(
    userId: string,
    requestId: string,
    reason: string,
  ): void {
    void this.guard("verification rejected", () => {
      this.mail.notify({
        template: "E14",
        userId,
        eventKey: `verification:${requestId}`,
        vars: { reason, verify_url: `${this.web()}/verify` },
      });
    });
  }

  /** E05: the account is back (people screen). */
  accountRestored(userId: string, eventKey: string): void {
    this.mail.notify({ template: "E05", userId, eventKey, vars: {} });
  }

  /** E06: the person filed an appeal. */
  async appealFiled(userId: string, appealId: string): Promise<void> {
    await this.guard("appeal", () => {
      this.mail.notify({
        template: "E06",
        userId,
        eventKey: `appeal:${appealId}`,
        vars: {
          appeal_ref: refOf("AP", appealId),
          appeal_url: `${this.web()}/notifications`,
        },
      });
    });
  }

  /** E09: the person reported something (not a news flag, which has no moderation outcome to promise). */
  async reportFiled(
    reporterId: string,
    reportId: string,
    reason: string,
  ): Promise<void> {
    await this.guard("report", () => {
      if (reason === "MISLEADING_NEWS_TAG") return;
      this.mail.notify({
        template: "E09",
        userId: reporterId,
        eventKey: `report:${reportId}:filed`,
        vars: {
          report_ref: refOf("RP", reportId),
          report_reason: REPORT_REASON[reason] ?? "Something else",
        },
      });
    });
  }

  /** E11: an editor changed the tag on a post. */
  async tagChanged(
    authorId: string,
    answerId: string,
    from: string,
    to: string,
    changeKey: string,
  ): Promise<void> {
    await this.guard("tag", async () => {
      this.mail.notify({
        template: "E11",
        userId: authorId,
        eventKey: `tag:${changeKey}`,
        vars: {
          post_excerpt: await this.excerpt("ANSWER", answerId),
          old_tag: NEWS_LABEL[from] ?? from,
          new_tag: NEWS_LABEL[to] ?? to,
          post_url: await this.postUrl("ANSWER", answerId),
        },
      });
    });
  }

  // ------------------------------------------------------------------ talk and vote

  /** B03: someone replied to a voice. Batched: at most one per post every 30 minutes (the template's limit). */
  async replied(
    answerId: string,
    replyId: string,
    authorId: string,
    replierHandle: string,
    kind: string,
    body: string | null,
  ): Promise<void> {
    await this.guard("reply", async () => {
      const count = await this.prisma.reply.count({
        where: { answerId, status: "PUBLISHED", deletedAt: null },
      });
      this.mail.notify({
        template: "B03",
        userId: authorId,
        eventKey: `reply:${replyId}`,
        scopeKey: `answer:${answerId}`,
        vars: {
          replier_name: `@${replierHandle}`,
          reply_type: kind === "VOICE" ? "Voice reply" : "Text reply",
          reply_excerpt:
            quoteOf(body)?.replace(/^“|”$/g, "") ?? "A voice reply",
          reply_count: count,
          post_url: await this.postUrl("ANSWER", answerId),
        },
      });
    });
  }

  /** B11: someone improved the person's proposal. */
  async proposalImproved(
    authorId: string,
    improvedBody: string | null,
    improverHandle: string,
    improvementBody: string | null,
    questionId: string,
    newProposalId: string,
  ): Promise<void> {
    await this.guard("improved", () => {
      this.mail.notify({
        template: "B11",
        userId: authorId,
        eventKey: `improved:${newProposalId}`,
        vars: {
          idea_text: bare(quoteOf(improvedBody, 160)) ?? "A voice proposal",
          improver_name: `@${improverHandle}`,
          improvement_text:
            bare(quoteOf(improvementBody, 160)) ?? "A voice proposal",
          idea_url: `${this.web()}/q/${questionId}`,
        },
      });
    });
  }

  // ------------------------------------------------------------------ account deletion and its undo (A10, A11, A12)

  /** A10: the person asked to delete the account. WAWU ID writes and sends it (app "voices"); once per request. */
  deletionRequested(
    userId: string,
    wawuId: string,
    requestedAt: Date,
    deleteOn: Date,
  ): void {
    this.mail.notifyNotice({
      template: "A10",
      userId,
      wawuId,
      kind: "account_deletion_started",
      data: { deleteOn: deleteOn.toISOString() },
      eventKey: `deletion:${requestedAt.getTime()}`,
    });
  }

  /** A11: the purge has run. `wawuId` is the one the account had before the purge cut the link. */
  deleted(userId: string, wawuId: string): void {
    this.mail.notifyNotice({
      template: "A11",
      userId,
      wawuId,
      kind: "account_deleted",
      data: {},
      eventKey: "purged",
    });
  }

  /** A12: the person pressed Undo and the account is active again. Sent through the relay with VOICES' own template. */
  async welcomeBack(userId: string, requestedAt: Date): Promise<void> {
    await this.guard("welcome-back", async () => {
      const [replies, polls, today] = await Promise.all([
        this.prisma.reply.count({
          where: {
            createdAt: { gt: requestedAt },
            authorId: { not: userId },
            status: "PUBLISHED",
            deletedAt: null,
            answer: { authorId: userId },
          },
        }),
        this.prisma.poll.count({ where: { status: "OPEN" } }),
        this.prisma.question.findFirst({
          where: { kind: "DAILY", status: "LIVE" },
          orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
          select: { text: true },
        }),
      ]);
      this.mail.notify({
        template: "A12",
        userId,
        eventKey: `undo:${requestedAt.getTime()}`,
        vars: {
          new_replies: replies,
          open_polls: polls,
          question_text:
            today?.text ??
            "A new question is on its way. Open Voices to see it.",
          app_url: this.web(),
        },
      });
    });
  }

  // ------------------------------------------------------------------ B01, B09, B12

  /** B01: the person's voice is public. One an hour at most (the template's limit). */
  async voiceLive(
    userId: string,
    a: {
      id: string;
      questionId: string;
      kind: string;
      isNews: boolean;
      newsTag: string | null;
      mood: string | null;
      durationMs: number | null;
    },
  ): Promise<void> {
    await this.guard("voice-live", async () => {
      const q = await this.prisma.question.findUnique({
        where: { id: a.questionId },
        select: { text: true },
      });
      const secs = a.durationMs
        ? Math.max(1, Math.round(a.durationMs / 1000))
        : 0;
      this.mail.notify({
        template: "B01",
        userId,
        eventKey: `live:${a.id}`,
        vars: {
          question_text: q?.text ?? "A question on Voices",
          duration:
            a.kind === "VOICE"
              ? secs
                ? `${secs} ${secs === 1 ? "second" : "seconds"}`
                : "Voice answer"
              : "Written answer",
          tag_label: a.isNews
            ? (NEWS_LABEL[a.newsTag ?? ""] ?? "News")
            : a.mood
              ? a.mood.charAt(0) + a.mood.slice(1).toLowerCase()
              : "No news tag",
          post_url: `${this.web()}/q/${a.questionId}/a/${a.id}`,
        },
      });
    });
  }

  /** B09: a quote from the person's voice is in a weekly report that has just been published. Once per quote. */
  async featured(reportId: string): Promise<void> {
    await this.guard("featured", async () => {
      const report = await this.prisma.weeklyReport.findUnique({
        where: { id: reportId },
        select: {
          topic: { select: { title: true } },
          quotes: { select: { answerId: true, excerpt: true } },
        },
      });
      if (!report || report.quotes.length === 0) return;
      const authors = await this.prisma.answer.findMany({
        where: { id: { in: report.quotes.map((q) => q.answerId) } },
        select: { id: true, authorId: true },
      });
      const by = new Map(authors.map((x) => [x.id, x.authorId]));
      for (const q of report.quotes) {
        const authorId = by.get(q.answerId);
        if (!authorId) continue;
        this.mail.notify({
          template: "B09",
          userId: authorId,
          eventKey: `featured:${reportId}:${q.answerId}`,
          vars: {
            topic_title: report.topic.title,
            excerpt: q.excerpt,
            report_url: `${this.web()}/weekly/${reportId}`,
          },
        });
      }
    });
  }

  /** B12: moderators grouped proposals; each author (not the moderator) hears once per group. */
  async grouped(
    actorId: string,
    groupId: string,
    title: string,
    questionId: string,
    proposals: Array<{ authorId: string; supportCount: number }>,
  ): Promise<void> {
    await this.guard("grouped", async () => {
      const q = await this.prisma.question.findUnique({
        where: { id: questionId },
        select: { text: true, topic: { select: { title: true } } },
      });
      const support = proposals.reduce((n, p) => n + p.supportCount, 0);
      for (const authorId of new Set(proposals.map((p) => p.authorId))) {
        if (authorId === actorId) continue;
        this.mail.notify({
          template: "B12",
          userId: authorId,
          eventKey: `group:${groupId}`,
          vars: {
            topic_title: q?.topic?.title ?? q?.text ?? "this question",
            group_title: title,
            group_size: proposals.length,
            support_count: support,
            summary_url: `${this.web()}/q/${questionId}`,
          },
        });
      }
    });
  }

  // ------------------------------------------------------------------ brands (F01 to F04, V-SURVEYS)

  private async surveyFacts(surveyId: string) {
    const sv = await this.prisma.sponsoredSurvey.findUnique({
      where: { id: surveyId },
      include: { brand: { select: { slug: true } } },
    });
    if (!sv) return null;
    const cats = sv.categoryIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: sv.categoryIds } },
          select: { name: true },
        })
      : [];
    const places = [...cats.map((c) => c.name), ...sv.states];
    const day = (d: Date | null) => (d ? lagosDate(d) : "No date set");
    return {
      sv,
      title: sv.title,
      audience: places.length ? places.join(", ") : "Everyone on Voices",
      start: day(sv.startsOn),
      end: day(sv.endsOn),
      page: sv.brand ? `${this.web()}/brands/${sv.brand.slug}` : this.web(),
    };
  }

  /** F01: the survey was sent for approval. To the survey's contact address, once per submission. */
  async surveySubmitted(surveyId: string): Promise<void> {
    await this.guard("survey-submitted", async () => {
      const f = await this.surveyFacts(surveyId);
      if (!f) return;
      const days = await this.prisma.configEntry.findUnique({
        where: { key: "surveys.review_days" },
      });
      this.mail.notifyBrand({
        template: "F01",
        surveyId,
        eventKey: `survey:${surveyId}:submitted:${f.sv.submittedAt?.getTime() ?? 0}`,
        vars: {
          contact_name: f.sv.brandName,
          survey_title: f.title,
          audience: f.audience,
          start_date: f.start,
          end_date: f.end,
          campaign_ref: refOf("SV", surveyId),
          campaign_url: this.web(),
          review_days: typeof days?.valueJson === "number" ? days.valueJson : 2,
        },
      });
    });
  }

  /** F02: the survey was approved and is live (or will be, from its start date). Once per approval. */
  async surveyApproved(surveyId: string): Promise<void> {
    await this.guard("survey-approved", async () => {
      const f = await this.surveyFacts(surveyId);
      if (!f) return;
      this.mail.notifyBrand({
        template: "F02",
        surveyId,
        eventKey: `survey:${surveyId}:approved:${f.sv.approvedAt?.getTime() ?? 0}`,
        vars: {
          survey_title: f.title,
          audience: f.audience,
          start_date: f.start,
          end_date: f.end,
          target_responses: f.sv.responseTarget ?? "No target set",
          campaign_url: f.page,
        },
      });
    });
  }

  /** F03: the team asked for changes. The reason is what the team wrote. Once per request. */
  async surveyNeedsChanges(surveyId: string, reason: string): Promise<void> {
    await this.guard("survey-changes", async () => {
      const f = await this.surveyFacts(surveyId);
      if (!f) return;
      this.mail.notifyBrand({
        template: "F03",
        surveyId,
        eventKey: `survey:${surveyId}:changes:${f.sv.updatedAt.getTime()}`,
        vars: {
          survey_title: f.title,
          change_reason: reason,
          campaign_url: `mailto:support@wawuafrica.com?subject=${encodeURIComponent(`Survey ${refOf("SV", surveyId)}`)}`,
        },
      });
    });
  }

  /**
   * F04: the survey's results were released and can be read. Once per survey. Awaited, and it answers what came of the
   * send, so the caller records "mailed" only on success and a failed mail is tried again later.
   */
  async surveyResultsReady(
    surveyId: string,
    r: {
      responses: number | string;
      completionRate: string;
      topAnswer: string;
      topAnswerPct: string;
      daysLive: number;
    },
  ): Promise<MailOutcome | null> {
    let outcome: MailOutcome | null = null;
    await this.guard("survey-results", async () => {
      const f = await this.surveyFacts(surveyId);
      if (!f) return;
      outcome = await this.mail.sendBrand({
        template: "F04",
        surveyId,
        eventKey: `survey:${surveyId}:results`,
        vars: {
          survey_title: f.title,
          response_count: r.responses,
          completion_rate: r.completionRate,
          days_live: r.daysLive,
          top_answer: r.topAnswer,
          top_answer_pct: r.topAnswerPct,
          report_url: `mailto:support@wawuafrica.com?subject=${encodeURIComponent(`Results for ${refOf("SV", surveyId)}`)}`,
        },
      });
    });
    return outcome;
  }

  // ------------------------------------------------------------------ the team (G01, G04, G05, G06, G09)

  private async team(roles: VoicesRole[]): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        mailTo: { not: null },
        roles: { some: { role: { in: roles } } },
      },
      select: { id: true },
      take: 200,
    });
    return rows.map((r) => r.id);
  }

  private async nameOf(userId: string | null): Promise<string> {
    if (!userId) return "The system";
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, handle: true },
    });
    return u?.displayName?.trim() || (u ? `@${u.handle}` : "An admin");
  }

  /** G01: the AI draft of the weekly report is ready. Editors and admins, once per week's report. */
  async draftReady(
    topicId: string,
    topicTitle: string,
    voices: number,
    votes: number,
  ): Promise<void> {
    await this.guard("draft-ready", async () => {
      for (const id of await this.team(["EDITOR", "ADMIN"]))
        this.mail.notify({
          template: "G01",
          userId: id,
          eventKey: `draft:${topicId}`,
          vars: {
            topic_title: topicTitle,
            voice_count: voices,
            vote_count: votes,
            admin_url: `${this.web()}/admin/weekly`,
          },
        });
    });
  }

  /** G04: an override is set for later. All admins. */
  async overrideScheduled(o: {
    id: string;
    actorId: string;
    startsAt: Date;
    endsAt: Date;
    replacedText: string | null;
    newSlot: string;
    alert: boolean;
  }): Promise<void> {
    await this.guard("override-scheduled", async () => {
      const admin = await this.nameOf(o.actorId);
      const hours =
        Math.round(
          ((o.endsAt.getTime() - o.startsAt.getTime()) / 3_600_000) * 10,
        ) / 10;
      const runs =
        hours >= 48 && Number.isInteger(hours / 24)
          ? `${hours / 24} days`
          : `${hours} ${hours === 1 ? "hour" : "hours"}`;
      for (const id of await this.team(["ADMIN"]))
        this.mail.notify({
          template: "G04",
          userId: id,
          eventKey: `override:${o.id}:scheduled`,
          vars: {
            override_date: lagosDateTime(o.startsAt),
            runs_for: runs,
            question_text: o.replacedText ?? "No question (that time had none)",
            new_slot: o.newSlot,
            alert_on: o.alert ? "Yes" : "No",
            admin_name: admin,
            admin_url: `${this.web()}/admin/override`,
            cancel_url: `${this.web()}/admin/override`,
          },
        });
    });
  }

  /** G05: an override is showing now (it started on time, or it was set to start at once). All admins. */
  async overrideLive(o: {
    id: string;
    actorId: string | null;
    title: string;
    endsAt: Date;
  }): Promise<void> {
    await this.guard("override-live", async () => {
      const admin = await this.nameOf(o.actorId);
      for (const id of await this.team(["ADMIN"]))
        this.mail.notify({
          template: "G05",
          userId: id,
          eventKey: `override:${o.id}:live`,
          vars: {
            override_title: o.title,
            end_time: lagosDateTime(o.endsAt),
            admin_name: admin,
            admin_url: `${this.web()}/admin/override`,
          },
        });
    });
  }

  /** G06: an override ended on time and the normal flow is back. All admins. */
  async overrideEnded(o: {
    id: string;
    replacedQuestionId: string | null;
  }): Promise<void> {
    await this.guard("override-ended", async () => {
      const [now, replaced] = await Promise.all([
        this.prisma.question.findFirst({
          where: { kind: "DAILY", status: "LIVE" },
          orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
          select: { text: true },
        }),
        o.replacedQuestionId
          ? this.prisma.question.findUnique({
              where: { id: o.replacedQuestionId },
              select: { scheduledFor: true, isSpare: true, status: true },
            })
          : null,
      ]);
      const slot = !replaced
        ? "No question was replaced"
        : replaced.scheduledFor
          ? lagosDate(replaced.scheduledFor)
          : replaced.isSpare
            ? "Back in the spare questions"
            : "Not scheduled";
      for (const id of await this.team(["ADMIN"]))
        this.mail.notify({
          template: "G06",
          userId: id,
          eventKey: `override:${o.id}:ended`,
          vars: {
            resumed_question:
              now?.text ?? "The next scheduled question, when it starts",
            new_slot: slot,
            admin_url: `${this.web()}/admin/override`,
          },
        });
    });
  }

  /** G09: a person's roles changed. They hear once per change (the audit row is the event). */
  async roleChanged(
    targetId: string,
    actorId: string,
    changeId: string,
    roles: string[],
  ): Promise<void> {
    await this.guard("role-changed", async () => {
      const label = (r: string) =>
        ({
          ADMIN: "Admin",
          EDITOR: "Editor",
          MODERATOR: "Moderator",
          AD_MANAGER: "Ad manager",
        })[r] ?? r;
      this.mail.notify({
        template: "G09",
        userId: targetId,
        eventKey: `role:${changeId}`,
        vars: {
          role: roles.length ? roles.map(label).join(", ") : "No admin role",
          admin_name: await this.nameOf(actorId),
          date: lagosDate(new Date()),
          admin_url: `${this.web()}/admin`,
        },
      });
    });
  }

  // ------------------------------------------------------------------ support

  /** H04: a signed-in person wrote to support. A guest has no address on file, so they get nothing. */
  async supportReceived(
    userId: string,
    messageId: string,
    topic: string,
  ): Promise<void> {
    await this.guard("support", () => {
      this.mail.notify({
        template: "H04",
        userId,
        eventKey: `support:${messageId}`,
        vars: {
          ticket_ref: refOf("SP", messageId),
          ticket_subject:
            { PAYMENT: "Payment", ACCOUNT: "Account", CONTENT: "Content" }[
              topic
            ] ?? "Something else",
        },
      });
    });
  }
}
