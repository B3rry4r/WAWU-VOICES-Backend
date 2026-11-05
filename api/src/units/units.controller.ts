import {
  Body,
  Controller,
  HttpCode,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";
import { WawuAuthGuard } from "../common/guards/wawu-auth.guard";
import type { MaybeVoicesUser } from "../common/auth/voices-user";
import { apiError, requireKey } from "./units.errors";
import { PaymentsService } from "./units.payments";
import { UnitsService } from "./units.service";
import { UnitsUsers } from "./units.users";

class InitPaymentDto {
  @IsIn(["UNITS", "EXTRA_VOICE"]) kind!: "UNITS" | "EXTRA_VOICE";
  @IsOptional() @IsUUID() tierId?: string;
  @IsOptional() @IsIn(["SECONDS_30", "SECONDS_60"]) tokenKind?:
    "SECONDS_30" | "SECONDS_60";
  @IsOptional() @IsIn(["card", "banktransfer", "ussd"]) method?:
    "card" | "banktransfer" | "ussd";
  @IsOptional() @IsString() @MaxLength(200) returnPath?: string;
}

class VerifyDto {
  @IsOptional() @IsString() @Matches(/^\d{1,20}$/) providerTxId?: string;
}

/** Voice Units routes (contract tag voice-units). The webhook route is NOT served (V-21): it answers 404. */
@Controller()
export class UnitsController {
  constructor(
    private readonly units: UnitsService,
    private readonly payments: PaymentsService,
    private readonly users: UnitsUsers,
  ) {}

  @Get("units/tiers")
  @UseGuards(OptionalAuthGuard)
  tiers() {
    return this.units.tiers();
  }

  @Get("wallet")
  @UseGuards(WawuAuthGuard)
  async wallet(@CurrentUser() user: MaybeVoicesUser) {
    return this.units.wallet((await this.users.resolve(user)).id);
  }

  @Get("wallet/history/export")
  @UseGuards(WawuAuthGuard)
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header(
    "Content-Disposition",
    'attachment; filename="voice-units-statement.csv"',
  )
  async export(@CurrentUser() user: MaybeVoicesUser) {
    return this.units.statementCsv((await this.users.resolve(user)).id);
  }

  @Get("wallet/history")
  @UseGuards(WawuAuthGuard)
  async history(
    @CurrentUser() user: MaybeVoicesUser,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    let limit = 20;
    if (limitRaw !== undefined) {
      if (!/^\d{1,3}$/.test(limitRaw) || +limitRaw < 1 || +limitRaw > 50)
        throw apiError(422, "VALIDATION_FAILED", "Some details need fixing.", {
          fields: [{ path: "limit", message: "Use 1 to 50." }],
        });
      limit = +limitRaw;
    }
    return this.units.history(
      (await this.users.resolve(user)).id,
      limit,
      cursor || undefined,
    );
  }

  @Post("payments")
  @UseGuards(WawuAuthGuard)
  async init(
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: InitPaymentDto,
  ) {
    const k = requireKey(key);
    const u = await this.users.resolve(user);
    this.users.assertCanWrite(u);
    return this.payments.init(u, body, k);
  }

  @Get("payments/:paymentId")
  @UseGuards(WawuAuthGuard)
  async payment(
    @CurrentUser() user: MaybeVoicesUser,
    @Param(
      "paymentId",
      new ParseUUIDPipe({
        exceptionFactory: () =>
          apiError(404, "NOT_FOUND", "We could not find that payment."),
      }),
    )
    id: string,
  ) {
    return this.payments.view((await this.users.resolve(user)).id, id);
  }

  @Post("payments/:paymentId/verify")
  @HttpCode(200)
  @UseGuards(WawuAuthGuard)
  async verify(
    @CurrentUser() user: MaybeVoicesUser,
    @Headers("idempotency-key") key: string | undefined,
    @Param(
      "paymentId",
      new ParseUUIDPipe({
        exceptionFactory: () =>
          apiError(404, "NOT_FOUND", "We could not find that payment."),
      }),
    )
    id: string,
    @Body() body: VerifyDto,
  ) {
    requireKey(key);
    const u = await this.users.resolve(user);
    return this.payments.verifyMine(u.id, id, body.providerTxId);
  }

  @Get("payments/:paymentId/receipt")
  @UseGuards(WawuAuthGuard)
  async receipt(
    @CurrentUser() user: MaybeVoicesUser,
    @Param(
      "paymentId",
      new ParseUUIDPipe({
        exceptionFactory: () =>
          apiError(404, "NOT_FOUND", "We could not find that payment."),
      }),
    )
    id: string,
  ) {
    return this.payments.receipt((await this.users.resolve(user)).id, id);
  }

  @Get("extra-voice-tokens")
  @UseGuards(WawuAuthGuard)
  async tokens(@CurrentUser() user: MaybeVoicesUser) {
    const a = await this.units.allowances((await this.users.resolve(user)).id);
    return {
      items: a.extraVoiceTokens.filter((t) => t.status === "AVAILABLE"),
    };
  }
}
