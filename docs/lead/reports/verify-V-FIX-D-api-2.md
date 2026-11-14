VERDICT: FIX

# Verify V-FIX-D, API side, round 2 (final)

Code under test: `origin/v/fix-d` at f7734ab (head confirmed). Branch `verify/fix-d-2`. Own PostgreSQL 16 (port 55601) and Redis (56601); no live provider, no `.env` or key file opened. The API was driven through its real HTTP stack in the repo's jest harness (supertest); I did NOT run it as a separate OS process. My attack specs are not committed.

## Findings (most severe first)

### MEDIUM 1. Editors' weekly-report check says whether a handle belongs to someone who took part this week, a nameless replier included
- Code: `api/src/admin/weekly.service.ts:93-115` (`leaks()`, `found.push("a handle of someone who spoke this week")`): it reads `User.replies.some` and `User.answers.some` with no `anonymous` filter.
- Ran: R's only activity is one nameless reply under a question of the topic. Editor `GET /admin/weekly-reports/{id}` on a summary reading "We spoke with @R about it": check "No names, handles or phone numbers" is `ok:false`. Same text with the handle of T (who posted nothing): `ok:true`. An editor can try any handle and learn that person wrote an answer or reply that week; for a person with no named post that means a nameless one.
- Should: posts made without a name must not count in this check. (Nameless answers have the same hole on origin/main; replies are new with V-FIX-D.)

### LOW 2. A person's public reply count drops when a question holding their nameless reply becomes unreadable
- Code: `api/src/me/views.ts:145-190` (`hiddenCounters` counts all replies, nameless included, and subtracts them from a stored count that never counted them).
- Ran: R has one named reply (count 1) and one nameless reply under Q2. Q2's window moved to the future: `GET /people/{R}` replyCount 1 -> 0 (should stay 1). Reachable only when a window is moved after posts exist.

### LOW 3. Writer can delete their reply under a question that has not opened (A6)
- Ran: `DELETE /replies/{id}` by the writer: 204 and the row changes, for the coming-up question and for a hidden spare one. Everything else was as required: reads 404 for writer, other member and guest (replies list, stance filter, answer, people replies empty); posts 409 `QUESTION_NOT_OPEN` for the coming-up question and 404 for the spare; another member's delete 403; replay of a stored receipt after the window moved: 404 with no body. `posts.service.ts deleteReply` has no window check; same on origin/main.

### LOW 4. The charge sweeper reverses the charge of a stored reply whose link was never attached
- Ran: a stored nameless reply whose charge has `refId` null (as when the attach update after the write fails), older than the sweep age: the sweep reversed it and the reply stayed. `charge-sweeper.service.ts` is unchanged from origin/main (identical for answers). Normal stored replies' charges were left alone; a real orphan was reversed once, a second pass did nothing. So A5's "never" holds only while the attach succeeds. Lead's call.

### LOW 5. Branch is 9 commits behind origin/main (5122c47)
- Scratch merge of origin/main into the branch: no conflicts. Not merged anywhere.

### Notes (not findings)
- After a failed first try (500, charge reversed) the same key gets 409 "That attempt was reversed. Start again with a new key" (free post stays unspent, no reply stored). That is origin/main's rule; the offline sender must take a new key after a 5xx. Never two replies.
- Share page (JSON) stays 200 for held posts and for answers of suspended/banned authors while all card sizes are 404; not part of this piece's rules.
- Not proved: suspension or deletion of a writer lowers the answer's reply count at the same moment their reply disappears (same for named replies); my suspend call was refused (422) and account deletion not run.

## A1: earlier findings (all CLOSED)
1 report + also-block on a nameless reply: CLOSED, RAN (`blocked:false`, writer not in `GET /me/blocks`; named reply still `blocked:true`).
2 block/unblock oracle: CLOSED, RAN (list, stance counts, answer `replyCount`, notices and unread count identical before/after blocks in both directions, on a nameless and a named answer; a blocked named reply still vanishes as on main).
3 expired idempotency key: CLOSED, RAN (paid answer, key expired 3 times and resent: 201 each time, balance unchanged, one answer, charge COMMITTED; free post not given back; paid reply the same).
4 story/square for banned/deleting authors: CLOSED, RAN (BANNED, SUSPENDED, DELETION_PENDING, deletionRequestedAt, DELETED: card, story, square all 404).
5 held post / unopened question: CLOSED, RAN (HELD, REMOVED, deleted, unopened question: all three sizes 404; link on unopened question 404).
6 burst of 100 card requests: CLOSED, RAN (60 x 200, 40 x 429; next 100 all 429; +120 MB RSS).
7 control characters: CLOSED, RAN (page, card, story, square all 200).
8 smaller points: `anonymous:false` accepted as expected; rollback now takes `LOCK TABLE` (READ).

