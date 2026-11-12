import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { quoteOf } from "../reach/reach-support";
import { MailService, lagosDate } from "./mail.service";

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
}
