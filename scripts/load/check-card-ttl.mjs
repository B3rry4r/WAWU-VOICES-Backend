// LCH-09 F1: proof, through nginx, that a card of a person who was deleted stops being served within 30 seconds.
//   node scripts/load/check-card-ttl.mjs     (needs the stack up; takes about 40 seconds)
import http from "node:http";
import { randomUUID } from "node:crypto";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NGINX = Number(arg("nginx-port", 15000)), ID = Number(arg("id-port", 15003));
const agent = new http.Agent({ keepAlive: false });
const call = (port, method, path, headers = {}, json) => new Promise((resolve) => {
  const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
  const r = http.request({ host: "127.0.0.1", port, method, path, agent, headers: { Host: "localhost", ...headers, ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}) } }, (res) => {
    const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch { /* png */ } resolve({ status: res.statusCode, h: res.headers, json: j }); });
  });
  r.on("error", () => resolve({ status: 0, h: {}, json: null })); if (body) r.write(body); r.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0; const check = (n, ok, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  (" + x + ")" : ""}`); if (!ok) bad++; };

const email = `ttl.${randomUUID().slice(0, 8)}@load.test`;
await call(ID, "POST", "/auth/register", {}, { fullName: "Ttl Person", email, phone: "+23480" + String(Date.now()).slice(-8), country: "Nigeria", dialCode: "+234", password: "x" });
const token = (await call(ID, "POST", "/auth/email/verify/confirm", {}, { email, code: "123456" })).json.data.accessToken;
const auth = { Authorization: `Bearer ${token}` };
const cats = (await call(NGINX, "GET", "/api/v1/categories")).json;
const handle = `tt${Date.now().toString(36)}`.slice(0, 20);
const me = await call(NGINX, "POST", "/api/v1/me", { ...auth, "Idempotency-Key": randomUUID() }, { handle, ageConfirmed: true, termsAccepted: true, rulesAccepted: true, countryCode: "NG", languages: ["en"], categoryIds: (cats.categories ?? cats.items ?? []).slice(0, 3).map((x) => x.id) });
const userId = me.json?.id ?? me.json?.profile?.id;
// the person's profile card (a non-mood card)
const link = await call(NGINX, "POST", "/api/v1/share/links", auth, { objectType: "PROFILE", objectId: userId });
const code = link.json?.code;
check("a profile share link was made", !!code, `status ${link.status}`);
let card;
for (let i = 0; i < 10; i++) { card = await call(NGINX, "GET", `/api/v1/share/${code}/card`, { "X-Forwarded-For": "203.0.113.5" }); if (card.status !== 202) break; await sleep(1500); }
check("the card is served", card.status === 200, `status ${card.status}`);
check("the browser may keep it an hour, nginx only 30 s (no X-Accel-Expires reaches the visitor)", /max-age=3600/.test(card.h["cache-control"] ?? "") && !card.h["x-accel-expires"]);
const again = await call(NGINX, "GET", `/api/v1/share/${code}/card`, { "X-Forwarded-For": "203.0.113.6" });
check("a second visit is served from nginx's copy", again.h["x-cache-status"] === "HIT", `X-Cache-Status ${again.h["x-cache-status"]}`);
// the person deletes their account
const del = await call(NGINX, "DELETE", "/api/v1/me", { ...auth, "Idempotency-Key": randomUUID() }, { confirmHandle: handle, understandUnitsForfeited: true });
check("the person asks to delete the account", del.status === 202, `status ${del.status}`);
const t0 = Date.now(); let gone = 0;
while (Date.now() - t0 < 40000) {
  const r = await call(NGINX, "GET", `/api/v1/share/${code}/card`, { "X-Forwarded-For": "203.0.113.7" });
  if (r.status !== 200) { gone = (Date.now() - t0) / 1000; console.log(`   card answered ${r.status} after ${gone.toFixed(1)} s (X-Cache-Status ${r.h["x-cache-status"]})`); break; }
  await sleep(1000);
}
check("the deleted person's card stops being served within 31 seconds", gone > 0 && gone <= 31, gone ? `${gone.toFixed(1)} s` : "still served after 40 s");
console.log(bad ? `CARD TTL CHECK EXIT 1 (${bad} failed)` : "CARD TTL CHECK EXIT 0");
process.exit(bad ? 1 : 0);
