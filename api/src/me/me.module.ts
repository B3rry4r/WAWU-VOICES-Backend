import { Global, Module } from "@nestjs/common";
import { UnitsModule } from "../units/units.module";
import { VerifyModule } from "../verify/verify.module";
import { AdminRolesController } from "./admin-roles.controller";
import { BlocksService } from "./blocks";
import { DeletionService } from "./deletion.service";
import { ExportService, ExportStore } from "./export.service";
import { InviteController } from "./invite.controller";
import { InviteLookupController } from "./invite-lookup.controller";
import { InviteService } from "./invite.service";
import { MeConfig } from "./me-config";
import { ProfileGuard, RolesGuard, WriterGuard } from "./me-guards";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";
import { PeopleController } from "./people.controller";
import { PeopleService } from "./people.service";
import { RolesService } from "./roles.service";
import { Views } from "./views";

/**
 * Me: identity, profile, settings, blocks, deletion and VOICES roles (A1). Global so every other module can use the guards
 * (`ProfileRequired`, `WriteAccess`, `Roles`) and `BlocksService` / `visibleUser` without importing anything.
 */
@Global()
@Module({
  imports: [UnitsModule, VerifyModule],
  controllers: [
    MeController,
    InviteController,
    InviteLookupController,
    PeopleController,
    AdminRolesController,
  ],
  providers: [
    MeService,
    MeConfig,
    Views,
    PeopleService,
    BlocksService,
    DeletionService,
    ExportService,
    ExportStore,
    InviteService,
    RolesService,
    ProfileGuard,
    WriterGuard,
    RolesGuard,
  ],
  exports: [MeService, BlocksService, ProfileGuard, WriterGuard, RolesGuard],
})
export class MeModule {}
