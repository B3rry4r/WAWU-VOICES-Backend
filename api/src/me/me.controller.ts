import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { VoicesUser } from "../common/auth/voices-user";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { BlocksService } from "./blocks";
import { DeletionService } from "./deletion.service";
import {
  CreateMeDto,
  DeleteAccountDto,
  SetCategoriesDto,
  SetTagFollowsDto,
  UpdateProfileDto,
  UpdateSettingsDto,
} from "./dto";
import { ExportService } from "./export.service";
import type { CurrentMeInfo } from "./me-context";
import { CurrentMe, ProfileRequired, WriteAccess } from "./me-guards";
import { MeService } from "./me.service";
import { PeopleService } from "./people.service";
import { UuidParam } from "./views";

/** Per-route limits; the env names let tests and an events mode change them without code. */
const envLimit = (name: string, dflt: number) =>
  Number(process.env[name] ?? dflt);

const user = (u: MaybeVoicesUser) => u as VoicesUser;

@Controller("me")
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly people: PeopleService,
    private readonly blocks: BlocksService,
    private readonly deletion: DeletionService,
    private readonly exports: ExportService,
  ) {}

  @Post()
  @UseGuards(WawuAuthGuard)
  @Throttle({
    default: { limit: () => envLimit("ME_SIGNUP_LIMIT", 20), ttl: 60_000 },
  })
  create(@CurrentUser() u: MaybeVoicesUser, @Body() dto: CreateMeDto) {
    return this.me.createMe(user(u), dto);
  }

  @Get()
  @UseGuards(WawuAuthGuard)
  get(@CurrentUser() u: MaybeVoicesUser) {
    return this.me.getMe(user(u));
  }

  @Delete()
  @HttpCode(202)
  @ProfileRequired()
  @Throttle({
    default: { limit: () => envLimit("ME_SENSITIVE_LIMIT", 5), ttl: 600_000 },
  })
  async remove(@CurrentMe() me: CurrentMeInfo, @Body() dto: DeleteAccountDto) {
    await this.deletion.request(me, dto);
  }

  @Patch("profile")
  @WriteAccess()
  updateProfile(@CurrentMe() me: CurrentMeInfo, @Body() dto: UpdateProfileDto) {
    return this.me.updateProfile(me, dto);
  }

  @Get("handle-check")
  @UseGuards(WawuAuthGuard)
  @Throttle({
    default: {
      limit: () => envLimit("ME_HANDLE_CHECK_LIMIT", 30),
      ttl: 60_000,
    },
  })
  handleCheck(
    @CurrentUser() u: MaybeVoicesUser,
    @Query("handle") handle: unknown,
  ) {
    return this.me.checkHandle(user(u), handle);
  }

  // GET /me/allowance is left for wiring: it needs A5's UnitsService (not on main yet).

  @Get("settings")
  @ProfileRequired()
  settings(@CurrentMe() me: CurrentMeInfo) {
    return this.me.getSettings(me);
  }

  @Patch("settings")
  @WriteAccess()
  updateSettings(
    @CurrentMe() me: CurrentMeInfo,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.me.updateSettings(me, dto);
  }

  @Get("categories")
  @ProfileRequired()
  categories(@CurrentMe() me: CurrentMeInfo) {
    return this.me.getCategories(me);
  }

  @Put("categories")
  @WriteAccess()
  setCategories(@CurrentMe() me: CurrentMeInfo, @Body() dto: SetCategoriesDto) {
    return this.me.setCategories(me, dto);
  }

  @Put("tag-follows")
  @WriteAccess()
  setTagFollows(@CurrentMe() me: CurrentMeInfo, @Body() dto: SetTagFollowsDto) {
    return this.me.setTagFollows(me, dto);
  }

  @Get("answers")
  @ProfileRequired()
  answers(
    @CurrentMe() me: CurrentMeInfo,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.people.listMyAnswers(me.id, cursor, limit);
  }

  @Get("saved")
  @ProfileRequired()
  saved(
    @CurrentMe() me: CurrentMeInfo,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("kind") kind?: string,
  ) {
    return this.people.listSaved(me.id, cursor, limit, kind);
  }

  @Get("blocks")
  @ProfileRequired()
  listBlocks(
    @CurrentMe() me: CurrentMeInfo,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.people.listBlocks(me.id, cursor, limit);
  }

  @Put("blocks/:userId")
  @HttpCode(204)
  @WriteAccess()
  async block(
    @CurrentMe() me: CurrentMeInfo,
    @Param("userId", new UuidParam()) userId: string,
  ) {
    await this.blocks.block(me.id, userId);
  }

  @Delete("blocks/:userId")
  @HttpCode(204)
  @WriteAccess()
  async unblock(
    @CurrentMe() me: CurrentMeInfo,
    @Param("userId", new UuidParam()) userId: string,
  ) {
    await this.blocks.unblock(me.id, userId);
  }

  @Post("export")
  @HttpCode(202)
  @ProfileRequired()
  @Throttle({
    default: { limit: () => envLimit("ME_SENSITIVE_LIMIT", 5), ttl: 600_000 },
  })
  requestExport(@CurrentMe() me: CurrentMeInfo) {
    return this.exports.request(me);
  }

  @Get("export")
  @ProfileRequired()
  getExport(@CurrentMe() me: CurrentMeInfo) {
    return this.exports.latest(me);
  }
}
