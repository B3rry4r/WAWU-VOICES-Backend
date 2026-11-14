import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
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
  ValidateNested,
} from "class-validator";
import { PageQuery } from "../admin/trust/dto";
import { AGE_BANDS, MAX_QUESTIONS } from "./survey-rules";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class SurveyQuestionDto {
  @IsIn(["SINGLE_CHOICE", "TEXT", "VOICE"]) kind!: string;
  @Transform(trim) @IsString() @Length(1, 200) prompt!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @Transform(({ value }: { value: unknown }): unknown =>
    Array.isArray(value)
      ? (value as unknown[]).map((v) => (typeof v === "string" ? v.trim() : v))
      : value,
  )
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  options?: string[];
}

export class SurveyListQuery extends PageQuery {
  @IsOptional()
  @IsIn(["DRAFT", "AWAITING_APPROVAL", "APPROVED", "REJECTED", "PAUSED"])
  status?: string;
}

export class UpsertSurveyDto {
  @Transform(trim) @IsString() @Length(1, 80) brandName!: string;
  @IsOptional() @IsUUID() brandId?: string;
  @Transform(trim) @IsEmail() @MaxLength(200) contactEmail!: string;
  @Transform(trim) @IsString() @Length(1, 120) title!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions!: SurveyQuestionDto[];
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
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  responseTarget?: number;
}

/** A PATCH takes any subset of the fields. */
export class UpdateSurveyDto extends UpsertSurveyDto {
  @IsOptional() declare brandName: string;
  @IsOptional() declare contactEmail: string;
  @IsOptional() declare title: string;
  @IsOptional() declare questions: SurveyQuestionDto[];
}

export class SurveyDecisionDto {
  @IsIn(["APPROVE", "REJECT", "ASK_FOR_CHANGES", "PAUSE", "RESUME"])
  decision!: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 500) reason?: string;
}

export class HideFreeAnswerDto {
  /** true hides the answer from the brand's report; false shows it again (before release only). */
  @IsBoolean() hidden!: boolean;
}

export class UpsertBrandDto {
  @Transform(trim) @IsString() @Length(1, 80) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(140) tagline?: string;
  @IsOptional() @IsUUID() logoFileId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) website?: string;
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(200)
  contactEmail?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateBrandDto extends UpsertBrandDto {
  @IsOptional() declare name: string;
}

export class SurveyEventDto {
  @IsIn(["VIEW", "START", "SKIP"]) kind!: string;
}

export class PlacementQuery {
  @IsOptional() @IsUUID() questionId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

export class SurveyAnswerDto {
  @IsUUID() questionId!: string;
  @IsOptional() @IsUUID() optionId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) text?: string;
  @IsOptional() @IsUUID() clipId?: string;
}

export class SurveyResponseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => SurveyAnswerDto)
  answers!: SurveyAnswerDto[];
  /** "Answer without my name": nothing about the person is kept beyond the answer itself. */
  @IsOptional() @IsBoolean() anonymous?: boolean;
  /** Agree to share my state with the brand, combined with others. */
  @IsOptional() @IsBoolean() shareState?: boolean;
  /** Agree to share this age band with the brand, combined with others. */
  @IsOptional() @IsIn([...AGE_BANDS]) ageBand?: string;
}
