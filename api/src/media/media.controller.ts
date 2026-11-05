import {
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
import { MEDIA_STORE, type ObjectStore } from "./object-store";
import {
  HttpException,
  PayloadTooLargeException,
  ForbiddenException,
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
}
