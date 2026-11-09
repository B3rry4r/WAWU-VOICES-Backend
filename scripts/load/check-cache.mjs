// LCH-09: proof, through nginx, that the shared copies never carry a person's data. Needs the stack up.
//   node scripts/load/check-cache.mjs      prints PASS or FAIL lines and exits 1 on any FAIL
import http from "node:http";
import { randomUUID } from "node:crypto";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NGINX = Number(arg("nginx-port", 15000)), ID = Number(arg("id-port", 15003));
const agent = new http.Agent({ keepAlive: false });
const call = (port, method, path, headers = {}, json) => new Promise((resolve) => {
  const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
  const r = http.request({ host: "127.0.0.1", port, method, path, agent, headers: { Host: "localhost", ...headers, ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}) } }, (res) => {
    const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ } resolve({ status: res.statusCode, h: res.headers, json: j, text: t }); });
  });
  r.on("error", () => resolve({ status: 0, h: {}, json: null, text: "" })); if (body) r.write(body); r.end();
});
let bad = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); if (!ok) bad++; };
const xff = (n) => ({ "X-Forwarded-For": `203.0.113.${n}` });

const email = `cache.${randomUUID().slice(0, 8)}@load.test`;
await call(ID, "POST", "/auth/register", {}, { fullName: "Cache Person", email, phone: "+2348088888888", country: "Nigeria", dialCode: "+234", password: "x" });
const token = (await call(ID, "POST", "/auth/email/verify/confirm", {}, { email, code: "123456" })).json.data.accessToken;
const auth = { Authorization: `Bearer ${token}` };
const cats = (await call(NGINX, "GET", "/api/v1/categories")).json;
await call(NGINX, "POST", "/api/v1/me", { ...auth, "Idempotency-Key": randomUUID() }, { handle: `cc${Date.now().toString(36)}`.slice(0, 20), ageConfirmed: true, termsAccepted: true, rulesAccepted: true, countryCode: "NG", languages: ["en"], categoryIds: (cats.categories ?? cats.items ?? []).slice(0, 3).map((x) => x.id) });

const guestToday = await call(NGINX, "GET", "/api/v1/questions/today");
const qid = guestToday.json.id;
await call(NGINX, "PUT", `/api/v1/questions/${qid}/save`, auth); // this person saves today's question
await new Promise((r) => setTimeout(r, 5500)); // let any copy from before expire

// 1. the person reads first: their own copy says saved, and nothing is kept
const mine1 = await call(NGINX, "GET", "/api/v1/questions/today", auth);
check("a signed-in read says the question is saved", mine1.json?.iSaved === true);
check("a signed-in read is never stored or served from the shared copy", ["BYPASS", undefined].includes(mine1.h["x-cache-status"]) && /private/.test(mine1.h["cache-control"] ?? ""), `X-Cache-Status ${mine1.h["x-cache-status"]}, Cache-Control ${mine1.h["cache-control"]}`);
// 2. a guest reads right after: not saved, and this one fills the shared copy
const g1 = await call(NGINX, "GET", "/api/v1/questions/today", xff(1));
check("a guest right after sees nothing of that person (iSaved false)", g1.json?.iSaved === false);
// 3. the person reads again while the shared copy is warm: still their own
const mine2 = await call(NGINX, "GET", "/api/v1/questions/today", auth);
check("the person still gets their own page while the shared copy is warm", mine2.json?.iSaved === true && mine2.h["x-cache-status"] === "BYPASS");
// 4. another guest is served the shared copy, and it is the neutral one
const g2 = await call(NGINX, "GET", "/api/v1/questions/today", { ...xff(2), "X-Guest-Id": randomUUID() });
check("a second guest is served the shared copy (HIT) and it is neutral", g2.h["x-cache-status"] === "HIT" && g2.json?.iSaved === false, `X-Cache-Status ${g2.h["x-cache-status"]}`);
// 5. the same for one question by id
const q1 = await call(NGINX, "GET", `/api/v1/questions/${qid}`, auth);
const q2 = await call(NGINX, "GET", `/api/v1/questions/${qid}`, xff(3));
const q3 = await call(NGINX, "GET", `/api/v1/questions/${qid}`, xff(4));
check("a question by id: person sees saved, guests see not saved, and guests share a copy", q1.json?.iSaved === true && q2.json?.iSaved === false && q3.json?.iSaved === false && q3.h["x-cache-status"] === "HIT");
// 6. the answers page is never kept by nginx (it carries a guest's own likes)
const a1 = await call(NGINX, "GET", `/api/v1/questions/${qid}/answers?limit=3`, { ...xff(5), "X-Guest-Id": randomUUID() });
const a2 = await call(NGINX, "GET", `/api/v1/questions/${qid}/answers?limit=3`, { ...xff(6), "X-Guest-Id": randomUUID() });
check("the answers page is not in nginx's shared copies", !a1.h["x-cache-status"] && !a2.h["x-cache-status"] && !a1.h["x-accel-expires"]);
// 7. the person's own routes are never cached
const me = await call(NGINX, "GET", "/api/v1/me", auth);
const me2 = await call(NGINX, "GET", "/api/v1/me", auth);
check("GET /me is never cached", !me.h["x-cache-status"] && !me2.h["x-cache-status"] && me.json?.handle === me2.json?.handle);
// 8. the share page and its card are shared, and say so
const l = await call(NGINX, "POST", "/api/v1/share/links", auth, { objectType: "QUESTION", objectId: qid });
const code = l.json?.code;
const s1 = await call(NGINX, "GET", `/api/v1/share/${code}`, xff(7));
const s2 = await call(NGINX, "GET", `/api/v1/share/${code}`, xff(8));
check("a share page is served from the shared copy on the second visit", s2.h["x-cache-status"] === "HIT", `first ${s1.h["x-cache-status"]}, second ${s2.h["x-cache-status"]}`);
console.log(bad ? `CACHE CHECK EXIT 1 (${bad} failed)` : "CACHE CHECK EXIT 0");
process.exit(bad ? 1 : 0);
