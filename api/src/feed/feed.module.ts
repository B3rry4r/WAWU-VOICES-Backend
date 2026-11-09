import { Module } from "@nestjs/common";
import { FeedController } from "./feed.controller";
import { FeedService } from "./feed.service";
import { GuestReadCache } from "./guest-cache";
import { PublicConfig } from "./public-config";
import { RankingService } from "./ranking.service";

/** Feed: topics, calendar, categories, today, home, discover, trending, search (task A2). */
@Module({
  controllers: [FeedController],
  providers: [FeedService, PublicConfig, RankingService, GuestReadCache],
  exports: [FeedService, RankingService],
})
export class FeedModule {}
