# V-LINK-IN-TX round 2

Branch `v/link-in-tx`. Head: see the last commit on the branch (the report commit; the code is in `ab86399`, the merge is `eb7cc01`).
No pull request opened. The contract did not change. No migration.

## Step 0 (M4): merged with main
`origin/main` at e53982b merged (`eb7cc01`). One conflict, `api/src/talk/posts.service.ts` in the reply transaction: kept main's `if (!anon)` around the user counter and kept `await link(tx, row.id)` as the LAST statement. Deleted this branch's duplicate `import type { Prisma }`. Everything from main kept. `prisma generate` and `tsc --noEmit` clean before any other change.

## M1: a linked charge is never reversed
- `api/src/units/units.ledger.ts` `reverseCharge` (~l.513-595): after the wallet lock the charge row is locked (`SELECT ... FOR UPDATE`, by id or by key) and then read, so a transaction that is linking it must commit first; `if (c.refId) return { reversed: false }` (l.537) changes nothing. The final write is now `updateMany where { id, status COMMITTED, refId null }`; zero rows rolls the whole reversal back and returns `{ reversed: false }` (second guard, cannot normally happen under the lock).
- Callers of `reverseCharge` (all reach it through `reverse`, `reverseByKey` or `reverseGuarded`):
  - `PostsService.spendThen` catch (posts.service.ts ~l.267): `reverse`. Linked charge: kept. This is the fix.
  - Edit refund (posts.service.ts ~l.720, ~l.731): `reverse`. The edit charge is never marked or linked (`refId` stays null), so it still reverses. Not affected.
  - Votes (`poll.service.ts:377`), reactions (`engagement.service.ts:213,222`), DMs (`dm.service.ts:303`), `units-access.ts:46,52`, `units.service.ts:88,93`: charges are never linked to a post (`refId` null), so they still reverse as before.
  - Sweeper (`reverseGuarded`): only reads unlinked charges; see M2.
  - `reverseByKey`: no caller outside tests.
  - Admin tools, moderation refunds, Fix my text: none of them calls the ledger's reversal in this code (grep of `src/`). No caller reverses a LINKED charge on purpose, so I added no `allowLinked` parameter (it would be unused code). If one is added later it needs its own named path.
- Tests (`api/test/talk/link-in-tx-round2.spec.ts`): the checker's repro (real `$transaction` then throw): HTTP 500, 1 post, charge COMMITTED and linked, wallet charged; 6 parallel same-key `createAnswer` calls into the service: 1 post, charge COMMITTED; `reverse`, `reverseByKey`, guarded reverse leave a linked charge alone, and an unlinked one still reverses. With the fix lines removed these fail (4 of 5 in M1/M2); with them they pass.

## M2: sweeper cannot reverse while a post links
- `charge-sweeper.service.ts` guard: `... FOR UPDATE OF c` (l.207), taken in the sweeper's own transaction. Final update conditional on `status = 'COMMITTED' AND "refId" IS NULL` (see M1; zero rows = left alone, not counted).
- Tests: the deterministic steps (link written in an open transaction, sweep started and waiting, commit): sweep reversed 0, post stored, charge COMMITTED and linked. Scale: 200 posts from 20 people, 3 sweepers looping, clock +31 minutes: 0 posts with a non-COMMITTED charge, every ledger transaction sums to 0, each wallet = start + its ledger entries, kept charges = stored posts per person. (That run passes even without the fix on my machine, as the checker said it is a rare race; the deterministic test is the one that proves it.)

## M3: old rows healed
- (a) `posts.service.ts` ~l.232 (`spendThen`): when a replay finds the stored post and the charge is marked and unlinked, it links that charge to the post (`updateMany refId null -> post id`, only a COMMITTED charge of that person and key). Test: old-shape row, key replayed: 201 with the stored post, charge linked, sweeper at +31 min reverses 0.
- (b) `ChargeSweeperService.healUnlinked()` (charge-sweeper.service.ts ~l.90), run in `onModuleInit` on every start before the sweeper loops. Chosen over a migration because a migration runs while the old process may still be taking posts (and would leave one more such row), and the start-up run happens after the old process is gone; it is idempotent and also covers rows left by crashes later. It never throws and never blocks boot (errors are logged). No migration, so no stamp and no rollback file are needed; to turn it off, remove the call.
  Rule (one SQL statement per post table, answers and replies): marked (`refType` set), COMMITTED, unlinked, POST_TEXT/POST_VOICE charge; candidate post = same author, same kind, created at or after the charge and within 10 minutes, with no charge linked to it. A charge is linked only when it has exactly one candidate post and that post has exactly one candidate charge. Everything else is left alone and counted; the log line is `linked N ... left M ambiguous` (counts only, no personal data).
  Tests: unambiguous row linked (and a second run links 0, row unchanged); two candidate posts: both charges left unlinked, ambiguous counted; a charge with no post: left, the sweeper reverses it; an already linked charge: row identical before and after; an empty database: `{ linked: 0, ambiguous: 0 }`.
- (c) NOT done: raising `ChargeSweeperState.startAt` to the new code's start time. It cannot be made safe: it would also hide a real orphan charge (charge taken, no post stored) made by the old process in the last moments before it stopped, and that person would pay for nothing with nobody to give it back. Relying on (a) and (b) instead. Left over: an ambiguous row (two candidate posts) is still reversed by the sweeper after 30 minutes and its post stays free; it is counted in the log so it can be looked at.

## Checks
- `prisma generate`, `tsc --noEmit`: clean. eslint (no `--fix`) on the touched files: 0 errors (I ran `--fix` only on my new spec file).
- New spec: 10/10. Existing `link-in-tx` and `link-in-tx-kill` specs: pass. Whole suite: see the totals line below.
- Own PostgreSQL 16 and Redis on this machine; nothing live was called.

## Could not prove
- A real lost COMMIT answer (simulated by throwing after the real commit, as the checker did).
- The sweeper race by luck at exactly 30 minutes (shown deterministically).
- The heal on a copy of the live database (rows shaped like live ones only).
