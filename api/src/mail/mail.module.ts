import { Global, Module } from "@nestjs/common";
import { MailAudienceController } from "./mail-audience.controller";
import { MailAudienceService } from "./mail-audience.service";
import { MailEvents } from "./mail-events";
import { MailService } from "./mail.service";
import { MailUnsubscribeController } from "./mail-unsubscribe.controller";
import { TopicMailService } from "./topic-mail.service";

/** VOICES notification mail (V-44, M-b). Global so a service can ask for MailEvents without importing anything. */
@Global()
@Module({
  controllers: [MailAudienceController, MailUnsubscribeController],
  providers: [MailService, MailEvents, MailAudienceService, TopicMailService],
  exports: [MailService, MailEvents, TopicMailService],
})
export class MailModule {}
