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
  SurveyDecisionDto,
  SurveyListQuery,
  UpdateBrandDto,
  UpdateSurveyDto,
  UpsertBrandDto,
  UpsertSurveyDto,
} from "./dto";
import { BrandsService } from "./brands.service";
import { AdminSurveysService } from "./surveys-admin.service";

/** Sponsored surveys sit in the admin ads area: the same roles as adverts, checked the same way. */
@Controller("admin")
export class AdminSurveysController {
  constructor(
    private readonly svc: AdminSurveysService,
    private readonly brands: BrandsService,
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
  report(@Param("surveyId", new UuidParam()) id: string) {
    return this.svc.report(id);
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
