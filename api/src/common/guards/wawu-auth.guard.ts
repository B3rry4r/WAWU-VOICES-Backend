import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/** The 401 for a bad token: TOKEN_EXPIRED when the token was valid but is out of date, else UNAUTHENTICATED. */
export function authFailure(info: unknown): UnauthorizedException {
  const name = (info as { name?: unknown } | null)?.name;
  return name === "TokenExpiredError"
    ? new UnauthorizedException({
        code: "TOKEN_EXPIRED",
        message: "Your session has expired. Sign in again.",
      })
    : new UnauthorizedException({
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
      });
}

/** Signed-in only. Missing or bad token: 401. */
@Injectable()
export class WawuAuthGuard extends AuthGuard("wawu-jwt") {
  handleRequest<T>(
    err: unknown,
    user: T,
    info: unknown,
    _context: ExecutionContext,
  ): T {
    if (err || !user) throw authFailure(info);
    return user;
  }
}
