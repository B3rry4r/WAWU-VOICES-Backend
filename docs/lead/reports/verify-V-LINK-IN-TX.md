VERDICT: FIX

# Verify V-LINK-IN-TX (branch v/link-in-tx, head d328403)

Checker: independent. No product code or existing test changed. My attack specs were kept outside git (`api/test/zz-verify/`, not committed). Own PostgreSQL 16 (port 56932) and Redis (56933), fresh databases, no live service.

Short version: the thing the builder set out to do works. A post is now stored and its charge linked in one transaction, and I could not make a stored post come out with an unlinked charge at any cut point. But the claim "never a stored post with a reversed charge" is not true. Two paths still end with a stored post and a REVERSED charge (a free post), one old-row gap is not healed by this change, and the branch no longer merges into main. None is a missing-money-for-a-person HIGH. All four are small fixes.

## Findings (most severe first)

No HIGH found. Four MEDIUM, three LOW.

### M1. A stored, linked post can still have its charge reversed (lost commit answer)
- Where: `api/src/talk/posts.service.ts:210-219` (the `catch` in `spendThen` calls `units.reverse`), `api/src/units/units.ledger.ts:513-576` (`reverseCharge` never looks at `refId`).
- Steps: the post transaction commits (post stored, charge linked), but the call reports an error to the app (a dropped connection on the COMMIT answer, a driver error after commit). `spendThen` goes to its `catch` and reverses the charge.
- Reproduced: I wrapped `prisma.$transaction` so it runs the real transaction and then throws. Result: HTTP 500, 1 post stored, charge `REVERSED` and `refId` set to the post. That is a free post, and the sweeper will not touch it (it is already reversed). Same on origin/main, so not new, but this change says it removes this class, and it does not.
- Same root cause, seen in the service alone (LOW, not reachable over HTTP): 6 parallel `createAnswer` calls with the same key straight into `PostsService` give 1 stored post and 5 x 409, and the 5 losers reverse the winner's charge: post stored, charge REVERSED. Over HTTP the idempotency layer made all 6 return 201 with 1 post and 1 charge (clean).
- Fix: in `reverseCharge`, return `{reversed:false}` when `c.refId` is set (a linked charge is never reversed, whoever asks). One line, and it covers the sweeper race in M2 too.

### M2. Sweeper can reverse a charge at the same moment the post links it (post + REVERSED + linked)
- Where: `api/src/talk/charge-sweeper.service.ts:133-160` (the guard is a plain `SELECT`, takes no row lock) and `units.ledger.ts:572-574` (`tx.charge.update({where:{id}})` sets REVERSED with no `refId IS NULL` condition).
- Steps (deterministic, real clock): a marked, unlinked charge that is 40 minutes old. Open the post transaction, create the answer, run the link `updateMany`, and hold the transaction open. Run `sweeper.sweep()`: the guard `SELECT` does not wait on the locked row, still sees `refId` null, passes. The sweeper's `UPDATE` then waits for the lock. Commit the post. The `UPDATE` lands. Result: sweep reversed 1, post stored, charge `REVERSED` and linked. Books flag it as "post has a REVERSED charge".
- At scale: 200 posts from 20 people with 3 sweepers looping and the sweeper clock set 31 minutes ahead (so every in-flight charge looks old): 2 runs, 24 and 10 bad rows (posts with a reversed charge). With the sweeper on the real clock (+0): 220 requests (20 sent twice), all 201, 200 posts, 0 problems, sweeper reversed 0.
- How likely in real life: the sweeper only picks charges older than 30 minutes with no live retry record, and the post transaction lasts milliseconds. It needs a request that links a charge older than 30 minutes (for example a same-key retry long after a double failure) in the same few milliseconds as a sweep. Rare. The builder listed this exact race as "not tested"; it is real.
- Fix: guard `SELECT ... FOR UPDATE`, and/or `where: {id, status:'COMMITTED', refId: null}` on the final update (count 0 = leave it). The M1 fix also closes it.

### M3. Posts stored by the OLD code with an unlinked charge are still reversed by the sweeper, and a retry does not heal them
- Steps: take a stored post whose charge is marked (`refType` set) and `refId` null (what the old code left after a crash between the store and the link). `sweeper.sweep(now+31min)` reverses 1: post stored, charge REVERSED (free post). Replay of that same key (record expired) returns the stored post with 201, but the charge stays unlinked (`refId` null after the replay), so the sweeper will still reverse it.
- Why it matters now: the deploy of this change stops the old process with no signal handler, so any post in flight at that second becomes exactly this row. The new code does not repair it. Rows from earlier crashes since the sweeper start time are the same.
- Right cases that held: an old charge with no `refType` mark is never read; an old marked charge with no post is reversed once.
- Fix: (a) in `spendThen`, when `find` returns a stored post for a replay, link that post's charge (`updateMany refId null -> post.id`); (b) before or right after deploy, one script that links marked, unlinked charges to their posts (same user, post created after the charge, same content) or turns the sweeper off until it ran. Stamp or raise `ChargeSweeperState.startAt` at deploy as a stopgap.

