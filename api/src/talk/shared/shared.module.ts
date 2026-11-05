import { Module } from "@nestjs/common";
import { UnitsModule } from "../../units/units.module";
import { AllowancesService } from "./allowances.service";
import { ConfigReader } from "./config-reader";
import { IdempotencyService } from "./idempotency.service";
import { ProfileService } from "./profile.service";
import { RateLimitGuard } from "./rate-limit";
import { UnitsAccess } from "./units-access";

const PROVIDERS = [
  ConfigReader,
  ProfileService,
  IdempotencyService,
  RateLimitGuard,
  UnitsAccess,
  AllowancesService,
];

/** Helpers shared by the talk and media modules (one instance each, so the rate limiter is one window). */
@Module({ imports: [UnitsModule], providers: PROVIDERS, exports: PROVIDERS })
export class TalkSharedModule {}
