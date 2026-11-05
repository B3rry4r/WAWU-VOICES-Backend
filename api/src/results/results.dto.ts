import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** The most any one total can be: a polling unit holds far fewer, and this keeps every count a safe integer. */
export const MAX_TOTAL = 100_000;

export class CreateResultPostDto {
  @Transform(trim) @IsString() @Length(1, 80) state!: string;
  @Transform(trim) @IsString() @Length(1, 80) lga!: string;
  @Transform(trim) @IsString() @Length(1, 80) ward!: string;
  @Transform(trim) @IsString() @Length(1, 120) pollingUnit!: string;
  @IsInt() @Min(0) @Max(MAX_TOTAL) accredited!: number;
  @IsInt() @Min(0) @Max(MAX_TOTAL) votesCast!: number;
  @IsInt() @Min(0) @Max(MAX_TOTAL) rejected!: number;
  @IsOptional() @IsUUID() photoFileId?: string;
}

export class ResultDecisionDto {
  @IsIn(["VERIFIED", "NOT_VERIFIED", "SEND_TO_MODERATION"])
  decision!: "VERIFIED" | "NOT_VERIFIED" | "SEND_TO_MODERATION";
  @IsOptional() @Transform(trim) @IsString() @Length(0, 500) note?: string;
}

export class CreateResultThreadDto {
  @Transform(trim) @IsString() @Length(1, 160) title!: string;
  @IsOptional() @Transform(trim) @IsString() @Length(0, 240) subtitle?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) heldOn!: string;
  @IsOptional() @IsIn(["SCHEDULED", "OPEN", "CLOSED"]) status?:
    "SCHEDULED" | "OPEN" | "CLOSED";
  @IsOptional() @IsUUID() topicId?: string;
}

export class ListQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() lga?: string;
  @IsOptional() @IsString() after?: string;
  @IsOptional() @IsUUID() threadId?: string;
}
