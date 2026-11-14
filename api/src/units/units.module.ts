import { Module } from "@nestjs/common";
import { FLW_CLIENT, FlutterwaveClient } from "./flutterwave.client";
import { UnitsController } from "./units.controller";
import { UnitsConfig } from "./units.config";
import { LedgerService } from "./units.ledger";
import { PaymentsService } from "./units.payments";
import { UNITS_PORT } from "./units.port";
import { ReconcileService } from "./units.reconcile";
import { SubscriptionsService } from "./units.subscriptions";
import { UnitsService } from "./units.service";
import { TokensService } from "./units.tokens";
import { UnitsUsers } from "./units.users";

/**
 * Voice Units: the ledger, free allowances, packs and extra voice tokens bought through Flutterwave Standard.
 * Other modules inject UNITS_PORT (never these classes). PaymentsService and ReconcileService are exported for the
 * admin module's re-verify route.
 */
@Module({
  controllers: [UnitsController],
  providers: [
    UnitsConfig,
    LedgerService,
    TokensService,
    PaymentsService,
    SubscriptionsService,
    ReconcileService,
    UnitsService,
    UnitsUsers,
    FlutterwaveClient,
    { provide: FLW_CLIENT, useExisting: FlutterwaveClient },
    { provide: UNITS_PORT, useExisting: UnitsService },
  ],
  exports: [
    UNITS_PORT,
    PaymentsService,
    ReconcileService,
    SubscriptionsService,
    UnitsConfig,
    UnitsService,
  ],
})
export class UnitsModule {}
