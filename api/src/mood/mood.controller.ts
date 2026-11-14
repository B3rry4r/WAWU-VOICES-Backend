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
import { isQuestionReadable } from "../feed/question-window";
import { ProfileService } from "../talk/shared/profile.service";
import { UuidParam } from "../talk/shared/uuid-pipe";
import { likePrefix } from "../reach/like-prefix";
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
    if (!q || q.moodOptions.length === 0 || !isQuestionReadable(q, now))
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
      include: {
        author: { select: { countryCode: true } },
        question: { select: { status: true, startsAt: true, endsAt: true } },
      },
    });
    if (
      !a ||
      !isQuestionReadable(a.question, new Date()) ||
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

  /**
   * The stored 1200x630 card may carry the name, so it is dropped here, on the server, with no help from the page: every
   * link of this answer goes back to PENDING (the next ask draws it again from the answer as it now is, and 202 until
   * then), and the old picture is marked for deletion. Story and square are drawn on request and follow at once.
   */
  private async dropStoredCards(answerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const links = await tx.shortLink.findMany({
        where: { objectType: "ANSWER", objectId: answerId },
        select: { id: true, code: true },
      });
      for (const l of links) {
        await tx.$executeRaw`
          UPDATE "StoredFile" SET "purgeRequestedAt" = now()
          WHERE kind = 'SHARE_CARD' AND "purgedAt" IS NULL AND "purgeRequestedAt" IS NULL
            AND key LIKE ${likePrefix(`share/${l.code}/`)} ESCAPE '\\'`;
        await tx.shareCard.updateMany({
          where: { linkId: l.id },
          data: {
            status: "PENDING",
            storyFileId: null,
            squareFileId: null,
            readyAt: null,
          },
        });
      }
    });
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
    await this.dropStoredCards(id);
    return { answerId: id, showNameOnCard: dto.showName };
  }
}
