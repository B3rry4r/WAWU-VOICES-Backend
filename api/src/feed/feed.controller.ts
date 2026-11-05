import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { FeedService } from "./feed.service";

interface PageQuery {
  cursor?: string;
  limit?: string;
}

/** Topics, calendar, categories, today, home, discover, trending and search. Every route is open to guests; a token adds my* fields. */
@Controller()
@UseGuards(OptionalAuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  private viewer(user: MaybeVoicesUser, guest?: string) {
    return this.feed.viewer(
      user,
      guest && /^[0-9a-f-]{16,64}$/i.test(guest) ? guest : undefined,
    );
  }

  @Get("topics/current")
  currentTopic() {
    return this.feed.currentTopic();
  }

  @Get("topics/:topicId")
  topic(
    @Param(
      "topicId",
      new ParseUUIDPipe({ exceptionFactory: () => notFound("topic") }),
    )
    id: string,
  ) {
    return this.feed.topic(id);
  }

  @Get("calendar")
  calendar(@Query() q: PageQuery & { status?: string }) {
    return this.feed.calendar({
      cursor: q.cursor,
      limit: num(q.limit),
      status: q.status,
    });
  }

  @Get("config/public")
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  publicConfig() {
    return this.feed.publicConfig();
  }

  @Get("countries")
  countries() {
    return this.feed.countries();
  }

  @Get("categories")
  categories() {
    return this.feed.categories();
  }

  @Get("categories/:slug")
  async category(
    @Param("slug") slug: string,
    @Query() q: PageQuery & { tab?: string },
    @CurrentUser() user: MaybeVoicesUser,
  ) {
    return this.feed.categoryDetail(
      slug,
      { cursor: q.cursor, limit: num(q.limit), tab: q.tab },
      await this.viewer(user),
    );
  }

  @Get("home")
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  async home(
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guest?: string,
  ) {
    return this.feed.home(await this.viewer(user, guest), user);
  }

  @Get("questions/today")
  async today(@CurrentUser() user: MaybeVoicesUser) {
    return this.feed.today(await this.viewer(user));
  }

  @Get("questions/:questionId")
  async question(
    @Param(
      "questionId",
      new ParseUUIDPipe({ exceptionFactory: () => notFound("question") }),
    )
    id: string,
    @CurrentUser() user: MaybeVoicesUser,
  ) {
    return this.feed.question(id, await this.viewer(user));
  }

  @Get("questions/:questionId/answers")
  async answers(
    @Param(
      "questionId",
      new ParseUUIDPipe({ exceptionFactory: () => notFound("question") }),
    )
    id: string,
    @Query() q: PageQuery & { sort?: string; tag?: string },
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guest?: string,
  ) {
    return this.feed.questionAnswers(
      id,
      { ...q, limit: num(q.limit) },
      await this.viewer(user, guest),
    );
  }

  @Get("questions/:questionId/polls")
  async polls(
    @Param(
      "questionId",
      new ParseUUIDPipe({ exceptionFactory: () => notFound("question") }),
    )
    id: string,
    @CurrentUser() user: MaybeVoicesUser,
  ) {
    return this.feed.questionPolls(id, await this.viewer(user));
  }

  @Get("questions")
  async questions(
    @Query()
    q: PageQuery & { categoryId?: string; kind?: string; status?: string },
    @CurrentUser() user: MaybeVoicesUser,
  ) {
    return this.feed.questions(
      { ...q, limit: num(q.limit) },
      await this.viewer(user),
    );
  }

  @Get("feed/trending")
  async trending(
    @Query() q: PageQuery & { categoryId?: string; tag?: string },
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guest?: string,
  ) {
    return this.feed.trendingAnswers(
      { ...q, limit: num(q.limit) },
      await this.viewer(user, guest),
    );
  }

  @Get("feed/trending-questions")
  async trendingQuestions(
    @Query() q: PageQuery & { categoryId?: string },
    @CurrentUser() user: MaybeVoicesUser,
  ) {
    return this.feed.trendingQuestions(
      { ...q, limit: num(q.limit) },
      await this.viewer(user),
    );
  }

  @Get("feed/new")
  async fresh(@Query() q: PageQuery, @CurrentUser() user: MaybeVoicesUser) {
    return this.feed.newConversations(
      { cursor: q.cursor, limit: num(q.limit) },
      await this.viewer(user),
    );
  }

  @Get("search")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async search(
    @Query() q: PageQuery & { q?: string; type?: string; tag?: string },
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("x-guest-id") guest?: string,
  ) {
    return this.feed.search(
      {
        q: q.q ?? "",
        type: q.type,
        tag: q.tag,
        cursor: q.cursor,
        limit: num(q.limit),
      },
      await this.viewer(user, guest),
    );
  }
}

function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v);
}

import { NotFoundException } from "@nestjs/common";
function notFound(what: string) {
  return new NotFoundException({
    code: "NOT_FOUND",
    message: `We could not find that ${what}.`,
  });
}
