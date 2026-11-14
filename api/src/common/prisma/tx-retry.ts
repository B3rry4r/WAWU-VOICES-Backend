/**
 * Runs a database transaction again when Postgres picked it as the loser of a deadlock (40P01) or could not serialize it
 * (40001). At most 2 more tries, each after a short random wait. Use it ONLY around a transaction whose body does nothing
 * outside the database before it commits (no mail, no provider call, no queue push), and whose body can start from the top
 * again (it keeps no state from the failed try). Every other error is thrown at once.
 */
export const TX_RETRIES = 2;

/** True for a Postgres deadlock or serialization failure, however the driver or Prisma wraps it. */
export function isRetryableTxError(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  for (let depth = 0; cur && typeof cur === "object" && depth < 6; depth++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    const o = cur as {
      code?: unknown;
      message?: unknown;
      meta?: {
        code?: unknown;
        message?: unknown;
        driverAdapterError?: unknown;
      };
      cause?: unknown;
      originalCode?: unknown;
    };
    for (const c of [o.code, o.originalCode, o.meta?.code])
      if (c === "40P01" || c === "40001" || c === "P2034") return true;
    const text = `${typeof o.message === "string" ? o.message : ""} ${
      typeof o.meta?.message === "string" ? o.meta.message : ""
    } ${JSON.stringify(o.meta?.driverAdapterError ?? "")}`;
    if (/40P01|40001|deadlock detected|could not serialize access/i.test(text))
      return true;
    cur = o.cause;
  }
  return false;
}

export async function withTxRetry<T>(
  run: () => Promise<T>,
  onRetry?: (attempt: number) => void,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= TX_RETRIES || !isRetryableTxError(e)) throw e;
      onRetry?.(attempt + 1);
      await wait(20 + Math.floor(Math.random() * 80));
    }
  }
}
