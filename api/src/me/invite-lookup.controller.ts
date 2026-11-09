import { Controller, Get, Header, Param } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { InviteService } from "./invite.service";

/**
 * LCH-A2: the public half of the invite link. /go reads the code the visitor arrived with and asks who sent it, to draw
 * "@ada.okafor asked how you feel." The answer is the handle and nothing else, never cached, and limited per address
 * (300 a minute, INVITE_LOOKUP_IP_LIMIT to change it) so codes cannot be walked.
 */
@Controller("invites")
export class InviteLookupController {
  constructor(private readonly invites: InviteService) {}

  @Get(":code")
  @Throttle({
    default: {
      limit: () => Number(process.env.INVITE_LOOKUP_IP_LIMIT ?? 300),
      ttl: 60_000,
    },
  })
  @Header("Cache-Control", "no-store")
  inviter(@Param("code") code: string) {
    return this.invites.inviterHandle(code.slice(0, 64));
  }
}
