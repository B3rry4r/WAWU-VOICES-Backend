import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { CurrentMe, ProfileRequired, WriteAccess } from "../me";
import type { CurrentMeInfo } from "../me";
import { UuidParam } from "../me/views";
import { PlacementQuery, SurveyEventDto, SurveyResponseDto } from "./dto";
import { BrandsService } from "./brands.service";
import { SurveysPublicService } from "./surveys-public.service";

@Controller()
export class SurveysController {
  constructor(
    private readonly svc: SurveysPublicService,
    private readonly brands: BrandsService,
  ) {}

  /** The feed slot (where adverts go). A guest gets { survey: null }. */
  @Get("surveys/placement")
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  placement(@CurrentUser() user: MaybeVoicesUser, @Query() q: PlacementQuery) {
    return this.svc.placement(user, q);
  }

  @Get("surveys/:surveyId")
  @ProfileRequired()
  get(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
  ) {
    return this.svc.get(me, id);
  }

  @Post("surveys/:surveyId/events")
  @HttpCode(204)
  @ProfileRequired()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async event(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
    @Body() body: SurveyEventDto,
  ): Promise<void> {
    await this.svc.event(me, id, body.kind as "VIEW" | "START" | "SKIP");
  }

  @Post("surveys/:surveyId/responses")
  @HttpCode(201)
  @WriteAccess()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  respond(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
    @Body() body: SurveyResponseDto,
  ) {
    return this.svc.respond(me, id, body);
  }

  /** The public page of a brand an admin set up. Open to everyone. */
  @Get("brands/:slug")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  brand(@Param("slug") slug: string) {
    return this.brands.page(slug);
  }
}
