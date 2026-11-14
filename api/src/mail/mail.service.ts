import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../common/prisma/prisma.service";
import { renderMail, type MailVars } from "./mail-render";
import {
  MAIL_TEMPLATES,
  type MailLimit,
  type MailTemplateId,
} from "./mail-templates";

/** One call to the relay is waited for this long. */
export const MAIL_TIMEOUT_MS = 10_000;
/** A busy relay is asked this many times in all. */
export const MAIL_MAX_ATTEMPTS = 3;

export interface MailJob {
  template: MailTemplateId;
  /** VOICES User.id of the person the mail is for. The address is looked up here, never passed by a caller. */
  userId: string;
  /** The event's own id (reply:<id>, payment:<id>): the same event mails once. */
  eventKey: string;
  /** What a time limit counts per (for example the post). */
  scopeKey?: string;
  vars: MailVars;
}

/** A mail WAWU ID writes itself (A10, A11): the person's WAWU ID, the notice kind and its facts. */
export interface NoticeJob {
  template: "A10" | "A11";
  /** VOICES User.id, for the send log. */
  userId: string;
  /** The person's WAWU ID id (the token's sub). */
  wawuId: string;
  kind: "account_deletion_started" | "account_deleted";
  data: Record<string, string>;
  eventKey: string;
}

/**
 * V-SURVEYS: a mail to the contact address of a sponsored survey (F01 to F04). The address is read from the survey row
 * here, never passed by a caller, and goes only to that survey's contact. The send log is keyed `brand:<surveyId>`.
 */
export interface BrandMailJob {
  template: "F01" | "F02" | "F03" | "F04";
  surveyId: string;
  eventKey: string;
  vars: MailVars;
}

export type MailOutcome =
  | "sent"
  | "unconfigured"
  | "no-address"
  | "switched-off"
  | "limited"
  | "bad-mail"
  | "failed";

