import { Module } from "@nestjs/common";
import { SpacesStore } from "../../media/object-store";
import { ResultsModule } from "../../results/results.module";
import { UnitsModule } from "../../units/units.module";
import { Views } from "../../me/views";
import { AdminAdsController } from "./ads.controller";
import { AdminAdsService } from "./ads.service";
import { ModerationController } from "./moderation.controller";
import { ADMIN_MEDIA_STORE, ModerationService } from "./moderation.service";
import { AdminMoneyController } from "./money.controller";
import { AdminMoneyService } from "./money.service";
import { AdminNewsController } from "./news.controller";
import { AdminNewsService } from "./news.service";
import { AdminResultsController } from "./results.controller";
import { AdminUsersController } from "./users.controller";
import { AdminUsersService } from "./users.service";

/** Admin trust (A7b): moderation, news review, results, people, adverts, wallets and payments. */
@Module({
  imports: [ResultsModule, UnitsModule],
  controllers: [
    ModerationController,
    AdminNewsController,
    AdminResultsController,
    AdminUsersController,
    AdminAdsController,
    AdminMoneyController,
  ],
  providers: [
    Views,
    { provide: ADMIN_MEDIA_STORE, useFactory: () => SpacesStore.fromEnv() },
    ModerationService,
    AdminNewsService,
    AdminUsersService,
    AdminAdsService,
    AdminMoneyService,
  ],
})
export class AdminTrustModule {}
