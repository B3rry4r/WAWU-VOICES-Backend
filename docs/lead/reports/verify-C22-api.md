VERDICT: FIX

# Verify C22 (API): the sweeper mark, the give-back for the 409 only, two CI tests

Checked head **b505087** on `verify/c22-api` (made from `origin/v/batch-api-1114c21`; the head is b505087, as the brief says). Every line says RAN (I ran it and saw the result) or READ. Own PostgreSQL 16 (port 55931) and Redis (56931); the API ran as real processes (compiled `dist`, one tree of origin/main as the "old code", one of this branch, one of 4dadb23). No live provider, no `.env`, no key file. Everything I started is stopped. My scripts and specs are not in the commit; this file is the only thing I commit.

## In one paragraph
The mark works for what it was built for. R1, R2, R4 and R5 hold in every run. The old code's charges are never touched, whatever the start time says. R3 does not hold in one narrow case that was already true at 4dadb23 (finding 1): when a post is stored but the link step does not happen (process killed, or the link statement fails), the charge stays marked and unlinked, and 30 minutes later the sweeper gives the money (or the free post) back while the post stays. The mark cannot tell that apart from a real orphan. It is not a regression of this round, but it is money moving wrongly for a real person and it is open, so the verdict is FIX. Separately the whole jest suite is red on a fresh database (finding 2, a test leaving a row behind). If the lead rules finding 1 accepted for launch, finding 2 is the only thing left and the answer becomes MERGE after it is fixed.

# Findings, most severe first

## 1. MEDIUM (same at 4dadb23, so not a regression of this round). A stored post whose charge was never linked is refunded by the sweeper after 30 minutes
- Code: `api/src/talk/posts.service.ts:175-188` (`spendThen`: `write()` commits the post and its counters in one transaction, and only afterwards a second statement, `charge.updateMany`, links the charge; a failure of that statement is only logged), `api/src/talk/charge-sweeper.service.ts:105-110` and `:139-143` (a candidate is any COMMITTED POST_TEXT / POST_VOICE charge with `refType` set and `refId` null; no look at whether a post exists). The mark `refType` is written when the charge is created, so a charge whose link did not happen looks exactly like an orphan.
- What I did, in four ways (all RAN):
  1. A database trigger makes the link statement fail for chosen keys. A paid person and a free-post person each post: both get 201 and their post is stored; the charge stays `COMMITTED`, `refType = answer`, `refId` null. Sweep at +29 minutes: 0. At +31 minutes: **2 reversed**, both posts still stored, the paid person has the money back, the free-post person has the free post back. Again: 0.
  2. The same at 4dadb23 (its own build, same trigger): 29 min 0, 31 min **2 reversed**, both posts stored. So this was true before this round. (At 4dadb23 the unmarked charge was also reversed; the mark changes nothing for this case.)
  3. A real restart with 50 people posting at once, one post each, no trigger. I let the first posts commit, then killed the API: SIGTERM run: 8 posts stored, 0 charges linked; SIGKILL run: 6 posts stored, 0 linked; second SIGKILL run: 24 posts stored, 5 linked. All three runs, then boot again and sweep at +31 minutes: 150 requests made 146 charges, 5 linked, 141 marked and unlinked, 38 posts stored; **33 people kept a post and got the charge (or the free post) back**. SIGTERM does not drain the in-flight posts (8 of 8 stored posts unlinked). Another run killed earlier (in the charge phase, before any post commit): 37 charges, 0 posts, all 37 reversed correctly, 0 people with both. At 4dadb23 one SIGKILL run: 37 posts stored, 6 of them refunded after the sweep.
  4. How wide the window is: one person posting alone, 28 pairs read from the statement log (post insert, then link update): median 4 ms, 95th percentile 7 ms, longest 9 ms. Under 50 at once the gap is much longer, because all 50 requests do their post write before any does its link.
- Who loses what and how often: the platform loses the price of a post (a few tenths of a unit; the free-post person gets a free post back and can post again) for each post that is stored in that window when the process stops or the link statement fails. At a deploy restart it is about (posts per second) x (about 5 ms) posts, so a few percent chance of one person at a few posts a second, more under a burst. Not a charge on the person, never a double charge on the person. It does not repeat for the same post.
- What should happen: the link is written in the same transaction as the post (pass the charge id into `write()` and update the charge inside it), so a stored post and an unlinked charge cannot exist together. Or the sweeper confirms no stored post exists for that author and question near the charge time before it reverses (the C21 design rejected content matching, so the first is better).
- Way round for tonight: restart the API when posting is quiet (SIGTERM does not drain), and accept one or two posts refunded per restart.

