import { Controller, Get, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser, VoicesUser } from "../common/auth/voices-user";

/**
 * Probe routes: prove the two guards work. Real routes replace the pattern;
 * these two stay as the auth smoke test.
 */
@Controller("_probe")
@SkipThrottle()
export class ProbeController {
  /** GET /api/_probe/protected: 401 without a valid token. */
  @Get("protected")
  @UseGuards(WawuAuthGuard)
  protectedProbe(@CurrentUser() user: MaybeVoicesUser): { sub: string } {
    return { sub: (user as VoicesUser).sub };
  }

  /** GET /api/_probe/guest: guests allowed; says who is calling. */
  @Get("guest")
  @UseGuards(OptionalAuthGuard)
  guestProbe(@CurrentUser() user: MaybeVoicesUser): {
    signedIn: boolean;
    sub: string | null;
  } {
    return { signedIn: !!user, sub: user?.sub ?? null };
  }
}
