import { Body, Controller, Get, Param, Put, Query } from "@nestjs/common";
import { SetRolesDto } from "./dto";
import type { CurrentMeInfo } from "./me-context";
import { CurrentMe, Roles } from "./me-guards";
import { RolesService } from "./roles.service";
import { UuidParam } from "./views";

/** The only HTTP way to grant a VOICES role (the other is `npm run roles:grant`). Admin only. */
@Controller("admin")
export class AdminRolesController {
  constructor(private readonly roles: RolesService) {}

  @Get("roles")
  @Roles("ADMIN")
  list(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("role") role?: string,
  ) {
    return this.roles.list(cursor, limit, role);
  }

  @Put("users/:userId/roles")
  @Roles("ADMIN")
  set(
    @CurrentMe() me: CurrentMeInfo,
    @Param("userId", new UuidParam()) userId: string,
    @Body() dto: SetRolesDto,
  ) {
    return this.roles.setRoles(me, userId, dto.roles, dto.reason);
  }
}
