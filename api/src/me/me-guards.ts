import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { VoicesUser } from "../common/auth/voices-user";
import type { VoicesRole } from "../generated/prisma/enums";
import type { CurrentMeInfo } from "./me-context";
import { MeService } from "./me.service";

type Req = { user?: VoicesUser; me?: CurrentMeInfo };

/** 403 FORBIDDEN, details.reason PROFILE_REQUIRED (CONVENTIONS.md, "Auth and who can do what"). */
export function profileRequired(): ForbiddenException {
  return new ForbiddenException({
    code: "FORBIDDEN",
    message: "Finish setting up your profile first.",
    details: { reason: "PROFILE_REQUIRED" },
  });
}

/**
 * Signed in with a finished profile. Runs after WawuAuthGuard, loads the person by the token's `sub` (never an id the
 * client sent), refreshes the phone hash when the claim changed, and puts `req.me` on the request. Reads are allowed
 * for a suspended, banned or deleting account.
 */
@Injectable()
export class ProfileGuard implements CanActivate {
  constructor(protected readonly me: MeService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Req>();
    if (!req.user) return false;
    const me = await this.me.loadCurrent(req.user);
    if (!me) throw profileRequired();
    req.me = me;
    return true;
  }
}

/** A profile, and the account is allowed to write: not suspended, banned or waiting to be deleted. */
@Injectable()
export class WriterGuard extends ProfileGuard {
  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await super.canActivate(ctx);
    const me = ctx.switchToHttp().getRequest<Req>().me as CurrentMeInfo;
    this.me.assertCanWrite(me);
    return true;
  }
}

const ROLES_KEY = "voices:roles";

/** Staff routes: the person has one of the roles (ADMIN counts as every role) and is not suspended or banned. */
@Injectable()
export class RolesGuard extends ProfileGuard {
  constructor(
    me: MeService,
    private readonly reflector: Reflector,
  ) {
    super(me);
  }

  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await super.canActivate(ctx);
    const me = ctx.switchToHttp().getRequest<Req>().me as CurrentMeInfo;
    this.me.assertCanWrite(me);
    const wanted =
      this.reflector.getAllAndOverride<VoicesRole[]>(ROLES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    if (me.roles.includes("ADMIN")) return true;
    if (wanted.some((r) => me.roles.includes(r))) return true;
    throw new ForbiddenException({
      code: "ROLE_REQUIRED",
      message: "You do not have access to this.",
    });
  }
}

/** Exported for A7 (admin): `@Roles("MODERATOR", "ADMIN")`. Does the sign-in check too, no other guard needed. */
export const Roles = (...roles: VoicesRole[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(WawuAuthGuard, RolesGuard),
  );

/** Signed in with a finished profile (reads). */
export const ProfileRequired = () =>
  applyDecorators(UseGuards(WawuAuthGuard, ProfileGuard));

/** Signed in with a finished profile and allowed to write. Every post, reaction, vote and payment route uses this. */
export const WriteAccess = () =>
  applyDecorators(UseGuards(WawuAuthGuard, WriterGuard));

/** The person behind the request. Only behind ProfileRequired, WriteAccess or Roles. */
export const CurrentMe = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): CurrentMeInfo =>
    ctx.switchToHttp().getRequest<Req>().me as CurrentMeInfo,
);
