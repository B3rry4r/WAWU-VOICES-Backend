import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { MaybeVoicesUser } from "../auth/voices-user";

/** The verified user, or undefined behind OptionalAuthGuard with no token. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): MaybeVoicesUser =>
    ctx.switchToHttp().getRequest<{ user?: MaybeVoicesUser }>().user,
);