## A2 to A9
- A2 RAN: 32 paths x 9 viewers (guest, writer, other signed-in, answer author, blocker, editor, moderator, admin, extra member) = 288 calls, bodies scanned for the writer's id, handle, wawu id. Only the writer's own public profile and people search showed them (their identity, no link to the reply). Reply thread, `GET /answers/{id}`, people replies, questions, feeds, notifications, `/me*`, admin moderation, users, news: no writer. As the writer: author null, `isMine:true`; as others `isMine:false`. Voice nameless reply (clip row): list and `GET /voice-clips/{id}` show no owner for guest, member, editor, moderator. Stored notice titles "Someone replied to your voice". Moderation list: moderator and admin 200, editor and member 403. READ: no reply route in the contract beyond three (checked by script); search, export, share, weekly code read no reply author except finding 1. The B03 mail is covered by `test/mail/mail.spec.ts` (inside the full suite, passed); READ `mail-events.ts`.
- A3 RAN: writer of a nameless answer replying under it with `anonymous` false, missing, true, null: 4 x 201, stored nameless, author null; `"no"`, `0`, `[]`: 422 (nothing stored). Writer of a named answer: missing/false named, true nameless. Writer's own nameless reply and another person's nameless reply on the same answer have identical fields (keys, stance, author, isMine), the writer's profile replyCount unchanged, no notice to the writer for their own reply.
- A4 RAN: see A1 items 1 and 2; a named reply still follows blocks (V blocks R2: named reply gone, nameless stays).
- A5 RAN: charge `refType:"reply"`, `refId` = reply id, `POST_TEXT`, COMMITTED; same price for named, nameless and default (300 milli, same text); free post: no charge, allowance used; 22 replies in a row (mixed): 20 x 201 then 429 (same limit); delete by writer 204 and counts down by one, other member and answer author 403, no edit route (404). Sweeper: see finding 4.
- A6 RAN: finding 3 plus give-back: 24 tries on the coming-up question all 409 and none counted; on a hidden spare 20 x 404 then 4 x 429.
- A7 RAN: same key twice: same reply once (`Idempotent-Replay`), other body 409, `anonymous` flipped or dropped 409; 8 parallel same key: 8 x 201, one reply, one charge; key expired then resent (also with the flag flipped): returns the stored reply, balance unchanged; injected DB failure on the insert (trigger): 500, charge reversed, no reply stored, retry see Notes.
- A8 RAN: on a database migrated with origin/main's migrations, `prisma migrate deploy` of the merged tree applied `20261114200000_fix_d` after the later stamps (no error); the file is one `ADD COLUMN ... NOT NULL DEFAULT false`; `migrate diff` shows the same 9 statements as origin/main's own (none about Reply). Rollback with no unnamed rows ran and dropped the column; the refusal path READ only. Old request shapes: 67 calls (reply post and replay, bad bodies, lists with and without stance, answer, people replies, profiles, notices, `/me`, blocks, reports, deletes) as guest, writer, other, answer author, run on origin/main and on the branch with ids and times normalised: identical except the intended one: the writer of a nameless answer replying under it with the old body is now nameless (main showed their handle), and that writer's profile replyCount is one lower.
- A9 RAN: `build.py` output is byte-identical to `docs/contract/openapi.yaml`.

## What I ran

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `eslint "{src,test}/**/*.ts"` (no `--fix`) | 0 errors, 25 warnings, none in a file this piece changed |
| Whole jest suite, fresh database, `--runInBand` | 123 suites passed, 1337 tests passed, 1 skipped, 0 failed |
| Attack specs (not committed), 6 files | privacy crawl 288 calls; 7 + 7 + 6 + 3 + 2 + 1 tests; all passed apart from one of my own wrong expectations (handle case), no source failure |
| Old-shape comparison main vs branch | 67 calls, 1 intended difference |
| Migration on main-migrated DB, drift diff, rollback | clean; drift same as main (9); rollback ok |
| Contract cmp | identical |
| `test/talk/hotfix1-block-oracle.spec.ts` | passed in the whole-suite run (the known folder-alone failure was not run) |
| `npm run test:audio` | not run |

Everything I started (PostgreSQL, Redis, scratch worktrees under /tmp) is mine; scratch DB and Redis are stopped below.
