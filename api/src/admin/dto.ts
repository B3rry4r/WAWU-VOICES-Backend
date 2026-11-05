import { Transform, Type } from "class-transformer";
import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  );
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_CONTROL = /^[^\p{Cc}]*$/u;
const INT_MAX = 2_000_000_000;

export const TOPIC_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "SCHEDULED",
  "LIVE",
  "CLOSED",
];
export const QUESTION_STATUSES = ["DRAFT", "SCHEDULED", "LIVE", "CLOSED"];

export class UpsertTopicDto {
  @IsInt() @Min(1) @Max(10_000) weekNumber!: number;
  @trim()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  @Matches(NO_CONTROL)
  title!: string;
  @IsOptional() @trim() @IsString() @MaxLength(400) blurb?: string;
  @Matches(DATE_RE) startsOn!: string;
  @IsOptional() @IsBoolean() sensitive?: boolean;
  @IsOptional() @trim() @IsString() @MaxLength(300) whatNextPrompt?: string;
  @IsOptional() @IsIn(TOPIC_STATUSES) status?: string;
}

export class UpsertQuestionDto {
  @IsOptional() @IsUUID("all") topicId?: string;
  @IsOptional() @IsUUID("all") categoryId?: string;
  @IsIn(["DAILY", "FLASH", "FOLLOW_UP", "OVERRIDE"]) kind!: string;
  @trim()
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  @Matches(NO_CONTROL)
  text!: string;
  @IsOptional() @trim() @IsString() @MaxLength(200) hint?: string;
  @IsOptional() @Matches(DATE_RE) scheduledFor?: string;
  @IsOptional() @IsInt() @Min(1) @Max(7) slotIndex?: number;
  @IsOptional() @IsBoolean() isSpare?: boolean;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @IsBoolean() sensitive?: boolean;
  @IsOptional() @IsISO8601({ strict: true }) startsAt?: string;
  @IsOptional() @IsISO8601({ strict: true }) endsAt?: string;
  @IsOptional() @IsIn(QUESTION_STATUSES) status?: string;
}

export class UpsertPollDto {
  @IsOptional() @IsUUID("all") topicId?: string;
  @IsOptional() @IsUUID("all") questionId?: string;
  @IsIn(["WEEKLY", "FLASH", "QUESTION"]) kind!: string;
  @trim() @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsIn(["SINGLE", "MULTIPLE"]) choiceMode!: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @trim()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  options!: string[];
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsOptional() @IsBoolean() publicInterest?: boolean;
  @IsOptional() @IsBoolean() showLiveResults?: boolean;
}

export class SummaryEditDto {
  @trim() @IsString() @MinLength(3) @MaxLength(600) mainView!: string;
  @IsInt() @Min(0) @Max(INT_MAX) mainViewVoices!: number;
  @trim() @IsString() @MinLength(3) @MaxLength(600) opposingView!: string;
  @IsInt() @Min(0) @Max(INT_MAX) opposingViewVoices!: number;
  @trim() @IsString() @MinLength(3) @MaxLength(600) pollLine!: string;
  @trim() @IsString() @MinLength(3) @MaxLength(600) nextStepsLine!: string;
  @IsBoolean() approve!: boolean;
}

export class ConfirmGroupDto {
  @trim() @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  proposalIds!: string[];
}

export class CreateOverrideDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(120)
  @Matches(NO_CONTROL)
  headline?: string;
  @IsIn(["TEXT", "VOICE", "IMAGE", "LINK"]) contentKind!: string;
  @IsOptional() @trim() @IsString() @MaxLength(500) body?: string;
  @IsOptional() @IsUUID("all") voiceClipId?: string;
  @IsOptional() @IsUUID("all") imageFileId?: string;
  @IsOptional() @trim() @IsString() @MaxLength(500) linkUrl?: string;
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsOptional() @IsBoolean() emergency?: boolean;
  @IsOptional() @IsBoolean() notifyAlert?: boolean;
  @IsOptional() @IsBoolean() keepWeeklyTheme?: boolean;
  @IsOptional() @IsBoolean() dropReplaced?: boolean;
  @IsOptional() @trim() @IsString() @MaxLength(500) reason?: string;
}

/** CancelRequest and HoldRequest: a reason, always. */
export class ReasonDto {
  @trim() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class UpdateConfigDto {
  @Allow() value!: unknown;
  @trim() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class ApproveWeeklyDto {
  @IsISO8601({ strict: true }) publishAt!: string;
}

export class EmotionDto {
  @trim() @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) share!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(-100) @Max(100) change!: number;
}

export class QuoteDto {
  @IsUUID("all") answerId!: string;
  @trim() @IsString() @MinLength(3) @MaxLength(400) excerpt!: string;
  @trim() @IsString() @MinLength(3) @MaxLength(80) placeLabel!: string;
  @IsBoolean() consent!: boolean;
}

export class EditWeeklyDto {
  @IsOptional() @trim() @IsString() @MaxLength(120) cardTitle?: string;
  @IsOptional() @trim() @IsString() @MaxLength(1000) editorNote?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => EmotionDto)
  emotions?: EmotionDto[];
  @IsOptional() @trim() @IsString() @MaxLength(160) headline?: string;
  @IsOptional() @trim() @IsString() @MaxLength(120) mood?: string;
  @IsOptional() @trim() @IsString() @MaxLength(4000) summary?: string;
  @IsOptional() themes?: unknown;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuoteDto)
  quotes?: QuoteDto[];
}
