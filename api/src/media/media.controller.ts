import {
  Logger,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { PrismaService } from "../common/prisma/prisma.service";
import { ConfigReader } from "../talk/shared/config-reader";
import { ProfileService } from "../talk/shared/profile.service";
import { RateLimit, RateLimitGuard } from "../talk/shared/rate-limit";
import { UuidParam } from "../talk/shared/uuid-pipe";
import { ClipsService } from "./clips.service";
import { MEDIA_STORE, publishPhoto, type ObjectStore } from "./object-store";
import {
  HttpException,
  PayloadTooLargeException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { FileKind, VoiceClipPurpose } from "../generated/prisma/client";

const PURPOSES = [
  "ANSWER",
  "REPLY",
  "PROPOSAL",
  "VOTE_EXPLANATION",
  "VOICE_CARD",
  "OVERRIDE_NOTE",
  "AD_AUDIO",
  "DM",
];

class CreateVoiceClipDto {
  @IsIn(PURPOSES) purpose!: VoiceClipPurpose;
  @IsString() mime!: string;
  @IsInt() @Min(1) sizeBytes!: number;
  @IsInt() @Min(1) durationMs!: number;
  @IsOptional() @IsUUID() extraVoiceTokenId?: string;
}

class CreateUploadDto {
  @IsIn(["AVATAR", "RESULT_PHOTO", "OVERRIDE_IMAGE", "AD_CREATIVE"])
  kind!: FileKind;
  @IsString() mime!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];

@Controller()
export class MediaController {
  private readonly logger = new Logger(MediaController.name);
  constructor(
    private readonly clips: ClipsService,
    private readonly profiles: ProfileService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigReader,
    @Inject(MEDIA_STORE) private readonly store: ObjectStore | null,
  ) {}

  @Post("voice-clips")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("voiceUpload")
  async create(
    @CurrentUser() u: MaybeVoicesUser,
    @Body() dto: CreateVoiceClipDto,
  ) {
    const me = await this.profiles.requireWriter(u);
    // V-FIX-B: the team's recordings follow the same role rule as the team's pictures (POST /uploads).
    const team: Partial<Record<VoiceClipPurpose, "EDITOR" | "AD_MANAGER">> = {
      OVERRIDE_NOTE: "EDITOR",
      AD_AUDIO: "AD_MANAGER",
    };
    const need = team[dto.purpose];
    if (need && !this.profiles.hasRole(me, need))
      throw new ForbiddenException({
        code: "ROLE_REQUIRED",
        message: "Your role cannot do that.",
      });
    return this.clips.create(me, dto);
  }

  @Post("voice-clips/:clipId/complete")
  @HttpCode(202)
  @UseGuards(WawuAuthGuard)
  async complete(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("clipId", UuidParam) id: string,
  ) {
    const me = await this.profiles.requireWriter(u);
    return this.clips.complete(me, id);
  }

  @Get("voice-clips/:clipId")
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async get(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("clipId", UuidParam) id: string,
  ) {
    const me = await this.profiles.optional(u);
    return this.clips.get(id, me?.id ?? null);
  }

  @Delete("voice-clips/:clipId")
  @HttpCode(204)
  @UseGuards(WawuAuthGuard)
  async remove(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("clipId", UuidParam) id: string,
  ) {
    const me = await this.profiles.requireWriter(u);
    await this.clips.remove(me, id);
  }

  @Get("voice-clips/:clipId/play")
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit("read")
  async play(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("clipId", UuidParam) id: string,
  ) {
    const me = await this.profiles.optional(u);
    return this.clips.playUrl(id, me?.id ?? null);
  }

  /** POST /uploads: a presigned PUT for a photo (avatar, result sheet, override image, advert picture). */
  @Post("uploads")
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("voiceUpload")
  async upload(
    @CurrentUser() u: MaybeVoicesUser,
    @Body() dto: CreateUploadDto,
  ) {
    const me = await this.profiles.requireWriter(u);
    if (!this.store)
      throw new HttpException(
        {
          code: "UNAVAILABLE",
          message: "VOICES is not available right now. Try again soon.",
        },
        503,
      );
    if (!IMAGE_MIME.includes(dto.mime))
      throw new HttpException(
        {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "That file type is not supported.",
        },
        415,
      );
    if (dto.sizeBytes > (await this.config.num("upload.max_bytes")))
      throw new PayloadTooLargeException({
        code: "PAYLOAD_TOO_LARGE",
        message: "That picture is too large to send.",
      });
    const needs: Partial<
      Record<FileKind, Parameters<ProfileService["hasRole"]>[1][]>
    > = {
      OVERRIDE_IMAGE: ["EDITOR"],
      AD_CREATIVE: ["AD_MANAGER"],
    };
    const roles = needs[dto.kind];
    if (roles && !this.profiles.hasRole(me, ...(roles as never[])))
      throw new ForbiddenException({
        code: "ROLE_REQUIRED",
        message: "Your role cannot do that.",
      });
    const put = await this.store.presignPut(
      `file/${dto.kind.toLowerCase()}`,
      dto.mime,
      dto.sizeBytes,
    );
    const file = await this.prisma.storedFile.create({
      data: {
        ownerId: me.id,
        kind: dto.kind,
        key: put.key,
        mime: dto.mime,
        bytes: dto.sizeBytes,
      },
    });
    return {
      fileId: file.id,
      putUrl: put.url,
      putHeaders: put.headers,
      expiresAt: put.expiresAt.toISOString(),
    };
  }
  /**
   * POST /uploads/:fileId/complete: the owner says the PUT is done. The object is checked with a HEAD (present, and the
   * size that was signed), then confirmedAt is set so the file can be used (PATCH /me/profile avatarFileId, an override
   * image). Repeating it is safe and answers the same.
   */
  @Post("uploads/:fileId/complete")
  @HttpCode(200)
  @UseGuards(WawuAuthGuard, RateLimitGuard)
  @RateLimit("voiceUpload")
  async completeUpload(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("fileId", UuidParam) fileId: string,
  ) {
    const me = await this.profiles.requireWriter(u);
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, ownerId: me.id },
    });
    if (!file)
      throw new NotFoundException({
        code: "NOT_FOUND",
        message: "We could not find that upload.",
      });
    if (!file.confirmedAt) {
      if (!this.store)
        throw new HttpException(
          {
            code: "UNAVAILABLE",
            message: "VOICES is not available right now. Try again soon.",
          },
          503,
        );
      let size: number | null;
      try {
        size = await this.store.head(file.key);
      } catch (e) {
        // lead ruling WF, 6 Nov: a bucket that is down is our side being down: the same 503 as the file attach.
        this.logger.error(
          `complete ${file.id}: storage check failed: ${String(e)}`,
        );
        throw new HttpException(
          {
            code: "UNAVAILABLE",
            message:
              "Uploads are not available right now. Try again in a minute.",
          },
          503,
        );
      }
      if (size === null)
        throw new ConflictException({
          code: "UPLOAD_NOT_RECEIVED",
          message: "We have not received your picture yet.",
        });
      if (file.bytes !== null && size !== file.bytes)
        throw new UnprocessableEntityException({
          code: "VALIDATION_FAILED",
          message: "That picture could not be accepted.",
          details: {
            fields: [
              {
                path: "fileId",
                message: "The picture sent is not the size you said.",
              },
            ],
          },
        });
      // First confirmation wins; a repeat leaves the time it already has.
      await this.prisma.storedFile.updateMany({
        where: { id: file.id, confirmedAt: null },
        data: { confirmedAt: new Date() },
      });
    }
    const done = await this.prisma.storedFile.findUniqueOrThrow({
      where: { id: file.id },
    });
    // Photos are read through the public CDN link: make the object public-read (logged, never fails; a repeat retries).
    if (this.store) await publishPhoto(this.store, done, this.logger);
    return {
      fileId: done.id,
      kind: done.kind,
      confirmedAt: (done.confirmedAt as Date).toISOString(),
    };
  }
}
