import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { UnitsConfig } from "./units.config";
import { displayKoboPerUnit, perUnitKobo } from "./units.display-rate";
import { apiError } from "./units.errors";
import { LedgerService, lagosDay } from "./units.ledger";
import { PaymentsService } from "./units.payments";
import { TokensService } from "./units.tokens";
import type {
  Allowances,
  ChargeAction,
  ChargeOpts,
  ChargeResult,
  FreeLeft,
  UnitsPortFull,
} from "./units.port";

const COST_KEYS = [
  "units.base_rate_kobo",
  "units.min_purchase_kobo",
  "allowance.free_reactions_per_day",
  "allowance.free_votes_per_day",
  "cost.text_post_milli",
  "cost.voice_post_milli",
  "cost.reaction_milli",
  "cost.vote_milli",
  "voice.free_seconds",
  "voice.extra30.price_kobo",
  "voice.extra60.price_kobo",
  "voice.extra30.max_seconds",
  "voice.extra60.max_seconds",
  "text.max_chars",
  "text.price_chars",
  "allowance.free_post_text_chars",
  "allowance.messages_per_day",
  "textfix.cost_milli",
];

const perUnit = perUnitKobo;

type TokenRow = {
  id: string;
  kind: string;
  maxSeconds: number;
  status: string;
  createdAt: Date;
};
const tokenView = (t: TokenRow) => ({
  id: t.id,
  kind: t.kind,
  maxSeconds: t.maxSeconds,
  status: t.status,
  createdAt: t.createdAt.toISOString(),
});

interface HistoryRow {
  id: string;
  at: Date;
  item: Record<string, unknown>;
}

