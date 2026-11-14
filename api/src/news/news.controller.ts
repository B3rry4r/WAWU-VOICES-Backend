import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser, VoicesUser } from "../common/auth/voices-user";
import { ActorService } from "../results/actor.service";
import { FlagDto, NewsQueryDto, RequestVerifiedDto } from "./news.dto";
import { NewsService } from "./news.service";

/** The Newsroom: contract group `news`, plus POST /news/:answerId/flag. `tags` is declared before `:answerId` so it is never read as an id. */
@Controller("news")
export class NewsController {
  constructor(
    private readonly news: NewsService,
    private readonly actors: ActorService,
  ) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  list(@CurrentUser() user: MaybeVoicesUser, @Query() q: NewsQueryDto) {
    return this.news.list(user, q);
  }

  @Get("tags")
  @UseGuards(OptionalAuthGuard)
  tags(@CurrentUser() user: MaybeVoicesUser) {
    return this.news.tags(user);
  }

  @Get(":answerId")
  @UseGuards(OptionalAuthGuard)
  get(
    @CurrentUser() user: MaybeVoicesUser,
    @Param("answerId", new ParseUUIDPipe()) answerId: string,
  ) {
    return this.news.get(user, answerId);
  }

  @Post(":answerId/flag")
  @UseGuards(WawuAuthGuard)
  async flag(
    @CurrentUser() user: MaybeVoicesUser,
    @Param("answerId", new ParseUUIDPipe()) answerId: string,
    @Body() dto: FlagDto,
  ) {
    const actor = await this.actors.resolve(user as VoicesUser, {
      write: true,
    });
    return this.news.flag(actor, answerId, dto.note);
  }

  /** V-FIX-B: the poster asks the editors for Verified News. The request lands in the editors' queue. */
  @Post(":answerId/request-verified")
  @UseGuards(WawuAuthGuard)
  async requestVerified(
    @CurrentUser() user: MaybeVoicesUser,
    @Param("answerId", new ParseUUIDPipe()) answerId: string,
    @Body() dto: RequestVerifiedDto,
  ) {
    const actor = await this.actors.resolve(user as VoicesUser, {
      write: true,
    });
    return this.news.requestVerified(actor, answerId, dto);
  }
}
