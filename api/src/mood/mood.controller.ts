import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { IsBoolean } from "class-validator";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import { PrismaService } from "../common/prisma/prisma.service";
import { isQuestionOpen, isQuestionOver } from "../feed/question-window";
import { ProfileService } from "../talk/shared/profile.service";
import { UuidParam } from "../talk/shared/uuid-pipe";
import { MoodStatsService } from "./mood-stats.service";

class CardNameDto {
  @IsBoolean() showName!: boolean;
}

const gone = () =>
  new NotFoundException({
    code: "NOT_FOUND",
    message: "We could not find that.",
  });

/** LCH-02 / LCH-04 / LCH-03: counts per word, where you sit, and the "Show my name on the card" choice. */
@Controller()
export class MoodController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: MoodStatsService,
    private readonly profiles: ProfileService,
  ) {}

  /** Counts per word on a mood question, for the "How Nigeria feels so far" bar. Public once the question is open. */
  @Get("questions/:questionId/moods")
  async moods(@Param("questionId", UuidParam) id: string) {
    const q = await this.prisma.question.findUnique({
      where: { id },
      select: { moodOptions: true, status: true, startsAt: true, endsAt: true },
    });
    const now = new Date();
    if (
      !q ||
      q.moodOptions.length === 0 ||
      !(isQuestionOpen(q, now) || isQuestionOver(q, now))
    )
      throw gone();
    return this.stats.perWord(id);
  }

  /** Where the signed-in person sits with their own word. Their own published answer only. */
  @Get("answers/:answerId/where-you-sit")
  @UseGuards(WawuAuthGuard)
  async whereYouSit(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
  ) {
    const me = await this.profiles.requireProfile(u);
    const a = await this.prisma.answer.findUnique({
      where: { id },
      include: { author: { select: { countryCode: true } } },
    });
    if (
      !a ||
      a.authorId !== me.id ||
      !a.mood ||
      a.status !== "PUBLISHED" ||
      a.deletedAt
    )
      throw gone();
    return {
      answerId: a.id,
      questionId: a.questionId,
      showNameOnCard: a.showNameOnCard,
      ...(await this.stats.whereYouSit({
        id: a.id,
        questionId: a.questionId,
        authorId: a.authorId,
        mood: a.mood,
        createdAt: a.createdAt,
        countryCode: a.author.countryCode,
      })),
    };
  }

  /** "Show my name on the card": off by default, stored on the answer, changeable any time by its author. */
  @Patch("answers/:answerId/card")
  @UseGuards(WawuAuthGuard)
  async cardName(
    @CurrentUser() u: MaybeVoicesUser,
    @Param("answerId", UuidParam) id: string,
    @Body() dto: CardNameDto,
  ) {
    const me = await this.profiles.requireWriter(u);
    const done = await this.prisma.answer.updateMany({
      where: {
        id,
        authorId: me.id,
        mood: { not: null },
        status: { not: "DELETED_BY_AUTHOR" },
      },
      data: { showNameOnCard: dto.showName },
    });
    if (done.count === 0) throw gone();
    return { answerId: id, showNameOnCard: dto.showName };
  }
}
