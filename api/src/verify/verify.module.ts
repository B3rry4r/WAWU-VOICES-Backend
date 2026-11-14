import { Module } from "@nestjs/common";
import { VerificationAdminController } from "./verification-admin.controller";
import { VerificationAdminService } from "./verification-admin.service";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";
import {
  SpacesVerificationStore,
  VERIFICATION_STORE,
} from "./verification.store";

/**
 * Verification (V-46): ID and utility bill, the admin queue, the private document store and the jobs. Imported by the Me
 * module (account deletion removes the documents) and the Vote module (suggesting an idea needs a verified person).
 * It imports no other feature module, so there is no cycle. Guards come from the global Me module.
 */
@Module({
  controllers: [VerificationController, VerificationAdminController],
  providers: [
    VerificationService,
    VerificationAdminService,
    {
      provide: VERIFICATION_STORE,
      useFactory: () => SpacesVerificationStore.fromEnv(),
    },
  ],
  exports: [VerificationService],
})
export class VerifyModule {}
