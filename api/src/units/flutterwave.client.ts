import { Injectable, Logger } from "@nestjs/common";
import { apiError } from "./units.errors";

/** The slice of a Flutterwave verify answer VOICES reads. Everything is checked against the stored payment. */
export interface FlwTransaction {
  id: number | string;
  tx_ref: string;
  status: string;
  amount: number | string;
  currency: string;
  payment_type?: string;
  processor_response?: string;
  card?: { last_4digits?: string };
  [k: string]: unknown;
}

export interface FlwVerifyResult {
  /** false when Flutterwave knows no such transaction. */
  found: boolean;
  data?: FlwTransaction;
  raw: unknown;
}

export interface FlwInitRequest {
  txRef: string;
  amountNaira: number;
  currency: "NGN";
  redirectUrl: string;
  customerEmail: string;
  title: string;
  paymentOptions?: string;
  meta?: Record<string, string>;
}

/** Test seam: the real client talks to Flutterwave; tests supply recorded responses through this token. */
export const FLW_CLIENT = Symbol("FLW_CLIENT");

export interface FlutterwavePort {
  initCheckout(req: FlwInitRequest): Promise<{ link: string }>;
  verifyById(id: string): Promise<FlwVerifyResult>;
  verifyByReference(txRef: string): Promise<FlwVerifyResult>;
}

@Injectable()
export class FlutterwaveClient implements FlutterwavePort {
  private readonly logger = new Logger(FlutterwaveClient.name);

  private get base(): string {
    return process.env.FLW_BASE_URL || "https://api.flutterwave.com/v3";
  }

  private async call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const key = process.env.FLW_SECRET_KEY;
    if (!key)
      throw apiError(
        503,
        "UNAVAILABLE",
        "Payments are not available right now. Try again soon.",
      );
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const json: unknown = await res.json().catch(() => null);
      return { status: res.status, json };
    } catch (e) {
      this.logger.warn(
        `Flutterwave ${method} ${path.split("?")[0]} failed: ${(e as Error).name}`,
      );
      throw apiError(
        503,
        "UNAVAILABLE",
        "Payments are not available right now. Try again soon.",
      );
    }
  }

  async initCheckout(req: FlwInitRequest): Promise<{ link: string }> {
    const { status, json } = await this.call("POST", "/payments", {
      tx_ref: req.txRef,
      amount: req.amountNaira,
      currency: req.currency,
      redirect_url: req.redirectUrl,
      customer: { email: req.customerEmail },
      customizations: { title: req.title },
      payment_options: req.paymentOptions,
      meta: req.meta,
    });
    const link = (json as { data?: { link?: unknown } } | null)?.data?.link;
    if (status >= 300 || typeof link !== "string")
      throw apiError(
        503,
        "UNAVAILABLE",
        "Payments are not available right now. Try again soon.",
      );
    return { link };
  }

  private parse(status: number, json: unknown): FlwVerifyResult {
    const j = json as { status?: string; data?: FlwTransaction } | null;
    if (
      status === 200 &&
      j?.status === "success" &&
      j.data &&
      typeof j.data === "object"
    )
      return { found: true, data: j.data, raw: json };
    if (status === 400 || status === 404) return { found: false, raw: json };
    throw apiError(
      503,
      "UNAVAILABLE",
      "Payments are not available right now. Try again soon.",
    );
  }

  async verifyById(id: string): Promise<FlwVerifyResult> {
    const r = await this.call(
      "GET",
      `/transactions/${encodeURIComponent(id)}/verify`,
    );
    return this.parse(r.status, r.json);
  }

  async verifyByReference(txRef: string): Promise<FlwVerifyResult> {
    const r = await this.call(
      "GET",
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`,
    );
    return this.parse(r.status, r.json);
  }
}
