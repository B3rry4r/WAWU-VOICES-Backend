// LCH-09 load generator: people arriving from the broadcast, each walking the real path through nginx.
// Plain Node (http, no paid service). Open loop: people START at a set rate whether or not the site keeps up.
//
//   node scripts/load/load.mjs --stages 5:60,10:60 --out result.json
//     --stages    people-per-second:seconds, comma separated (the ramp)
//     --think     scale on the pauses a person takes (1 = a real person, 0.3 = a quicker crowd). Default 0.3
//     --viral     friends who open each share link, on average. Default 1.0
//     --sources   distinct network addresses people come from (127.x.y.z, one per person up to N, then round robin). Default 100000
//     --stop      stop the ramp at the first stage that fails (p95 over 1 s on a page or API path, or errors over 1%). Default on
//     --label     a name for this run in the result file
// The path (and why) is described in docs/launch/LOAD-REPORT.md, "The broadcast mix".
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { execFileSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const NGINX = Number(arg("nginx-port", 15000));
const ID_PORT = Number(arg("id-port", 15003));
const RUN = arg("run", "/tmp/voices-load/lch-d");
const API_DIR = arg("api-dir", join(process.cwd(), "api"));
const DB_URL = arg("db", process.env.DATABASE_URL ?? "");
const THINK = Number(arg("think", 0.3));
const VIRAL = Number(arg("viral", 1.0));
const SOURCES = Number(arg("sources", 100000));
const STOP = arg("stop", "on") !== "off";
const FAIL_P95_MS = Number(arg("fail-p95", 1000));
const FAIL_ERR_PCT = Number(arg("fail-err", 1));
const LABEL = arg("label", "run");
const OUT = arg("out", join(RUN, `result-${LABEL}.json`));
const stages = arg("stages", "2:20").split(",").map((s) => { const [r, d] = s.split(":").map(Number); return { rate: r, secs: d }; });
const MIX = {
  bounce: 0.15,        // open /go and leave
  viaInvite: 0.30,     // arrived by a friend's /go/<code> link
  listen: 0.80,        // of those who stay: go and listen to answers
  signUp: 0.45,        // of those who stay: sign up (through the WAWU ID stand-in)
  post: 0.70,          // of those who signed up: post
  postVoice: 0.60,     // of those who post: by voice (the rest by text)
  share: 0.70,         // of those who posted: share
  like: 0.30,          // of listeners: like one answer
};
// --mix postVoice=0,signUp=0.2 changes shares for one run (to see what a part of the mix costs)
for (const kv of arg("mix", "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); if (k in MIX) MIX[k] = Number(v); }
const require = createRequire(join(API_DIR, "package.json"));
const { Client } = require("pg");

const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const think = (a, b) => sleep(rnd(a, b) * THINK);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const poisson = (lambda) => { let L = Math.exp(-lambda), k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; };

// ------------------------------------------------------------------ metrics
const t0 = Date.now();
const bounds = []; { let at = 0; for (const s of stages) { bounds.push({ from: at, to: at + s.secs * 1000 }); at += s.secs * 1000; } }
const stageOf = (tMs) => { for (let i = 0; i < bounds.length; i++) if (tMs < bounds[i].to) return i; return bounds.length - 1; };
const data = stages.map(() => ({ labels: new Map(), people: 0, peak: 0, voiceReady: [], res: [], peopleDone: 0 }));
// Paths that are not "the site" for the pass/fail line: the stand-ins and things that are slow on purpose.
const NOT_SITE = new Set(["standin.register", "standin.verify-start", "standin.verify-confirm", "spaces.put", "voice.ready-poll"]);
function rec(label, startedMs, status, ms, bytes) {
  const st = data[stageOf(startedMs)];
  let l = st.labels.get(label);
  if (!l) st.labels.set(label, (l = { lat: [], ok: 0, limited: 0, server: 0, net: 0, other: 0, bytes: 0, warm: [] }));
  l.lat.push(ms); l.bytes += bytes;
  if (status === 0) l.net++; else if (status === 429) l.limited++; else if (status >= 500) l.server++; else if (status >= 400) l.other++; else l.ok++;
}
const pct = (a, p) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// ------------------------------------------------------------------ http
let activePeople = 0, peakActive = 0;
function agentFor(addr) { return new http.Agent({ keepAlive: true, maxSockets: 6, localAddress: addr }); }
function call(person, label, method, path, o = {}) {
  const startedMs = Date.now() - t0, t = process.hrtime.bigint();
  const port = o.port ?? NGINX;
  const headers = { "Accept-Encoding": "gzip", ...(port === NGINX ? { Host: "localhost" } : {}), ...(o.headers ?? {}) };
  let payload = null;
  if (o.json !== undefined) { payload = Buffer.from(JSON.stringify(o.json)); headers["Content-Type"] = "application/json"; }
  if (o.raw) { payload = o.raw; }
  if (payload) headers["Content-Length"] = payload.length;
  if (person.token && !o.noAuth) headers.Authorization = `Bearer ${person.token}`;
  if (o.api !== false && port === NGINX && path.startsWith("/api/")) { headers["X-Guest-Id"] = person.guest; }
  return new Promise((resolve) => {
    const done = (status, buf) => {
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      if (!o.quiet) rec(label, startedMs, status, ms, buf ? buf.length : 0);
      let json = null, text = null;
      if (buf && o.parse !== false) { try { if (o.resHeaders?.["content-encoding"] === "gzip") buf = zlib.gunzipSync(buf); } catch { /* not gzip after all */ } text = buf.toString("utf8"); if ((o.json_out ?? true) && text.startsWith("{") || text.startsWith("[")) { try { json = JSON.parse(text); } catch { /* html */ } } }
      resolve({ status, ms, json, text, headers: o.resHeaders });
    };
    const r = http.request({ host: "127.0.0.1", port, method, path, headers, agent: o.agent ?? person.agent, timeout: 10000 }, (res) => {
      const c = []; res.on("data", (d) => c.push(d));
      res.on("end", () => { o.resHeaders = res.headers; done(res.statusCode ?? 0, Buffer.concat(c)); });
      res.on("error", () => done(0, null));
    });
    r.on("timeout", () => { r.destroy(); done(0, null); });
    r.on("error", () => done(0, null));
    if (payload) r.write(payload);
    r.end();
  });
}

// ------------------------------------------------------------------ world (read once at start)
const world = { qid: null, categoryIds: [], inviteCodes: [], clipIds: [], audio: null };
async function loadWorld() {
  const boot = { guest: randomUUID(), agent: agentFor("127.0.0.1") };
  const q = await call(boot, "boot", "GET", "/api/v1/questions/today", { quiet: true });
  if (q.status !== 200) throw new Error(`the stack is not answering /questions/today through nginx (status ${q.status})`);
  world.qid = q.json.id;
  const cats = await call(boot, "boot", "GET", "/api/v1/categories", { quiet: true });
  const list = cats.json?.categories ?? cats.json?.items ?? [];
  world.categoryIds = list.map((c) => c.id).filter(Boolean);
  if (DB_URL) {
    const c = new Client({ connectionString: DB_URL }); await c.connect();
    world.inviteCodes = (await c.query(`SELECT code FROM "Invite" LIMIT 3000`)).rows.map((r) => r.code);
    await c.end();
  }
  const audioPath = join(RUN, "voice-8s.webm");
  if (!fs.existsSync(audioPath)) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=8", "-c:a", "libopus", "-b:a", "24k", audioPath]);
  world.audio = fs.readFileSync(audioPath);
  boot.agent.destroy();
}

// ------------------------------------------------------------------ pages and assets
const ASSET = /\/_next\/static\/[^"'\s)\\]+\.(?:js|css|woff2)/g;
async function page(p, label, path) {
  const r = await call(p, label, "GET", path, { headers: { Accept: "text/html" } });
  if (r.status === 200 && r.text) {
    const fresh = [...new Set(r.text.match(ASSET) ?? [])].filter((u) => !p.seen.has(u));
    fresh.forEach((u) => p.seen.add(u));
    // a browser asks for the files of a page together
    await Promise.all(fresh.map((u) => call(p, "static", "GET", u, { parse: false })));
  }
  return r;
}

// ------------------------------------------------------------------ the people
let personNo = 0;
const addrOf = (n) => { const m = n % SOURCES; return `127.${1 + ((m >> 16) & 0xff)}.${(m >> 8) & 0xff}.${(m & 0xff) || 1}`; };
function newPerson() {
  const n = personNo++;
  return { n, guest: randomUUID(), visitor: randomUUID(), seen: new Set(), agent: agentFor(addrOf(n)), token: null, inviteCode: null, mood: pick(["ANGRY", "TIRED", "TIRED", "PROUD", "HOPEFUL", "HOPEFUL"]) };
}
const listenHeaders = (p) => ({ "X-Visitor-Id": p.visitor });

async function journey(viaShare) {
  const p = newPerson();
  activePeople++; peakActive = Math.max(peakActive, activePeople);
  const st = data[stageOf(Date.now() - t0)]; st.people++; st.peak = Math.max(st.peak, activePeople);
  try {
    if (viaShare) {
      const r = await page(p, "page.share", `/s/${viaShare}`);
      if (r.status === 200) {
        // the preview picture a chat app or the page itself asks for
        for (let i = 0; i < 4; i++) { const c = await call(p, "api.card", "GET", `/api/v1/share/${viaShare}/card`, { parse: false }); if (c.status !== 202) break; await sleep(1500 * THINK + 300); }
      }
      await think(1500, 5000);
      if (Math.random() > 0.5) return;
    } else if (Math.random() < MIX.viaInvite && world.inviteCodes.length) {
      p.inviteCode = pick(world.inviteCodes);
      await call(p, "page.go-code", "GET", `/go/${p.inviteCode}`, { parse: false, headers: { Accept: "text/html" } });
    }
    // 1. guest /go
    await Promise.all([
      page(p, "page.go", "/go"),
      call(p, "api.today", "GET", "/api/v1/questions/today"),
      p.inviteCode ? call(p, "api.invite", "GET", `/api/v1/invites/${p.inviteCode}`) : null,
    ]);
    await think(1500, 4000);
    if (Math.random() < MIX.bounce) return;
    // 2. pick a word
    await Promise.all([page(p, "page.mood", `/q/${world.qid}/mood`), call(p, "api.question", "GET", `/api/v1/questions/${world.qid}`)]);
    await think(800, 2000);
    // 3. the question page and listening
    if (Math.random() < MIX.listen) await listening(p);
    // 4. sign in and post
    if (Math.random() < MIX.signUp) {
      await signUp(p);
      if (Math.random() < MIX.post) await posting(p);
    }
  } catch (e) {
    rec("journey.error", Date.now() - t0, 0, 0, 0); console.error("journey error:", e?.message ?? e);
  } finally {
    activePeople--; st.peopleDone++; p.agent.destroy();
  }
}

async function listening(p) {
  const [, , answers] = await Promise.all([
    page(p, "page.question", `/q/${world.qid}`),
    call(p, "api.config", "GET", "/api/v1/config/public"),
    call(p, "api.answers", "GET", `/api/v1/questions/${world.qid}/answers?sort=TOP&limit=10`),
    call(p, "api.question", "GET", `/api/v1/questions/${world.qid}`),
    call(p, "api.moods", "GET", `/api/v1/questions/${world.qid}/moods`),
  ]).then((rs) => [rs[0], rs[1], rs[2]]);
  const items = answers.json?.items ?? [];
  const voices = items.map((i) => i.answer).filter((a) => a?.clip?.id);
  await think(1000, 3000);
  for (const a of voices.slice(0, 2)) {
    await call(p, "api.play", "GET", `/api/v1/voice-clips/${a.clip.id}/play`);
    await call(p, "api.listen", "POST", `/api/v1/answers/${a.id}/listen`, { json: {}, headers: listenHeaders(p) });
    await think(5000, 9000); // the clip is 4 to 10 seconds long
    await call(p, "api.listen", "POST", `/api/v1/answers/${a.id}/listen`, { json: { secondsPlayed: 8, finished: true }, headers: listenHeaders(p) });
  }
  if (Math.random() < 0.5 && answers.json?.nextCursor) {
    await call(p, "api.answers", "GET", `/api/v1/questions/${world.qid}/answers?sort=TOP&limit=10&cursor=${encodeURIComponent(answers.json.nextCursor)}`);
  }
  if (items.length && Math.random() < MIX.like) await call(p, "api.like", "PUT", `/api/v1/answers/${pick(items).answer.id}/like`);
}

async function signUp(p) {
  const email = `p${p.n}.${randomUUID().slice(0, 8)}@load.test`;
  const phone = `+23480${String(10000000 + (p.n * 7919) % 89999999).padStart(8, "0")}`;
  await Promise.all([page(p, "page.signup", "/join"), call(p, "api.countries", "GET", "/api/v1/countries")]);
  await think(8000, 20000); // typing the form
  await call(p, "standin.register", "POST", "/auth/register", { port: ID_PORT, json: { fullName: `Load ${p.n}`, firstName: "Load", lastName: String(p.n), email, phone, dialCode: "+234", country: "Nigeria", password: "Passw0rd!" }, noAuth: true });
  await call(p, "standin.verify-start", "POST", "/auth/email/verify/start", { port: ID_PORT, json: { email }, noAuth: true });
  await think(3000, 8000);
  const v = await call(p, "standin.verify-confirm", "POST", "/auth/email/verify/confirm", { port: ID_PORT, json: { email, code: "123456" }, noAuth: true });
  p.token = v.json?.data?.accessToken ?? null;
  if (!p.token) throw new Error("the WAWU ID stand-in gave no token");
  // back on VOICES: the profile
  await Promise.all([page(p, "page.profile", "/join/profile"), call(p, "api.categories", "GET", "/api/v1/categories"), call(p, "api.me", "GET", "/api/v1/me")]);
  await think(3000, 8000);
  const me = await call(p, "api.me.create", "POST", "/api/v1/me", { json: { handle: `l${(Date.now() % 1e9).toString(36)}${p.n.toString(36)}`.slice(0, 20), ageConfirmed: true, termsAccepted: true, rulesAccepted: true, countryCode: "NG", languages: ["en"], categoryIds: world.categoryIds.slice(0, 3) }, headers: { "Idempotency-Key": randomUUID() } });
  if (me.status >= 400) throw new Error(`POST /me ${me.status} ${me.text?.slice(0, 120)}`);
  await call(p, "api.me", "GET", "/api/v1/me");
}

async function posting(p) {
  await Promise.all([page(p, "page.speak", `/q/${world.qid}/speak?mood=${p.mood}`), call(p, "api.config", "GET", "/api/v1/config/public"), call(p, "api.allowance", "GET", "/api/v1/me/allowance"), call(p, "api.question", "GET", `/api/v1/questions/${world.qid}`)]);
  let answerId = null;
  if (Math.random() < MIX.postVoice) {
    await think(9000, 12000); // recording ten seconds
    const up = await call(p, "api.clip.create", "POST", "/api/v1/voice-clips", { json: { purpose: "ANSWER", mime: "audio/webm", sizeBytes: world.audio.length, durationMs: 8000 } });
    if (up.status !== 201 && up.status !== 200) throw new Error(`voice-clips ${up.status} ${up.text?.slice(0, 120)}`);
    const put = new URL(up.json.putUrl);
    const putRes = await call(p, "spaces.put", "PUT", put.pathname + put.search, { port: Number(put.port), raw: world.audio, headers: { "Content-Type": "audio/webm" }, noAuth: true, api: false });
    if (putRes.status >= 300) throw new Error(`spaces put ${putRes.status}`);
    await call(p, "api.clip.complete", "POST", `/api/v1/voice-clips/${up.json.clip.id}/complete`);
    const started = Date.now(); let ready = false;
    while (Date.now() - started < 40000) { // the app asks again until the clip is ready
      await sleep(700);
      const c = await call(p, "voice.ready-poll", "GET", `/api/v1/voice-clips/${up.json.clip.id}`);
      if (c.json?.status === "READY") { ready = true; break; }
      if (c.json?.status === "FAILED") break;
    }
    data[stageOf(started - t0)].voiceReady.push(ready ? Date.now() - started : 40000);
    if (!ready) throw new Error("clip not ready in 40 s");
    const a = await call(p, "api.post", "POST", `/api/v1/questions/${world.qid}/answers`, { json: { kind: "VOICE", clipId: up.json.clip.id, mood: p.mood }, headers: { "Idempotency-Key": randomUUID() } });
    answerId = a.json?.answer?.id ?? a.json?.id ?? a.json?.answerId ?? null;
  } else {
    await think(8000, 18000); // writing
    const a = await call(p, "api.post", "POST", `/api/v1/questions/${world.qid}/answers`, { json: { kind: "TEXT", body: `I feel ${p.mood.toLowerCase()} about Nigeria, ${p.n} says so.`, mood: p.mood }, headers: { "Idempotency-Key": randomUUID() } });
    answerId = a.json?.answer?.id ?? a.json?.id ?? a.json?.answerId ?? null;
  }
  if (!answerId) return;
  await Promise.all([page(p, "page.posted", `/q/${world.qid}/posted`), call(p, "api.where", "GET", `/api/v1/answers/${answerId}/where-you-sit`), call(p, "api.moods", "GET", `/api/v1/questions/${world.qid}/moods`)]);
  if (Math.random() < MIX.share) {
    const l = await call(p, "api.share.create", "POST", "/api/v1/share/links", { json: { objectType: "ANSWER", objectId: answerId } });
    const code = l.json?.code ?? l.json?.shortCode ?? (l.json?.url ?? "").split("/").pop();
    if (code) {
      await call(p, "api.share.page", "GET", `/api/v1/share/${code}`);
      // friends who open the link, a few seconds to a minute later
      for (let i = 0, k = poisson(VIRAL); i < k; i++) setTimeout(() => void journey(code), rnd(2000, 20000) * THINK);
    }
  }
}

// ------------------------------------------------------------------ resource sampler
function descendants(pid) {
  const out = [pid]; const kids = new Map();
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try { const s = fs.readFileSync(`/proc/${d}/stat`, "utf8"); const m = /^\d+ \(.*\) \S (\d+)/.exec(s); if (m) { const pp = Number(m[1]); (kids.get(pp) ?? kids.set(pp, []).get(pp)).push(Number(d)); } } catch { /* gone */ }
  }
  const q = [pid]; while (q.length) { const x = q.pop(); for (const k of kids.get(x) ?? []) { out.push(k); q.push(k); } }
  return out;
}
function procStat(pids) {
  let ticks = 0, rss = 0;
  for (const pid of pids) {
    try {
      const s = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
      ticks += Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14]); // own time plus finished children (ffmpeg, ffprobe)
      // PSS, not RSS: Postgres backends all map the same shared buffers, and RSS would count them once per backend.
      const m = /Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8")); if (m) rss += Number(m[1]);
    } catch { /* gone */ }
  }
  return { ticks, rssMb: rss / 1024 };
}
const pidFile = (n) => { try { return Number(fs.readFileSync(join(RUN, "pids", `${n}.pid`), "utf8").trim()); } catch { return 0; } };
const WATCH = ["nginx", "api", "web", "redis", "standin"];
let pgSampler = null;
async function startSampler() {
  const prev = {}; let last = Date.now();
  let pgc = null;
  if (DB_URL) { pgc = new Client({ connectionString: DB_URL }); await pgc.connect().catch(() => { pgc = null; }); }
  const pgMaster = (() => { try { return Number(fs.readFileSync(join(RUN, "pg", "postmaster.pid"), "utf8").split("\n")[0]); } catch { return 0; } })();
  const self = process.pid;
  const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  const tick = async () => {
    const now = Date.now(), dt = (now - last) / 1000; last = now;
    const row = { t: (now - t0) / 1000 };
    for (const n of [...WATCH, "postgres", "loadgen"]) {
      const root = n === "postgres" ? pgMaster : n === "loadgen" ? self : pidFile(n);
      if (!root) continue;
      const s = procStat(descendants(root));
      if (prev[n] !== undefined) row[`${n}.cpu`] = Math.max(0, (s.ticks - prev[n]) / 100 / dt * 100); // percent of one CPU
      prev[n] = s.ticks; row[`${n}.mem`] = s.rssMb;
    }
    // The two CPUs the droplet stands in for: how busy they were in total (percent of both, 100 = both flat out).
    try {
      const cpus = (process.env.APP_CPUS ?? "2,3").split(",").map(Number);
      const lines = fs.readFileSync("/proc/stat", "utf8").split("\n");
      let busy = 0, all = 0;
      for (const c of cpus) { const f = lines.find((l) => l.startsWith(`cpu${c} `))?.trim().split(/\s+/).slice(1).map(Number); if (!f) continue; const idle = f[3] + f[4]; const tot = f.reduce((a, b) => a + b, 0); busy += tot - idle; all += tot; }
      if (prev.__all !== undefined && all > prev.__all) row["appcpus.busy"] = 100 * (busy - prev.__busy) / (all - prev.__all);
      prev.__all = all; prev.__busy = busy;
    } catch { /* ignore */ }
    row["loadgen.lagp99"] = lag.percentile(99) / 1e6; lag.reset();
    if (pgc) { try { const r = await pgc.query(`SELECT count(*)::int n, count(*) FILTER (WHERE state='active')::int act FROM pg_stat_activity WHERE datname = current_database()`); row["pg.conns"] = r.rows[0].n; row["pg.active"] = r.rows[0].act; } catch { /* ignore */ } }
    row.active = activePeople;
    try { const r = await redisInfo(); Object.assign(row, r); } catch { /* ignore */ }
    data[stageOf(now - t0)].res.push(row);
  };
  const iv = setInterval(() => void tick(), 2000);
  return () => { clearInterval(iv); pgc?.end().catch(() => undefined); };
}
function redisInfo() {
  const port = Number(arg("redis-port", 15011));
  return new Promise((resolve, reject) => {
    import("node:net").then(({ connect }) => {
      const s = connect(port, "127.0.0.1"); let buf = "";
      s.setTimeout(1500, () => { s.destroy(); reject(new Error("redis timeout")); });
      s.on("connect", () => s.write("INFO\r\nQUIT\r\n"));
      s.on("data", (d) => (buf += d)); s.on("error", reject);
      s.on("close", () => { const g = (k) => Number(new RegExp(`${k}:(\\d+)`).exec(buf)?.[1] ?? NaN); resolve({ "redis.clients": g("connected_clients"), "redis.ops": g("instantaneous_ops_per_sec"), "redis.memKb": Math.round(g("used_memory") / 1024) }); });
    }, reject);
  });
}

// ------------------------------------------------------------------ run
async function main() {
  await loadWorld();
  console.log(`world: question ${world.qid}, ${world.categoryIds.length} categories, ${world.inviteCodes.length} invite codes; think x${THINK}, viral ${VIRAL}`);
  const stopSampler = await startSampler();
  const summary = [];
  for (let i = 0; i < stages.length; i++) {
    const { rate, secs } = stages[i];
    const stageEnd = t0 + bounds[i].to;
    let next = Date.now();
    while (Date.now() < stageEnd) {
      const now = Date.now();
      const n = poisson(rate * 0.02);
      for (let k = 0; k < n; k++) void journey(null);
      next += 20; await sleep(Math.max(1, next - Date.now()));
    }
    const s = stageSummary(i, rate, secs); summary.push(s);
    console.log(`stage ${i + 1}: ${rate} people/s for ${secs}s | ${s.requestsPerSec} req/s | people at once ${s.peakActive} | worst p95 ${s.worst.label} ${Math.round(s.worst.p95)} ms | errors ${s.errPct}% | ${s.fail ? "FAIL " + s.fail : "ok"}`);
    if (STOP && s.fail) break;
  }
  // let people who are mid-way finish, so their requests count in the stage they started
  const drainUntil = Date.now() + 70000;
  while (activePeople > 0 && Date.now() < drainUntil) await sleep(500);
  stopSampler();
  const final = stages.map((st, i) => stageSummary(i, st.rate, st.secs)).slice(0, summary.length);
  const result = { label: LABEL, startedAt: new Date(t0).toISOString(), think: THINK, viral: VIRAL, mix: MIX, stages: final, drainedPeople: activePeople === 0 };
  fs.mkdirSync(join(OUT, ".."), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(`wrote ${OUT}`);
  printTable(final);
  process.exit(0);
}

function stageSummary(i, rate, secs) {
  const st = data[i]; const warmCut = secs * 1000 * 0.2; const from = bounds[i].from + warmCut;
  const labels = {}; let total = 0, bad = 0, worst = { label: "", p95: 0 };
  for (const [label, l] of st.labels) {
    const n = l.lat.length; const site = !NOT_SITE.has(label);
    const row = { n, ok: l.ok, limited: l.limited, server: l.server, net: l.net, other: l.other, p50: pct(l.lat, 0.5), p95: pct(l.lat, 0.95), p99: pct(l.lat, 0.99), max: Math.max(0, ...l.lat.slice(0, 1e5)), kb: Math.round(l.bytes / 1024), site };
    labels[label] = row;
    if (site) { total += n; bad += l.limited + l.server + l.net; if (n >= 30 && row.p95 > worst.p95 && label !== "static") worst = { label, p95: row.p95 }; if (n >= 30 && label === "static" && row.p95 > worst.p95) worst = { label, p95: row.p95 }; }
  }
  const errPct = total ? +(100 * bad / total).toFixed(2) : 0;
  const fail = errPct > FAIL_ERR_PCT ? `errors ${errPct}%` : worst.p95 > FAIL_P95_MS ? `p95 ${worst.label} ${Math.round(worst.p95)} ms` : "";
  const res = st.res.filter((r) => r.t * 1000 >= from);
  const avg = (k) => { const v = res.map((r) => r[k]).filter((x) => Number.isFinite(x)); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null; };
  const max = (k) => { const v = res.map((r) => r[k]).filter((x) => Number.isFinite(x)); return v.length ? +Math.max(...v).toFixed(1) : null; };
  const resKeys = [...new Set(res.flatMap((r) => Object.keys(r)))].filter((k) => k !== "t");
  const resources = Object.fromEntries(resKeys.map((k) => [k, { avg: avg(k), max: max(k) }]));
  const vr = st.voiceReady;
  return { stage: i + 1, peoplePerSec: rate, seconds: secs, people: st.people, peopleFinished: st.peopleDone, peakActive: st.peak, requests: total, requestsPerSec: +(total / secs).toFixed(1), errPct, fail, worst, labels, resources, voiceReadyMs: { n: vr.length, p50: pct(vr, 0.5), p95: pct(vr, 0.95) } };
}
function printTable(final) {
  const lines = ["", "per path p95 (ms) by stage, site paths only:"]; const all = new Set(); final.forEach((s) => Object.entries(s.labels).forEach(([k, v]) => v.site && all.add(k)));
  lines.push(["path".padEnd(22), ...final.map((s) => String(s.peoplePerSec + "/s").padStart(8))].join(" "));
  for (const k of [...all].sort()) lines.push([k.padEnd(22), ...final.map((s) => String(s.labels[k] ? Math.round(s.labels[k].p95) : "-").padStart(8))].join(" "));
  console.log(lines.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
