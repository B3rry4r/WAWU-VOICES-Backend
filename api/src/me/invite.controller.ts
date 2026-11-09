import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, MaxLength } from "class-validator";
import type { CurrentMeInfo } from "./me-context";
import { CurrentMe, ProfileRequired } from "./me-guards";
import { InviteService } from "./invite.service";
import { pageLimit } from "./paging";

class ClaimInviteDto {
  @IsString() @MaxLength(32) code!: string;
}

/** LCH-06: my invite link, the friends who answered through it, and counting myself as someone's friend. */
@Controller("me")
export class InviteController {
  constructor(private readonly invites: InviteService) {}

  @Get("invite")
  @ProfileRequired()
  invite(@CurrentMe() me: CurrentMeInfo) {
    return this.invites.summary(me.id);
  }

  @Get("friends")
  @ProfileRequired()
  friends(
    @CurrentMe() me: CurrentMeInfo,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.invites.friends(me.id, pageLimit(limit), cursor);
  }

  @Post("invite/claim")
  @HttpCode(204)
  @ProfileRequired()
  @Throttle({
    default: {
      limit: () => Number(process.env.INVITE_CLAIM_LIMIT ?? 10),
      ttl: 60_000,
    },
  })
  async claim(@CurrentMe() me: CurrentMeInfo, @Body() dto: ClaimInviteDto) {
    await this.invites.claim(me, dto.code);
  }
}
