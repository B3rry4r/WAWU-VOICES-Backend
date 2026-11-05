import { Module } from "@nestjs/common";
import { FeedController } from "./feed.controller";
import { FeedService } from "./feed.service";
import { PublicConfig } from "./public-config";

/** Feed: topics, calendar, categories, today, home, discover, trending, search (task A2). */
@Module({
  controllers: [FeedController],
  providers: [FeedService, PublicConfig],
  exports: [FeedService],
})
export class FeedModule {}
