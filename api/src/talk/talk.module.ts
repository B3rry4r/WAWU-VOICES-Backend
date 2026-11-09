import { Module } from "@nestjs/common";
import { MoodModule } from "../mood/mood.module";
import { MediaModule } from "../media/media.module";
import { ReachModule } from "../reach/reach.module";
import { EngagementService } from "./engagement.service";
import { ListenRetentionService } from "./listen-retention.service";
import { PostsService } from "./posts.service";
import { TalkSharedModule } from "./shared/shared.module";
import { TalkController } from "./talk.controller";
import { Views } from "./views";

/**
 * Talk: answers (text and voice), replies with a stance, likes, the 10 reactions and reports. Costs go through
 * UNITS_PORT only (talk/shared/units-access.ts). Voice goes through the media module's ClipsService.
 */
@Module({
  imports: [TalkSharedModule, MediaModule, ReachModule, MoodModule],
  controllers: [TalkController],
  providers: [Views, PostsService, EngagementService, ListenRetentionService],
})
export class TalkModule {}
