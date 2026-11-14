# V-FREE5: 5 free posts, launch hint "Up to 1 minute" (14 Nov 2026)

Scope was cut by the lead to a plain number swap: no full API suite run as one, no website build, no pictures, no full migration rehearsal on a database migrated from origin/main (a short SQL rehearsal was done, see below).

## Does the live database store the number?
Yes. `UnitsConfig.seedDefaults` (api/src/units/units.config.ts:37) and `ConfigAdminService.ensureRows` insert a `ConfigEntry` row `allowance.free_posts` on boot (never overwriting), and V-46's migration wrote 2 into it. So the live row is 2 and changing the default alone would not change it. Also each person's `FreeAllowance.freePostsRemaining` is stored (V-46 set it to max(0, 2 - used)); free posts are counted per person for life in `FreeAllowance.freePostsUsed` / `freePostsRemaining`.

## Server changes
- api/src/units/units.defaults.ts:25 `allowance.free_posts` 2 -> 5. Same default in api/src/vote/vote-config.ts:14 and api/src/feed/public-config.ts:12; api/src/admin/config-catalogue.ts (value 5).
- api/prisma/schema.prisma: `FreeAllowance.freePostsRemaining @default(5)` (the migration sets the column default too).
- api/src/feed/launch-question.ts:11 hint "...say it in your voice. Up to 1 minute."
- api/src/mail/templates html+txt C12 "Your first 5 posts are free." (template is not sent by any code today).
- docs/contract/src/routes.py (allowance text), docs/contract/CONVENTIONS.md, regenerated docs/contract/openapi.yaml (one line; rebuilt with build.py and `cmp` identical), docs/legal/terms.md ("Your first 5 posts"), docs/legal/CLAIMS.md. refunds.md has no number, unchanged. Voice card (10 s) and the 20 a day limit untouched.

## Migrations (both with rollback.down.sql)
- `20261114290000_free_posts_5`: column default 5. If an admin chose any value other than 2 for the setting, nothing else is touched. Otherwise: allowance rows still in the V-46 shape (remaining = max(0, 2 - used)) become max(0, 5 - used), so used 2 -> 3 left, used 1 -> 4 left, used 0 -> 5; the config row changes only where it is exactly 2 (version + 1, ConfigChange row). Rollback reverses the same rows only.
- `20261114300000_launch_hint`: `UPDATE "Question" SET "hint" = '...Up to 1 minute.' WHERE "hint" = '...10 seconds.'`. Rollback puts the old text back.
- Rehearsal (scratch PostgreSQL 16, all earlier migrations deployed, rows seeded with replica role, SQL files run with psql): setting 2 with allowances used 2/1/0/9 -> remaining 3/4/5/0, config 5, hint changed, other hint untouched; rollback -> 0/1/2/0, config 2, old hint; apply again -> same as first. Setting 7: config stays 7, allowances untouched, hint changed.

## Test assertions changed (old -> new), all server
- src/feed/feed.spec.ts:562 freePosts 2 -> 5
- test/admin/money.spec.ts:87 freePostsRemaining 2 -> 5
- test/me/me.spec.ts:43, 107, 138: 2 -> 5
- test/results/results.spec.ts:203 freePostsRemaining 2 -> 5
- test/units/payments.spec.ts:993 2 -> 5; :1007 1 -> 4; history item freePostsLeft 1 -> 4
- test/units/ledger.spec.ts: "gives 2 free posts" -> 5 (title, loop 2 -> 5, freePostsUsed 2 -> 5, refused key "k2" -> "k5" so it is not a replay, charge count 2 -> 5); freeLeft POST_TEXT 2 -> 5 (two places); reverse test remaining 1 -> 4 and 2 -> 5; load test freePostsRemaining 1 -> 4
- test/talk/talk.spec.ts: freePostsRemaining 1 -> 4 (four places)
- test/talk/tokens.int.spec.ts:333 2 -> 5 (line 237 keeps 1: that person is built with freePosts: 2 on purpose)
- test/talk/token-prices.spec.ts: title "5 posts"; three more free text charges added before the "free posts are gone" step (needed to use up 5); freePostsUsed 2 -> 5
- test/verify/verify.spec.ts: "no config rows" test: 2 -> 5 (title, `"freePosts":5`, new account 5)
- test/mood/mood.spec.ts, test/mood/launch-seed.spec.ts: hint text "Up to 1 minute."
Not changed on purpose: the V-46 migration test in verify.spec.ts (it tests the old migration's own arithmetic).

## Runs
- `npx tsc --noEmit` clean; eslint on the five most edited spec files clean.
- Jest on a scratch PostgreSQL 16 (port 55432) and Redis (55379): after the edits, one run of test/talk test/shared test/mail test/vote test/admin test/units test/me test/results test/mood test/privacy test/news test/launch test/textfix test/reach and src: 107 suites passed, 1180 tests passed, 1 skipped. test/verify (116 tests with talk files) passed in a separate run. Not run: test/hand-sql, test/app.contract, test/audio, the e2e config.
- `build.py` output `cmp` identical to docs/contract/openapi.yaml.

## Website (v/free5 in wawu-voices-web)
Everything reads the number from `/config/public` `freePosts` except one typed-in fallback: src/features/speak/SpeakScreen.tsx:116 `config?.freePosts ?? 2` -> 5. Read from the server (unchanged code, shows 5 when the server says 5): landing (Landing.tsx:125 "Your first N posts are free."), onboarding slides (Onboarding.tsx:106,111,170), FreePosts pills (record screen, write, reply, question, thread, me page, rail), wallet, buy tokens, out-of-posts sheet (wallet counts). Go.tsx hint comes from the question row (fallback has no number). Copied with `sync:shared`: content/legal/terms.md, contract/openapi.yaml; `npm run api:types` updated src/lib/api/types.ts (one comment line). No web test states 2 free posts (mocks use 5, 7, 10 as test data), so no web test changed.
Green tick add-on: `.vx-tick` in src/components/vx/vx.css:296 `color: var(--verified)` -> `color: var(--success)` (#0a7446 light, #6edda8 dark, both dark blocks have it); `--verified` and the news tag untouched. Every person tick uses `.vx-tick` (VerifiedTick: search, post rows, share page, news post, thread; conversation.tsx:251 and 376; profile.tsx:101). Also the "You are verified" circle on /verify (VerifyScreen.tsx:139) `bg-verified-bg text-verified` -> `bg-success-bg text-success`. Left alone: sponsor "Verified brand" badge, `.vx-tag--verified`, `.vx-mark--verified`, `.vx-result--verified`, mood colours.
Web runs: `npm run typecheck` clean; vitest on w4-speak, lch-a-go, mood, v-anon, legal-pages, w1-entry, lastfix-web, v-verify: all passed (43 + 78 + 26). No build, no pictures (cut).

## Not done
Full web test suite, `npm run build`, screenshots, lint on the website, a rehearsal from origin/main's own prisma folder through `prisma migrate deploy` (SQL files were run directly with psql on a database migrated by `prisma migrate deploy` without the two new folders). A dedicated spec for "used 2 keeps 3 left" was not added; it is shown by the SQL rehearsal.