### M4. The branch does not merge into current origin/main
- origin/main has moved (DMs-off switch, anonymous replies, admin first, etc.). `git merge origin/main` conflicts in `api/src/talk/posts.service.ts` (the reply transaction, ~line 685: main wraps the user counter in `if (!anon)`; this branch adds `await link(tx, row.id)` right after).
- Even when the conflict is resolved, `tsc` fails: `posts.service.ts(27,15)` and `(57,3)` "Duplicate identifier 'Prisma'" (this branch adds `import type { Prisma }` at line 26; main's type import now also brings `Prisma`). Deleting the branch's import line fixes it. Loud, not silent, but it needs a rebase before merge.
- I tested the merged result in a scratch worktree (conflict resolved, `link` kept as the last statement, duplicate import removed): `tsc` clean, DM specs, dm-off, builder's `link-in-tx.spec` all pass (94 tests, 5 suites).

### L1. `npm run lint` is `eslint --fix` and rewrites files
It changed 19 existing test files in my checkout (I reverted them). Plain `eslint` (no `--fix`): 0 errors, 47 warnings. Not caused by this branch.

### L2. A client reusing an idle keep-alive connection right after SIGTERM gets a reset
Measured: status -1 (connection reset) on the first request after SIGTERM. No money effect (the request never starts; the app must retry, safe with the Idempotency-Key). The builder noted it; nginx needs to stop sending to a draining instance. `infra/` was not changed; the systemd unit has no `TimeoutStopSec`, so systemd's default 90 s applies, which is above the 10 s drain limit. Good.

### L3. The 10 s drain limit cuts a slower post
A post made to take 12 s: process exited 1 after 10519 ms, client got no answer, 0 posts stored (the transaction rolled back), charge COMMITTED unlinked, then the sweeper reversed it exactly once at +31 min; books clean. Works as designed.

## What held (with numbers)

1. Cut points (my own specs, text answer, one free person and one paid person each): throw at the post insert, at the question counter update, at the link update, and at COMMIT (deferred trigger): every time HTTP 409/500, 0 posts, 1 charge REVERSED once, wallet and free post back, sweeper at +31 reversed 0 more, same key again gives 409 "start again", a new key posts 201, books clean. Link AND reversal both failing: charge stays, 0 posts, sweeper reversed it once (two sweepers at the same time: total 1), then 0. A failure after the commit (view build throws): post stays linked, charge kept, sweeper leaves it, retry with the same key returns the one post (1 post, 1 charge). Builder's `link-in-tx-kill.spec` (50 people, SIGKILL, restart, sweep) passed all 3 runs, and its SIGTERM test passed.
2. Books under load: 200 posts, 20 people (10 with 4 free posts, 10 with none, 4 poor wallets), 20 requests sent twice, 3 sweepers looping, real clock: 220 x 201, 200 posts, 0 problems. Audit checked: every ledger transaction sums to 0 (whole table), wallet = start + ledger = start - kept charges, free counters, usage counters = kept charges, exactly one SPEND per paid charge and one REVERSAL per reversed paid charge, one linked committed charge per post, no kept charge without a post. (With the sweeper's clock 31 minutes ahead the books break: that is M2, plus that sweeper deleting live idempotency records and the app answering 404 after a stored post, which is only the artificial clock.)
3. Idempotency over HTTP: 6 parallel same-key requests: 6 x 201, 1 post, 1 charge. Same key with a different body: 409. Same key and body after: returns the same post. Replay after a cut: 409 "start again", never a second charge.
4. No migration: `git diff origin/main...origin/v/link-in-tx -- api/prisma` is empty; the new code writes the same columns with the same values (`refType` at charge, `refId` at link) as the old code, so old code reading new rows and new code reading old rows both work, and a roll back and forward is safe. The only old-row gap is M3.
5. SIGTERM (compiled process): 40 slow posts in flight, SIGTERM at 0.5 s: 40 x 201, all linked, exit 0 after 3799 ms, new connection refused, a late request refused, 0 problems.
6. DMs (merged with main, where `DMS_LIVE` lives; the branch has no switch because it is based on the older 6ad9ad5): `DMS_LIVE=off`: 404, 0 charges, 0 messages, wallet unchanged. On: message stored then the balance read fails: message and charge kept; store fails: charge reversed once; sweeper at +31 leaves DM charges alone.

## What I ran

- Branch d328403: `npx prisma generate`, `npx tsc --noEmit` clean, eslint 0 errors (47 warnings), full `jest --runInBand`: 126 suites, 1409 tests, 1408 passed, 1 skipped, 0 failed (no test that fails only together with others). `npm run test:audio`: 13/13.
- Builder's kill + graceful-stop specs alone: 7/7.
- My specs on the branch: cuts 12 (9 pass, 3 show M1/M3), load 3 (real clock passes; two early-clock runs show M2), interleave 1 (shows M2), SIGTERM 3 (all pass).
- Merged scratch worktree: dm + dm-off + builder `link-in-tx` 94/94.

## Could not prove

- A real lost COMMIT answer (I simulated it by throwing after a real commit).
- The sweeper race at exactly 30 minutes by real time; shown by holding the transaction open, not by luck.
- Old-code behaviour was not run; I reasoned from the diff (same columns and values) and tested the old-row states by editing rows.
- `createReply` cut points: the builder's spec covers them; I cut only answers myself.
- nginx behaviour during drain (outside the repo's `api/`).
