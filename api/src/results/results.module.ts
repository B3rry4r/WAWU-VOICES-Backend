import { Module } from "@nestjs/common";
import { ActorService } from "./actor.service";
import { IdempotencyService } from "./idempotency.service";
import { ResultsController } from "./results.controller";
import { ResultsService } from "./results.service";

/**
 * Results (V-7, V-8). The admin console (A7) imports this module and calls ResultsService:
 * adminListPosts, adminGetPost, decide, adminListThreads, adminCreateThread. Each checks the caller's role itself.
 */
@Module({
  controllers: [ResultsController],
  providers: [ResultsService, ActorService, IdempotencyService],
  exports: [ResultsService, ActorService, IdempotencyService],
})
export class ResultsModule {}
