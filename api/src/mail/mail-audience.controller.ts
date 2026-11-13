import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { InternalServiceKeyGuard } from "../common/guards/internal-service-key.guard";
import {
  MailAudienceService,
  type MailAudiencePage,
} from "./mail-audience.service";

export class MailAudienceQuery {
  /** The last id of the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  /** 1 to 1000, default 500. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}

/**
 * EMAIL-03 (V-AUD): the list of members a bulk email may go to, read by the WAWU Hub's email campaigns.
 * Service-to-service only (X-Service-Key); the guard comes first, so a call with no key learns nothing.
 */
@Controller("internal/mail")
@UseGuards(InternalServiceKeyGuard)
@SkipThrottle()
export class MailAudienceController {
  constructor(private readonly audience: MailAudienceService) {}

  /** GET /api/v1/internal/mail/audience?cursor=&limit= */
  @Get("audience")
  list(@Query() q: MailAudienceQuery): Promise<MailAudiencePage> {
    return this.audience.page(q.cursor, q.limit ?? 500);
  }
}
