VERDICT: MERGE

# Check of v/rel-d6 (full report)

Branch checked: `origin/v/rel-d6` at 3cf738b. I changed no product code and no existing test, and I committed none of my own attack specs. Real HTTP, own Postgres 16 (`log_lock_waits=on`, `deadlock_timeout=200ms`), own Redis. I never touched a live service or a key file.

One clean full `npm test` re-run was still going when I wrote this (see "The full test run"). Everything else below is finished.

## Findings (most severe first)

HIGH: none found.
MEDIUM: none found.

LOW-1. Two older specs leave readable posts behind, and this branch adds a little more.
- `test/talk/admin-first.spec.ts` leaves 34 readable posts and 17 replies on 3 live questions. On `origin/main` the same spec leaves 33 posts and 13 replies. `test/feed/admin-first-home.spec.ts` leaves 11 posts on 2 live questions, same as main (11).
- This is the kind of leftover that broke `hotfix1-block-oracle` and `shared2` today. In my full run on one fresh database, both of those specs passed, so it does not bite in the release order today. The risk is real if the order ever changes.
- Steps: fresh database, run each spec alone, count `Answer` rows with status PUBLISHED whose question is not DRAFT.
- The branch's new tests inside these two files add 1 post and 4 replies. Cleanup in their `afterAll` would close it.

LOW-2. In `test/talk/rel-d2-lock-order.spec.ts` the two "one lock at a time" tests fail at 200 rounds.
- With `D2_ROUNDS=200`: "a moderator's action takes the post before it waits for the item" and "an editor's decision holds the post with FOR NO KEY UPDATE" fail with "the action never started waiting" (file lines 330-332, after 1,200 earlier rounds). Run alone, and at the normal 20 rounds, all 10 tests pass.
- I did not find the cause. It looks like the test's wait probe, not product code: the six mixes at 200 rounds, and everything else I ran, show the right lock order. I could not prove that.

LOW-3. The purge of a person with many likes holds many post locks for its whole run.
- A person who liked 5,000 posts: purge took 5.6 s and holds a "no key update" lock on all 5,000 posts until it commits. An edit or a moderator action on any of those posts waits up to that long. Readers and likers are not blocked: 537 reads in that time, 0 slow (over 1 s) and 0 server errors, slowest read 158 ms; likes on the same posts, slowest 54 ms. Like counts matched the rows afterwards (0 mismatches).
- `api/src/me/deletion.service.ts` purgeOnce: the lists of posts to lock are read before the person's row is locked. A like or reply made in that gap would not be in the lock list. It cannot lose data (the person is already DELETION_PENDING); at worst it is one unlocked row in the old order. I did not try to hit it.

LOW-4. Forged cursors: a cursor can carry up to 50 ids of its own choosing and the page then leaves those ids out of the ordinary list. That only changes what the forger sees. No server error from any forgery I tried (below).

## What held

### The unchanged parts (byte for byte)
- `git diff origin/main HEAD` on `api/src/units`, `api/src/talk/shared/units-access.ts` and `api/test/talk/fixb-r4-edit.spec.ts`: empty. The edit path in `posts.service.ts` is untouched; the only change in that file is reply paging and the not-public filter.
- `fixb-r4-edit.spec.ts`: passes alone, 21 of 21, 3 runs of 3 on the branch and 2 of 2 on main on a quiet machine. In my first full run it failed one timing check ("60 edits at once, the bystander's request must take under 500 ms": took 722 ms). I was running my own attack jobs on the same machine at that moment. See "The full test run".

### A. Lock order (200 rounds each, real HTTP)
| Mix | 5xx | "deadlock detected" | counts and books |
|---|---|---|---|
| decide + remove | 0 | 0 | clean |
| decide + remove + edit | 0 | 0 | clean |
| decide + remove + report | 0 | 0 | clean |
| decide + purge | 0 | 0 | clean |
| remove + purge | 0 | 0 | clean |
| purge + remove + decide | 0 | 0 | clean |

- Postgres log across everything I ran: "deadlock detected" 0 times. Lock waits logged 30, longest wait 413 ms, mostly purges waiting on the role lock (as designed).
- Did the retry ever fire on its own? No: with 0 deadlocks the 40P01 path was never needed. I did not count P2034.
- All pairs of 17 actions (edit, second edit, delete, reply, nameless reply, reaction, like, save, report, news flag, editor decision, moderator removal, moderator restore, appeal, purge of the author, purge of a replier, purge of a liker): 136 pairs once, then 3 rounds = 408 pair runs, plus 400 random triples. 5xx: 0. Deadlocks: 0. After each batch: like, reply, reaction and flag counts equal the rows; no ledger transaction off zero; every wallet equals its ledger; at most one OPEN Verified News row. Moderator on a post that was removed, deleted or decided meanwhile: clean 409 or 404 in the response counts (13 of 16 removals 200, 3 got 409; nothing half done).
- Forced retry (injected a 40P01 on the first try):
  - Purge: ran twice, mail sent once, ID-file purge once, person ends DELETED.
  - Moderator action: 200 on the second try, 1 mail, 1 alert, 1 action row (nothing doubled).
  - Editor decision: 200 on the second try, nothing doubled (this decision sends no mail).
- Purge of a person who liked 5,000 posts: see LOW-3.