/** Naira from kobo: "₦1,500" or "₦1,500.50". */
export function naira(kobo: number): string {
  const n = kobo / 100;
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** A count with a thousands separator: "1,250", "2,000.5". */
export function count(n: number): string {
  return n.toLocaleString("en-NG", { maximumFractionDigits: 3 });
}

/** 12 Nov 2026, on the Lagos calendar. */
export function lagosDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** 14 Nov 2026, 9:00am, on the Lagos clock. */
export function lagosDateTime(d: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .replace(" ", "");
  return `${lagosDate(d)}, ${time}`;
}

/**
 * VOICES notification mail (V-44, bundle M-b). Sends through WAWU ID's mail relay, `POST /internal/mail/send`, the way the
 * WAWU Hub does: the shared service key in a header, one Idempotency-Key per mail. WAWU ID owns the sender and the
 * provider key; VOICES holds neither. With the relay unset nothing is sent (development and tests).
 *
 * A mail never breaks the action that caused it: `notify` returns at once, `send` never throws.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly inFlight = new Set<Promise<unknown>>();
  private warnedUnset = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** The WAWU ID base URL, no trailing slash; empty when unset. */
  relayBase(): string {
    return (
      this.config.get<string>("MAIL_RELAY_BASE_URL") ??
      this.config.get<string>("WAWU_ID_BASE_URL") ??
      ""
    )
      .trim()
      .replace(/\/+$/, "");
  }

  private key(): string {
    return this.config.get<string>("INTERNAL_SERVICE_KEY")?.trim() ?? "";
  }

  webBase(): string {
    return (
      this.config.get<string>("PUBLIC_WEB_BASE") ?? "https://usevoices.com"
    )
      .trim()
      .replace(/\/+$/, "");
  }

  /**
   * The folder the VOICES logos are fetched from (logo-wordmark-white.png and the others). WAWU ID serves them at
   * `<its assets folder>/voices/<file>`, beside its own header picture; the default is that folder, found from the relay
   * address. `VOICES_MAIL_ASSET_URL` (the same name WAWU ID uses) overrides it. One setting, every mail.
   */
  assetBase(): string {
    const set = this.config.get<string>("VOICES_MAIL_ASSET_URL")?.trim();
    return (set || `${this.relayBase()}/assets/voices`).replace(/\/+$/, "");
  }

  /** Raises a mail and returns at once. Call it after the action's own transaction has committed. */
  notify(job: MailJob): void {
    const p = this.send(job).catch((e: unknown) =>
      this.logger.error(
        `mail ${job.template} ${job.eventKey}: ${e instanceof Error ? e.name : "error"}`,
      ),
    );
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }

  /** Resolves when every mail raised so far has been asked (or given up). Tests and shutdown use it. */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.race([
      this.settled(),
      new Promise<void>((r) => setTimeout(r, 5_000).unref()),
    ]);
  }

  async send(job: MailJob): Promise<MailOutcome> {
    try {
      return await this.sendInner(job);
    } catch (e) {
      this.logger.error(
        `mail ${job.template} ${job.eventKey}: not sent (${e instanceof Error ? e.name : "error"})`,
      );
      return "failed";
    }
  }

  private async sendInner(job: MailJob): Promise<MailOutcome> {
    const base = this.relayBase();
    const key = this.key();
    if (!base || !key) {
      if (!this.warnedUnset) {
        this.warnedUnset = true;
        this.logger.warn(
          "mail relay not set (WAWU_ID_BASE_URL, INTERNAL_SERVICE_KEY): VOICES notification mail is off",
        );
      }
      return "unconfigured";
    }
    const def = MAIL_TEMPLATES[job.template];
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: {
        status: true,
        mailTo: true,
        displayName: true,
        handle: true,
        settings: true,
      },
    });
    if (!user || !user.mailTo || user.status === "DELETED") return "no-address";
    // The person's own switch (always-on mail has none): money, safety and account mail is not optional.
    if (def.setting && user.settings && user.settings[def.setting] === false)
      return "switched-off";

    const web = this.webBase();
    const vars: MailVars = {
      first_name:
        (user.displayName?.trim().split(/\s+/)[0] || user.handle) ?? "",
      app_url: web,
      preferences_url: `${web}/settings`,
      asset_base: this.assetBase(),
      ...job.vars,
    };
    const mail = renderMail(job.template, def.subject, vars);
    if (!mail.ok) {
      this.logger.error(
        `mail ${job.template} ${job.eventKey}: not sent, missing ${mail.missing.join(",")}`,
      );
      return "bad-mail";
    }

    // Send limit. The log row is written first, so two servers or a replay cannot both send.
    const logId = await this.reserve(job, def.limit);
    if (!logId) return "limited";

    const ok = await this.post(base, key, {
      to: user.mailTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      tag: `voices_${job.template}`,
      idempotency:
        "vm-" +
        createHash("sha256")
          .update(`${job.userId}|${job.template}|${job.eventKey}`)
          .digest("hex")
          .slice(0, 40),
    });
    if (!ok) {
      // Give the slot back, so the same event can be tried again.
      await this.prisma.mailLog
        .delete({ where: { id: logId } })
        .catch(() => undefined);
      return "failed";
    }
    return "sent";
  }

  /** Raises a mail to a survey's brand contact and returns at once. Call it after the action's own transaction committed. */
  notifyBrand(job: BrandMailJob): void {
    const p = this.sendBrand(job).catch((e: unknown) =>
      this.logger.error(
        `brand mail ${job.template} ${job.eventKey}: ${e instanceof Error ? e.name : "error"}`,
      ),
    );
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }

  async sendBrand(job: BrandMailJob): Promise<MailOutcome> {
    try {
      const base = this.relayBase();
      const key = this.key();
      if (!base || !key) return "unconfigured";
      const def = MAIL_TEMPLATES[job.template];
      const survey = await this.prisma.sponsoredSurvey.findUnique({
        where: { id: job.surveyId },
        select: { contactEmail: true },
      });
      if (!survey?.contactEmail) return "no-address";
      const web = this.webBase();
      const mail = renderMail(job.template, def.subject, {
        app_url: web,
        preferences_url: `${web}/settings`,
        asset_base: this.assetBase(),
        ...job.vars,
      });
      if (!mail.ok) {
        this.logger.error(
          `brand mail ${job.template} ${job.eventKey}: not sent, missing ${mail.missing.join(",")}`,
        );
        return "bad-mail";
      }
      const logUser = `brand:${job.surveyId}`;
      const logId = await this.reserve(
        { userId: logUser, template: job.template, eventKey: job.eventKey },
        def.limit,
      );
      if (!logId) return "limited";
      const ok = await this.post(base, key, {
        to: survey.contactEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tag: `voices_${job.template}`,
        idempotency:
          "vm-" +
          createHash("sha256")
            .update(`${logUser}|${job.template}|${job.eventKey}`)
            .digest("hex")
            .slice(0, 40),
      });
      if (!ok) {
        await this.prisma.mailLog
          .delete({ where: { id: logId } })
          .catch(() => undefined);
        return "failed";
      }
      return "sent";
    } catch (e) {
      this.logger.error(
        `brand mail ${job.template} ${job.eventKey}: not sent (${e instanceof Error ? e.name : "error"})`,
      );
      return "failed";
    }
  }

  /**
   * A mail WAWU ID writes and sends itself: `POST /internal/mail/notice` with `app: "voices"` (the two deletion
   * notices, A10 and A11). VOICES names the person (`wawuId`), the kind and the facts; WAWU ID finds the proven address.
   * Same rules as `send`: once per event (MailLog), never throws, three tries on a 5xx or a network error.
   * `wawuId` is passed in because A11 runs after the purge has cut the link on the VOICES side.
   */
  notifyNotice(job: NoticeJob): void {
    const p = this.sendNotice(job).catch((e: unknown) =>
      this.logger.error(
        `notice ${job.template} ${job.eventKey}: ${e instanceof Error ? e.name : "error"}`,
      ),
    );
    this.inFlight.add(p);
    void p.finally(() => this.inFlight.delete(p));
  }

  async sendNotice(job: NoticeJob): Promise<MailOutcome> {
    try {
      const base = this.relayBase();
      const key = this.key();
      if (!base || !key) return "unconfigured";
      const logId = await this.reserve(job, { kind: "per-event" });
      if (!logId) return "limited";
      const idempotency =
        "vm-" +
        createHash("sha256")
          .update(`${job.userId}|${job.template}|${job.eventKey}`)
          .digest("hex")
          .slice(0, 40);
      const ok = await this.postJson(
        `${base}/internal/mail/notice`,
        key,
        idempotency,
        `voices_${job.template}`,
        {
          wawuId: job.wawuId,
          kind: job.kind,
          data: job.data,
          app: "voices",
          idempotencyKey: idempotency,
        },
      );
      if (!ok) {
        await this.prisma.mailLog
          .delete({ where: { id: logId } })
          .catch(() => undefined);
        return "failed";
      }
      return "sent";
    } catch (e) {
      this.logger.error(
        `notice ${job.template} ${job.eventKey}: not sent (${e instanceof Error ? e.name : "error"})`,
      );
      return "failed";
    }
  }

  private async reserve(
    job: {
      userId: string;
      template: string;
      eventKey: string;
      scopeKey?: string;
    },
    limit: MailLimit,
  ): Promise<string | null> {
    try {
      if (limit.kind === "window") {
        const since = new Date(Date.now() - limit.ms);
        const scope = job.scopeKey ?? null;
        // Count and insert under one lock per (person, template, scope), so simultaneous sends cannot all see "none yet".
        return await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mail:${job.userId}:${job.template}:${scope ?? ""}`}, 0))`;
          const recent = await tx.mailLog.count({
            where: {
              userId: job.userId,
              template: job.template,
              scopeKey: scope,
              createdAt: { gt: since },
            },
          });
          if (recent > 0) return null;
          const row = await tx.mailLog.create({
            data: {
              userId: job.userId,
              template: job.template,
              eventKey: job.eventKey,
              scopeKey: scope,
            },
            select: { id: true },
          });
          return row.id;
        });
      }
      const row = await this.prisma.mailLog.create({
        data: {
          userId: job.userId,
          template: job.template,
          eventKey: job.eventKey,
          scopeKey: job.scopeKey ?? null,
        },
        select: { id: true },
      });
      return row.id;
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return null;
      throw e;
    }
  }

  private post(
    base: string,
    serviceKey: string,
    m: {
      to: string;
      subject: string;
      html: string;
      text: string;
      tag: string;
      idempotency: string;
    },
  ): Promise<boolean> {
    return this.postJson(
      `${base}/internal/mail/send`,
      serviceKey,
      m.idempotency,
      m.tag,
      {
        to: m.to,
        subject: m.subject,
        html: m.html,
        text: m.text,
        tag: m.tag,
        app: "voices",
      },
    );
  }

  private async postJson(
    url: string,
    serviceKey: string,
    idempotency: string,
    tag: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const wait = Number(this.config.get("MAIL_RETRY_MS") ?? 500);
    for (let attempt = 1; attempt <= MAIL_MAX_ATTEMPTS; attempt++) {
      let retry = true;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-service-key": serviceKey,
            "idempotency-key": idempotency,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
        });
        if (res.ok) return true;
        // 400, 401, 429 (daily cap) and the like will not get better by asking again.
        retry = res.status >= 500;
        this.logger.warn(`mail ${tag}: relay answered ${res.status}`);
      } catch (e) {
        this.logger.warn(
          `mail ${tag}: relay unreachable (${e instanceof Error ? e.name : "error"})`,
        );
      }
      if (!retry || attempt === MAIL_MAX_ATTEMPTS) return false;
      await new Promise((r) => setTimeout(r, wait * 2 ** (attempt - 1)));
    }
    return false;
  }
}