## 2. LOW (test only, but CI is red). `test/talk/c22-sweep-mark.spec.ts` fails in the whole suite and in the `test/talk` folder run
- RAN: whole suite on a fresh database, in band: **120 suites, 119 passed, 1 failed; 1,304 tests, 1,302 passed, 1 skipped, 1 failed**. The failure is `c22-sweep-mark` "deploy, rollback to the old code, deploy again..." at line 129: the sweep at +31 minutes reversed 1 where 0 is expected. Alone it passes (2 of 2 runs). Cause: the spec sets the start time to 100 days back and sweeps the whole database; `test/talk/hotfix1-sweeper.spec.ts` (whose fixture this round changed to `refType: "answer"`) leaves one marked, unlinked, committed post charge behind (RAN: 1 row after that spec alone; the other six specs I checked leave 0). Another spec's row is then reversed inside this spec's count.
- `jest test/talk` on a fresh database: 24 suites, 2 failed, 280 tests, 4 failed: this spec (1) and `hotfix1-block-oracle` (3; the known test-only fault from the C21 report, which passed in the whole-suite run).
- Should: the spec counts only its own people's charges, or `hotfix1-sweeper.spec.ts` cleans up its row.

## 3. LOW. The candidate query reads every unmarked old-code row every pass
- RAN, 100,000 mixed charges: the candidate query uses `Charge_sweep_idx` (index scan, 0.3 ms for the first page; "Rows Removed by Filter" is the unmarked rows; the index does not contain `refType`). With 155,000 unmarked, unlinked old-code post charges added and one marked orphan behind them: 29.6 ms for one page. Linear in the number of old-code charges after the start time, every 10 minutes: harmless.
- A pass that had 9,893 orphans to reverse (the cap is 50 pages x 200 = 10,000) took 84 s (about 8.5 ms each); a pass with nothing to do, about 1 s of which most is booting my script. A second sweep of the same rows reversed 0.

## 4. Noted, by design of R1 (not a finding against the rules)
- A person who paid under the OLD code and got nothing (the old code's write failed and its reversal failed) is never refunded by the sweeper: the charge has no mark (RAN, case S4 below). A retry with the same key writes the post under that charge.
- A free-post charge reversed in the request writes no ledger row (only the allowance changes); that is how it was before.

# Rules, one by one

| Rule | Result | How |
|---|---|---|
| R1 the sweeper never reverses an old-code charge | HELD | RAN section A |
| R2 this code's orphan reversed once after 30 min, free post back, dead record gone, retry = 409 CONFLICT | HELD (text answer, reply; voice READ) | RAN section B |
| R3 a stored post's charge is never reversed | NOT HELD in the link window | finding 1 (also at 4dadb23) |
| R4 no other action carries the mark; no reader changes because of it | HELD | RAN/READ section E |
| R5 give-back only for the coming-up question | HELD | RAN section G |

# What I ran

## A. The rollback, real processes (RAN)
Database migrated with origin/main's own `prisma/` (`migrate deploy` ok), then this branch's migrations (ok, so "migrate deploy from an origin/main database" works). Real processes: this code (stamps the start time on boot) and the old code (origin/main tree).
- Order new, old, new: a paid post that stays, a paid post whose answer I then deleted, a free-post person's post (it used a free post: the person's `usedFreePost` true), one charge aged by 90 days, all taken through the old code's API; boot this code again; sweep at +31 minutes and +2 hours: **0 reversed, 0 REVERSAL rows, free posts unchanged (4 left for the free person), 4 of 4 answers still there**, all four charges `COMMITTED`.
- Order new, old, new, old, new (3 old-code posts per old visit, one of them aged 90 days, new-code posts between): sweeps at +31 and +120: 0, 0; 6 old-code charges (unmarked, unlinked) and 6 new-code charges (marked, linked): all `COMMITTED`, 0 REVERSAL rows, 12 answers, free posts unchanged. Then I moved the start time to 5 days back by hand (the clock case the mark replaces) and swept again: 0, 0.
- Order old, new, old, new with the start time set to NULL between boots: 0 and 0 at +31 and +120; 12 answers, 0 REVERSAL rows (every old-code charge was before or after a stamp; the mark would hold them regardless, shown by the 5-day case above). With NULL the sweeper reads nothing (READ and RAN: first boot stamps it).
- Not run: the old code's charges at 4dadb23 for comparison (the C21 report did that run and found the refund).

