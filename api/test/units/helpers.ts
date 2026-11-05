import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TEST_DATABASE_URL } from "../test-env";
import { TestJwks } from "../test-jwks";
import { apiError } from "../../src/units/units.errors";
import type {
  FlutterwavePort,
  FlwInitRequest,
  FlwTransaction,
  FlwVerifyResult,
} from "../../src/units/flutterwave.client";

/** Recorded-shape Flutterwave answers (fixtures only: no test ever calls Flutterwave). */
export function fixture(name: string): {
  status: string;
  message: string;
  data: FlwTransaction | null;
} {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", name), "utf8"),
  ) as ReturnType<typeof fixture>;
}

/** A stand-in for Flutterwave's side: what it knows about each tx_ref and id. Answers in the recorded shapes. */
export class FakeFlutterwave implements FlutterwavePort {
  byRef = new Map<string, FlwTransaction>();
  byId = new Map<string, FlwTransaction>();
  inits: FlwInitRequest[] = [];
  failInit = false;
  calls = { byId: 0, byRef: 0 };
  private next = 900000;

  reset(): void {
    this.byRef.clear();
    this.byId.clear();
    this.inits = [];
    this.failInit = false;
    this.calls = { byId: 0, byRef: 0 };
  }

  /** The provider records a transaction for a reference. `over` changes fields (amount, currency, status, id ...). */
  record(
    txRef: string,
    template: string,
    over: Partial<FlwTransaction> = {},
  ): FlwTransaction {
    const tx = {
      ...fixture(template).data!,
      id: this.next++,
      tx_ref: txRef,
      ...over,
    } as FlwTransaction;
    this.byRef.set(txRef, tx);
    this.byId.set(String(tx.id), tx);
    return tx;
  }

  pay(
    txRef: string,
    amountNaira: number,
    over: Partial<FlwTransaction> = {},
  ): FlwTransaction {
    return this.record(txRef, "flw-verify-successful.json", {
      amount: amountNaira,
      charged_amount: amountNaira,
      ...over,
    });
  }

  private answer(tx: FlwTransaction | undefined): FlwVerifyResult {
    if (!tx) return { found: false, raw: fixture("flw-verify-notfound.json") };
    const raw = { ...fixture("flw-verify-successful.json"), data: tx };
    return { found: true, data: tx, raw };
  }

  initCheckout(req: FlwInitRequest): Promise<{ link: string }> {
    this.inits.push(req);
    if (this.failInit)
      return Promise.reject(
        apiError(
          503,
          "UNAVAILABLE",
          "Payments are not available right now. Try again soon.",
        ),
      );
    const link = (
      fixture("flw-init-ok.json").data as unknown as { link: string }
    ).link.replace("TEMPLATE", req.txRef);
    return Promise.resolve({ link });
  }
  verifyById(id: string): Promise<FlwVerifyResult> {
    this.calls.byId++;
    return Promise.resolve(this.answer(this.byId.get(id)));
  }
  verifyByReference(txRef: string): Promise<FlwVerifyResult> {
    this.calls.byRef++;
    return Promise.resolve(this.answer(this.byRef.get(txRef)));
  }
}

export interface Harness {
  app: INestApplication;
  jwks: TestJwks;
  flw: FakeFlutterwave;
  close(): Promise<void>;
}

export async function boot(): Promise<Harness> {
  const jwks = new TestJwks();
  await jwks.start();
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.WAWU_ID_JWKS_URL = jwks.url;
  process.env.THROTTLE_LIMIT = "1000000";
  process.env.APP_BASE_URL = "https://voices.test";
  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/app-config.js");
  const { FLW_CLIENT } = await import("../../src/units/flutterwave.client.js");
  const flw = new FakeFlutterwave();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FLW_CLIENT)
    .useValue(flw)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    jwks,
    flw,
    close: async () => {
      await app.close();
      await jwks.stop();
    },
  };
}

/** Empty every table the units tests touch. TRUNCATE is the only way: the ledger tables refuse DELETE. */
export async function resetDb(prisma: {
  $executeRawUnsafe(q: string): Promise<number>;
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "User","LedgerTransaction","UnitTier","ConfigEntry","Notification","Payment","Charge","Wallet","FreeAllowance","UsageCounter","ExtraVoiceToken" CASCADE`,
  );
}
