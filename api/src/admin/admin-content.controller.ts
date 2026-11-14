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
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { UuidParam } from "../me/views";
import {
  AdminRead,
  AdminWrite,
  CurrentMe,
  type CurrentMeInfo,
} from "./admin-access";
import { AuditAdminService } from "./audit.service";
import { ConfigAdminService } from "./config.service";
import {
  ApproveWeeklyDto,
  BulkQuestionsDto,
  ConfirmGroupDto,
  CreateOverrideDto,
  DraftSummaryDto,
  EditWeeklyDto,
  MoveQuestionDto,
  ReasonDto,
  ScheduleQuestionDto,
  SummaryEditDto,
  UpdateConfigDto,
  UpsertPollDto,
  UpsertQuestionDto,
  UpsertTopicDto,
} from "./dto";
import { GroupsAdminService } from "./groups.service";
import { IdeasAdminService } from "./ideas.service";
import { OverridesAdminService } from "./overrides.service";
import { PoolAdminService } from "./pool.service";
import { SummaryDraftService } from "./summary-draft";
import { notFound, invalid } from "./support";
import { TodayAdminService } from "./today.service";
import { TopicsAdminService } from "./topics.service";
import { WeeklyAdminService } from "./weekly.service";

/** A query value that must be one string (a repeated key is a mistake, not a list). */
function one(name: string, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string")
    throw invalid({ path: name, message: "Send one value." });
  return v;
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/**
 * The editorial side of the admin console (V-12): today, the calendar, questions, polls, What Next? groups, overrides,
 * weekly reports, config and the audit log. Roles are the contract's x-wawu-roles on each operation (ADMIN counts as all).
 */
@Controller("admin")
export class AdminContentController {
  constructor(
    private readonly today: TodayAdminService,
    private readonly topics: TopicsAdminService,
    private readonly pool: PoolAdminService,
    private readonly groups: GroupsAdminService,
    private readonly ideas: IdeasAdminService,
    private readonly summaries: SummaryDraftService,
    private readonly overrides: OverridesAdminService,
    private readonly weekly: WeeklyAdminService,
    private readonly config: ConfigAdminService,
    private readonly audit: AuditAdminService,
  ) {}

  // ---------------------------------------------------------------- today

  @Get("today")
  @AdminRead("EDITOR", "MODERATOR", "AD_MANAGER", "ADMIN")
  getToday() {
    return this.today.today();
  }

  // ---------------------------------------------------------------- calendar

  @Get("topics")
  @AdminRead("EDITOR", "ADMIN")
  listTopics(
    @Query("cursor") cursor?: unknown,
    @Query("limit") limit?: unknown,
    @Query("status") status?: unknown,
    @Query("sensitive") sensitive?: unknown,
    @Query("q") q?: unknown,
  ) {
    return this.topics.list({
      cursor: one("cursor", cursor),
      limit,
      status: one("status", status),
      sensitive: one("sensitive", sensitive),
      q: one("q", q),
    });
  }

  @Post("topics")
  @AdminWrite("EDITOR", "ADMIN")
  createTopic(@CurrentMe() me: CurrentMeInfo, @Body() dto: UpsertTopicDto) {
    return this.topics.create(me.id, dto);
  }

  @Get("topics/:topicId")
  @AdminRead("EDITOR", "ADMIN")
  getTopic(@Param("topicId", new UuidParam()) id: string) {
    return this.topics.get(id);
  }

  @Patch("topics/:topicId")
  @AdminWrite("EDITOR", "ADMIN")
  updateTopic(
    @CurrentMe() me: CurrentMeInfo,
    @Param("topicId", new UuidParam()) id: string,
    @Body() dto: UpsertTopicDto,
  ) {
    return this.topics.update(me.id, id, dto);
  }

  /** The saved What Next? summary, reviewed or not, and whether the AI draft is on. */
  @Get("topics/:topicId/summary")
  @AdminRead("EDITOR", "ADMIN")
  getSummary(@Param("topicId", new UuidParam()) id: string) {
    return this.summaries.saved(id);
  }

  /** A summary draft built from the week's data (and from the AI when asked and a key is set). Nothing is saved. */
  @Post("topics/:topicId/summary/draft")
  @HttpCode(200)
  @AdminRead("EDITOR", "ADMIN")
  draftSummary(
    @Param("topicId", new UuidParam()) id: string,
    @Body() dto: DraftSummaryDto,
  ) {
    return this.summaries.draft(id, dto.ai === true);
  }

  @Put("topics/:topicId/summary")
  @AdminWrite("EDITOR", "ADMIN")
  saveSummary(
    @CurrentMe() me: CurrentMeInfo,
    @Param("topicId", new UuidParam()) id: string,
    @Body() dto: SummaryEditDto,
  ) {
    return this.topics.saveSummary(me.id, id, dto);
  }

  /** V-42 (bundle K1): the question pool, newest first. Only `?pool=1` is served. */
  @Get("questions")
  @AdminRead("EDITOR", "ADMIN")
  listQuestions(
    @Query("pool") pool?: unknown,
    @Query("cursor") cursor?: unknown,
    @Query("limit") limit?: unknown,
  ) {
    return this.pool.list({
      pool: one("pool", pool),
      cursor: one("cursor", cursor),
      limit,
    });
  }

  /** V-42 (bundle K2): up to 50 pasted lines, each made as POST /admin/questions would; a bad line is named, the rest kept. */
  @Post("questions/bulk")
  @HttpCode(200)
  @AdminWrite("EDITOR", "ADMIN")
  bulkQuestions(@CurrentMe() me: CurrentMeInfo, @Body() dto: BulkQuestionsDto) {
    return this.pool.bulk(me.id, dto.kind, dto.categoryId, dto.lines);
  }

  /** V-42 (bundle K3): put a pool question on a day of the week that holds it; a taken day needs `replace`. */
  @Post("questions/:questionId/schedule")
  @HttpCode(200)
  @AdminWrite("EDITOR", "ADMIN")
  scheduleQuestion(
    @CurrentMe() me: CurrentMeInfo,
    @Param("questionId", new UuidParam()) id: string,
    @Body() dto: ScheduleQuestionDto,
  ) {
    return this.pool.schedule(me.id, id, dto.day, dto.replace === true);
  }

  @Post("questions")
  @AdminWrite("EDITOR", "ADMIN")
  createQuestion(
    @CurrentMe() me: CurrentMeInfo,
    @Body() dto: UpsertQuestionDto,
  ) {
    return this.topics.createQuestion(me.id, dto);
  }

  @Patch("questions/:questionId")
  @AdminWrite("EDITOR", "ADMIN")
  updateQuestion(
    @CurrentMe() me: CurrentMeInfo,
    @Param("questionId", new UuidParam()) id: string,
    @Body() dto: UpsertQuestionDto,
  ) {
    return this.topics.updateQuestion(me.id, id, dto);
  }

  /** lead ruling WF, 6 Nov (RW6, C-M4): move a scheduled question to another day of its week; a taken day swaps the two. */
  @Post("questions/:questionId/move")
  @HttpCode(200)
  @AdminWrite("EDITOR", "ADMIN")
  moveQuestion(
    @CurrentMe() me: CurrentMeInfo,
    @Param("questionId", new UuidParam()) id: string,
    @Body() dto: MoveQuestionDto,
  ) {
    return this.topics.moveQuestion(me.id, id, dto.day);
  }

  @Post("polls")
  @AdminWrite("EDITOR", "ADMIN")
  createPoll(@CurrentMe() me: CurrentMeInfo, @Body() dto: UpsertPollDto) {
    return this.topics.createPoll(me.id, dto);
  }

  @Patch("polls/:pollId")
  @AdminWrite("EDITOR", "ADMIN")
  updatePoll(
    @CurrentMe() me: CurrentMeInfo,
    @Param("pollId", new UuidParam()) id: string,
    @Body() dto: UpsertPollDto,
  ) {
    return this.topics.updatePoll(me.id, id, dto);
  }

  /** The questions that have proposals, for the grouping screen. */
  @Get("proposal-questions")
  @AdminRead("MODERATOR", "ADMIN")
  proposalQuestions() {
    return this.ideas.questions();
  }

  /** One question's proposals with its groups and automatic suggestions. */
  @Get("proposals")
  @AdminRead("MODERATOR", "ADMIN")
  proposals(@Query("questionId") questionId?: unknown) {
    return this.ideas.proposals(one("questionId", questionId));
  }

  @Post("proposal-groups")
  @AdminWrite("MODERATOR", "ADMIN")
  confirmGroup(@CurrentMe() me: CurrentMeInfo, @Body() dto: ConfirmGroupDto) {
    return this.groups.confirm(me.id, dto.title, dto.proposalIds);
  }

  /** Split a group: its proposals return to ungrouped. */
  @Delete("proposal-groups/:groupId")
  @AdminWrite("MODERATOR", "ADMIN")
  removeGroup(
    @CurrentMe() me: CurrentMeInfo,
    @Param("groupId", new UuidParam()) id: string,
  ) {
    return this.groups.remove(me.id, id);
  }

  // ---------------------------------------------------------------- overrides

  @Get("overrides")
  @AdminRead("EDITOR", "ADMIN")
  listOverrides(
    @Query("cursor") cursor?: unknown,
    @Query("limit") limit?: unknown,
  ) {
    return this.overrides.list(one("cursor", cursor), limit);
  }

  @Post("overrides")
  @AdminWrite("EDITOR", "ADMIN")
  createOverride(
    @CurrentMe() me: CurrentMeInfo,
    @Body() dto: CreateOverrideDto,
  ) {
    return this.overrides.create(me.id, dto);
  }

  @Post("overrides/preview")
  @HttpCode(200)
  @AdminRead("EDITOR", "ADMIN")
  previewOverride(@Body() dto: CreateOverrideDto) {
    return this.overrides.preview(dto);
  }

  @Post("overrides/:overrideId/cancel")
  @HttpCode(200)
  @AdminWrite("EDITOR", "ADMIN")
  cancelOverride(
    @CurrentMe() me: CurrentMeInfo,
    @Param("overrideId", new UuidParam()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.overrides.cancel(me.id, id, dto.reason);
  }

  // ---------------------------------------------------------------- weekly reports

  @Get("weekly-reports")
  @AdminRead("EDITOR", "ADMIN")
  listWeekly(
    @Query("cursor") cursor?: unknown,
    @Query("limit") limit?: unknown,
    @Query("status") status?: unknown,
  ) {
    return this.weekly.list(
      one("cursor", cursor),
      limit,
      one("status", status),
    );
  }

  @Get("weekly-reports/:reportId")
  @AdminRead("EDITOR", "ADMIN")
  getWeekly(@Param("reportId", new UuidParam()) id: string) {
    return this.weekly.get(id);
  }

  /** LCH-13: all the pictures in one zip. Staff only; nothing is posted anywhere. */
  @Get("weekly-reports/:reportId/instagram")
  @AdminRead("EDITOR", "ADMIN")
  async instagramZip(
    @Param("reportId", new UuidParam()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const zip = await this.weekly.instagramZip(id);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="voices-weekly-instagram.zip"',
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).end(zip);
  }

  /** One picture: carousel-1.png and so on, or story.png. */
  @Get("weekly-reports/:reportId/instagram/:file")
  @AdminRead("EDITOR", "ADMIN")
  async instagramOne(
    @Param("reportId", new UuidParam()) id: string,
    @Param("file") file: string,
    @Res() res: Response,
  ): Promise<void> {
    const pics = await this.weekly.instagram(id);
    const p = pics.find((x) => x.name === file);
    if (!p) throw notFound("that picture");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="${p.name}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).end(p.png);
  }

  @Patch("weekly-reports/:reportId")
  @AdminWrite("EDITOR", "ADMIN")
  editWeekly(
    @CurrentMe() me: CurrentMeInfo,
    @Param("reportId", new UuidParam()) id: string,
    @Body() dto: EditWeeklyDto,
  ) {
    return this.weekly.edit(me.id, id, dto);
  }

  @Post("weekly-reports/:reportId/approve")
  @HttpCode(200)
  @AdminWrite("EDITOR", "ADMIN")
  approveWeekly(
    @CurrentMe() me: CurrentMeInfo,
    @Param("reportId", new UuidParam()) id: string,
    @Body() dto: ApproveWeeklyDto,
  ) {
    return this.weekly.approve(me.id, id, dto.publishAt);
  }

  @Post("weekly-reports/:reportId/hold")
  @HttpCode(200)
  @AdminWrite("EDITOR", "ADMIN")
  holdWeekly(
    @CurrentMe() me: CurrentMeInfo,
    @Param("reportId", new UuidParam()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.weekly.hold(me.id, id, dto.reason);
  }

  // ---------------------------------------------------------------- config

  @Get("config")
  @AdminRead("ADMIN")
  listConfig() {
    return this.config.list();
  }

  @Get("config/changes")
  @AdminRead("ADMIN")
  configChanges(
    @Query("cursor") cursor?: unknown,
    @Query("limit") limit?: unknown,
    @Query("key") key?: unknown,
  ) {
    return this.config.changes(one("cursor", cursor), limit, one("key", key));
  }

  @Put("config/:key")
  @AdminWrite("ADMIN")
  updateConfig(
    @CurrentMe() me: CurrentMeInfo,
    @Param("key") key: string,
    @Body() dto: UpdateConfigDto,
  ) {
    if (!KEY_RE.test(key)) throw notFound("that setting");
    return this.config.update(me.id, key, dto.value, dto.reason);
  }

  @Post("config/changes/:changeId/rollback")
  @HttpCode(200)
  @AdminWrite("ADMIN")
  rollbackConfig(
    @CurrentMe() me: CurrentMeInfo,
    @Param("changeId", new UuidParam()) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.config.rollback(me.id, id, dto.reason);
  }

  // ---------------------------------------------------------------- audit

  @Get("audit")
  @AdminRead("ADMIN")
  auditLog(
    @Query("cursor") cursor?: unknown,
    @Query("limit") limit?: unknown,
    @Query("action") action?: unknown,
    @Query("targetType") targetType?: unknown,
    @Query("targetId") targetId?: unknown,
  ) {
    return this.audit.list({
      cursor: one("cursor", cursor),
      limit,
      action: one("action", action),
      targetType: one("targetType", targetType),
      targetId: one("targetId", targetId),
    });
  }
}
