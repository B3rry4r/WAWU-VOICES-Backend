import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gracefulStop } from "../../src/graceful-stop";

/** V-LINK-IN-TX: SIGTERM lets requests in flight finish, takes no new ones, and exits after at most the timeout. */
describe("gracefulStop", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.closeAllConnections();
  });

  async function start(delayMs: number) {
    const server = createServer((_req, res) => {
      setTimeout(() => res.end("done"), delayMs);
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { server, port: (server.address() as AddressInfo).port };
  }
  const get = (port: number) =>
    new Promise<string>((resolve, reject) => {
      request({ port, host: "127.0.0.1", agent: undefined }, (res) => {
        let b = "";
        res.on("data", (c: Buffer) => (b += c.toString()));
        res.on("end", () => resolve(b));
      })
        .on("error", reject)
        .end();
    });

  it("a request in flight finishes, a new one is refused, then exit 0", async () => {
    const { server, port } = await start(400);
    const exits: number[] = [];
    const closed = jest.fn(() => Promise.resolve());
    const stop = gracefulStop(server, closed, { exit: (c) => exits.push(c) });
    const inflight = get(port);
    await new Promise((r) => setTimeout(r, 100));
    stop();
    await new Promise((r) => setTimeout(r, 50));
    await expect(get(port)).rejects.toBeDefined(); // no new connection is taken
    expect(exits).toEqual([]); // still waiting for the request in flight
    expect(await inflight).toBe("done");
    await new Promise((r) => setTimeout(r, 150));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });

  it("a request that outlasts the timeout is cut and the exit code is 1", async () => {
    const { server, port } = await start(5000);
    const exits: number[] = [];
    const stop = gracefulStop(server, () => Promise.resolve(), {
      timeoutMs: 300,
      exit: (c) => exits.push(c),
    });
    const inflight = get(port).catch(() => "cut");
    await new Promise((r) => setTimeout(r, 100));
    stop();
    await new Promise((r) => setTimeout(r, 500));
    expect(exits).toEqual([1]);
    server.closeAllConnections();
    expect(await inflight).toBe("cut");
  });

  it("a second signal does nothing", async () => {
    const { server } = await start(10);
    const closed = jest.fn(() => Promise.resolve());
    const exits: number[] = [];
    const stop = gracefulStop(server, closed, { exit: (c) => exits.push(c) });
    stop();
    stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });
});
