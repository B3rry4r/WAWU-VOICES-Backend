import { Module } from "@nestjs/common";
import { MeModule } from "../me/me.module";
import { AdminTrustModule } from "./trust/trust.module";
import { AdminContentController } from "./admin-content.controller";
import { AdminWriteLimitGuard } from "./admin-access";
import { AuditAdminService } from "./audit.service";
import { ConfigAdminService } from "./config.service";
import { GroupsAdminService } from "./groups.service";
import { OverridesAdminService } from "./overrides.service";
import { TodayAdminService } from "./today.service";
import { TopicsAdminService } from "./topics.service";
import { AdminViews } from "./views";
import { WeeklyAdminService } from "./weekly.service";

/**
 * Admin console API (V-12). This file holds the content side (A7a: today, calendar, questions, polls, groups,
 * overrides, weekly reports, config, audit). Trust and money routes (A7b) add their own controllers and providers.
 */
@Module({
  imports: [MeModule, AdminTrustModule],
  controllers: [AdminContentController],
  providers: [
    AdminWriteLimitGuard,
    AdminViews,
    TodayAdminService,
    TopicsAdminService,
    GroupsAdminService,
    OverridesAdminService,
    WeeklyAdminService,
    ConfigAdminService,
    AuditAdminService,
  ],
  exports: [AdminWriteLimitGuard, AdminViews],
})
export class AdminModule {}
