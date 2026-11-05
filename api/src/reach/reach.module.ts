import { Module } from "@nestjs/common";
import { AdsController, AdsService } from "./ads";
import { AnalyticsController, AnalyticsService } from "./analytics";
import { CARD_RENDERER, ResvgCardRenderer } from "./card-renderer";
import { CARD_STORE, SpacesCardStore } from "./card-store";
import { NotificationsController } from "./notifications.controller";
import { ReachService } from "./reach.service";
import { ShareController } from "./share.controller";
import { ShareCardService, ShareService } from "./share.service";
import {
  WeeklyDraftService,
  WEEKLY_DRAFTER,
  makeGeminiWeeklyDrafter,
} from "./weekly-draft";
import { WeeklyController } from "./weekly.controller";
import { WeeklyService } from "./weekly.service";

/**
 * Reach: in-app notifications (V-10, no phone push), the weekly report and its archive (V-19), share data, share pages,
 * share card images, the public ad slot and first-party analytics events. Other modules import ReachModule and call ReachService.notify (wired in a later step).
 */
@Module({
  controllers: [
    NotificationsController,
    WeeklyController,
    ShareController,
    AdsController,
    AnalyticsController,
  ],
  providers: [
    ReachService,
    WeeklyService,
    WeeklyDraftService,
    {
      provide: WEEKLY_DRAFTER,
      useFactory: () =>
        process.env.GEMINI_API_KEY ? makeGeminiWeeklyDrafter() : null,
    },
    ShareService,
    ShareCardService,
    AdsService,
    AnalyticsService,
    { provide: CARD_RENDERER, useFactory: () => new ResvgCardRenderer() },
    { provide: CARD_STORE, useFactory: () => new SpacesCardStore() },
  ],
  exports: [ReachService, WeeklyService, WeeklyDraftService],
})
export class ReachModule {}
