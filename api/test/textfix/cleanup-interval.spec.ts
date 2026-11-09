import {
  TEXTFIX_CLEANUP_EVERY_MS,
  TextFixCleanupService,
} from "../../src/textfix/textfix-cleanup.service";

/**
 * BEFORE LAUNCH (privacy accuracy): Fix my text results are kept up to 10 minutes. The job that deletes them runs every
 * minute, so a row is gone about 11 minutes after it was stored at the latest, never 15.
 */
describe("Fix my text cleanup interval", () => {
  const env = { ...process.env };
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NODE_ENV = "production";
    delete process.env.TEXTFIX_CLEANUP_INTERVAL_MS;
  });
  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...env };
  });

  it("is one minute by default", () => {
    expect(TEXTFIX_CLEANUP_EVERY_MS).toBe(60_000);
  });

  it("runs the delete once a minute, not every five", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const svc = new TextFixCleanupService({
      idempotencyRecord: { deleteMany },
    } as never);
    svc.onModuleInit();
    await jest.advanceTimersByTimeAsync(59_999);
    expect(deleteMany).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(4 * 60_000);
    expect(deleteMany).toHaveBeenCalledTimes(5);
    svc.onModuleDestroy();
  });
});
