// LCH-09: how each per-address limit behaves, from one address and from a few. Needs the stack up (scripts/load/stack.sh up).
//   node scripts/load/limits.mjs suite                   every limit, one address each, until the first 429 (about a minute)
//   node scripts/load/limits.mjs nginx --rate 200 --secs 5     the nginx limit (20 r/s, burst 40) from one address
// The app's limits are counted per address, so the suite goes to the API port directly with X-Forwarded-For set (the API
// trusts the last address on that header, the one nginx would add). The nginx limit is measured through nginx.
// The result is a table of: the limit as configured, the number of requests that got through in one minute, and the first 429.
import http from "node:http";
import fs from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const mode = process.argv[2] ?? "suite";
const NGINX = Number(arg("nginx-port", 15000)), API = Number(arg("api-port", 15001)), ID = Number(arg("id-port", 15003));
const RUN = arg("run", "/tmp/voices-load/lch-d");
const API_DIR = arg("api-dir", join(process.cwd(), "api"));
const { Client } = createRequire(join(API_DIR, "package.json"))("pg");
const DB_URL = arg("db", "postgresql://postgres@127.0.0.1:15010/lchd_load");
const OUT = arg("out", join(RUN, "limits.json"));

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
function send({ port, method, path, headers = {}, json, localAddress }) {
  return new Promise((resolve) => {
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const h = { Host: "localhost", ...headers, ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}) };
    const r = http.request({ host: "127.0.0.1", port, method, path, headers: h, agent: localAddress ? new http.Agent({ keepAlive: false, localAddress }) : agent, timeout: 10000 }, (res) => {
      const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => {
        const text = Buffer.concat(c).toString("utf8");
        const from = res.statusCode === 429 ? (/RATE_LIMITED|ThrottlerException|Too many/.test(text) && !/nginx/i.test(text) ? "app" : "nginx") : "";
        resolve({ status: res.statusCode, from, text });
      });
    });
    r.on("error", () => resolve({ status: 0, from: "", text: "" })); r.on("timeout", () => r.destroy());
    if (body) r.write(body); r.end();
  });
}

const world = {};
async function setup() {
  const t = await send({ port: API, method: "GET", path: "/api/v1/questions/today" });
  world.qid = JSON.parse(t.text).id;
  const c = new Client({ connectionString: DB_URL }); await c.connect();
  world.invite = (await c.query(`SELECT code FROM "Invite" LIMIT 1`)).rows[0].code;
  world.answerId = (await c.query(`SELECT a.id, c.id AS clip FROM "Answer" a JOIN "VoiceClip" c ON c.id = a."clipId" LIMIT 1`)).rows[0].id;
  await c.end();
  // a signed-in person from the WAWU ID stand-in, with a profile (for the routes that need one)
  const email = `limits.${randomUUID().slice(0, 8)}@load.test`;
  const idc = (path, json) => send({ port: ID, method: "POST", path, json }).then((r) => JSON.parse(r.text));
  await idc("/auth/register", { fullName: "Limits Person", email, phone: "+2348099999999", country: "Nigeria", dialCode: "+234", password: "x" });
  const tok = (await idc("/auth/email/verify/confirm", { email, code: "123456" })).data.accessToken;
  world.auth = { Authorization: `Bearer ${tok}` };
  const cats = JSON.parse((await send({ port: API, method: "GET", path: "/api/v1/categories" })).text);
  const ids = (cats.categories ?? cats.items ?? []).map((x) => x.id).slice(0, 3);
  await send({ port: API, method: "POST", path: "/api/v1/me", headers: { ...world.auth, "Idempotency-Key": randomUUID(), "X-Forwarded-For": "198.51.100.250" }, json: { handle: `lim${Date.now().toString(36)}`.slice(0, 20), ageConfirmed: true, termsAccepted: true, rulesAccepted: true, countryCode: "NG", languages: ["en"], categoryIds: ids } });
  // the share link for the share limits
  const l = await send({ port: API, method: "POST", path: "/api/v1/share/links", headers: { ...world.auth, "X-Forwarded-For": "198.51.100.251" }, json: { objectType: "QUESTION", objectId: world.qid } });
  world.shareCode = JSON.parse(l.text).code;
}

