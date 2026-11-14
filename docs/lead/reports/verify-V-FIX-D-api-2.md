VERDICT: FIX
INTERIM

# Verify V-FIX-D, API side, round 2 (INTERIM)

Code under test: `origin/v/fix-d` at f7734ab (head confirmed). Branch `verify/fix-d-2`. Own PostgreSQL 16 (port 55601) and Redis (56601); no live provider, no `.env`. The API was driven in-process through its real HTTP stack (the repo's jest harness, supertest), not as a separate OS process.

## Findings so far (most severe first)

### MEDIUM 1. Editors' weekly-report check says whether a handle belongs to someone who took part this week, a nameless replier included
- Code: `api/src/admin/weekly.service.ts:93-115` (`leaks()`, the line `found.push("a handle of someone who spoke this week")` reads `User.replies.some` and `User.answers.some` with no `anonymous` filter).
- Ran: R's only activity is one nameless reply under a question of the topic. An editor opens `GET /admin/weekly-reports/{id}` for that topic with the summary text "We spoke with @R about it": check "No names, handles or phone numbers" is `ok:false`. The same text with the handle of T (no post at all) is `ok:true`. So an editor can test any handle and learn that the person wrote an answer or reply in that week, and for a person with no named post that means they wrote a nameless one.
- Should: posts made without a name must not count in this check (answers already have the same hole; replies are new with V-FIX-D).

### LOW 2. A person's public reply count drops when a question holding their nameless reply becomes unreadable
- Code: `api/src/me/views.ts:145-190` (`hiddenCounters`: `reply` counts all replies including nameless ones, and is subtracted from the stored count that never counted them).
- Ran: R has one named reply (count 1) and one nameless reply under question Q2. Q2's window moved to the future: `GET /people/{R}` replyCount 1 -> 0 (should stay 1). Only reachable when a window is moved after posts exist.

### LOW 3. Writer can delete their reply under a question that has not opened (A6)
- `DELETE /replies/{id}` returns 204 and changes the row (and counts) for both the coming-up question and a hidden spare question. Reads and posts are all 404 / 409 as required. `posts.service.ts deleteReply` has no window check; same as origin/main, and a reply can only be there if the window was moved later.

### LOW 4. The charge sweeper reverses the charge of a stored reply whose link was never attached
- Ran: a stored nameless reply whose charge has `refId` null (as when the attach update after the write fails) and is older than the sweep age: the sweep reversed it (`REVERSED`), the reply stayed. A real orphan (no reply) was reversed once, a second pass did nothing, a normal stored reply's charge was left alone. `charge-sweeper.service.ts` is unchanged from origin/main, so this is not this piece's; it means rule A5 "never" holds only while the link attach succeeds.

### LOW 5. Branch is 9 commits behind origin/main (5122c47)
- A scratch merge of origin/main into the branch has no conflicts and `prisma migrate deploy` on a database already migrated with origin/main applies `20261114200000_fix_d` cleanly after the later stamps.

## A1: earlier findings
1 report with also-block on a nameless reply: CLOSED (RAN: `blocked:false`, the writer is not in `GET /me/blocks`; a named reply still gives `blocked:true`).
2 block/unblock oracle: CLOSED (RAN: list, stance counts, answer `replyCount`, notices and unread count identical before and after blocks in both directions, on a nameless and a named answer; a blocked named reply still vanishes as on main).
3 expired idempotency key reverses a charge: CLOSED (RAN: paid answer, key expired 3 times, same key resent: 201 each time, balance unchanged, one answer, charge COMMITTED; free post not given back; same for a paid reply).
4 story/square for banned/deleting authors: CLOSED (RAN: BANNED, SUSPENDED, DELETION_PENDING, deletionRequestedAt, DELETED: card, story and square all 404).
5 held post / unopened question card: CLOSED (RAN: HELD, REMOVED, deleted, question not opened: card, story, square 404; link creation on an unopened question 404).
6 burst of 100 card requests: CLOSED (RAN: 60 x 200, 40 x 429; next 100 all 429).
7 control character: CLOSED (RAN: BEL and ESC text: page, card, story, square all 200).
8 smaller points: accepted `anonymous:false` is expected; rollback now takes `LOCK TABLE` (READ).

More runs (A2 crawl, A3, A4, A5, A6, A7, A8, A9, full suite) are below in the final report.
