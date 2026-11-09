import { Module } from "@nestjs/common";
import { TalkSharedModule } from "../talk/shared/shared.module";
import { MoodController } from "./mood.controller";
import { MoodStatsService } from "./mood-stats.service";

/** The launch question's mood words: counts per word, where you sit (LCH-04) and the card's name choice (LCH-03). */
@Module({
  imports: [TalkSharedModule],
  controllers: [MoodController],
  providers: [MoodStatsService],
  exports: [MoodStatsService],
})
export class MoodModule {}
