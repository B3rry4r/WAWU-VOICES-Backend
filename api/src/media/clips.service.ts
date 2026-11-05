import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  MAX_SECONDS,
  RAW_MAX_BYTES,
  type VoiceTier,
} from "../audio-ref/limits";
import { processClip } from "../audio-ref/pipeline.js";
import { isAllowedAudioType } from "../audio-ref/spaces";
import { ConfigReader } from "../talk/shared/config-reader";
import { UnitsAccess } from "../talk/shared/units-access";
import type { Profile } from "../talk/shared/profile.service";
import type {
  Transcript,
  VoiceClip,
  VoiceClipPurpose,
} from "../generated/prisma/client";
import { MEDIA_STORE, type ObjectStore } from "./object-store";
import { MediaJobs } from "./media-jobs";

export type ClipRow = VoiceClip & { transcript: Transcript | null };

export interface ClipView {
  id: string;
  status: VoiceClip["status"];
  durationMs: number | null;
  maxDurationMs: number;
  peaks: number[] | null;
  transcript: {
    status: Transcript["status"];
    language: string | null;
    text: string | null;
  } | null;
}

export function clipView(c: ClipRow): ClipView {
  return {
    id: c.id,
    status: c.status,
    durationMs: c.durationMs,
    maxDurationMs: c.maxDurationMs,
    peaks: (c.peaks as number[] | null) ?? null,
    transcript: c.transcript
      ? {
          status: c.transcript.status,
          language: c.transcript.language,
          text: c.transcript.text,
        }
      : null,
  };
}

const TIER_BY_MS: Record<number, VoiceTier> = {
  10_000: "free",
  30_000: "voice30",
  60_000: "voice60",
};

export function tierOf(maxDurationMs: number): VoiceTier {
  return (
    TIER_BY_MS[maxDurationMs] ??
    (maxDurationMs <= 10_000
      ? "free"
      : maxDurationMs <= 30_000
        ? "voice30"
        : "voice60")
  );
}

