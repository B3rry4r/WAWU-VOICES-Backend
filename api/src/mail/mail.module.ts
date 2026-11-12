import { Global, Module } from "@nestjs/common";
import { MailEvents } from "./mail-events";
import { MailService } from "./mail.service";

/** VOICES notification mail (V-44, M-b). Global so a service can ask for MailEvents without importing anything. */
@Global()
@Module({
  providers: [MailService, MailEvents],
  exports: [MailService, MailEvents],
})
export class MailModule {}
