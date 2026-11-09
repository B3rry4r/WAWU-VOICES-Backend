# Verifier report v/lch-a2 (backend a1a4d78, web 7112ab2)
## 1 Contract
- build.py -> tmp; diff tmp openapi.yaml: EXIT 0, no output. PASS
- diff vs main: new GET /invites/{code} + InviterHandle schema + whitespace re-wraps of 3 existing descriptions (text identical). PASS
- web contract/openapi.yaml identical to backend; openapi-typescript regenerates src/lib/api/types.ts identical. PASS
## 2 www
- nginx: www block server_name www.__DOMAIN__ -> 301 https://__DOMAIN__$request_uri (path+query kept); apex block serves bare only. provision.sh: certbot -d apex (+ -d www when DNS points here), --expand (existing apex cert gains www); install uses same names. RUNBOOK step 3 has www A record, expand note and old-droplet note. PASS (static)
- Live nginx: NOT RUN (no nginx binary, docker daemon not running).
## 3 Guest Write (real browser 390, stand-ins: WAWU ID stub 15041, real API 15042, web 15043)
/go (kept invite cookie) -> HOPEFUL -> mood page -> "Type it instead" -> /q/<id>/write?mood=HOPEFUL: guest sees banner + Sign in button, no composer (0 textboxes), so there is no typed draft to lose. Sign in -> /sign-in?next=<same write url> -> sign in -> back on Write with word HOPEFUL and the composer. PASS. Other guest screens unchanged (diff touches only SignInNote, used with `from` only here).
## 4 Onboarding
Slide 1 title = LANDING_HEADLINE, body = LANDING_INTRO (exactly LAUNCH-SPEC §1 headline and intro; eyebrow not used on the slide, INFO). grep "Nigeria is talking|editors ask" in web src, built .next, api src/test: only negative assertions in tests and docs/boards/Onboarding.md (design note) and old lead docs. PASS
## 5 Invited-by attack (own jest attack spec, since removed, plus live curl against the real API)
- Body is {"handle": ...} only; Cache-Control no-store asserted in builder test. Suspended/banned/deletion owner -> null (builder test + my live suspended case). Unknown, wrong shape, upper case ok. PASS
- Rate limit: 60 pass, 61st = 429 RATE_LIMITED with Retry-After 60 (jest and 70 live curls: 55 x 200 + 15 x 429 after 5 earlier). PASS. Per address on a shared network: acceptable; only people holding a cookie call it, once per /go load, and a 429 silently draws no line. Counter is in memory (per process): fine for one API process, would multiply across instances (INFO).
- Enumeration: 36^7 codes, ~1e6 owners => ~1e-5 hit rate per guess at 60/min/address plus nginx 20 r/s; X-Forwarded-For spoof safe (trust proxy 1, nginx appends). Timing good 3.7 ms vs unknown 2.9 ms median in-process; no oracle beyond the response itself. PASS
- Web never sends a malformed cookie (cleanInviteCode + test); line text identical to Go-390 (picture check); bad code -> 0 line elements live. PASS
- Privacy: shows the handle of anyone with a link they chose to share, including accounts that only answer anonymously (their handle is public anyway at /people). LOW/INFO, owner may want to list it.
## 6 Existing tests changed
Backend: none (only 3 new specs). Web: tests/w1-entry.test.tsx only: import of LANDING_HEADLINE and the three "Nigeria is talking" lines. PASS
## 7 Regression
Full api (889 incl. A, B, C, F suites) and web (651) pass. PASS
## 8 Checks
api eslint EXIT 0; tsc EXIT 0; npm test (jest 74 suites, 888 passed 1 skipped + audio 13) EXIT 0 on fresh db; npm run build EXIT 0. ranking.spec alone EXIT 0 (13 pass, worst 189 ms vs 200 limit, idle 82 ms; borderline under shared machine load, passed in full run too). web lint 0, typecheck 0, test 0 (62 files, 651), build 0 (stand-in bases; only host text in bundle is the display string usevoices.com), sync:shared --check EXIT 0.
## 9 Pictures
Builder 9 of 9 viewed beside rendered Go-390 board (light+dark, render-boards.cjs): invited line, avatar, colours, text match. Mine: go-light/dark, write-guest light/dark, after-sign-in in /tmp/va2/pics (shown and match). No board for Write guest or 1440.
## Findings
HIGH none. MEDIUM none. LOW: ranking.spec latency margin thin (189/200 alone). LOW: invited handle of anonymous-only people. INFO: www live redirect NOT RUN (no nginx, docker daemon down); in-memory throttle; docs/boards/Onboarding.md still has old words.
## Verdict MERGE
