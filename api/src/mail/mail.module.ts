import { Global, Module } from "@nestjs/common";
import { MailAudienceController } from "./mail-audience.controller";
import { MailAudienceService } from "./mail-audience.service";
import { MailEvents } from "./mail-events";
import { MailService } from "./mail.service";

/** VOICES notification mail (V-44, M-b). Global so a service can ask for MailEvents without importing anything. */
@Global()
@Module({
  controllers: [MailAudienceController],
  providers: [MailService, MailEvents, MailAudienceService],
  exports: [MailService, MailEvents],
})
export class MailModule {}
