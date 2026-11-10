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

export class ExplainVoteDto extends PostBodyDto {
  /** LCH-02: on a mood question the explanation is an answer, so it carries one of the question's words. */
  @IsOptional()
  @IsIn(["ANGRY", "TIRED", "PROUD", "HOPEFUL"])
  mood?: "ANGRY" | "TIRED" | "PROUD" | "HOPEFUL";

  /** H2: the question the voter came from (the one whose words they were shown). It must belong to the poll's conversation. */
  @IsOptional()
  @IsUUID("all")
  questionId?: string;
}

export class CreateProposalDto extends PostBodyDto {
  @IsOptional()
  @IsUUID("all")
  improvesId?: string;
}

export class StanceDto {
  @IsIn(["SUPPORT", "CHALLENGE"])
  kind!: "SUPPORT" | "CHALLENGE";
}
