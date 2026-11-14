import type { Server } from "node:http";

/**
 * SIGTERM / SIGINT: stop taking new connections, let requests already running finish (up to `timeoutMs`), close the app,
 * then exit. Idle keep-alive connections are closed at once and again as running requests finish, so the wait ends when
 * the last request ends. A request still running after `timeoutMs` is cut and the process exits with 1.
 */
export function gracefulStop(
  server: Server,
  closeApp: () => Promise<void>,
  opts: { timeoutMs?: number; exit?: (code: number) => void } = {},
): () => void {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let stopping = false;
  return () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => exit(1), timeoutMs);
    timer.unref();
    const sweep = setInterval(() => server.closeIdleConnections(), 100);
    sweep.unref();
    server.close(() => {
      clearInterval(sweep);
      closeApp().then(
        () => exit(0),
        () => exit(1),
      );
    });
    server.closeIdleConnections();
  };
}
