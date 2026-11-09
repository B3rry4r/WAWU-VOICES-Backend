# Verifier report: bundle A (go), T1. Backend 6314808, web 7949a14 (branch v/lch-a)

VERDICT: MERGE (with 1 MEDIUM that is old behaviour but /go makes it common, and 3 LOW/info). Nothing blocks.

## Checks (EXIT lines)
- api: tsc EXIT 0 (after prisma generate), eslint 0 errors (33 warnings, no --fix) EXIT 0, build EXIT 0,
  full `npm test` on fresh va_test: jest 70 suites 848 passed 1 skipped, audio 13/13, EXIT 0.
- web: lint EXIT 0, typecheck EXIT 0, test 59 files 619 passed EXIT 0, build (stand-in bases) EXIT 0,
  `sync:shared --check` (VOICES_BACKEND_DIR = backend worktree) EXIT 0 "all copies up to date".
- B and F hold: their specs are in the full suites above, all green.

## 1 LCH-01 words: PASS
- Headline, intro, eyebrow exactly LAUNCH-SPEC s1 (one landing-words.ts, curly apostrophes, no em-dash).
- Page title, description, og and twitter on /welcome and /go carry the new headline (read from served HTML).
- Old "Nigeria is talking. Add your voice." / "Every day our editors ask one question" appear nowhere in src, api src, built bundle.
- Lone word at 390 (measured per line): Landing h1 "Finally, a place / to say it. And / be heard."; intro 5 lines, last "actually help."; /go h1 2 lines. 1440: no lone word.
- Info: Onboarding slide 1 (/join carousel) still says "Nigeria is talking" and "One question from our editors every day...". Board text, different string from the spec, so untouched. Lead may want it aligned.

## 2 /go: PASS (browser, stand-in API 15040, stand-in WAWU ID 15041, web 15042, launch question made live for today in va_run)
- Guest and signed in both render as Go-390 (signed in: no Sign in, "Listen to answers"). Four word chips use board tokens.
- Word tap: /go -> /q/{id}/mood?mood=HOPEFUL with HOPEFUL pressed.
- End to end: tap HOPEFUL -> Say it in 10 s (fake mic) -> Send -> /join?next=...speak&held=1 -> onboarding -> country -> Join form -> email code -> topics -> profile -> "Finish and post my voice" -> back on /q/{id}/speak showing "Your word HOPEFUL" and the held recording. localStorage voices-mood-pick kept HOPEFUL the whole way. (Final upload failed only because no Spaces stand-in; not part of this bundle.)
- Non-mood question (moodOptions emptied): page shows QuestionHero, Add your voice -> /speak, Listen as a guest -> /q/{id}.
- 1440: one centred 560px column, header with Sign in and Add your voice, no bottom bar, no horizontal scroll at 390 (scrollWidth 390).
- MEDIUM (existing, not in this diff): a guest who taps "Type it instead" on the pick screen lands on /q/{id}/write at 390 with only the banner "Sign in to continue." and no Sign in button (the only sign-in link is in the desktop header, hidden at 390). Write screen is untouched by this bundle, but the broadcast now sends 1M guests through it. Suggest a follow-up: give that banner a sign-in link with next= (Speak already does this on Send).
- LOW: dark mode PROUD chip (success-bg) nearly the same colour as the forest card; text is readable; token-driven, matches the board tokens.
- /go/{code} 404s here: bundle C owns it. The "@ada.okafor asked how you feel." line is deliberately left out (lead ruling).

## 3 Address: PASS with one gap
- grep both repos (src, infra, env examples, workflows, contract, tests, docs) and both built bundles (.next excluding cache): zero voices.wawuafrica.com outside history notes (lead reports, tasks, DECISIONS, LAUNCH-SPEC) and the test that bans it. Only wawuafrica.com left: support@wawuafrica.com (30 in legal pages), id.wawuafrica.com (WAWU ID, correct).
- usevoices.com used by: webBase() default, APP_BASE_URL default (payment return URL), customer email user-{id}@usevoices.com, ShareCard fallback, openapi servers, CONVENTIONS, provision.sh default, env examples, cors.xml, RUNBOOK, restore.md. nginx server_name is __DOMAIN__ filled from VOICES_DOMAIN; certbot -d "$DOMAIN"; deploy.yml health check uses the VOICES_DOMAIN secret.
- Legal pages name no website address (nothing to change); support email unchanged.
- GAP (say to the owner): www.usevoices.com does NOT work. server_name and certbot cover the apex only, RUNBOOK adds one A record, no www record, no redirect. People who type www get nothing (or a certificate error if DNS is added later). Fix is small: add a www A/CNAME in RUNBOOK step 3, `-d www.$DOMAIN` in certbot, and a server block redirecting www to the apex.
- LOW: provision.sh copies the nginx site file only when missing, so a droplet already provisioned on the old name would keep the old server_name. Fine if nothing is provisioned yet.
- RUNBOOK: DNS A record, VOICES_DOMAIN secret, PUBLIC_WEB_BASE and APP_BASE_URL, WAWU ID allowed origin https://usevoices.com (no www, no trailing slash), Spaces CORS origin (console steps and s3cmd with cors.xml) are all present and consistent. Not mentioned: the Flutterwave dashboard redirect/webhook URL if one is set there (it was not in the old RUNBOOK either).

## 4 Cleanup interval: PASS
- Default 60 000 ms (constant), TEXTFIX_CLEANUP_INTERVAL_MS set nowhere in infra. Test fakes timers: nothing at 59.999 s, one call at 60 s, five at 5 min.
- Live proof (API under NODE_ENV=development, started 11:28:07): inserted one expired and one live (+10 min) text-fix row at 11:28:16; at 11:29:11 the expired one was gone and the live one kept (tick at 11:29:07).
- Worst case: row expires at store+10:00, next tick is at most 60 s later, so gone by store+11:00 (was 15:00). Replay refuses an expired row (expiresAt check in idempotency.service), so the text is unreadable after 10:00 and the line "up to 10 minutes" is true for what a person can retrieve; physical deletion can lag up to 1 minute. LOW wording note only. expiresAt is indexed, so a 1-minute delete is cheap.

## 5 Existing tests changed: only ruling values
- Backend 7 specs (not 9): listen1-poll-bars, mood-card, polish-c, share (12 lines), wf-card-wrap, wf7-poll-card, wf7-poll-tie: voices.wawuafrica.com -> usevoices.com only. New cleanup-interval.spec.
- Web: w1-entry 2 lines (old headline -> new headline); new lch-a-go.test.tsx (words, metadata, /go guest/signed in/word tap/plain question, no old host in repo).

## 6 Regression: PASS
- B and F suites green. Landing still links Sign in (/sign-in) and Join VOICES (/join) at 390, Sign in and Add your voice at 1440.

## 7 Pictures
- Builder's 7 in /tmp/voices-shots/lch-a/ viewed (Go 390 light/dark, Go 1440, Landing 390 light/dark, Landing 1440, tap-pick): match the boards.
- Mine in /tmp/voices-shots/va-lch-a/: Go-390-light, Go-390-dark, Go-390-signedin, Go-390-plainq, Go-1440, Landing-390-light, Landing-1440, Go-tap-pick-390, e2e-*.

Cleanup done: my processes stopped, va_* databases dropped, Redis db 11 flushed, worktrees removed.
