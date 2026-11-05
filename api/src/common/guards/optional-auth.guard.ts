import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Guest reads. No token: the request goes through with `req.user` undefined.
 * A token that is present but bad or expired still answers 401, so a client
 * with a stale session learns it is signed out instead of silently seeing the
 * guest view.
 */
@Injectable()
export class OptionalAuthGuard extends AuthGuard("wawu-jwt") {
  handleRequest<T>(
    err: unknown,
    user: T,
    info: unknown,
    context: ExecutionContext,
  ): T {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const hasToken = /^Bearer\s+\S+/i.test(req.headers["authorization"] ?? "");
    if (!hasToken) return undefined as T;
    return super.handleRequest(err, user, info, context);
  }
}
