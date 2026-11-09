// LCH-09 stand-ins, one process, never a real service:
//   WAWU ID  (--id-port):     POST /auth/register, /auth/email/verify/start, /auth/email/verify/confirm, /auth/login, /auth/refresh
//                             and GET /.well-known/jwks.json. Tokens are RS256 with a key made at start-up.
//   Spaces   (--spaces-port): the S3 calls the API makes (presigned PUT, HEAD, GET, DELETE), path style, kept in memory.
// GET /__stats on either port says how many calls each has had.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const idPort = Number(arg("id-port", 15003));
const spacesPort = Number(arg("spaces-port", 15004));
const apiDir = arg("api-dir", join(process.cwd(), "api"));
const jwt = createRequire(join(apiDir, "package.json"))("jsonwebtoken");

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "load-1", use: "sig", alg: "RS256" };
const stats = { id: {}, spaces: {}, started: Date.now() };
const count = (grp, k) => { stats[grp][k] = (stats[grp][k] ?? 0) + 1; };

const users = new Map(); // email -> { id, fullName, phone, email }
const body = (req) => new Promise((res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => res(Buffer.concat(c))); });
const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(b) }); res.end(b); };

function tokens(u) {
  const base = { sub: u.id, email: u.email, phone: u.phone, firstName: u.fullName.split(" ")[0], status: "active" };
  const opt = { algorithm: "RS256", keyid: "load-1" };
  return {
    accessToken: jwt.sign(base, privateKey, { ...opt, expiresIn: "15m" }),
    refreshToken: jwt.sign({ sub: u.id, type: "refresh" }, privateKey, { ...opt, expiresIn: "30d" }),
    user: { id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, status: "active" },
  };
}

createServer(async (req, res) => {
  const path = (req.url ?? "").split("?")[0];
  count("id", `${req.method} ${path}`);
  if (path === "/__stats") return json(res, 200, stats);
  if (path === "/.well-known/jwks.json") return json(res, 200, { keys: [jwk] });
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }); return res.end(); }
  let b = {};
  try { b = JSON.parse((await body(req)).toString() || "{}"); } catch { /* empty */ }
  const email = String(b.email ?? b.identifier ?? "").toLowerCase();
  if (path === "/auth/register") {
    const u = { id: randomUUID(), fullName: String(b.fullName ?? "Load Person"), phone: String(b.phone ?? ""), email };
    users.set(email, u);
    return json(res, 201, { data: tokens(u) });
  }
  if (path === "/auth/email/verify/start") return json(res, 200, { data: { message: "sent", expiresIn: 300 } });
  const u = users.get(email);
  if (path === "/auth/email/verify/confirm" || path === "/auth/login") return u ? json(res, 200, { data: tokens(u) }) : json(res, 401, { message: "Wrong details.", code: "INVALID_CREDENTIALS" });
  if (path === "/auth/refresh") {
    try {
      const c = jwt.verify(String(b.refreshToken), publicKey, { algorithms: ["RS256"] });
      const found = [...users.values()].find((x) => x.id === c.sub);
      return found ? json(res, 200, { data: tokens(found) }) : json(res, 401, { message: "Unknown." });
    } catch { return json(res, 401, { message: "Expired." }); }
  }
  json(res, 404, { message: "no such stand-in route" });
}).listen(idPort, "127.0.0.1", () => console.log(`WAWU ID stand-in on ${idPort}`));

// ---- Spaces: /<bucket>/<key>, signatures ignored. Objects live in memory only.
const objects = new Map();
createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "").split("?")[0]);
  count("spaces", req.method ?? "?");
  if (path === "/__stats") return json(res, 200, { ...stats.spaces, objects: objects.size });
  const key = path.split("/").slice(2).join("/"); // drop "", bucket
  if (req.method === "PUT") { const d = await body(req); objects.set(key, { d, type: req.headers["content-type"] ?? "application/octet-stream" }); res.writeHead(200, { etag: '"x"' }); return res.end(); }
  if (req.method === "HEAD") { const o = objects.get(key); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-length": o.d.length, "content-type": o.type }); return res.end(); }
  if (req.method === "GET") { const o = objects.get(key); if (!o) { res.writeHead(404, { "content-type": "application/xml" }); return res.end("<Error><Code>NoSuchKey</Code></Error>"); } res.writeHead(200, { "content-length": o.d.length, "content-type": o.type }); return res.end(o.d); }
  if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
  res.writeHead(405); res.end();
}).listen(spacesPort, "127.0.0.1", () => console.log(`Spaces stand-in on ${spacesPort}`));
