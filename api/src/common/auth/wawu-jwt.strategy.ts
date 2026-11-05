import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import * as jwksRsa from "jwks-rsa";
import type { VoicesUser } from "./voices-user";

/**
 * A WAWU ID ACCESS token has no `type`; its refresh tokens carry
 * `type: 'refresh'` and are signed with the same key. A refresh token is not a
 * session (same rule as the Hub).
 */
export function isAccessToken(claims: object): boolean {
  const type = (claims as { type?: unknown }).type;
  return type === undefined || type === "access";
}

/**
 * WAWU ID puts the account's standing in the `status` claim ("active", "suspended", "banned", "pending_deletion", ...).
 * A token with NO status claim is treated as active, because older tokens may lack it. Any other value, including one we
 * do not know, can read as a signed-in person but may not write (CONVENTIONS: a suspended or banned account can read,
 * every write is 403 ACCOUNT_SUSPENDED). `until` is null: WAWU ID gives no date.
 */
export function isActiveStatus(claims: object): boolean {
  const status = (claims as { status?: unknown }).status;
  if (status === undefined || status === null) return true;
  return typeof status === "string" && status.trim().toLowerCase() === "active";
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** A person can still appeal a moderation decision while suspended (V-28), and telemetry is not a post. */
const WRITES_OPEN_TO_ANY_STANDING =
  /^\/(?:api\/v1\/)?(?:appeals|events|ads)(?:[/?]|$)/;

/** Called by both auth guards: every write by an account that is not active is refused here, so no module can miss it. */
export function assertAccountCanWrite(
  claims: object | undefined,
  req: { method?: string; originalUrl?: string; url?: string },
): void {
  if (!claims || isActiveStatus(claims)) return;
  if (SAFE_METHODS.has((req.method ?? "GET").toUpperCase())) return;
  if (WRITES_OPEN_TO_ANY_STANDING.test(req.originalUrl ?? req.url ?? ""))
    return;
  throw new ForbiddenException({
    code: "ACCOUNT_SUSPENDED",
    message: "This account cannot post right now.",
    details: { until: null },
  });
}

/**
 * Verifies WAWU ID RS256 access tokens against WAWU ID's JWKS. This API never
 * issues, refreshes or stores tokens: it is a resource server.
 */
@Injectable()
export class WawuJwtStrategy extends PassportStrategy(Strategy, "wawu-jwt") {
  constructor(config: ConfigService) {
    const jwksUri =
      config.get<string>("WAWU_ID_JWKS_URL") ??
      "https://id.wawuafrica.com/.well-known/jwks.json";
    const issuer = config.get<string>("WAWU_ID_JWT_ISSUER");
    const audience = config.get<string>("WAWU_ID_JWT_AUDIENCE");

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ["RS256"],
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
      secretOrKeyProvider: jwksRsa.passportJwtSecret({
        cache: true,
        cacheMaxAge: 24 * 60 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri,
      }),
    });
  }

  validate(payload: VoicesUser & { type?: unknown }): VoicesUser {
    if (!isAccessToken(payload)) throw new UnauthorizedException();
    return payload;
  }
}
