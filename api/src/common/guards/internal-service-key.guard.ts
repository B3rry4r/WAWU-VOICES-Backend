import { createHash, timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

/**
 * Service-to-service routes under /internal (EMAIL-03, V-AUD). The caller sends X-Service-Key; it must equal
 * INTERNAL_SERVICE_KEY. Both sides are hashed first so the compare is constant-time whatever their lengths. With no key
 * set here, nobody gets in. There is no user auth on these routes, so this guard is mandatory on every one.
 */
@Injectable()
export class InternalServiceKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>("INTERNAL_SERVICE_KEY")?.trim();
    const given = context.switchToHttp().getRequest<Request>().headers[
      "x-service-key"
    ];
    if (!expected || typeof given !== "string" || given.length === 0) {
      throw new UnauthorizedException();
    }
    const digest = (v: string) => createHash("sha256").update(v).digest();
    if (!timingSafeEqual(digest(given), digest(expected))) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
