import { Global, Module } from "@nestjs/common";
import { AdminRolesController } from "./admin-roles.controller";
import { BlocksService } from "./blocks";
import { DeletionService } from "./deletion.service";
import { ExportService, ExportStore } from "./export.service";
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
  controllers: [MeController, PeopleController, AdminRolesController],
  providers: [
    MeService,
    MeConfig,
    Views,
    PeopleService,
    BlocksService,
    DeletionService,
    ExportService,
    ExportStore,
    RolesService,
    ProfileGuard,
    WriterGuard,
    RolesGuard,
  ],
  exports: [MeService, BlocksService, ProfileGuard, WriterGuard, RolesGuard],
})
export class MeModule {}
