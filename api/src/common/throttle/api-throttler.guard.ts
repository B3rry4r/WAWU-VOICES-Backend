import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/** Sends the contract's header names (CONVENTIONS.md): RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset. Retry-After stays on a 429. */
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected headerPrefix = "RateLimit";
}
