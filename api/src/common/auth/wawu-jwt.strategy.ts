import { Injectable, UnauthorizedException } from "@nestjs/common";
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