// Each target: what it is, where the limit is written, and the limit's value per minute (as configured).
const T = () => [
  ["every other read route, default (GET /questions/:id/answers)", "THROTTLE_LIMIT, per route", 600, { method: "GET", path: `/api/v1/questions/${world.qid}/answers?limit=1` }],
  ["invite lookup (GET /invites/:code)", "INVITE_LOOKUP_IP_LIMIT", 60, { method: "GET", path: `/api/v1/invites/${world.invite}` }],
  ["share page (GET /share/:code)", "share.controller @Throttle", 300, { method: "GET", path: `/api/v1/share/${world.shareCode}` }],
  ["share card (GET /share/:code/card)", "share.controller @Throttle", 300, { method: "GET", path: `/api/v1/share/${world.shareCode}/card` }],
  ["share card story (GET /share/:code/story)", "share.controller @Throttle", 60, { method: "GET", path: `/api/v1/share/${world.shareCode}/story` }],
  ["share link create (POST /share/links)", "share.controller @Throttle", 60, { method: "POST", path: "/api/v1/share/links", json: { objectType: "QUESTION", objectId: world.qid }, auth: true }],
  ["config/public", "feed.controller @Throttle", 300, { method: "GET", path: "/api/v1/config/public" }],
  ["home", "feed.controller @Throttle", 300, { method: "GET", path: "/api/v1/home" }],
  ["search", "feed.controller @Throttle", 60, { method: "GET", path: "/api/v1/search?q=fuel" }],
  ["invite claim (POST /me/invite/claim)", "INVITE_CLAIM_IP_LIMIT", 300, { method: "POST", path: "/api/v1/me/invite/claim", json: { code: "zzzzzzz" }, auth: true }],
  ["sign-up profile (POST /me)", "ME_SIGNUP_LIMIT", 20, { method: "POST", path: "/api/v1/me", json: {}, auth: true }],
  ["handle check (GET /me/handle-check)", "ME_HANDLE_CHECK_LIMIT", 30, { method: "GET", path: "/api/v1/me/handle-check?handle=zzzzz1", auth: true }],
  ["listen report, guest, one visitor (POST /answers/:id/listen)", "ratelimit.listen_per_min, per visitor", 120, { method: "POST", path: `/api/v1/answers/${world.answerId}/listen`, json: {}, visitor: "one" }],
  ["listen report, guest, a new visitor each time", "ratelimit.listen_ip_per_min, per address", 300, { method: "POST", path: `/api/v1/answers/${world.answerId}/listen`, json: {}, visitor: "new" }],
];

async function suite() {
  await setup();
  const rows = [];
  let n = 0;
  for (const [name, where, limit, t] of T()) {
    const addr = `203.0.113.${10 + n++}`;
    const visitor = randomUUID();
    let ok = 0, limited = 0, first = 0, other = 0, sent = 0; const sample = [];
    const max = Math.min(limit * 2 + 20, 700);
    while (sent < max && !(limited >= 5)) {
      const batch = Array.from({ length: Math.min(10, max - sent) }, () => send({
        port: API, method: t.method, path: t.path, json: t.json,
        headers: { "X-Forwarded-For": addr, "X-Guest-Id": randomUUID(), ...(t.auth ? world.auth : {}), ...(t.visitor === "one" ? { "X-Visitor-Id": visitor } : t.visitor === "new" ? { "X-Visitor-Id": randomUUID() } : {}) },
      }));
      for (const r of await Promise.all(batch)) { sent++; if (r.status === 429) { limited++; if (!first) first = sent; } else if (r.status >= 500 || r.status === 0) other++; else ok++; if (sample.length < 3 && r.status !== 429 && r.status >= 400) sample.push(r.status); }
    }
    rows.push({ name, where, configuredPerMin: limit, passedBeforeFirst429: first ? first - 1 : ok, firstLimitedAt: first || null, errors: other, note: sample.length ? `other statuses seen: ${[...new Set(sample)].join(",")}` : "" });
    console.log(`${name.padEnd(64)} configured ${String(limit).padStart(4)}/min | passed ${String(first ? first - 1 : ok).padStart(4)} | first 429 at ${first || "never"}`);
  }
  // nginx: one address, as fast as it can go, for 3 seconds
  const nx = await nginxBurst(200, 3);
  console.log(`nginx limit_req (20 r/s, burst 40), one address, ${nx.sent} requests in ${nx.secs}s: ${nx.ok} got through, ${nx.limited} told 429`);
  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), app: rows, nginx: nx }, null, 1));
  console.log(`wrote ${OUT}`);
}

async function nginxBurst(rate, secs, addr = "127.77.1.1") {
  let ok = 0, limited = 0, other = 0, sent = 0; const end = Date.now() + secs * 1000; const inflight = [];
  const start = Date.now();
  while (Date.now() < end) {
    const due = Math.floor((Date.now() - start) / 1000 * rate) - sent;
    for (let i = 0; i < due; i++) { sent++; inflight.push(send({ port: NGINX, method: "GET", path: "/api/v1/questions/today", localAddress: addr }).then((r) => { if (r.status === 429) limited++; else if (r.status === 200) ok++; else other++; })); }
    await new Promise((r) => setTimeout(r, 5));
  }
  await Promise.all(inflight);
  return { sent, ok, limited, other, secs, rate, address: addr };
}

if (mode === "suite") await suite().then(() => process.exit(0));
else if (mode === "nginx") { const r = await nginxBurst(Number(arg("rate", 200)), Number(arg("secs", 5))); console.log(JSON.stringify(r)); process.exit(0); }
else { console.error("usage: limits.mjs suite | nginx --rate N --secs S"); process.exit(2); }