const notFound = () =>
  new NotFoundException({
    code: "CLIP_NOT_FOUND",
    message: "We could not find that recording.",
  });

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigReader,
    private readonly units: UnitsAccess,
    private readonly jobs: MediaJobs,
    @Inject(MEDIA_STORE) private readonly store: ObjectStore | null,
  ) {}

  private needStore(): ObjectStore {
    if (!this.store)
      throw new HttpException(
        {
          code: "UNAVAILABLE",
          message: "VOICES is not available right now. Try again soon.",
        },
        503,
      );
    return this.store;
  }

  /** POST /voice-clips: the server checks type, bytes and the declared length before it signs anything. */
  async create(
    me: Profile,
    dto: {
      purpose: VoiceClipPurpose;
      mime: string;
      sizeBytes: number;
      durationMs: number;
      extraVoiceTokenId?: string;
    },
  ) {
    const store = this.needStore();
    if (!isAllowedAudioType(dto.mime))
      throw new HttpException(
        {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "That file type is not supported.",
        },
        415,
      );
    if (!(dto.durationMs >= 300))
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            { path: "durationMs", message: "The recording is too short." },
          ],
        },
      });
    const freeSeconds = await this.config.num("voice.free_seconds");
    let maxMs = freeSeconds * 1000;
    let token: { id: string; maxSeconds: number } | null = null;
    if (dto.extraVoiceTokenId) {
      // A read only: every change to a token goes through UNITS_PORT.
      const t = await this.prisma.extraVoiceToken.findFirst({
        where: { id: dto.extraVoiceTokenId, userId: me.id },
      });
      if (!t)
        throw new NotFoundException({
          code: "NOT_FOUND",
          message: "We could not find that voice token.",
        });
      if (t.status !== "AVAILABLE")
        throw new ConflictException({
          code: "CONFLICT",
          message: "That voice token is already in use.",
        });
      token = t;
      maxMs = t.maxSeconds * 1000;
    }
    const tier = tierOf(maxMs);
    const overallMax = MAX_SECONDS.voice60 * 1000;
    if (dto.durationMs > overallMax + 500 || dto.durationMs > maxMs + 500) {
      if (!token && dto.durationMs <= overallMax + 500) {
        const bal = await this.units
          .freeLeft(me.id, "POST_VOICE")
          .catch(() => null);
        throw new HttpException(
          {
            code: "EXTRA_VOICE_REQUIRED",
            message: "A longer voice needs an extra voice token.",
            details: {
              costMilli: 0,
              balanceMilli: bal?.balanceMilli ?? 0,
              minPackKobo: await this.config.num("units.min_purchase_kobo"),
              needSeconds: Math.ceil(dto.durationMs / 1000),
            },
          },
          402,
        );
      }
      throw new UnprocessableEntityException({
        code: "VOICE_TOO_LONG",
        message: "That recording is too long.",
        details: { maxSeconds: Math.floor(maxMs / 1000) },
      });
    }
    if (!Number.isInteger(dto.sizeBytes) || dto.sizeBytes <= 0)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            {
              path: "sizeBytes",
              message: "Send the size of the recording in bytes.",
            },
          ],
        },
      });
    if (dto.sizeBytes > RAW_MAX_BYTES[tier])
      throw new PayloadTooLargeException({
        code: "PAYLOAD_TOO_LARGE",
        message: "That recording is too large to send.",
      });

    const put = await store.presignPut("raw", dto.mime, dto.sizeBytes);
    let clip = await this.prisma.voiceClip.create({
      data: {
        ownerId: me.id,
        purpose: dto.purpose,
        rawKey: put.key,
        rawMime: dto.mime,
        rawBytes: dto.sizeBytes,
        maxDurationMs: maxMs,
        durationMs: null,
      },
      include: { transcript: true },
    });
    if (token) {
      try {
        await this.units.reserveToken(me.id, token.id, clip.id);
        // an older clip that still points at this token lost it (released or swept): it no longer holds it
        await this.prisma.voiceClip.updateMany({
          where: { extraTokenId: token.id, id: { not: clip.id } },
          data: { extraTokenId: null },
        });
        clip = await this.prisma.voiceClip.update({
          where: { id: clip.id },
          data: { extraTokenId: token.id },
          include: { transcript: true },
        });
      } catch (e) {
        await this.units
          .releaseToken(me.id, token.id, clip.id)
          .catch(() => undefined);
        await this.prisma.voiceClip
          .delete({ where: { id: clip.id } })
          .catch(() => undefined);
        throw e;
      }
    }
    return {
      clip: clipView(clip),
      putUrl: put.url,
      putHeaders: put.headers,
      expiresAt: put.expiresAt.toISOString(),
    };
  }

  private async ownClip(me: Profile, id: string): Promise<ClipRow> {
    const c = await this.prisma.voiceClip.findFirst({
      where: { id, ownerId: me.id },
      include: { transcript: true },
    });
    if (!c) throw notFound();
    return c;
  }

  /** POST /voice-clips/:id/complete: the object must be there and the size must match what was signed. */
  async complete(me: Profile, id: string): Promise<ClipView> {
    const store = this.needStore();
    const clip = await this.ownClip(me, id);
    if (
      clip.status === "UPLOADED" ||
      clip.status === "PROCESSING" ||
      clip.status === "READY"
    )
      return clipView(clip);
    if (clip.status !== "PENDING_UPLOAD")
      throw new ConflictException({
        code: "CONFLICT",
        message: "That recording can no longer be used.",
      });
    const size = await store.head(clip.rawKey);
    if (size === null)
      throw new ConflictException({
        code: "UPLOAD_NOT_RECEIVED",
        message: "We have not received your recording yet.",
      });
    const tier = tierOf(clip.maxDurationMs);
    if (size > RAW_MAX_BYTES[tier] || size !== clip.rawBytes) {
      await this.fail(
        clip,
        size > RAW_MAX_BYTES[tier] ? "too_large" : "size_mismatch",
      );
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "That recording could not be accepted.",
        details: {
          fields: [
            {
              path: "clipId",
              message: "The uploaded file is not the size that was signed.",
            },
          ],
        },
      });
    }
    const got = await this.prisma.voiceClip.updateMany({
      where: { id: clip.id, status: "PENDING_UPLOAD" },
      data: { status: "UPLOADED", uploadedAt: new Date(), rawBytes: size },
    });
    if (got.count === 1) {
      await this.prisma.transcript.upsert({
        where: { clipId: clip.id },
        create: { clipId: clip.id, status: "PENDING" },
        update: {},
      });
      this.jobs.enqueue(clip.id);
    }
    return clipView(await this.ownClip(me, id));
  }

  /** The queued job: normalise, measure, peaks, store, delete the raw. Never silently truncates. */
  async process(clipId: string): Promise<void> {
    const store = this.needStore();
    const claimed = await this.prisma.voiceClip.updateMany({
      where: { id: clipId, status: "UPLOADED" },
      data: { status: "PROCESSING", processingStartedAt: new Date() },
    });
    if (claimed.count !== 1) return;
    const clip = await this.prisma.voiceClip.findUniqueOrThrow({
      where: { id: clipId },
    });
    try {
      const raw = await store.get(clip.rawKey);
      const out = await processClip(raw, tierOf(clip.maxDurationMs));
      const playKey = await store.putPlay(out.audio);
      await this.prisma.voiceClip.update({
        where: { id: clip.id },
        data: {
          status: "READY",
          playKey,
          playMime: "audio/mp4",
          durationMs: Math.round(out.durationSeconds * 1000),
          peaks: out.peaks,
          readyAt: new Date(),
        },
      });
      await store.delete(clip.rawKey).catch(() => undefined);
    } catch (e) {
      const known = ["too_large", "too_long", "not_audio"];
      const msg = e instanceof Error ? e.message : "processing_error";
      this.logger.warn(`clip ${clip.id} failed: ${msg}`);
      await this.fail(clip, known.includes(msg) ? msg : "processing_error");
    }
  }

  /** FAILED: release the voice token and drop the raw file. */
  private async fail(clip: VoiceClip, reason: string): Promise<void> {
    await this.prisma.voiceClip.update({
      where: { id: clip.id },
      data: { status: "FAILED", failureReason: reason },
    });
    await this.releaseToken(clip.id);
    await this.store?.delete(clip.rawKey).catch(() => undefined);
    await this.prisma.transcript.deleteMany({ where: { clipId: clip.id } });
  }

  /** A token held for a clip goes back to AVAILABLE (a failed or discarded clip). A USED token stays used. */
  async releaseToken(clipId: string): Promise<void> {
    const clip = await this.prisma.voiceClip.findUnique({
      where: { id: clipId },
    });
    if (!clip?.extraTokenId) return;
    await this.units.releaseToken(clip.ownerId, clip.extraTokenId, clip.id);
    await this.prisma.voiceClip.update({
      where: { id: clip.id },
      data: { extraTokenId: null },
    });
  }

  /** The post is committed: the reserved token becomes USED (through UNITS_PORT). */
  async consumeToken(clip: {
    id: string;
    ownerId: string;
    extraTokenId: string | null;
  }): Promise<void> {
    if (!clip.extraTokenId) return;
    try {
      await this.units.consumeToken(clip.ownerId, clip.extraTokenId, clip.id);
    } catch (e) {
      this.logger.error(
        `token ${clip.extraTokenId} not consumed for clip ${clip.id}: ${String(e)}`,
      );
    }
  }

  /** Is this clip attached to something people can see, or is it the viewer's own? */
  private async visible(c: ClipRow, viewerId: string | null): Promise<boolean> {
    if (viewerId && c.ownerId === viewerId) return true;
    const [a, r, p, u] = await Promise.all([
      this.prisma.answer.findFirst({
        where: { clipId: c.id, status: "PUBLISHED" },
        select: { id: true },
      }),
      this.prisma.reply.findFirst({
        where: { clipId: c.id, status: "PUBLISHED" },
        select: { id: true },
      }),
      this.prisma.proposal.findFirst({
        where: { clipId: c.id, status: "PUBLISHED" },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: { voiceCardClipId: c.id, status: "ACTIVE" },
        select: { id: true },
      }),
    ]);
    return !!(a || r || p || u);
  }

  async get(clipId: string, viewerId: string | null): Promise<ClipView> {
    const c = await this.prisma.voiceClip.findUnique({
      where: { id: clipId },
      include: { transcript: true },
    });
    if (!c || c.status === "REMOVED" || !(await this.visible(c, viewerId)))
      throw notFound();
    return clipView(c);
  }

  async playUrl(clipId: string, viewerId: string | null) {
    const store = this.needStore();
    const c = await this.prisma.voiceClip.findUnique({
      where: { id: clipId },
      include: { transcript: true },
    });
    if (!c || c.status === "REMOVED" || !(await this.visible(c, viewerId)))
      throw notFound();
    if (c.status !== "READY" || !c.playKey)
      throw new ConflictException({
        code: "CLIP_NOT_READY",
        message: "That recording is not ready yet.",
      });
    const s = await store.signedGet(c.playKey);
    return {
      url: s.url,
      expiresAt: s.expiresAt.toISOString(),
      mime: c.playMime ?? "audio/mp4",
    };
  }

  /** DELETE /voice-clips/:id: a recording that is not on a post. */
  async remove(me: Profile, clipId: string): Promise<void> {
    const c = await this.ownClip(me, clipId);
    if (c.status === "REMOVED") return;
    const [a, r, p] = await Promise.all([
      this.prisma.answer.findFirst({
        where: { clipId: c.id, status: { not: "DELETED_BY_AUTHOR" } },
        select: { id: true },
      }),
      this.prisma.reply.findFirst({
        where: { clipId: c.id, status: { not: "DELETED_BY_AUTHOR" } },
        select: { id: true },
      }),
      this.prisma.proposal.findFirst({
        where: { clipId: c.id },
        select: { id: true },
      }),
    ]);
    if (a || r || p)
      throw new ConflictException({
        code: "CONFLICT",
        message: "That recording is on a post. Delete the post instead.",
      });
    await this.releaseToken(c.id);
    await this.discard(c);
  }

  /** Mark REMOVED and delete both stored objects (best effort). Used for deleted posts too. */
  async discard(c: VoiceClip): Promise<void> {
    await this.prisma.voiceClip.update({
      where: { id: c.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    for (const key of [c.rawKey, c.playKey]) {
      if (key) await this.store?.delete(key).catch(() => undefined);
    }
  }

  /** Checks a clip can go on a post: yours, READY, right purpose, not on another post. */
  async forPublish(
    me: Profile,
    clipId: string,
    purpose: VoiceClipPurpose,
  ): Promise<ClipRow> {
    const c = await this.prisma.voiceClip.findFirst({
      where: { id: clipId, ownerId: me.id },
      include: { transcript: true },
    });
    if (!c || c.status === "REMOVED") throw notFound();
    if (c.status !== "READY")
      throw new ConflictException({
        code: "CLIP_NOT_READY",
        message: "Your recording is not ready yet.",
      });
    // A clip longer than the free length must still hold its paid token (a swept or released one is gone).
    const freeMs = (await this.config.num("voice.free_seconds")) * 1000;
    if (c.maxDurationMs > freeMs) {
      const held = c.extraTokenId
        ? await this.prisma.extraVoiceToken.findFirst({
            where: {
              id: c.extraTokenId,
              userId: me.id,
              status: "RESERVED",
              usedOnClipId: c.id,
            },
            select: { id: true },
          })
        : null;
      if (!held)
        throw new ConflictException({
          code: "CONFLICT",
          message:
            "The extra voice token for this recording is no longer held. Record again.",
        });
    }
    if (c.purpose !== purpose)
      throw new UnprocessableEntityException({
        code: "VALIDATION_FAILED",
        message: "Some details need fixing.",
        details: {
          fields: [
            {
              path: "clipId",
              message: "That recording was made for something else.",
            },
          ],
        },
      });
    return c;
  }
}
