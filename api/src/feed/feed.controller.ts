import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { FeedService } from "./feed.service";
import { GuestReadCache, cacheHeaders } from "./guest-cache";

interface PageQuery {
  cursor?: string;
  limit?: string;
}

/** Topics, calendar, categories, today, home, discover, trending and search. Every route is open to guests; a token adds my* fields. */
@Controller()
@UseGuards(OptionalAuthGuard)
export class FeedController {
  constructor(
    private readonly feed: FeedService,
    private readonly guests: GuestReadCache,
  ) {}

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
  publicConfig(@Res({ passthrough: true }) res: Response) {
    // The same for everybody (prices and limits), so a shared cache may keep it a few seconds.
    cacheHeaders(res, false, { shared: this.guests.sharedSeconds() });
    return this.guests.wrap("config/public", () => this.feed.publicConfig());
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
  async today(
    @CurrentUser() user: MaybeVoicesUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    // A guest read is the same for everybody (LCH-09): shared. A signed-in read has iSaved and hidden people: private.
    cacheHeaders(res, !!user, { shared: this.guests.sharedSeconds() });
    if (user) return this.feed.today(await this.viewer(user));
    return this.guests.wrap("questions/today", async () =>
      this.feed.today(await this.viewer(undefined)),
    );
  }

  @Get("questions/:questionId")
  async question(
    @Param(
      "questionId",
      new ParseUUIDPipe({ exceptionFactory: () => notFound("question") }),
    )
    id: string,
    @CurrentUser() user: MaybeVoicesUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    cacheHeaders(res, !!user, { shared: this.guests.sharedSeconds() });
    if (user) return this.feed.question(id, await this.viewer(user));
    return this.guests.wrap(`questions/${id}`, async () =>
      this.feed.question(id, await this.viewer(undefined)),
    );
  }

  @Get("questions/:questionId/answers")
  async answers(
    @Param(
      "questionId",
      new ParseUUIDPipe({ exceptionFactory: () => notFound("question") }),
    )
    id: string,
    @Query() q: PageQuery & { sort?: string; tag?: string; mood?: string },
    @CurrentUser() user: MaybeVoicesUser,
    @Res({ passthrough: true }) res: Response,
    @Headers("x-guest-id") guest?: string,
  ) {
    // The page differs by X-Guest-Id (iLiked), so the proxy never keeps it; the in-process copy below is guest-neutral.
    cacheHeaders(res, !!user, {
      shared: this.guests.sharedSeconds(),
      sharedOk: false,
    });
    const query = { ...q, limit: num(q.limit) };
    if (user)
      return this.feed.questionAnswers(
        id,
        query,
        await this.viewer(user, guest),
      );
    const key = `questions/${id}/answers?${canonical(query)}`;
    const page = await this.guests.wrap(key, async () =>
      this.feed.questionAnswers(id, query, await this.viewer(undefined)),
    );
    const gid = guest && GUEST_ID.test(guest) ? guest : undefined;
    return gid ? this.feed.withGuestLikes(page, gid) : page;
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

const GUEST_ID = /^[0-9a-f-]{16,64}$/i;

/** The query as one string, the same whatever the order of the parameters. */
function canonical(q: Record<string, unknown>): string {
  return Object.keys(q)
    .filter((k) => q[k] !== undefined)
    .sort()
    .map((k) => `${k}=${String(q[k])}`)
    .join("&");
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
