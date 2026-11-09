import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, MaxLength } from "class-validator";
import type { CurrentMeInfo } from "./me-context";
import { CurrentMe, ProfileRequired } from "./me-guards";
import { InviteService } from "./invite.service";
import { pageLimit } from "./paging";

class ClaimInviteDto {
  @IsString() @MaxLength(32) code!: string;
}

/**
 * lead ruling LC, 9 Nov: the claim limit is per signed-in person (10 a minute), so a shared network (a venue, a carrier
 * address) never costs a real friend. The per-address ceiling below it is only an abuse guard.
 */
const USER_WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; resetAt: number }>();
function userLimit(userId: string): void {
  const limit = Number(process.env.INVITE_CLAIM_USER_LIMIT ?? 10);
  const now = Date.now();
  let w = hits.get(userId);
  if (!w || w.resetAt <= now) {
    w = { n: 0, resetAt: now + USER_WINDOW_MS };
    hits.set(userId, w);
    if (hits.size > 5000)
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  w.n += 1;
  if (w.n > limit)
    throw new HttpException(
      {
        code: "RATE_LIMITED",
        message: "Too many tries. Wait a moment and try again.",
        details: {
          retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
        },
      },
      429,
    );
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
      limit: () => Number(process.env.INVITE_CLAIM_IP_LIMIT ?? 300),
      ttl: 60_000,
    },
  })
  async claim(@CurrentMe() me: CurrentMeInfo, @Body() dto: ClaimInviteDto) {
    userLimit(me.id);
    await this.invites.claim(me, dto.code);
  }
}
