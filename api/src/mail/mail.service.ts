import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../common/prisma/prisma.service";
import { renderMail, type MailVars } from "./mail-render";
import {
  MAIL_TEMPLATES,
  type MailLimit,
  type MailTemplateDef,
  type MailTemplateId,
} from "./mail-templates";
import { signUnsubscribe } from "./mail-unsubscribe";

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
  /**
   * A cap on how many mails of these templates the log may hold for the current UTC day (the relay's own day). It is
   * counted and the log row written under one lock, so two processes together cannot go past it.
   */
  /** The topic mails (C01, C02, C14) say they want to be told when the relay names the address as the fault ("refused"). */
  tellRefused?: boolean;
  /** Relay asks for this one send (default MAIL_MAX_ATTEMPTS). A topic mail to a person who already had trouble in the window uses 1. */
  attempts?: number;
  budget?: {
    templates: string[];
    max: number;
    /** A smaller cap on this job's own template for the UTC day (C02 before C01's window has closed). Counted under the same lock. */
    ownMax?: number;
  };
}

/** What `reserve` answers when the day's budget is used up (no row is written). */
const BUDGET_USED = "budget-used";

/** 00:00 UTC of the day `d` falls on: the relay counts its daily cap on the UTC day. */
export function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
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
 * What the relay's answer must say for ONE address to be treated as bad. This repo records no sample of such an answer
 * (no doc, no fake), so this is the clearest signal the client can see: a 400, 404, 410 or 422 whose JSON body names the
 * recipient as the fault, by a code/reason/error/type value from ADDRESS_FAULT_CODES, or by a field/param/path/target
 * value from ADDRESS_FAULT_FIELDS. These keys are read on the body, on `error` when it is an object, and on each entry of
 * `errors`. A status alone (a bare 404 or 422), an unreadable body, any other body, any 5xx, 401, 403 and 429 are relay
 * trouble, never a bad address.
 */
export const ADDRESS_FAULT_STATUSES = [400, 404, 410, 422];
export const ADDRESS_FAULT_CODES = [
  "invalid_recipient",
  "invalid_address",
  "invalid_email",
  "invalid_to",
  "recipient_invalid",
  "recipient_suppressed",
  "address_suppressed",
  "suppressed_recipient",
  "suppressed",
  "recipient_bounced",
  "address_bounced",
  "hard_bounce",
  "bounced",
  "mailbox_not_found",
  "recipient_not_found",
];
export const ADDRESS_FAULT_FIELDS = ["to", "recipient", "email", "address"];

export function relayNamesAddress(status: number, body: unknown): boolean {
  if (!ADDRESS_FAULT_STATUSES.includes(status)) return false;
  const objs: unknown[] = [body];
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; errors?: unknown };
    objs.push(b.error);
    if (Array.isArray(b.errors))
      for (const e of b.errors as unknown[]) objs.push(e);
  }
  const norm = (v: unknown) =>
    typeof v === "string" ? v.trim().toLowerCase() : "";
  for (const o of objs) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    for (const k of ["code", "reason", "error", "type"])
      if (ADDRESS_FAULT_CODES.includes(norm(r[k]))) return true;
    for (const k of ["field", "param", "path", "target"])
      if (ADDRESS_FAULT_FIELDS.includes(norm(r[k]))) return true;
  }
  return false;
}

/** What one call to the relay came to: sent, refused because a cap is reached (429), or any other failure. */
type PostResult =
  "ok" | "capped" | "paused" | "refused" | "key-refused" | "failed";

/** The relay's own words for "the day's allowance is used": the Lagos day is over for this mail. */
export const DAILY_LIMIT_CODES = [
  "daily_cap",
  "daily_limit",
  "daily_quota",
  "provider_daily_quota",
  "provider_monthly_quota",
  "monthly_cap",
  "monthly_quota",
];
/** The relay's own words for "too fast, wait a little". */
export const RATE_LIMIT_CODES = [
  "rate_limited",
  "rate_limit",
  "rate_limit_exceeded",
  "too_many_requests",
  "throttled",
];
/** A pause with no stated length (the relay did not say how long): 2 minutes. */
export const DEFAULT_PAUSE_MS = 120_000;
const MAX_PAUSE_MS = 30 * 60_000;