/** The UNITS_PORT implementation and the read views of the wallet routes. */
@Injectable()
export class UnitsService implements UnitsPortFull {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: UnitsConfig,
    private readonly ledger: LedgerService,
    private readonly tokens: TokensService,
    private readonly payments: PaymentsService,
  ) {}

  // ---- the port
  charge(
    userId: string,
    action: ChargeAction,
    key: string,
    opts?: ChargeOpts,
  ): Promise<ChargeResult> {
    return this.ledger.charge(userId, action, key, opts);
  }
  freeLeft(userId: string, action: ChargeAction): Promise<FreeLeft> {
    return this.ledger.freeLeft(userId, action);
  }
  reverse(chargeId: string, reason = "action failed") {
    return this.ledger.reverse(chargeId, reason);
  }
  reverseByKey(userId: string, key: string) {
    return this.ledger.reverseByKey(userId, key);
  }
  attachRef(userId: string, key: string, refType: string, refId: string) {
    return this.ledger.attachRef(userId, key, refType, refId);
  }
  reserveToken(userId: string, tokenId: string, clipId: string) {
    return this.tokens.reserve(userId, tokenId, clipId);
  }
  consumeToken(userId: string, tokenId: string, clipId: string) {
    return this.tokens.consume(userId, tokenId, clipId);
  }
  releaseToken(userId: string, tokenId: string, clipId: string) {
    return this.tokens.release(userId, tokenId, clipId);
  }
  adjustBalance(
    adminId: string,
    userId: string,
    deltaMilli: number,
    reason: string,
    key: string,
  ) {
    return this.ledger.adjust(adminId, userId, deltaMilli, reason, key);
  }

  // ---- views
  async costs() {
    const c = await this.cfg.ints(COST_KEYS);
    return {
      // RX4: one display source, the smallest pack's per-unit price.
      baseKoboPerUnit: await displayKoboPerUnit(
        this.prisma,
        () => c["units.base_rate_kobo"],
      ),
      extraVoice30Kobo: c["voice.extra30.price_kobo"],
      extraVoice60Kobo: c["voice.extra60.price_kobo"],
      freeReactionsPerDay: c["allowance.free_reactions_per_day"],
      freeVoiceSeconds: c["voice.free_seconds"],
      freeVotesPerDay: c["allowance.free_votes_per_day"],
      minPackKobo: c["units.min_purchase_kobo"],
      reactionAfterFreeMilli: c["cost.reaction_milli"],
      textMaxChars: c["text.max_chars"],
      textPriceChars: c["text.price_chars"],
      freePostTextChars: c["allowance.free_post_text_chars"],
      messagesPerDay: c["allowance.messages_per_day"],
      textFixMilli: c["textfix.cost_milli"],
      voiceTier1Seconds: c["voice.extra30.max_seconds"],
      voiceMaxSeconds: c["voice.extra60.max_seconds"],
      textPostMilli: c["cost.text_post_milli"],
      voicePostMilli: c["cost.voice_post_milli"],
      voteAfterFreeMilli: c["cost.vote_milli"],
    };
  }

  async tiers() {
    const [rows, costs, c] = await Promise.all([
      this.prisma.unitTier.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      }),
      this.costs(),
      this.cfg.ints(["voice.extra30.max_seconds", "voice.extra60.max_seconds"]),
    ]);
    return {
      tiers: rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        priceKobo: t.priceKobo,
        unitsMilli: t.unitsMilli,
        bonusMilli: t.bonusMilli,
        effectiveKoboPerUnit: perUnit(t.priceKobo, t.unitsMilli),
        baseKoboPerUnit: perUnit(t.priceKobo, t.unitsMilli - t.bonusMilli),
      })),
      minPackKobo: costs.minPackKobo,
      costs,
      extraVoice: [
        {
          kind: "SECONDS_30",
          maxSeconds: c["voice.extra30.max_seconds"],
          priceKobo: costs.extraVoice30Kobo,
          label: "Up to 30 sec",
        },
        {
          kind: "SECONDS_60",
          maxSeconds: c["voice.extra60.max_seconds"],
          priceKobo: costs.extraVoice60Kobo,
          label: "Up to 1 min",
        },
      ],
      walletOffer: null,
    };
  }

  async allowances(userId: string): Promise<Allowances> {
    const [wallet, allowance, counters, costs, tokens, freePosts] =
      await Promise.all([
        this.prisma.wallet.findUnique({ where: { userId } }),
        this.prisma.freeAllowance.findUnique({ where: { userId } }),
        this.prisma.usageCounter.findMany({
          where: { userId, day: lagosDay() },
        }),
        this.costs(),
        this.tokens.mine(userId),
        this.cfg.int("allowance.free_posts"),
      ]);
    const used = (a: string) => counters.find((c) => c.action === a)?.used ?? 0;
    const available = tokens.filter((t) => t.status === "AVAILABLE");
    return {
      freePostsRemaining: allowance?.freePostsRemaining ?? freePosts,
      balanceMilli: wallet?.balanceMilli ?? 0,
      // Any recording up to the longest voice message is allowed now; its price follows its length.
      maxVoiceSeconds: Math.max(
        costs.voiceMaxSeconds,
        ...available.map((t) => t.maxSeconds),
      ),
      messagesLeftToday: Math.max(
        0,
        costs.messagesPerDay - used("POST_TEXT") - used("POST_VOICE"),
      ),
      freeReactionsLeftToday: Math.max(
        0,
        costs.freeReactionsPerDay - used("REACTION"),
      ),
      freeVotesLeftToday: Math.max(0, costs.freeVotesPerDay - used("VOTE")),
      costs,
      extraVoiceTokens: tokens.map(tokenView),
    };
  }

  /** GET /me/allowance?action= : one quote. */
  async quote(userId: string, action: ChargeAction) {
    const [a, f] = await Promise.all([
      this.allowances(userId),
      this.ledger.freeLeft(userId, action),
    ]);
    const costMilli = {
      POST_TEXT: a.costs.textPostMilli,
      POST_VOICE: a.costs.voicePostMilli,
      REACTION: a.costs.reactionAfterFreeMilli,
      VOTE: a.costs.voteAfterFreeMilli,
      TEXT_FIX: a.costs.textFixMilli,
      EDIT_TEXT: a.costs.textPostMilli,
      DM_TEXT: 0, // direct messages are quoted by GET /dm/limits
      DM_VOICE: 0,
    }[action];
    return {
      action,
      costMilli: f.freeLeft > 0 ? 0 : costMilli,
      freeLeft: f.freeLeft,
      balanceMilli: f.balanceMilli,
    };
  }

  async wallet(userId: string) {
    const [a, allowance] = await Promise.all([
      this.allowances(userId),
      this.prisma.freeAllowance.findUnique({ where: { userId } }),
    ]);
    return {
      balanceMilli: a.balanceMilli,
      freePostsRemaining: a.freePostsRemaining,
      freePostsUsed: allowance?.freePostsUsed ?? 0,
      allowances: a,
      costs: a.costs,
      tokens: a.extraVoiceTokens,
    };
  }

  // ---- history
  private encode(at: Date, id: string): string {
    return Buffer.from(JSON.stringify({ t: at.toISOString(), id })).toString(
      "base64url",
    );
  }
  private decode(cursor: string): { t: Date; id: string } {
    try {
      const j = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as { t: string; id: string };
      const t = new Date(j.t);
      if (typeof j.id !== "string" || Number.isNaN(t.getTime()))
        throw new Error("bad");
      return { t, id: j.id };
    } catch {
      throw apiError(400, "BAD_REQUEST", "That page marker is not valid.");
    }
  }

  async history(userId: string, limit = 20, cursor?: string) {
    const after = cursor ? this.decode(cursor) : null;
    const before = after
      ? {
          OR: [
            { createdAt: { lt: after.t } },
            { createdAt: after.t, id: { lt: after.id } },
          ],
        }
      : {};
    const take = limit + 1;
    const [txns, freeCharges, tokenBuys, allowance] = await Promise.all([
      this.prisma.ledgerTransaction.findMany({
        where: {
          entries: { some: { walletUserId: userId, account: "USER_WALLET" } },
          ...before,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        include: {
          entries: { where: { walletUserId: userId, account: "USER_WALLET" } },
        },
      }),
      this.prisma.charge.findMany({
        where: { userId, usedFreePost: true, status: "COMMITTED", ...before },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
      }),
      this.prisma.payment.findMany({
        where: {
          userId,
          kind: { in: ["EXTRA_VOICE", "SUBSCRIPTION"] },
          status: "SUCCEEDED",
          ...before,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        include: { tier: true, plan: true },
      }),
      this.prisma.freeAllowance.findUnique({ where: { userId } }),
    ]);
    // Charges and payments for titles of the ledger rows.
    const chargeIds = txns
      .map((t) => t.chargeId)
      .filter((x): x is string => !!x);
    const payIds = txns.map((t) => t.paymentId).filter((x): x is string => !!x);
    const [charges, pays, allFree] = await Promise.all([
      this.prisma.charge.findMany({ where: { id: { in: chargeIds } } }),
      this.prisma.payment.findMany({
        where: { id: { in: payIds } },
        include: { tier: true, plan: true },
      }),
      this.prisma.charge.findMany({
        where: { userId, usedFreePost: true, status: "COMMITTED" },
        select: { id: true, createdAt: true },
      }),
    ]);
    const remaining = allowance?.freePostsRemaining ?? 0;
    const freeLeftAfter = (c: { id: string; createdAt: Date }) =>
      remaining +
      allFree.filter(
        (o) =>
          o.createdAt > c.createdAt ||
          (o.createdAt.getTime() === c.createdAt.getTime() && o.id > c.id),
      ).length;

    const rows: HistoryRow[] = [];
    for (const t of txns) {
      const e = t.entries[0];
      const ch = charges.find((c) => c.id === t.chargeId);
      const pay = pays.find((p) => p.id === t.paymentId);
      const title =
        t.kind === "PURCHASE"
          ? `${pay?.tier?.name ?? "Tokens"} pack`
          : t.kind === "SUBSCRIPTION_CREDIT"
            ? "Monthly plan tokens"
            : t.kind === "SPEND_POST"
              ? ch?.action === "TEXT_FIX"
                ? "AI text fix"
                : ch?.action === "EDIT_TEXT"
                  ? "Longer edit"
                  : ch?.action === "POST_VOICE"
                    ? "Voice answer"
                    : "Text answer"
              : t.kind === "SPEND_REACTION"
                ? "Reaction, after free ones"
                : t.kind === "SPEND_VOTE"
                  ? "Vote, after free ones"
                  : t.kind === "REVERSAL"
                    ? "Returned: the action did not go through"
                    : t.kind === "REFUND"
                      ? "Refund"
                      : "Adjustment by the team";
      rows.push({
        id: t.id,
        at: t.createdAt,
        item: {
          id: t.id,
          kind: t.kind,
          title,
          deltaMilli: e?.deltaMilli ?? 0,
          balanceAfterMilli: e?.balanceAfterMilli ?? null,
          free: false,
          freePostsLeft: null,
          paymentId: t.paymentId,
          hasReceipt: !!pay?.receiptNo,
          amountKobo: pay ? pay.amountKobo : null,
          note:
            t.kind === "ADJUSTMENT" || t.kind === "SUBSCRIPTION_CREDIT"
              ? t.reason
              : null,
          createdAt: t.createdAt.toISOString(),
        },
      });
    }
    for (const c of freeCharges)
      rows.push({
        id: c.id,
        at: c.createdAt,
        item: {
          id: c.id,
          kind: "SPEND_POST",
          title: c.action === "POST_VOICE" ? "Voice answer" : "Text answer",
          deltaMilli: 0,
          balanceAfterMilli: null,
          free: true,
          freePostsLeft: freeLeftAfter(c),
          paymentId: null,
          hasReceipt: false,
          amountKobo: null,
          note: null,
          createdAt: c.createdAt.toISOString(),
        },
      });
    for (const p of tokenBuys)
      rows.push({
        id: p.id,
        at: p.createdAt,
        item: {
          id: p.id,
          kind: "PURCHASE",
          title: this.payments.title(p),
          deltaMilli: 0,
          balanceAfterMilli: null,
          free: false,
          freePostsLeft: null,
          paymentId: p.id,
          hasReceipt: !!p.receiptNo,
          amountKobo: p.amountKobo,
          note: null,
          createdAt: p.createdAt.toISOString(),
        },
      });
    rows.sort(
      (a, b) =>
        b.at.getTime() - a.at.getTime() ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => r.item),
      nextCursor:
        rows.length > limit && last ? this.encode(last.at, last.id) : null,
    };
  }

  /** The statement as CSV. Cells that start with = + - @ are prefixed so a spreadsheet never runs them as a formula. */
  async statementCsv(userId: string): Promise<string> {
    const lines = ["When (Lagos),What,Tokens,Balance after,Naira,Reference"];
    let cursor: string | undefined;
    const cell = (v: unknown) => {
      let s = typeof v === "string" || typeof v === "number" ? String(v) : "";
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    for (let i = 0; i < 200; i++) {
      const page = await this.history(userId, 50, cursor);
      for (const it of page.items) {
        const when = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Africa/Lagos",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(it.createdAt as string));
        const units = (it.deltaMilli as number) / 1000;
        lines.push(
          [
            when,
            it.title,
            it.free ? "Free" : units,
            it.balanceAfterMilli === null
              ? ""
              : (it.balanceAfterMilli as number) / 1000,
            it.amountKobo === null ? "" : (it.amountKobo as number) / 100,
            it.paymentId ?? "",
          ]
            .map(cell)
            .join(","),
        );
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return lines.join("\r\n") + "\r\n";
  }
}
