import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, KeyObject } from "node:crypto";
import * as jwt from "jsonwebtoken";

/** A local WAWU ID stand-in for tests: a fresh RSA key and a JWKS endpoint. */
export class TestJwks {
  private server!: Server;
  private privateKey!: KeyObject;
  private jwk!: Record<string, unknown>;
  readonly kid = "test-key-1";
  url = "";

  async start(): Promise<void> {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    this.privateKey = privateKey;
    this.jwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: this.kid,
      use: "sig",
      alg: "RS256",
    };
    this.server = createServer((req, res) => {
      if (req.url === "/.well-known/jwks.json") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [this.jwk] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/.well-known/jwks.json`;
  }

  sign(
    claims: Record<string, unknown> = {},
    opts: jwt.SignOptions = {},
  ): string {
    return jwt.sign(
      { sub: "user-1", email: "a@example.com", ...claims },
      this.privateKey,
      {
        algorithm: "RS256",
        keyid: this.kid,
        expiresIn: "10m",
        ...opts,
      },
    );
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
