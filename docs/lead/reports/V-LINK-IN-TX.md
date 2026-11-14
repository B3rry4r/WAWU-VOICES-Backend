# V-LINK-IN-TX: the charge is linked in the same transaction as the post

Branch `v/link-in-tx` from origin/main (6ad9ad5). Commits: 2c0af0e (code + tests), 5b268c6 (specs close their questions), REPORT_HASH (this file).

## What changed (`api/src`, 118 diff lines with context, so not pasted; read `git diff origin/main -- api/src`)
- `posts.service.ts` `spendThen`: `write` now receives `link(tx, postId)`. `link` runs `charge.updateMany({userId, idempotencyKey, refId: null, status: COMMITTED} -> {refType, refId})` on the transaction client and throws `409 CONFLICT` unless exactly 1 row matched. The old after-the-commit `updateMany` (failure only logged) is gone. Replay rules, `find`, `IDEMPOTENCY_KEY_REUSED`, "reverse only a charge this request created", `P2003 -> gone()`, the logging: unchanged.
- Callers: only two exist (`createAnswer`, `createReply`; text and voice share them). Each calls `await link(tx, row.id)` as the LAST statement of its own transaction, after the post row and the counters (answerCount/voiceCount, replyCount/stance counts, user counters). Link fails -> the whole transaction rolls back (post and counters) -> request fails like any failed write -> in-request reversal.
- `dm/dm.service.ts`: the success value was built inside the `try`, so a failing read after the store (the balance read) reversed the charge of a stored message. Moved after the `try`.
- `main.ts` + new `graceful-stop.ts`: SIGTERM/SIGINT drain, see below.

## Point 2: link matches no row
- Free post: a Charge row exists (cost 0, usedFreePost) and is linked the same way; matches 1. Prepaid voice token: same, a Charge row with cost 0 (token is consumed after the commit, as before; test checks it stays unused when the link fails). Replay under an older unlinked charge (no post stored): matches 1, links inside the transaction, as today. Replay of a stored post: `find` returns it, no write, no link.
- Matches 0 only if the charge was linked or reversed meanwhile (a parallel twin, or the sweeper): the transaction fails, nothing stored, 409. A replayed request never reverses (rule kept); a fresh one reverses (a no-op when already reversed). I added `status: COMMITTED` to the match so a reversed charge can never get a post (tested).

## Point 3: DM
Same gap as the sweeper's: NO. DM charges carry no `refType` and have no link (the sweeper reads only marked POST charges), and the message is stored in one transaction. But another gap: after the store, `balanceOf` / the view ran inside the `try`; if it threw, the charge of a STORED message was reversed. Reproduced on origin/main (spy on `balanceOf`: message stored, charge REVERSED), fixed, test `test/dm/dm-after-store.spec.ts` (fails on main, passes now).

## Point 4: SIGTERM
Today (origin/main): no signal handler, no `enableShutdownHooks`; Node's default ends the process at once, requests in flight are cut (the checker saw 8 of 8 stored posts unlinked). Now: `gracefulStop` closes the listener, closes idle keep-alive connections (repeatedly), waits for running requests up to 10 s, then `app.close()` and exit 0; after 10 s exit 1. Only `api/src` touched. Not done (outside `api/src`): the service file / deploy script must send SIGTERM and wait >= 10 s before SIGKILL (systemd `TimeoutStopSec=15`, `KillMode=mixed` or default); nginx should retry/stop sending to the instance while it drains (a request reusing an idle keep-alive connection at that instant is reset).

## Tests (all new; no existing assertion changed)
- `test/talk/link-in-tx.spec.ts` (30): text/voice x answer/reply x paid/free (+ prepaid voice answer), by a DB trigger on the link: 500, no post, counters unchanged, charge REVERSED, balance/free post back, sweeper +31 min reverses 0; link AND reversal fail: no post, orphan, sweeper 0 at +29, 1 at +31, given back; happy path checked inside the transaction (deferred constraint trigger: post without linked charge at commit raises); reader loop with 20 posters (0 bad rows); replays. 11 of them fail on origin/main code.
- `test/talk/link-in-tx-kill.spec.ts` (4): real compiled process, 50 people, SIGKILL after 8 posts stored, restart, sweep at +31 min. Branch: run1 charges 50, stored 8, linked 8, reversed 42; run2 50/8/8/42; run3 27/8/8/19. People with post AND reversed charge: 0, 0, 0; post with unlinked charge 0; charged with no post and not given back 0. Same spec on origin/main code: post AND reversed charge 8, 8, 8 (all stored posts refunded). SIGTERM test: slow post (1.5 s) + SIGTERM at 0.4 s: 201, stored, linked, exit 0 after 1831 ms, new connection refused meanwhile.
- `test/units/graceful-stop.spec.ts` (3), `test/dm/dm-after-store.spec.ts` (1).

## Commands
- `npx tsc --noEmit`: clean. eslint on touched files: clean. Contract build + `cmp`: identical (no route change).
- Own PostgreSQL 16.15 (port 56932), Redis (56933), no live provider. `jest test/talk test/units test/dm` on a fresh database: 35 suites, 491 tests, all pass (before my new files: 31 suites, 453 tests, all pass). Whole suite on a fresh database: 126 suites, 1409 tests, 1408 passed, 1 skipped, 0 failed. (A first whole run failed hotfix1-block-oracle: my new specs left answers on live questions and filled the trending feed; fixed by closing their questions in afterAll, spec-only.)

## Not done / unsure
- The kill spec compiles the API into `node_modules/.cache/lit-dist` (about 12 s) and spawns it; it needs `tsc` and free local ports.
- A sweeper reversal and a link racing at exactly 30 min: not tested (the in-request window is milliseconds).
- No schema change. `.github/` and `infra/` untouched.
