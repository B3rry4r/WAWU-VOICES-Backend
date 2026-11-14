import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { CurrentMe, Roles } from "../../me";
import type { CurrentMeInfo } from "../../me";
import { UuidParam } from "../../me/views";
import { IdempotencyService } from "../../results/idempotency.service";
import {
  AdjustDto,
  PageQuery,
  PaymentListQuery,
  SubscriptionListQuery,
} from "./dto";
import { AdminMoneyReportService } from "./money-report.service";
import { AdminMoneyService } from "./money.service";

/** Wallets and payments: ADMIN only. Adjust and reverify need an Idempotency-Key. */
@Controller("admin")
export class AdminMoneyController {
  constructor(
    private readonly svc: AdminMoneyService,
    private readonly report: AdminMoneyReportService,
    private readonly idem: IdempotencyService,
  ) {}

  /** V-ADMIN-MONEY: today, the last 7 and the last 30 Lagos days, summed by the database. */
  @Get("money/overview")
  @Roles("ADMIN")
  overview() {
    return this.report.overview();
  }

  /** V-ADMIN-MONEY: current and ended subscription plans. Read only. */
  @Get("subscriptions")
  @Roles("ADMIN")
  subscriptions(@Query() q: SubscriptionListQuery) {
    return this.report.subscriptions(q);
  }

  @Get("wallets/:userId")
  @Roles("ADMIN")
  wallet(
    @Param("userId", new UuidParam()) userId: string,
    @Query() q: PageQuery,
  ) {
    return this.svc.wallet(userId, q);
  }

  @Post("wallets/:userId/adjust")
  @Roles("ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async adjust(
    @CurrentMe() me: CurrentMeInfo,
    @Param("userId", new UuidParam()) userId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() dto: AdjustDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.idem.run(
      me.id,
      key,
      "POST",
      `/admin/wallets/${userId}/adjust`,
      dto,
      async () => ({
        status: 201,
        body: await this.svc.adjust(
          me,
          userId,
          dto.deltaMilli,
          dto.reason,
          key as string,
        ),
      }),
    );
    res.status(out.status);
    if (out.replay) res.setHeader("Idempotent-Replay", "true");
    return out.body;
  }

  @Get("payments")
  @Roles("ADMIN")
  payments(@Query() q: PaymentListQuery) {
    return this.svc.listPayments(q);
  }

  @Post("payments/:paymentId/reverify")
  @Roles("ADMIN")
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async reverify(
    @CurrentMe() me: CurrentMeInfo,
    @Param("paymentId", new UuidParam()) paymentId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.idem.run(
      me.id,
      key,
      "POST",
      `/admin/payments/${paymentId}/reverify`,
      {},
      async () => ({
        status: 200,
        body: await this.svc.reverify(me, paymentId),
      }),
    );
    res.status(out.status);
    if (out.replay) res.setHeader("Idempotent-Replay", "true");
    return out.body;
  }
}
