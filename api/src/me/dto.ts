import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const NO_CONTROL = /^[^\p{Cc}]*$/u;

export class CreateMeDto {
  @IsString() @MaxLength(64) handle!: string;
  @IsBoolean() ageConfirmed!: boolean;
  @IsBoolean() termsAccepted!: boolean;
  @IsBoolean() rulesAccepted!: boolean;
  @IsString() @MaxLength(2) @MinLength(2) countryCode!: string;
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(LANG_RE, { each: true })
  languages!: string[];
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  categoryIds!: string[];
  @IsOptional() @IsString() @MaxLength(32) referralCode?: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(60) @Matches(NO_CONTROL) displayName?:
    string | null;
  @IsOptional() @IsString() @MaxLength(280) bio?: string | null;
  @IsOptional() @IsUUID() avatarFileId?: string | null;
  @IsOptional() @IsUUID() voiceCardClipId?: string | null;
  @IsOptional() @IsString() @MaxLength(60) state?: string | null;
  @IsOptional() @IsString() @MaxLength(60) city?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @Matches(LANG_RE, { each: true })
  languages?: string[];
  @IsOptional() @IsString() @MaxLength(2) @MinLength(2) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(64) handle?: string;
}

export class UpdateSettingsDto {
  @IsOptional() @IsString() @Matches(LANG_RE) language?: string;
  @IsOptional() @IsBoolean() dataSaver?: boolean;
  @IsOptional() @IsIn(["system", "light", "dark"]) theme?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1439) quietHoursStart?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(1439) quietHoursEnd?: number | null;
  @IsOptional() @IsBoolean() notifyDailyQuestion?: boolean;
  @IsOptional() @IsBoolean() notifyWeeklyTopic?: boolean;
  @IsOptional() @IsBoolean() notifyReplies?: boolean;
  @IsOptional() @IsBoolean() notifyReactions?: boolean;
  @IsOptional() @IsBoolean() notifyPollResults?: boolean;
  @IsOptional() @IsBoolean() notifyFlashPolls?: boolean;
  @IsOptional() @IsBoolean() notifyCategoryAlerts?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1439) dailyQuestionMinute?: number;
  @IsOptional() @IsBoolean() shareMyWord?: boolean;
}

export class CategoryFollowDto {
  @IsUUID() categoryId!: string;
  @IsBoolean() alertsOn!: boolean;
}

export class SetCategoriesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CategoryFollowDto)
  categories!: CategoryFollowDto[];
}

export class SetTagFollowsDto {
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(["VERIFIED_NEWS", "UNVERIFIED_NEWS", "GOSSIP"], { each: true })
  tags!: ("VERIFIED_NEWS" | "UNVERIFIED_NEWS" | "GOSSIP")[];
}

export class DeleteAccountDto {
  @IsString() @MaxLength(64) confirmHandle!: string;
  @IsBoolean() understandUnitsForfeited!: boolean;
}

export class SetRolesDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsIn(["MODERATOR", "EDITOR", "AD_MANAGER", "ADMIN"], { each: true })
  roles!: ("MODERATOR" | "EDITOR" | "AD_MANAGER" | "ADMIN")[];
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}
