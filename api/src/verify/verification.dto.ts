import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, Length, MaxLength } from "class-validator";
import { REJECT_REASON_CODES } from "./verification.reasons";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class RejectVerificationDto {
  @IsIn(REJECT_REASON_CODES) reasonCode!: string;
  /** The admin's own words, shown to the person after the short reason. Required with OTHER. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class ApproveVerificationDto {
  /** Optional words for the audit line only; the person does not see them. */
  @IsOptional() @Transform(trim) @IsString() @Length(0, 500) note?: string;
}

export class VerificationListQuery {
  @IsOptional() @IsIn(["pending", "decided"]) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) cursor?: string;
  @IsOptional() limit?: unknown;
}
