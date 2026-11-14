VERDICT: MERGE

# Verify V-LINK-IN-TX round 2 (branch v/link-in-tx, head 2cc5929)

Checker: independent. No product code or existing test changed. My attack specs stayed outside git (`api/test/zz-verify/`, not committed). Own PostgreSQL 16 (`log_lock_waits=on`, `deadlock_timeout=200ms`) and Redis, fresh databases, no live service, no `.env` opened.

Short version: all four round 1 findings (M1 to M4) are closed. I found no HIGH and no MEDIUM. Three LOW notes below. Money stayed right in every run.

## Findings (most severe first)

No HIGH. No MEDIUM.

### L1. An ambiguous old row is still reversed by the sweeper after 30 minutes
- Where: `api/src/talk/charge-sweeper.service.ts` `healUnlinked` (rule: exactly one candidate post per charge and one candidate charge per post).
- Steps: an old-code row where one person has two unlinked charges for one post, or one charge and two candidate posts. The heal leaves both alone (checked: `ambiguous` counted, `refId` stays null). The sweeper then reverses them at +31 minutes, so that post is free.
- Why LOW: it needs old-code crashes at the deploy second, and the person is never charged for nothing. It is counted in the log (counts only). On my 505,000-charge database 8 charges were left this way. The builder named this in the report.

