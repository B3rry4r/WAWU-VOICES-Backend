import {
  CanActivate,
  Global,
  Injectable,
  Module,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * THE direct-message switch (owner order, 14 Nov 2026): DMS_LIVE=on turns direct messages on; anything else, and unset,
 * means OFF. Read once, when the app starts, through the same ConfigService as every other env value. Changing it
 * needs a restart. The DM code, tables and data are kept; with the switch off the routes answer as if they were not
 * there and nothing else hands out or acts on DMs.
 */
@Injectable()
export class DmLive {
  readonly on: boolean;
  constructor(config: ConfigService) {
    this.on =
      String(config.get("DMS_LIVE") ?? "")
        .trim()
        .toLowerCase() === "on";
  }
}

/** On every route of the DM controller: with the switch off, the answer is the one an unknown route gets, before any other check. */
@Injectable()
export class DmLiveGuard implements CanActivate {
  constructor(private readonly live: DmLive) {}
  canActivate(): boolean {
    if (!this.live.on) throw new NotFoundException();
    return true;
  }
}

@Global()
@Module({ providers: [DmLive, DmLiveGuard], exports: [DmLive, DmLiveGuard] })
export class DmLiveModule {}
