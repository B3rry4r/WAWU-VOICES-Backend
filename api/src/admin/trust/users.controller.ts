import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentMe, Roles } from "../../me";
import type { CurrentMeInfo } from "../../me";
import { UuidParam } from "../../me/views";
import { CancelDto, SuspendDto, UserListQuery } from "./dto";
import { AdminUsersService } from "./users.service";

@Controller("admin/users")
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  @Roles("ADMIN")
  list(@Query() q: UserListQuery) {
    return this.svc.list(q);
  }

  @Post(":userId/suspend")
  @HttpCode(200)
  @Roles("MODERATOR", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  suspend(
    @CurrentMe() me: CurrentMeInfo,
    @Param("userId", new UuidParam()) userId: string,
    @Body() dto: SuspendDto,
  ) {
    return this.svc.suspend(me, userId, dto);
  }

  @Post(":userId/restore")
  @HttpCode(200)
  @Roles("MODERATOR", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  restore(
    @CurrentMe() me: CurrentMeInfo,
    @Param("userId", new UuidParam()) userId: string,
    @Body() dto: CancelDto,
  ) {
    return this.svc.restore(me, userId, dto.reason);
  }
}