/** What a 429 means: `daily` ends the day for that mail; `pause` waits `ms`. Pure, so a test can try every shape. */
export function classify429(
  code: string,
  retryAfter: string | null,
  now = Date.now(),
): { kind: "daily" } | { kind: "pause"; ms: number } {
  const c = code.trim().toLowerCase();
  if (DAILY_LIMIT_CODES.includes(c)) return { kind: "daily" };
  let ms = DEFAULT_PAUSE_MS;
  const ra = (retryAfter ?? "").trim();
  if (ra) {
    const secs = /^\d+(\.\d+)?$/.test(ra)
      ? Number(ra) * 1000
      : Date.parse(ra) - now;
    if (Number.isFinite(secs) && secs > 0)
      ms = Math.min(Math.max(Math.ceil(secs), 1000), MAX_PAUSE_MS);
  }
  return { kind: "pause", ms };
}

export type MailOutcome =
  | "sent"
  | "unconfigured"
  | "no-address"
  | "switched-off"
  | "limited"
  | "capped"
  | "paused"
  | "budget"
  | "bad-mail"
  | "refused"
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
  /** How long the relay asked us to wait, from the last 429 that was a rate limit (ms); read once with `takePauseMs`. */
  private pauseMs = 0;

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

  /** The key the one-click unsubscribe links are signed with: its own setting, else the service key. */
  unsubscribeSecret(): string {
    return (
      this.config.get<string>("MAIL_UNSUBSCRIBE_SECRET")?.trim() || this.key()
    );
  }

  /** Every key a link may be signed with: the secret when set, and the service key (links made before the secret was set). */
  unsubscribeKeys(): string[] {
    const secret = this.config.get<string>("MAIL_UNSUBSCRIBE_SECRET")?.trim();
    return [...new Set([secret, this.key()].filter((k): k is string => !!k))];
  }

  /** The wait the relay's last rate-limit 429 asked for (ms); 0 when none. Reading it clears it. */
  takePauseMs(): number {
    const ms = this.pauseMs;
    this.pauseMs = 0;
    return ms;
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
    const def: MailTemplateDef = MAIL_TEMPLATES[job.template];
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
    // Bulk mail (daily question, topic of the week) goes to active accounts only; a notice about the account itself
    // (a restriction, a decision) still reaches a suspended or banned person.
    if (def.activeOnly && user.status !== "ACTIVE") return "no-address";
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
    // A mail with an unsubscribe kind carries a link in its footer and the two headers a mail client's own
    // "unsubscribe" button uses (RFC 8058 one click). The link names this person and this kind only.
    let headers: Record<string, string> | undefined;
    if (def.unsubscribe) {
      const secret = this.unsubscribeSecret();
      const url = `${web}/api/v1/mail/unsubscribe?t=${encodeURIComponent(
        signUnsubscribe(secret, job.userId, def.unsubscribe),
      )}`;
      vars.unsubscribe_url = url;
      headers = {
        "List-Unsubscribe": `<${url}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    }
    const mail = renderMail(job.template, def.subject, vars);
    if (!mail.ok) {
      this.logger.error(
        `mail ${job.template} ${job.eventKey}: not sent, missing ${mail.missing.join(",")}`,
      );
      return "bad-mail";
    }

    // Send limit. The log row is written first, so two servers or a replay cannot both send.
    const logId = await this.reserve(job, def.limit);
    if (logId === BUDGET_USED) return "budget";
    if (!logId) return "limited";

    const ok = await this.post(base, key, {
      to: user.mailTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      tag: `voices_${job.template}`,
      headers,
      idempotency:
        "vm-" +
        createHash("sha256")
          .update(`${job.userId}|${job.template}|${job.eventKey}`)
          .digest("hex")
          .slice(0, 40),
      attempts: job.attempts,
    });
    if (ok !== "ok") {
      // Give the slot back, so the same event can be tried again (a capped mail is simply not sent yet).
      await this.prisma.mailLog
        .delete({ where: { id: logId } })
        .catch(() => undefined);
      if (ok === "capped") return "capped";
      // A rate limit is only told apart for the topic mails (they pause and go on); every other mail keeps "capped".
      if (ok === "paused")
        return job.tellRefused || job.budget ? "paused" : "capped";
      // Only the budgeted topic mails tell "this address is refused" from "the relay is in trouble"; every other mail keeps "failed".
      if (ok === "key-refused" && job.budget)
        this.logger.error(
          `mail ${job.template} ${job.eventKey}: the relay refused our service key (401/403): check INTERNAL_SERVICE_KEY and the relay address`,
        );
      return ok === "refused" && (job.budget || job.tellRefused)
        ? "refused"
        : "failed";
    }
    return "sent";
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
      if (ok !== "ok") {
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
      budget?: { templates: string[]; max: number; ownMax?: number };
    },
    limit: MailLimit,
  ): Promise<string | null> {
    try {
      if (job.budget) {
        const b = job.budget;
        return await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('mail:budget', 0))`;
          const used = await tx.mailLog.count({
            where: {
              template: { in: b.templates },
              createdAt: { gte: utcDayStart(new Date()) },
            },
          });
          if (used >= b.max) return BUDGET_USED;
          if (b.ownMax !== undefined) {
            const own = await tx.mailLog.count({
              where: {
                template: job.template,
                createdAt: { gte: utcDayStart(new Date()) },
              },
            });
            if (own >= b.ownMax) return BUDGET_USED;
          }
          const row = await tx.mailLog.create({
            data: {
              userId: job.userId,
              template: job.template,
              eventKey: job.eventKey,
              scopeKey: job.scopeKey ?? null,
            },
            select: { id: true },
          });
          return row.id;
        });
      }
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
      headers?: Record<string, string>;
      idempotency: string;
      attempts?: number;
    },
  ): Promise<PostResult> {
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
        ...(m.headers ? { headers: m.headers } : {}),
      },
      m.attempts,
    );
  }

  private async postJson(
    url: string,
    serviceKey: string,
    idempotency: string,
    tag: string,
    body: Record<string, unknown>,
    attempts = MAIL_MAX_ATTEMPTS,
  ): Promise<PostResult> {
    const wait = Number(this.config.get("MAIL_RETRY_MS") ?? 500);
    const last = Math.max(1, Math.min(attempts, MAIL_MAX_ATTEMPTS));
    for (let attempt = 1; attempt <= last; attempt++) {
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
        if (res.ok) return "ok";
        // 400, 401, 429 (daily cap) and the like will not get better by asking again.
        retry = res.status >= 500;
        // 401 and 403 mean the relay turned our own service key down: a fault of the relay link, never of the address.
        if (res.status === 401 || res.status === 403) {
          this.logger.warn(`mail ${tag}: relay answered ${res.status}`);
          return "key-refused";
        }
        // Only an answer that NAMES the address as the fault is a refused address; any other 4xx is trouble with the relay.
        if (ADDRESS_FAULT_STATUSES.includes(res.status)) {
          const named = relayNamesAddress(
            res.status,
            await res.json().catch(() => null),
          );
          this.logger.warn(
            `mail ${tag}: relay answered ${res.status}${named ? " (names the address)" : ""}`,
          );
          return named ? "refused" : "failed";
        }
        if (res.status === 429) {
          // The relay says why: a daily or monthly allowance (the day is over for this mail), or a rate limit (wait a little).
          const why = await res
            .json()
            .then((j: { code?: unknown; reason?: unknown }) =>
              typeof j?.code === "string"
                ? j.code
                : typeof j?.reason === "string"
                  ? j.reason
                  : "",
            )
            .catch(() => "");
          this.logger.warn(`mail ${tag}: relay answered 429 ${why}`.trim());
          const c = classify429(why, res.headers.get("retry-after"));
          if (c.kind === "daily") return "capped";
          this.pauseMs = c.ms;
          return "paused";
        }
        this.logger.warn(`mail ${tag}: relay answered ${res.status}`);
      } catch (e) {
        this.logger.warn(
          `mail ${tag}: relay unreachable (${e instanceof Error ? e.name : "error"})`,
        );
      }
      if (!retry || attempt === last) return "failed";
      await new Promise((r) => setTimeout(r, wait * 2 ** (attempt - 1)));
    }
    return "failed";
  }
}
