import { createHash, randomInt } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
  BadRequestException,
} from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import type { VoicesUser } from "../common/auth/voices-user";
import { AccountStatus, type VoicesRole } from "../generated/prisma/enums";
import type { CurrentMeInfo } from "./me-context";
import {
  assertHandleShape,
  handleProblem,
  HANDLE_MESSAGES,
  normaliseHandle,
} from "./handle";
import { MeConfig } from "./me-config";
import { phoneHashOf, phonePepper } from "./phone";
import { Views } from "./views";
import type {
  CreateMeDto,
  SetCategoriesDto,
  SetTagFollowsDto,
  UpdateProfileDto,
  UpdateSettingsDto,
} from "./dto";

/** Countries VOICES knows at launch: Nigeria live, the rest coming (PRICES.md, countries.list). */
export const COUNTRY_CODES = ["NG", "GH", "KE", "ZA"];

export const DEFAULT_SETTINGS = {
  language: "en",
  dataSaver: false,
  theme: "system",
  timezone: "Africa/Lagos",
  quietHoursStart: null,
  quietHoursEnd: null,
  notifyDailyQuestion: true,
  notifyReplies: true,
  notifyReactions: true,
  notifyPollResults: true,
  notifyFlashPolls: true,
  notifyCategoryAlerts: true,
  dailyQuestionMinute: 480,
} as const;

const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function maskPhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const p = phone.replace(/\s+/g, "");
  if (p.length < 8) return null;
  return `${p.slice(0, 4)} ••• ••• ${p.slice(-4)}`;
}

/** The token's `sub`, the only identity key. A token without one is not a session. */
export function subOf(token: VoicesUser): string {
  const sub = (token as { sub?: unknown }).sub;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > 128)
    throw new UnauthorizedException({
      code: "UNAUTHENTICATED",
      message: "Sign in to continue.",
    });
  return sub;
}

/** A stable, well-formed UUID for a person with no VOICES profile yet (nothing is stored for them). */
function virtualId(sub: string): string {
  const h = createHash("sha256").update(`voices-virtual:${sub}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The Lagos calendar day as a UTC-midnight date (UsageCounter.day). */
export function lagosDay(now = new Date()): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${s}T00:00:00Z`);
}

function fieldError(
  path: string,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: "VALIDATION_FAILED",
    message: "Some details need fixing.",
    details: { fields: [{ path, message }] },
  });
}

