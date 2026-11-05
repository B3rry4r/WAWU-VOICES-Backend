import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

export class VoteRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  optionIds!: string[];
}

export class PostBodyDto {
  @IsIn(["TEXT", "VOICE"])
  kind!: "TEXT" | "VOICE";

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsUUID("all")
  clipId?: string;

  @IsOptional()
  @IsUUID("all")
  extraVoiceTokenId?: string;
}

export class ExplainVoteDto extends PostBodyDto {}

export class CreateProposalDto extends PostBodyDto {
  @IsOptional()
  @IsUUID("all")
  improvesId?: string;
}

export class StanceDto {
  @IsIn(["SUPPORT", "CHALLENGE"])
  kind!: "SUPPORT" | "CHALLENGE";
}