### L2. Main has moved past what the brief named
- Main is now 6eccda4 (#30, "An admin's nameless reply is never lifted"). The one change in `posts.service.ts` is in `listReplies` (`anonymous: false` added to the admin-first query). No `listReplies` line is "one-line" at 21fa85a; that commit changes the edit lock and the news lock. I merged both (see M4). Nothing to fix.

### L3. `npm run lint` is `eslint --fix` (as in round 1)
- Plain eslint (no `--fix`): 0 errors, 51 warnings. Not caused by this branch.

## M1: a linked charge is never reversed (held)
- `reverseCharge` (`api/src/units/units.ledger.ts` ~l.522-590) takes the wallet lock, then `SELECT ... FOR UPDATE` on the charge row, then reads it; `if (c.refId) return { reversed: false }` (l.537) sits before the guard and before any write; the final write is `updateMany where { id, status COMMITTED, refId null }` and zero rows rolls the reversal back. So the refusal is inside the same transaction and row lock as the status change.
- Round 1 repro, my own spec: wrap `$transaction` to run the real one and then throw. Text answer: HTTP 500, 1 post, 1 charge COMMITTED and linked. Nameless reply: same (500, 1 reply, charge COMMITTED and linked).
- 6 parallel same-key `createAnswer` calls into the service, 10 rounds: every round 1 post, 1 charge, COMMITTED and linked.
- Every caller of reverse (grep of `src/`): posts `spendThen` catch (posts.service.ts:282), edit refund (:735, :746), votes (poll.service.ts:377), reactions (engagement.service.ts:213, :222), DMs (dm.service.ts:303), units-access.ts:46,52, the sweeper via `reverseGuarded` (charge-sweeper.service.ts:191), `reverseByKey` (no caller outside tests). Admin refund of a removed post, moderation, the vote explanation and Fix my text: none of them calls a ledger reversal anywhere in `src/` (money.service.ts only flags a naira overpayment for a manual refund). `attachRef` (the one other writer of `refId`) has no caller. Only post charges are ever marked (`refType`, ledger l.430), so a vote, reaction, DM or edit charge never has a `refId` and still reverses exactly as before. There is no "allow linked" switch at all, so no ordinary request can pass one. No caller silently stopped refunding. (The full suite includes the vote, reaction, DM and edit refund specs: all pass.)

## M2: the sweeper race (held)
- Deterministic steps, 5 rounds: marked charge aged 40 minutes, post transaction opened, answer created, link written, transaction held open, `sweep(now + 31 min)` started (it waited on the row), then commit. Sweep reversed 0 every time; post stored; charge COMMITTED and linked. (Round 1 showed the reverse: sweep reversed 1.)
- Scale, 5 runs: 200 posts from 20 people (10 with 4 free posts, 10 with none, 4 poor wallets), 3 sweepers looping, sweeper clock 31 minutes ahead. Stored posts 200 each run; sweeper reversed 0 each run; violations 0 each run. Books audit after each run: no post with a reversed charge; every ledger transaction sums to zero; each wallet equals start plus its ledger entries and equals start minus its kept paid charges; free-post counters right; one SPEND per paid charge and one REVERSAL per reversed paid charge (nobody charged twice); kept charges equal stored posts per person (nobody refunded for a stored post); no COMMITTED unlinked charge left. Client codes were 201 and 404: the 404s come from the artificial clock deleting live idempotency records (as in round 1), all 200 posts still stored.

## M3: old rows healed (held)
- (a) Replay of the key for a stored post links its still-unlinked charge (builder's spec and mine: 201 with the stored post, charge linked, sweeper at +31 reverses 0).
- (b) The heal is not a migration; it runs in `onModuleInit` before the sweeper loops, never throws, and logs counts only. My own spec, 7 cases, all pass: unambiguous answer row and unambiguous REPLY row (the builder tested answers only) are linked; second run `{linked:0, ambiguous:0}` and rows identical; never links to another person's post; never links to another kind (TEXT charge vs VOICE post), nor an `answer` charge to a reply or the reverse; window held (post before the charge: no; 11 minutes after: no; 9 minutes after: yes); a REVERSED charge, an unmarked charge, an already linked charge, and a post that already owns a linked charge are untouched; two charges for one post and one charge for two posts are both left; a real orphan next to the same person's later linked post stays unlinked and the sweeper reverses it once.
- Timing: 505,000 charges (500,000 posts, 480,000 linked at first, 10,000 old-shape rows with one candidate post, 5,000 orphans). The heal's SQL for the answer table linked 9,992 in 1.47 s, left 8 ambiguous; the second run linked 0 in 0.42 s. After it: 0 charges linked to another person's post or another kind. It reads whole tables (a scan of Answer and Charge each boot, about 1.5 s here, with other work running); the reply table is the same statement and smaller. It runs on every start. No migration: no stamp, no `rollback.down.sql`, no collision (main's newest stamp is 20261114350000; the branch adds none).
- (c) `startAt` was not raised. The builder's reason holds: raising it would hide a real orphan charge made by the old process in its last moments. With (a) and (b) the real orphan stays visible to the sweeper (tested above), and an ambiguous row is the only leftover (L1).

## M4: join with main (held)
- The branch joined `origin/main` at e53982b (merge commit `eb7cc01`). One conflict, kept both sides: main's `if (!anon)` around the user counter, and `await link(tx, row.id)` as the last statement of the reply transaction; duplicate `Prisma` import removed.
- My local merge (not pushed) of `origin/main` 21fa85a: clean, no conflict, `tsc --noEmit` clean, whole suite 150 suites, 2,452 tests: 2,451 passed, 1 skipped, 0 failed. Then main 6eccda4 merged on top: clean, `tsc` clean, `jest test/talk test/dm test/units`: 41 suites, 561 tests, 0 failed.
- `test/talk/fixb-r4-edit.spec.ts` (21 tests) and `test/talk/lock-no-key.spec.ts` (4 tests), 5 runs each on the merged tree: 25 of 25 pass, no failure. (The builder saw `fixb-r4-edit` flake on the older main; the `FOR NO KEY UPDATE` lock removes it.)
- Held from main: nameless replies (the link is the last statement and a nameless reply's charge links the same way: checked in the reply repro above), admin posts first, the post lock, paid characters on an edit (extra charge and refund, via the suite), DMs off.

## New deadlocks (none)
- 200 rounds each, real HTTP plus 3 concurrent sweepers at +31 minutes: post + sweeper; post + three same-key requests; edit + two edits + `reverseByKey` of the post's linked charge + sweeper (the post charge stayed COMMITTED every round); post + account purge (`DeletionService.purge`) + sweeper. 5xx: 0. Postgres log: 0 "deadlock detected", 0 "still waiting" lines.
- Reason it holds: the sweeper and `reverseCharge` lock wallet then charge row; the post transaction locks question and user rows, then the charge row, and never the wallet; purge locks user then wallet and never a charge.

## SIGTERM drain (held)
- Compiled process, 40 slow posts in flight, SIGTERM at 0.5 s: 40 of 40 answered 201, 40 stored, 0 unlinked, 0 reversed, process exited 0 after 4,407 ms, a new connection was refused, a late request on the old connection was reset, sweep at +31 reversed 0. Builder's kill spec (3 runs of SIGKILL, plus its SIGTERM test) and `graceful-stop` spec: pass.
- Still true from round 1: the service file and nginx must send SIGTERM and wait over 10 s, and stop sending to a draining instance (outside `api/`).

## What I ran (totals)
- Branch 2cc5929: `npm ci`, `prisma generate`, `tsc --noEmit` clean. eslint, no `--fix`: 0 errors, 51 warnings. Whole `jest --runInBand` on a fresh database: 149 suites, 2,448 tests: 2,447 passed, 1 skipped, 0 failed (the builder saw two failures on their machine: `vote.spec` Redis cache and `fixb-r4-edit` flake; neither failed here).
- Merged tree: see M4 (150 suites, 2,452 tests, 0 failed; then 41 suites, 561 tests, 0 failed on 6eccda4; lock specs 25/25).
- My specs: M1/M2 4 tests (plus 5 scale runs of 200 posts), heal 7, deadlocks 4 plus a 0-5xx check, SIGTERM 1. All pass.

## What I could not prove
- A real lost COMMIT answer: simulated by throwing after a real commit.
- The sweeper race at exactly 30 minutes by luck: shown by holding the transaction open.
- The heal on a copy of the live database: only rows shaped like live ones, 505,000 charges generated by me.
- I did not run my deterministic M2 and repro tests against the round 1 code to see them fail; round 1 already showed that failure, and the builder reports 4 of 5 of their tests failing without the fix.
- Voice posts at scale and the reply scale run: the scale runs used text answers; voice and reply paths are covered by the builder's `link-in-tx` spec and the full suite.
- nginx behaviour during drain (outside `api/`).