type UserWithAll = Prisma.UserGetPayload<{
  include: { roles: true; settings: true };
}>;

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MeConfig,
    private readonly views: Views,
  ) {
    phonePepper(); // refuses to boot in production without VOICES_PHONE_PEPPER
  }

  // ------------------------------------------------------------ who is calling

  /** The person for a verified token, or null before POST /me. Refreshes the phone hash when the claim changed. */
  async loadCurrent(token: VoicesUser): Promise<CurrentMeInfo | null> {
    const sub = subOf(token);
    const user = await this.prisma.user.findUnique({
      where: { wawuId: sub },
      include: { roles: true },
    });
    if (!user || user.status === AccountStatus.DELETED) return null;
    await this.refreshPhoneHash(user, token);
    const status = (await this.cancelDeletionIfFresh(user, token)).status;
    return {
      id: user.id,
      wawuId: user.wawuId,
      handle: user.handle,
      status,
      suspendedUntil: user.suspendedUntil,
      roles: user.roles.map((r) => r.role),
      token: { sub, iat: token.iat, phone: token.phone },
    };
  }

  private async refreshPhoneHash(
    user: { id: string; phoneHash: string | null },
    token: VoicesUser,
  ): Promise<void> {
    const h = phoneHashOf(
      token.phone,
      (token as { country?: unknown }).country,
    );
    if (!h || h === user.phoneHash) return;
    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneHash: h },
      });
      user.phoneHash = h;
    } catch (e) {
      // The new number already belongs to another account: keep the old hash, one account per phone.
      this.logger.warn(
        `phone hash refresh refused for ${user.id}: ${String(e)}`,
      );
    }
  }

  /** 403 ACCOUNT_SUSPENDED for a suspended, banned or deleting account (reads stay open). */
  assertCanWrite(me: CurrentMeInfo, now = new Date()): void {
    const s = me.status;
    if (s === AccountStatus.ACTIVE) return;
    if (
      s === AccountStatus.SUSPENDED &&
      me.suspendedUntil &&
      me.suspendedUntil <= now
    )
      return;
    throw new ForbiddenException({
      code: "ACCOUNT_SUSPENDED",
      message:
        s === AccountStatus.DELETION_PENDING
          ? "This account is being deleted. Sign in again to keep it."
          : "This account cannot post right now.",
      details: {
        until: me.suspendedUntil ? me.suspendedUntil.toISOString() : null,
        status: s,
      },
    });
  }

  // ------------------------------------------------------------ GET /me, POST /me

  async getMe(token: VoicesUser): Promise<Record<string, unknown>> {
    const sub = subOf(token);
    let user = await this.findAll(sub);
    if (!user || user.status === AccountStatus.DELETED)
      return this.virtualMe(token, sub);
    await this.refreshPhoneHash(user, token);
    user = await this.cancelDeletionIfFresh(user, token);
    return this.meView(user, token);
  }

  private findAll(sub: string): Promise<UserWithAll | null> {
    return this.prisma.user.findUnique({
      where: { wawuId: sub },
      include: { roles: true, settings: true },
    });
  }

  /** Signing in again cancels a pending deletion: a token issued after the request is a fresh sign-in. */
  async cancelDeletionIfFresh<
    T extends {
      id: string;
      status: AccountStatus;
      deletionRequestedAt: Date | null;
    },
  >(user: T, token: VoicesUser): Promise<T> {
    if (
      user.status !== AccountStatus.DELETION_PENDING ||
      !user.deletionRequestedAt ||
      typeof token.iat !== "number" ||
      token.iat * 1000 <= user.deletionRequestedAt.getTime()
    )
      return user;
    await this.prisma.user.updateMany({
      where: { id: user.id, status: AccountStatus.DELETION_PENDING },
      data: { status: AccountStatus.ACTIVE, deletionRequestedAt: null },
    });
    return { ...user, status: AccountStatus.ACTIVE, deletionRequestedAt: null };
  }

  private async virtualMe(
    token: VoicesUser,
    sub: string,
  ): Promise<Record<string, unknown>> {
    const cfg = await this.config.numbers();
    return {
      phoneMasked: maskPhone(token.phone),
      id: virtualId(sub),
      wawuId: sub,
      handle: null,
      profileComplete: false,
      savedCount: 0,
      replyCount: 0,
      reactionsReceived: 0,
      roles: [],
      profile: null,
      allowances: this.allowanceView(cfg, {
        freePosts: cfg["allowance.free_posts"],
        balanceMilli: 0,
        reactionsUsed: 0,
        votesUsed: 0,
        tokens: [],
      }),
      unreadNotifications: 0,
      settings: { ...DEFAULT_SETTINGS },
      referralCode: "",
      status: "ACTIVE",
    };
  }

  private async meView(
    user: UserWithAll,
    token: VoicesUser,
  ): Promise<Record<string, unknown>> {
    const [profiles, allowances, unread] = await Promise.all([
      this.views.profiles([user.id]),
      this.allowances(user.id),
      this.prisma.notification.count({
        where: { userId: user.id, readAt: null },
      }),
    ]);
    return {
      phoneMasked: maskPhone(token.phone),
      id: user.id,
      wawuId: user.wawuId,
      handle: user.handle,
      profileComplete: true,
      savedCount: user.savedCount,
      replyCount: user.replyCount,
      reactionsReceived: user.reactionsReceived,
      roles: user.roles.map((r) => r.role),
      profile: profiles.get(user.id) ?? null,
      allowances,
      unreadNotifications: unread,
      settings: this.settingsView(user.settings),
      referralCode: user.referralCode,
      status: user.status,
    };
  }

  async createMe(
    token: VoicesUser,
    dto: CreateMeDto,
  ): Promise<Record<string, unknown>> {
    const sub = subOf(token);
    const handle = assertHandleShape(dto.handle);
    const existing = await this.findAll(sub);
    if (existing && existing.status !== AccountStatus.DELETED)
      return this.replay(existing, token, handle);

    if (!dto.ageConfirmed)
      throw new ForbiddenException({
        code: "AGE_CONFIRMATION_REQUIRED",
        message: "You must confirm you are 18 or older.",
      });
    if (!dto.termsAccepted)
      throw fieldError("termsAccepted", "Accept the terms to continue.");
    if (!dto.rulesAccepted)
      throw fieldError("rulesAccepted", "Accept the rules to continue.");
    const country = dto.countryCode.toUpperCase();
    if (!COUNTRY_CODES.includes(country))
      throw fieldError("countryCode", "Pick a country from the list.");
    const categoryIds = [...new Set(dto.categoryIds)];
    if (categoryIds.length < 3)
      throw new BadRequestException({
        code: "MIN_TOPICS",
        message: "Pick at least 3 topics.",
      });
    await this.assertCategories(categoryIds);

    const phoneHash = phoneHashOf(
      token.phone,
      (token as { country?: unknown }).country,
    );
    if (phoneHash) {
      const owner = await this.prisma.user.findUnique({
        where: { phoneHash },
        select: { id: true },
      });
      if (owner)
        throw new ConflictException({
          code: "CONFLICT",
          message: "That phone number already has a VOICES account.",
          details: { reason: "PHONE_IN_USE" },
        });
    }
    if (
      await this.prisma.user.findUnique({
        where: { handle },
        select: { id: true },
      })
    )
      throw this.handleTaken();

    const cfg = await this.config.numbers();
    const referrer = dto.referralCode
      ? await this.prisma.user.findUnique({
          where: { referralCode: dto.referralCode.trim().toUpperCase() },
          select: { id: true },
        })
      : null;
    const now = new Date();

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const user = await this.prisma.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: {
              wawuId: sub,
              phoneHash,
              handle,
              countryCode: country,
              languages: dto.languages,
              ageConfirmedAt: now,
              termsAcceptedAt: now,
              rulesAcceptedAt: now,
              referralCode: this.newReferralCode(),
              referredByUserId: referrer?.id ?? null,
              settings: { create: {} },
              wallet: { create: {} },
              allowance: {
                create: { freePostsRemaining: cfg["allowance.free_posts"] },
              },
              categories: {
                create: categoryIds.map((categoryId) => ({ categoryId })),
              },
              tagFollows: { create: [{ tag: "VERIFIED_NEWS" }] },
            },
          });
          if (referrer)
            await tx.referral.create({
              data: { referrerId: referrer.id, referredId: u.id },
            });
          return u;
        });
        const full = (await this.findAll(user.wawuId)) as UserWithAll;
        return this.meView(full, token);
      } catch (e) {
        if (!isUnique(e)) throw e;
        // Lost a race. Work out which key it was by looking, not by parsing the driver's message.
        const again = await this.findAll(sub);
        if (again) return this.replay(again, token, handle);
        if (
          await this.prisma.user.findUnique({
            where: { handle },
            select: { id: true },
          })
        )
          throw this.handleTaken();
        if (
          phoneHash &&
          (await this.prisma.user.findUnique({
            where: { phoneHash },
            select: { id: true },
          }))
        )
          throw new ConflictException({
            code: "CONFLICT",
            message: "That phone number already has a VOICES account.",
            details: { reason: "PHONE_IN_USE" },
          });
        // otherwise the referral code collided: try again with a new one
      }
    }
    throw new ConflictException({
      code: "CONFLICT",
      message: "Try again in a moment.",
    });
  }

  /** A second POST /me: the same Me, never an overwrite (a different handle is a 409: use PATCH /me/profile). */
  private async replay(
    user: UserWithAll,
    token: VoicesUser,
    handle: string,
  ): Promise<Record<string, unknown>> {
    if (user.handle !== handle)
      throw new ConflictException({
        code: "CONFLICT",
        message: "You already have a profile. Edit it from your profile page.",
        details: { reason: "PROFILE_EXISTS" },
      });
    await this.refreshPhoneHash(user, token);
    const fresh = await this.cancelDeletionIfFresh(user, token);
    return this.meView(fresh, token);
  }

  private handleTaken(): ConflictException {
    return new ConflictException({
      code: "HANDLE_TAKEN",
      message: HANDLE_MESSAGES.TAKEN,
    });
  }

  private newReferralCode(): string {
    let s = "";
    for (let i = 0; i < 8; i++)
      s += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
    return s;
  }

  private async assertCategories(ids: string[]): Promise<void> {
    const n = await this.prisma.category.count({
      where: { id: { in: ids }, active: true },
    });
    if (n !== ids.length)
      throw fieldError("categoryIds", "One of those topics is not available.");
  }

  // ------------------------------------------------------------ handle check

  async checkHandle(token: VoicesUser, raw: unknown) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 64)
      throw fieldError("handle", "Enter a handle to check.");
    const handle = normaliseHandle(raw);
    const problem = handleProblem(handle);
    if (problem) return { handle, available: false, reason: problem };
    const owner = await this.prisma.user.findUnique({
      where: { handle },
      select: { wawuId: true },
    });
    if (owner && owner.wawuId !== subOf(token))
      return { handle, available: false, reason: "TAKEN" };
    return { handle, available: true };
  }

  // ------------------------------------------------------------ profile

  async updateProfile(me: CurrentMeInfo, dto: UpdateProfileDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.displayName !== undefined)
      data.displayName = dto.displayName?.trim() || null;
    if (dto.bio !== undefined) data.bio = dto.bio?.trim() || null;
    if (dto.state !== undefined) data.state = dto.state?.trim() || null;
    if (dto.city !== undefined) data.city = dto.city?.trim() || null;
    if (dto.languages !== undefined) data.languages = dto.languages;
    if (dto.countryCode !== undefined) {
      const c = dto.countryCode.toUpperCase();
      if (!COUNTRY_CODES.includes(c))
        throw fieldError("countryCode", "Pick a country from the list.");
      data.countryCode = c;
    }
    if (dto.handle !== undefined) {
      const handle = assertHandleShape(dto.handle);
      if (handle !== me.handle) {
        if (
          await this.prisma.user.findUnique({
            where: { handle },
            select: { id: true },
          })
        )
          throw this.handleTaken();
        data.handle = handle;
      }
    }
    if (dto.avatarFileId !== undefined) {
      if (dto.avatarFileId === null) data.avatarFileId = null;
      else {
        // Only my own, finished avatar upload: another person's file id is refused.
        const f = await this.prisma.storedFile.findFirst({
          where: {
            id: dto.avatarFileId,
            ownerId: me.id,
            kind: "AVATAR",
            confirmedAt: { not: null },
          },
          select: { id: true },
        });
        if (!f)
          throw fieldError("avatarFileId", "That picture is not available.");
        data.avatarFileId = f.id;
      }
    }
    if (dto.voiceCardClipId !== undefined) {
      if (dto.voiceCardClipId === null) data.voiceCardClipId = null;
      else {
        const cfg = await this.config.numbers();
        const clip = await this.prisma.voiceClip.findFirst({
          where: {
            id: dto.voiceCardClipId,
            ownerId: me.id,
            purpose: "VOICE_CARD",
            status: "READY",
          },
          select: { id: true, durationMs: true },
        });
        if (!clip)
          throw fieldError(
            "voiceCardClipId",
            "That voice recording is not available.",
          );
        if (
          clip.durationMs !== null &&
          clip.durationMs > cfg["profile.voice_card_seconds"] * 1000 + 500
        )
          throw fieldError(
            "voiceCardClipId",
            "A voice card can be at most 10 seconds.",
          );
        data.voiceCardClipId = clip.id;
      }
    }
    try {
      await this.prisma.user.update({ where: { id: me.id }, data });
    } catch (e) {
      if (isUnique(e)) {
        // handle race, or a voice card clip already used by another profile
        const clash = dto.handle
          ? await this.prisma.user.findUnique({
              where: { handle: normaliseHandle(dto.handle) },
              select: { id: true },
            })
          : null;
        if (clash && clash.id !== me.id) throw this.handleTaken();
        throw fieldError(
          "voiceCardClipId",
          "That voice recording is already in use.",
        );
      }
      throw e;
    }
    const p = (await this.views.profiles([me.id])).get(me.id);
    if (!p) throw new NotFoundException();
    return p;
  }

  // ------------------------------------------------------------ settings, categories, tags

  settingsView(s: Record<string, unknown> | null) {
    if (!s) return { ...DEFAULT_SETTINGS };
    return {
      language: s.language,
      dataSaver: s.dataSaver,
      theme: s.theme,
      timezone: s.timezone,
      quietHoursStart: s.quietHoursStart,
      quietHoursEnd: s.quietHoursEnd,
      notifyDailyQuestion: s.notifyDailyQuestion,
      notifyReplies: s.notifyReplies,
      notifyReactions: s.notifyReactions,
      notifyPollResults: s.notifyPollResults,
      notifyFlashPolls: s.notifyFlashPolls,
      notifyCategoryAlerts: s.notifyCategoryAlerts,
      dailyQuestionMinute: s.dailyQuestionMinute,
    };
  }

  async getSettings(me: CurrentMeInfo) {
    const s = await this.prisma.userSettings.upsert({
      where: { userId: me.id },
      create: { userId: me.id },
      update: {},
    });
    return this.settingsView(s);
  }

  async updateSettings(me: CurrentMeInfo, dto: UpdateSettingsDto) {
    if (dto.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: dto.timezone });
      } catch {
        throw fieldError("timezone", "That time zone is not recognised.");
      }
    }
    const s = await this.prisma.userSettings.upsert({
      where: { userId: me.id },
      create: { userId: me.id, ...dto },
      update: { ...dto },
    });
    return this.settingsView(s);
  }

  async getCategories(me: CurrentMeInfo) {
    const rows = await this.prisma.userCategory.findMany({
      where: { userId: me.id },
      orderBy: [{ createdAt: "asc" }, { categoryId: "asc" }],
    });
    return {
      categories: rows.map((r) => ({
        categoryId: r.categoryId,
        alertsOn: r.alertsOn,
      })),
    };
  }

  async setCategories(me: CurrentMeInfo, dto: SetCategoriesDto) {
    const byId = new Map(dto.categories.map((c) => [c.categoryId, c.alertsOn]));
    const ids = [...byId.keys()];
    if (ids.length < 3)
      throw new BadRequestException({
        code: "MIN_TOPICS",
        message: "Pick at least 3 topics.",
      });
    await this.assertCategories(ids);
    await this.prisma.$transaction(async (tx) => {
      await tx.userCategory.deleteMany({
        where: { userId: me.id, categoryId: { notIn: ids } },
      });
      for (const [categoryId, alertsOn] of byId)
        await tx.userCategory.upsert({
          where: { userId_categoryId: { userId: me.id, categoryId } },
          create: { userId: me.id, categoryId, alertsOn },
          update: { alertsOn },
        });
    });
    return this.getCategories(me);
  }

  async setTagFollows(me: CurrentMeInfo, dto: SetTagFollowsDto) {
    // Verified News is always followed: the server keeps it in the list.
    const tags = [
      ...new Set(["VERIFIED_NEWS", ...dto.tags]),
    ] as SetTagFollowsDto["tags"];
    await this.prisma.$transaction([
      this.prisma.newsTagFollow.deleteMany({
        where: { userId: me.id, tag: { notIn: tags } },
      }),
      ...tags.map((tag) =>
        this.prisma.newsTagFollow.upsert({
          where: { userId_tag: { userId: me.id, tag } },
          create: { userId: me.id, tag },
          update: {},
        }),
      ),
    ]);
    return { tags };
  }

  // ------------------------------------------------------------ allowances

  private async allowances(userId: string) {
    const [cfg, allowance, wallet, usage, tokens] = await Promise.all([
      this.config.numbers(),
      this.prisma.freeAllowance.findUnique({ where: { userId } }),
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.usageCounter.findMany({
        where: { userId, day: lagosDay() },
      }),
      this.prisma.extraVoiceToken.findMany({
        where: { userId, status: { in: ["AVAILABLE", "RESERVED"] } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ]);
    const used = (a: string) => usage.find((u) => u.action === a)?.used ?? 0;
    return this.allowanceView(cfg, {
      freePosts: allowance?.freePostsRemaining ?? 0,
      balanceMilli: wallet?.balanceMilli ?? 0,
      reactionsUsed: used("REACTION"),
      votesUsed: used("VOTE"),
      tokens,
    });
  }

  allowanceView(
    cfg: Record<string, number>,
    a: {
      freePosts: number;
      balanceMilli: number;
      reactionsUsed: number;
      votesUsed: number;
      tokens: {
        id: string;
        kind: string;
        maxSeconds: number;
        status: string;
        createdAt: Date;
      }[];
    },
  ) {
    const usable = a.tokens.filter((t) => t.status === "AVAILABLE");
    return {
      freePostsRemaining: a.freePosts,
      balanceMilli: a.balanceMilli,
      maxVoiceSeconds: Math.max(
        cfg["voice.free_seconds"],
        ...usable.map((t) => t.maxSeconds),
      ),
      freeReactionsLeftToday: Math.max(
        0,
        cfg["allowance.free_reactions_per_day"] - a.reactionsUsed,
      ),
      freeVotesLeftToday: Math.max(
        0,
        cfg["allowance.free_votes_per_day"] - a.votesUsed,
      ),
      costs: {
        freeReactionsPerDay: cfg["allowance.free_reactions_per_day"],
        freeVotesPerDay: cfg["allowance.free_votes_per_day"],
        baseKoboPerUnit: cfg["units.base_rate_kobo"],
        textPostMilli: cfg["cost.text_post_milli"],
        voicePostMilli: cfg["cost.voice_post_milli"],
        reactionAfterFreeMilli: cfg["cost.reaction_milli"],
        voteAfterFreeMilli: cfg["cost.vote_milli"],
        minPackKobo: cfg["units.min_purchase_kobo"],
        extraVoice30Kobo: cfg["voice.extra30.price_kobo"],
        extraVoice60Kobo: cfg["voice.extra60.price_kobo"],
        textMaxChars: cfg["text.max_chars"],
        freeVoiceSeconds: cfg["voice.free_seconds"],
      },
      extraVoiceTokens: a.tokens.map((t) => ({
        id: t.id,
        kind: t.kind,
        maxSeconds: t.maxSeconds,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  async getAllowance(me: CurrentMeInfo, action: unknown) {
    if (
      action !== undefined &&
      !["POST_TEXT", "POST_VOICE", "REACTION", "VOTE"].includes(
        typeof action === "string" ? action : "",
      )
    )
      throw fieldError(
        "action",
        "Use POST_TEXT, POST_VOICE, REACTION or VOTE.",
      );
    return this.allowances(me.id);
  }

  // ------------------------------------------------------------ roles used by staff checks

  async rolesOf(userId: string): Promise<VoicesRole[]> {
    const rows = await this.prisma.userRoleGrant.findMany({
      where: { userId },
      select: { role: true },
    });
    return rows.map((r) => r.role);
  }
}

export function isUnique(e: unknown): boolean {
  const c = e as { code?: unknown } | null;
  return !!c && typeof c === "object" && c.code === "P2002";
}
