import { Module } from "@nestjs/common";
import { UnitsModule } from "../units/units.module";
import { PollService } from "./poll.service";
import { ProposalService } from "./proposal.service";
import { RedisCache } from "./redis-cache";
import { Actors, Idempotency, RateLimiter } from "./support";
import { VoteConfig } from "./vote-config";
import { VoteController } from "./vote.controller";
import { Views } from "./views";

/**
 * Vote: polls and votes, live results, explain my vote, What Next? proposals with support and challenge, and the
 * editorial summary a reader sees. Spends units only through UNITS_PORT (units module).
 */
@Module({
  imports: [UnitsModule],
  controllers: [VoteController],
  providers: [
    RedisCache,
    VoteConfig,
    Actors,
    RateLimiter,
    Idempotency,
    Views,
    PollService,
    ProposalService,
  ],
})
export class VoteModule {}