## B. This code's own orphans (RAN)
A trigger fails the post insert ("BOOM" text) and a second trigger makes the reversal fail, so the charge stays `COMMITTED`, marked, unlinked; a second variant kills the API with SIGKILL while the post insert sleeps, so the retry record stays unfinished.
- Paid text answer, free-post person (free post used), reply (mark `reply`): sweep at +29 minutes **0**; at +31 minutes **reversed once each** (3 charges `REVERSED`; 3 REVERSAL rows in all, with the 1 earlier from the paid in-request case; the free-post person's count went back from 2 to 3; `reversalTxn` once); again at +31 and at +120: 0; unfinished retry records: gone.
- The retry with the same key after that: **409 `CONFLICT` "That attempt was reversed. Start again with a new key."** for the paid answer, the free answer and the reply.
- `refType` on the failed charges: `answer` for answers, `reply` for the reply (read in the rows).
- Voice: READ only (`spendThen` is the same path, `units.ledger.ts:366-369` writes the mark for POST_TEXT and POST_VOICE alike). The reply path I ran is text.

## C. The window you asked to measure: finding 1.

## D. Replays, same key (RAN, this code on port 4101, old code on 4102, record deleted to stand for "expired")
| State | Same request again | Different request under the key |
|---|---|---|
| S1 marked, unlinked, no post (write failed, reversal failed) | 201, the post is written under the old charge, no second charge (1 charge, 1 post), charge now linked | not run |
| S2 marked, linked | 201, same answer id, 1 charge | 409 `IDEMPOTENCY_KEY_REUSED` |
| S3 old-code charge (unmarked), post stored | 201, same answer id found by content and time, 1 charge | 409 `IDEMPOTENCY_KEY_REUSED`, still 1 post |
| S4 old-code charge, no post | 201, post written under the old charge, charge now marked and linked, 1 charge | not run |
| S5 marked, unlinked, post stored (link failed) | 201, same answer id, 1 charge, 1 post | 409 `IDEMPOTENCY_KEY_REUSED`, still 1 post |

The reader `prior?.refType === "answer" && prior.refId` (`posts.service.ts:376`, replies `:664`) with a marked, unlinked prior takes its other branch (content and `createdAt`), finds the stored post (S5) and finds nothing when there is none (S1); both right. After a reversal (S1 reversed by the sweeper) a retry is the 409 CONFLICT of B.

## E. Other actions (RAN and READ)
- RAN: a reaction (charge `REACTION`) and an edit that made the text longer (`EDIT_TEXT`): `refType` null, `refId` null, as before. At 4dadb23 only the ledger path above differed from now (READ of the diff: `units.ledger.ts` writes the mark only when the action is POST_TEXT or POST_VOICE and a `refType` option is passed; only `spendThen` passes one).
- READ: the other charge callers are `vote/poll.service.ts:338` (VOTE), `textfix/textfix.service.ts:103` (TEXT_FIX), `talk/engagement.service.ts:194` (REACTION), `posts.service.ts:482` (EDIT_TEXT): none passes `refType`. Proposals and "explain my vote" have no charge action (the enum has six). 
- Every reader of `refType` in `api/src` (not the generated client): `posts.service.ts:161` (select), `:376` and `:664` (both need `refId` too: set with `refId` null takes the content branch), `charge-sweeper.service.ts:108` and `:142` (the mark, wanted), `units.ledger.ts:367` and `:526` (writers). `attachRef` (`units.ledger.ts:518`) has no caller. No admin money route reads `refType` (the readers of `Charge` outside the sweeper are `units.service.ts:306-335`, which read status, `usedFreePost`, `createdAt`). A marked, unlinked row changes none of them. I did not call the admin routes over such rows (READ only).

## F. Load (RAN)
- 100,000 charges (50% text, 10% voice, 25% reaction, 15% vote; 1% reversed; 9,897 marked and unlinked, 5,000 unmarked unlinked): EXPLAIN ANALYZE of the candidate query: `Charge_sweep_idx`, 0.32 ms (finding 3 for the worst case). A pass that reversed 9,893 orphans: 84 s; next two passes: 0 reversed.
- One person, 50 parallel posts with distinct keys, a sweeper running about every 0.15 s (not once a second): real clock, 3 rounds: 201 x 20 and 429 x 30 each round (the person limit is 20 per 10 minutes), 0 reversed, 20 stored posts each. With the sweeper told the time is +31 minutes, 6 rounds: 0 reversed. The 4 ms window was not hit by the sweeper, which is expected; finding 1 is about a stop, not about a race with the sweeper.

## G. Give-back (RAN, my own spec, not committed)
One person each, 40 posts and 40 replies to: an unknown id, a DRAFT question, a hidden spare question (SCHEDULED, `isSpare`), a scheduled question not shown as coming up. Every one: **20 x 404, then 20 x 429**. Replies (to an unknown answer, and to an answer whose question is draft, spare, or scheduled): the same. Same result with a different address on every request.
Coming-up question (a live override makes it today's): **200 early tries, 200 x 409, 0 x 429** (half with rotating addresses); then the post at the opening: **201**; after the opening, 41 posts: 20 x 201, 21 x 429 (the limit counts as normal; the early tries were not counted).

## H. Repeats and static checks (RAN)
| Check | Result |
|---|---|
| `batch-c2-r3.spec.ts`, 30 runs in a row (while a second jest loop ran beside) | 30 of 30 green, 8 tests each |
| `shared-address.spec.ts` alone, 3 runs | 4 of 4 tests each; 24.6 s, 26.7 s, 26.3 s |
| the same beside two other jest runs, 3 runs | 4 of 4 each; 32.6 s, 32.9 s, 30.6 s (over the old 30 s default; the 120 s limit is needed) |
| whole jest suite, fresh database, in band | 120 suites, 119 passed, 1 failed (`c22-sweep-mark`, finding 2); 1,304 tests, 1,302 passed, 1 skipped, 1 failed |
| `npx tsc --noEmit` | exit 0 |
| eslint over `{src,test}` (without `--fix`) | 0 errors, 47 warnings |
| `python3 docs/contract/src/build.py /tmp/o.yaml && cmp /tmp/o.yaml docs/contract/openapi.yaml` | identical |
| `prisma migrate diff` (the migrated database to `schema.prisma`) | 19 lines, the same 19 as origin/main's own tree (the hand-made search indexes and `searchTsv` columns); nothing for `Charge` or `ChargeSweeperState` |
| `prisma migrate deploy` from an origin/main database | succeeded (section A) |
| `jest test/talk` fresh database | 24 suites, 2 failed (`c22-sweep-mark` 1 test, `hotfix1-block-oracle` 3 tests), 276 of 280 passed |

## Test diff since 4dadb23 (`git diff 4dadb23..HEAD -- api/test`) (READ)
Existing specs changed (the two new files `c22-giveback.spec.ts` and `c22-sweep-mark.spec.ts` are new):
- `load/shared-address.spec.ts`: timeout 30 s to 120 s; assertions same.
- `talk/batch-c2-r3.spec.ts`: a wait loop (fixture) and `oldCodePost(withPost, marked)` (fixture).
- `talk/c2-joined.spec.ts` and `talk/c21-giveback.spec.ts`: **the two assertion changes the lead ruled** (404 becomes 409 on the coming-up question, 30 and 31 tries) plus a fixture (a live override to make the question "coming up" and a `try/finally` to delete it). No other assertion touched.
- `hotfix1-r4-chaos`, `hotfix1-r4-sweeper`, `hotfix1-sweeper`: fixture only (`refType: null` becomes `"answer"` / `"reply"` so the fixture is a marked orphan; one line adds `refType: "answer"` to a created charge).
So every changed line of an existing test is a fixture or one of the two ruled assertion changes. (The fixture change in `hotfix1-sweeper.spec.ts` is what leaves the row behind in finding 2.)

# What I did not do
- Voice posts through the sweeper and the in-request reversal (READ).
- The admin money routes over marked, unlinked rows (READ).
- A real nginx or deploy script; the kill runs used `kill -TERM` and `kill -KILL` on the API process directly.
- The "process dies between the post commit and the link" case by exact timing: I could not stop the process in the 4 to 9 ms between them on demand. I used a failing link statement (same state) and the 50-at-once kill runs (natural window), which both produced the state.
