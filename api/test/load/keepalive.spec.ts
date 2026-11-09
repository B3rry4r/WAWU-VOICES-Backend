import http from "node:http";
import type { AddressInfo } from "node:net";
import { startHarness, type Harness } from "../talk/harness";
import { tuneServer } from "../../src/app-config";

/**
 * LCH-09 F2: the API keeps an idle connection open for 65 s (nginx's keepalive is 60 s), so nginx never sends a request on a
 * connection Node is closing. Node's default is 5 s: a connection idle for 6 s used to be closed by Node.
 */
describe("idle connections from nginx", () => {
  let h: Harness;
  const server = () => h.app.getHttpServer() as unknown as http.Server;
  beforeAll(async () => {
    h = await startHarness();
    await h.app.listen(0, "127.0.0.1");
    tuneServer(server());
  });
  afterAll(() => h.close());

  it("sets keepAliveTimeout to 65 s and headersTimeout above it", () => {
    const s = server();
    expect(s.keepAliveTimeout).toBe(65_000);
    expect(s.headersTimeout).toBeGreaterThan(s.keepAliveTimeout);
  });

  it("a connection idle for 7 s is still open and serves the next request (no reset)", async () => {
    const port = (server().address() as AddressInfo).port;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const get = () =>
      new Promise<number>((resolve, reject) => {
        http
          .get(
            { host: "127.0.0.1", port, path: "/api/health", agent },
            (res) => {
              res.resume();
              res.on("end", () => resolve(res.statusCode ?? 0));
            },
          )
          .on("error", reject);
      });
    try {
      expect(await get()).toBe(200);
      await new Promise((r) => setTimeout(r, 7000));
      expect(await get()).toBe(200);
    } finally {
      agent.destroy();
    }
  }, 30000);
});
