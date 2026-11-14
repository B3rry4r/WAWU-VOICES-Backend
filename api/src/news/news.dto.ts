import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class NewsQueryDto {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
  @IsOptional()
  @IsIn(["VERIFIED_NEWS", "UNVERIFIED_NEWS", "GOSSIP"])
  tag?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

export class FlagDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 500)
  note?: string;
}

/** V-FIX-B: ask the editors to make a post Verified News. The source is what the editors check. */
export class RequestVerifiedDto {
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  sourceName!: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(0, 500)
  sourceUrl?: string;
}
