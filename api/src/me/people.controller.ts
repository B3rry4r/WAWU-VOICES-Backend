import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { PeopleService } from "./people.service";
import { UuidParam } from "./views";

const GUEST_RE = /^[0-9a-f-]{8,64}$/i;

@Controller("people")
@UseGuards(OptionalAuthGuard)
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get("by-handle/:handle")
  async personByHandle(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("handle") handle: string,
    @Headers("x-guest-id") guest?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const viewer = await this.people.viewerOf(
      u,
      guest && GUEST_RE.test(guest) ? guest : undefined,
    );
    return this.people.getPersonByHandle(handle, viewer, cursor, limit);
  }

  @Get(":userId")
  async person(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("userId", new UuidParam()) userId: string,
    @Headers("x-guest-id") guest?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const viewer = await this.people.viewerOf(
      u,
      guest && GUEST_RE.test(guest) ? guest : undefined,
    );
    return this.people.getPerson(userId, viewer, cursor, limit);
  }

  @Get(":userId/replies")
  async replies(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("userId", new UuidParam()) userId: string,
    @Headers("x-guest-id") guest?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const viewer = await this.people.viewerOf(
      u,
      guest && GUEST_RE.test(guest) ? guest : undefined,
    );
    return this.people.listPersonReplies(userId, viewer, cursor, limit);
  }
}
