import type { Prisma } from "../generated/prisma/client";

/** The UserSettings switch that turns a template off. null = always on (money, safety and account mail). */
export type MailSetting = keyof Pick<
  Prisma.UserSettingsGetPayload<object>,
  | "notifyDailyQuestion"
  | "notifyReplies"
  | "notifyReactions"
  | "notifyPollResults"
  | "notifyFlashPolls"
  | "notifyCategoryAlerts"
>;

/** How often one template may reach one person (the owner's catalogue column "Send limit"). */
export type MailLimit =
  | { kind: "per-event" } // one mail per event key (a payment, a decision, a report)
  | { kind: "window"; ms: number }; // at most one per scope (a post) in the window

export interface MailTemplateDef {
  /** Subject line, with {{merge}} fields. Words checked against VOICES (V-44). */
  subject: string;
  setting: MailSetting | null;
  limit: MailLimit;
}

const HALF_HOUR = 30 * 60_000;

/** The templates the API sends. Every other file under templates/ is kept and listed as unsent in docs/mail/CATALOGUE.md. */
export const MAIL_TEMPLATES = {
  B03: {
    subject: "{{replier_name}} replied to your voice",
    setting: "notifyReplies",
    limit: { kind: "window", ms: HALF_HOUR },
  },
  B11: {
    subject: "{{improver_name}} improved your proposal",
    setting: "notifyReplies",
    limit: { kind: "per-event" },
  },
  D01: {
    subject: "Receipt for your Voices purchase {{receipt_no}}",
    setting: null,
    limit: { kind: "per-event" },
  },
  D02: {
    subject: "Receipt for your VOICES Tokens {{receipt_no}}",
    setting: null,
    limit: { kind: "per-event" },
  },
  D03: {
    subject: "We could not take your payment",
    setting: null,
    limit: { kind: "per-event" },
  },
  D04: {
    subject: "We are waiting to confirm your payment",
    setting: null,
    limit: { kind: "per-event" },
  },
  E01: {
    subject: "We removed one of your posts",
    setting: null,
    limit: { kind: "per-event" },
  },
  E02: {
    subject: "A warning about your account",
    setting: null,
    limit: { kind: "per-event" },
  },
  E04: {
    subject: "Your Voices account is {{status_word}}",
    setting: null,
    limit: { kind: "per-event" },
  },
  E05: {
    subject: "Your Voices account is back to normal",
    setting: null,
    limit: { kind: "per-event" },
  },
  E06: {
    subject: "We got your appeal",
    setting: null,
    limit: { kind: "per-event" },
  },
  E07: {
    subject: "Good news about your appeal",
    setting: null,
    limit: { kind: "per-event" },
  },
  E08: {
    subject: "The result of your appeal",
    setting: null,
    limit: { kind: "per-event" },
  },
  E09: {
    subject: "Thanks for letting us know",
    setting: null,
    limit: { kind: "per-event" },
  },
  E10: {
    subject: "An update on your report",
    setting: null,
    limit: { kind: "per-event" },
  },
  E11: {
    subject: "An editor changed the tag on your post",
    setting: null,
    limit: { kind: "per-event" },
  },
} satisfies Record<string, MailTemplateDef>;

export type MailTemplateId = keyof typeof MAIL_TEMPLATES;
