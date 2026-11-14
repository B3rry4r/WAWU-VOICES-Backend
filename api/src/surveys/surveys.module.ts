import {
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  Logger,
} from "@nestjs/common";
import { FileAttachModule } from "../media/file-attach.service";
import { MeModule } from "../me/me.module";
import { BrandsService } from "./brands.service";
import { AdminSurveysController } from "./surveys-admin.controller";
import { AdminSurveysService } from "./surveys-admin.service";
import { SurveysController } from "./surveys.controller";
import { SurveysPublicService } from "./surveys-public.service";

/** V-SURVEYS: sponsored surveys, their results for the brand, and brand pages. */
@Module({
  imports: [MeModule, FileAttachModule],
  controllers: [AdminSurveysController, SurveysController],
  providers: [AdminSurveysService, SurveysPublicService, BrandsService],
})
export class SurveysModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SurveysModule.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly admin: AdminSurveysService) {}

  /** F04 for surveys whose end date has passed: checked every ten minutes. Off in tests (they call sweepFinished). */
  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.ADMIN_JOBS === "off")
      return;
    this.timer = setInterval(() => {
      this.admin
        .sweepFinished()
        .catch((e) => this.logger.error(`survey sweep failed: ${String(e)}`));
    }, 600_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