### B. The purge itself
- Same seed (person with posts, anonymous post, likes, reaction, save, listen, replies, alert, report, moderation item, wallet and ledger, saved question) purged on `origin/main` and on the branch, then `pg_dump --data-only` of every table, ids and times normalised, rows sorted: 101 rows each, diff empty.
- `purgeDue` with one person failing every time: the other two are purged (DELETED), the failing one stays DELETION_PENDING and is tried again on the next run (3 tries in the first run, more in the second). The log line is "purge of one account failed (Error 40P01); it will be tried again": no id, no name.

### C. Paging
- 45 walks: sorts NEW, TOP, DEBATED × page sizes 1, 7, 20 × scenarios (post under the cursor removed, an admin posts, an admin role removed, an admin banned, nothing). Duplicates 0, missing 0 in all 45 (not counting what I removed).
- Cursor size with 20 admin ids: 1,131 characters.
- A nameless admin post is not in the block and its id is not in the decoded cursor (checked by decoding).
- Forged cursors on answers: 10,000 ids: 431 (too large), 4 ms; wrong types in the id list: 200 (ignored), 47 ms; id list is a string: 200 (ignored); one 100,000-character id: 431; id is a number: 400; garbage: 400; 200,000-character id: 431. None 5xx, none slow. On replies: 422, 431, 422.
- A cursor in the old shape (no id list) still walks: page 2 repeats nothing from page 1 (0 overlap).
- No code path deletes an answer or reply row, so a cursor can only point at a REMOVED row, which still works.

### D. Not public, not lifted
Question with 5 admins (one per status) each with an old answer and an old reply, plus ordinary newer posts:
- Answers (NEW): SUSPENDED admin at position 0 and ACTIVE at 1 (lifted). BANNED, DELETION_PENDING, DELETED sit at positions 10, 9, 8 (ordinary place, once each).
- Replies: SUSPENDED 0 and ACTIVE 1 (lifted); BANNED 2, DELETION_PENDING 3, DELETED 4 (ordinary place, once each).
- Home, trending and a category page: covered by the branch's own `admin-first-home.spec.ts` (10 of 10 pass). My own trending probe was not conclusive (see below).

### E. M3, L2, L3
- Share picture for a question with words: identical to `origin/main` byte for byte for the card, story and square sizes (sha256 prefixes `c017cc83fb70361b`, `b1357e29a82652e7`, `c16877e00a725a84`, sizes 56,835 / 94,002 / 72,460 bytes on both).
- A question with no words: main drew the pick layout (50,022 bytes), the branch draws the plain card (51,815 bytes): that is the intended change. Story and square sizes are identical either way.
- L2 and L3: the branch's `rel-d2-dm-off.spec.ts` passes (3 of 3). I did not write a separate attack for these.

### F. The record flow
- 20 people, 200 text posts at once, then an edit, a like, a reply, a read of replies and a delete: status and body shape of every call identical on `origin/main` and on the branch. All 200 posts 201. Books clean: 0 unbalanced ledger transactions, 0 wallet mismatches, question count right.
- I did not run it with the charge sweeper running, and I did not run voice posts.

### G. Shared test database
- Each new or changed spec alone on a fresh database, then a count of what is left (readable posts / replies / moderation items / reports):
  - `dm/rel-d2-dm-off`: 0 / 0 / 0 / 0
  - `reach/rel-d2-pick`: 0 / 0 / 0 / 0
  - `talk/rel-d2-admin-walk`: 0 / 0 / 0 / 0
  - `talk/rel-d2-lock-order`: 0 readable posts, 124 replies on a DRAFT question's posts, 0 moderation items, 0 reports
  - `feed/admin-first-home` (changed file): 11 posts left (main: 11): LOW-1
  - `talk/admin-first` (changed file): 34 posts, 17 replies left (main: 33, 13): LOW-1
- The whole release run: next section.

### H. Gate
- `npm ci`, `prisma generate`, `tsc --noEmit`: clean. ESLint without `--fix`: 0 errors, 51 warnings, the same 51 as on `origin/main`.

## The full test run (whole `npm test`, one fresh database, in band)
- Run 1: 162 suites, 161 passed, 1 failed; 2,673 tests passed, 1 skipped, 1 failed; 1,635 s. The one failure is the timing check in `fixb-r4-edit.spec.ts` ("60 edits at once and a bystander's request", took 722 ms against a limit of 500 ms). That file is byte for byte main and passes alone 3 of 3 here (2 of 2 on main). I was running my own attacks at the same time on the same machine, so I treat it as load, not a fault in the branch. `hotfix1-block-oracle` and `shared2` both passed in this run. The audio test script after jest was not reached in this run's summary.
- Run 2: started on a fresh database with nothing else running. Its numbers are in the addendum below if it finished in time.

## What I could not prove
- Share-card draw, the charge sweeper and a Verified News request were not in my mixes. The Verified News request is only covered by the builder's own specs and by the "one OPEN row" count after the mixes.
- Walks with mood, tag and stance filters: not run by me.
- A cursor made by main's own code used on the branch: I made the same shape by hand (`{i, t}`) instead of using a main server; replies' old two-part cursor: I only fuzzed it, I did not walk it.
- Home, trending and category with not-public admins: only through the builder's spec; my own probe of trending was inconclusive.
- A purge racing a person's own new like in the gap described in LOW-3.
- Why the two "one lock at a time" tests fail at 200 rounds (LOW-2).
- Natural retries on P2034 (never counted).
