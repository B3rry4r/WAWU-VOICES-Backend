import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
const toInt = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === "" ? undefined : Number(value);

export class PageQuery {
  @IsOptional() @IsString() @MaxLength(2000) cursor?: string;
  @IsOptional() @Transform(toInt) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class ModerationListQuery extends PageQuery {
  @IsOptional()
  @IsIn(["REPORTED", "SCREENED", "SENSITIVE", "PRIORITY", "APPEAL"])
  queue?: string;
  @IsOptional() @IsIn(["OPEN", "RESOLVED"]) status?: string;
}

export class ModerationDecisionDto {
  @IsIn([
    "KEEP",
    "REMOVE",
    "WARN",
    "REMOVE_AND_WARN",
    "SUSPEND",
    "BAN",
    "RESTORE",
  ])
  action!: string;
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
}

export class NewsListQuery extends PageQuery {
  @IsOptional()
  @IsIn(["flagged", "asking-verified", "all-changes"])
  tab?: string;
}

export class NewsDecisionDto {
  @IsIn([
    "KEEP",
    "CHANGE_TAG",
    "SEND_TO_MODERATION",
    "APPROVE_VERIFIED",
    "DECLINE_VERIFIED",
  ])
  decision!: string;
  @IsOptional()
  @IsIn(["VERIFIED_NEWS", "UNVERIFIED_NEWS", "GOSSIP"])
  newTag?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  sourceName?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 500) sourceUrl?: string;
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
}

export class UserListQuery extends PageQuery {
  @Transform(trim) @IsString() @Length(1, 80) q!: string;
  @IsOptional()
  @IsIn(["ACTIVE", "SUSPENDED", "BANNED", "DELETION_PENDING", "DELETED"])
  status?: string;
}

export class SuspendDto {
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(40)
  until!: string | null;
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
  @IsBoolean() ban!: boolean;
}

export class CancelDto {
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
}

export class AdListQuery extends PageQuery {
  @IsOptional()
  @IsIn(["DRAFT", "AWAITING_APPROVAL", "APPROVED", "REJECTED", "PAUSED"])
  status?: string;
}

const AD_KINDS = ["FEED_CARD", "BANNER", "AUDIO_SLOT", "WALLET_OFFER"];

export class UpsertAdDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  ageBands?: string[];
  @Transform(trim) @IsString() @Length(1, 80) brand!: string;
  @IsIn(AD_KINDS) kind!: string;
  @Transform(trim) @IsString() @Length(1, 120) headline!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) body?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) linkUrl?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) ctaLabel?: string;
  @IsOptional() @IsUUID() imageFileId?: string;
  @IsOptional() @IsUUID() audioClipId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  states?: string[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  frequencyCapPerDay?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  priceKobo?: number;
}

/**
 * lead ruling WF, 6 Nov (C-M8): the advert PATCH takes any subset of the fields. Create still needs brand, kind and
 * headline; an edit that sends only the dates must not look like a words change (a paused advert stays paused).
 */
export class UpdateAdDto extends UpsertAdDto {
  @IsOptional() declare brand: string;
  @IsOptional() declare kind: string;
  @IsOptional() declare headline: string;
}

export class AdDecisionDto {
  @IsIn(["APPROVE", "REJECT", "ASK_FOR_CHANGES", "PAUSE", "RESUME"])
  decision!: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 500) reason?: string;
}

export class AdjustDto {
  @IsInt() @Min(-1_000_000) @Max(1_000_000) deltaMilli!: number;
  @Transform(trim) @IsString() @Length(1, 500) reason!: string;
}

export class PaymentListQuery extends PageQuery {
  @IsOptional()
  @IsIn(["INITIATED", "PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "REFUNDED"])
  status?: string;
  @IsOptional()
  @IsIn(["UNITS", "EXTRA_VOICE", "SUBSCRIPTION"])
  kind?: string;
}

export class SubscriptionListQuery extends PageQuery {
  @IsOptional()
  @IsIn(["ACTIVE", "QUEUED", "ENDED", "CANCELLED_DELETED"])
  status?: string;
}
