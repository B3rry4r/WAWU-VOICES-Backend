import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { VerifyModule } from "../verify/verify.module";
import { TalkSharedModule } from "../talk/shared/shared.module";
import { DmController } from "./dm.controller";
import { DmService } from "./dm.service";

/**
 * V-DM: one-to-one direct messages. Who may send is decided in ONE place (dm-access.ts). The price, the ledger and the
 * 20-a-day limit are the existing ones, reached through UNITS_PORT (talk/shared/units-access.ts). Voice goes through the
 * media module's ClipsService, with purpose DM.
 */
@Module({
  imports: [TalkSharedModule, MediaModule, VerifyModule],
  controllers: [DmController],
  providers: [DmService],
})
export class DmModule {}
