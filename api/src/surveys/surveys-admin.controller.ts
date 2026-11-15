import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentMe, Roles } from "../me";
import type { CurrentMeInfo } from "../me";
import { UuidParam } from "../me/views";
import {
  HideFreeAnswerDto,
  SurveyDecisionDto,
  SurveyListQuery,
  UpdateBrandDto,
  UpdateSurveyDto,
  UpsertBrandDto,
  UpsertSurveyDto,
} from "./dto";
import { PageQuery } from "../admin/trust/dto";
import { BrandsService } from "./brands.service";
import { AdminSurveysService } from "./surveys-admin.service";
import { SurveyResultsService } from "./surveys-results.service";

/** Sponsored surveys sit in the admin ads area: the same roles as adverts, checked the same way. */
@Controller("admin")
export class AdminSurveysController {
  constructor(
    private readonly svc: AdminSurveysService,
    private readonly brands: BrandsService,
    private readonly results: SurveyResultsService,
  ) {}

  @Get("surveys")
  @Roles("AD_MANAGER", "ADMIN")
  list(@Query() q: SurveyListQuery) {
    return this.svc.list(q);
  }

  @Post("surveys")
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  create(@CurrentMe() me: CurrentMeInfo, @Body() dto: UpsertSurveyDto) {
    return this.svc.create(me, dto);
  }

  @Get("surveys/:surveyId")
  @Roles("AD_MANAGER", "ADMIN")
  get(@Param("surveyId", new UuidParam()) id: string) {
    return this.svc.get(id);
  }

  @Patch("surveys/:surveyId")
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  update(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
    @Body() dto: UpdateSurveyDto,
  ) {
    return this.svc.update(me, id, dto);
  }

  @Post("surveys/:surveyId/submit")
  @HttpCode(200)
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  submit(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
  ) {
    return this.svc.submit(me, id);
  }

  @Post("surveys/:surveyId/decision")
  @HttpCode(200)
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  decide(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
    @Body() dto: SurveyDecisionDto,
  ) {
    return this.svc.decide(me, id, dto);
  }

  @Get("surveys/:surveyId/report")
  @Roles("AD_MANAGER", "ADMIN")
  report(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
  ) {
    return this.svc.report(me, id);
  }

  /** Every free answer and transcript of a survey that is over, scrubbed, for staff to read before release. */
  @Get("surveys/:surveyId/free-answers")
  @Roles("AD_MANAGER", "ADMIN")
  freeAnswers(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
    @Query() q: PageQuery,
  ) {
    return this.results.freeAnswers(me, id, q);
  }

  /** Hide one free answer from the brand (or show it again) before the results are released. */
  @Patch("surveys/:surveyId/free-answers/:handle")
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  hideFreeAnswer(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
    @Param("handle") handle: string,
    @Body() dto: HideFreeAnswerDto,
  ) {
    return this.results.setHidden(me, id, handle, dto.hidden);
  }

  /** Staff have read the free answers: release the results to the brand (once). */
  @Post("surveys/:surveyId/release")
  @HttpCode(200)
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  release(
    @CurrentMe() me: CurrentMeInfo,
    @Param("surveyId", new UuidParam()) id: string,
  ) {
    return this.results.release(me, id);
  }

  @Get("brands")
  @Roles("AD_MANAGER", "ADMIN")
  listBrands() {
    return this.brands.list();
  }

  @Post("brands")
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  createBrand(@CurrentMe() me: CurrentMeInfo, @Body() dto: UpsertBrandDto) {
    return this.brands.create(me, dto);
  }

  @Patch("brands/:brandId")
  @Roles("AD_MANAGER", "ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  updateBrand(
    @CurrentMe() me: CurrentMeInfo,
    @Param("brandId", new UuidParam()) id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brands.update(me, id, dto);
  }
}
