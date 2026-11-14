VERDICT: FIX

# Verify V-FIX-D, API side

Code under test: `v/fix-d` at a9f1a5f. Tested on a local merge of `origin/main` (755aa15) into it (never pushed).

## Merge
- `git merge origin/main` into a scratch branch: **no conflicts**. Auto-merged `api/test/mail/mail.spec.ts` (both sides edited it). New migrations on main (`20261114100000_topic_mails`, `…120000_subscriptions`, `…170000_subscription_terms`) sort before `20261114200000_fix_d`, so the order is fine.
- Contract: `python3 docs/contract/src/build.py <temp>` is byte-identical to `docs/contract/openapi.yaml` on the merged tree (`cmp` clean; the working tree stayed clean).

## Findings

### BLOCKER 1. Reporting an unnamed reply with "also block" puts the writer's profile in the reporter's block list
- Code: `api/src/talk/engagement.service.ts:440-446` (REPLY target takes `authorId` from the row, no `anonymous` check) and `:584-590` (`alsoBlock` creates a `Block` row for that author). The block list route (`GET /me/blocks`, `me/people.service` `listBlocks`) returns the blocked person's full profile.
- Ran: member A posts an unnamed reply; member B `POST /reports {targetType:"REPLY", targetId:<reply>, reason:"SCAM_OR_SPAM", alsoBlock:true}` → 201 `{"blocked":true}`; B then `GET /me/blocks`.
- Happened: B's block list contains the writer: id, handle, joinedAt, counts. The report response itself says `blocked:true`.
- Should: for an unnamed reply, `alsoBlock` must not block the author, and the report must not return `blocked:true`. Same for the existing anonymous-answer path (I ran it: same leak, so this is a hole that already existed for answers; it is now open for replies too).

### BLOCKER 2. Block / unblock is a one-step oracle that names the writer of an unnamed reply
- Code: `api/src/talk/posts.service.ts:624-635` (`listReplies` drops replies whose author is in `hiddenUserIdsOf`), `:660-690` (`stanceCounts` recounted without them), `:313-315` (the answer's `replyCount` recounted for the viewer), `api/src/reach/reach.service.ts:346` (a reply notice is skipped when the writer is hidden).
- Ran (`PUT /me/blocks/{id}`, `DELETE`, no other action): one unnamed reply by W on answer X. A viewer who blocks W sees the reply vanish from `GET /answers/X/replies` (items 1 → 0, stance counts `agree 1 → 0`), and the answer's `replyCount` drops; unblock and it returns. The answer's author who blocks W sees the "Someone replied to your voice" notice disappear (1 → 0, unread 1 → 0). A person who suspects someone can test each suspect with two cheap calls. A person W has blocked also sees the reply missing while others see it (items 0 vs 1).
- Should: an unnamed reply must not depend on who the viewer has blocked (it should show or hide the same for everyone, or never be filtered by author). Whatever rule is chosen has to apply to the list, the stance counts, the answer `replyCount` and the notice.
- Not run for anonymous answers (my probe of the answers list did not show the seeded anonymous answer for any viewer, so I cannot say whether the same oracle exists there; it likely does by the same code at `posts.service.ts:300-313`).

### HIGH 3. Money: re-sending the same Idempotency-Key after the key has expired refunds the original charge and leaves the answer posted
- Code: `api/src/talk/shared/idempotency.service.ts:61-67` (a record older than 24 h is deleted and the request runs again); `api/src/talk/posts.service.ts:121-140` (`spendThen`: `units.charge` replays the old charge for the same key, the write fails because the clip is already on a post, then `units.reverse(charge.chargeId)` reverses the first, valid charge).
- Ran (paid voice answer, balance 500 000 milli, cost 78 000): POST → 201, balance 422 000. Expire the idempotency record (set `expiresAt` 6 days back, which is what the web's new 7-day outbox does by waiting), POST again with the same key and clip → 409 CONFLICT, **balance 500 000**, answer still published, ledger `-78000, +78000`. Repeated three times: same. A free post: used once, then a replay gave it back (`freePostsRemaining` 1 → 2).
- Same run on `origin/main`: identical, so this is old server code, not the builder's. It matters now because V-FIX-D makes the web send the recording's own key for up to 7 days.
- Should: an expired key must not reverse a charge that belongs to a successful answer; or keep the record for the longest life of a kept recording (at least 7 days); or the reverse must only run for a charge this request made.
- Other idempotency runs (all OK): same key twice in sequence → one answer, one free post used; same key 6 times at once → all 201, one answer, one free post used; same key with a different clip → 409 `IDEMPOTENCY_KEY_REUSED`; same already-posted clip with a new key → 409, one answer.

### HIGH 4. New square card is served for people whose account is being deleted or is banned (story already was)
- Code: `api/src/reach/share.service.ts:296-327` (`sizedImage`) never calls `moodCardGone`; the person check in `api/src/reach/share-subject.ts:491-498` applies to **mood** answers only. Only `image()` (the 1200x630 card, `share.service.ts:372`) checks.
- Ran (answer with a link made while healthy, then the author's status changed). Merged tree: BANNED → `card 404, story 200, square 200`; DELETION_PENDING → `card 404, story 200, square 200`; page 200. On origin/main the same cases are `story 200, square 404`. So the story hole was old and the builder's change opens the same hole on the square, with the person's `@handle` on the card for a named post.
- Should: story and square return 404 for the same cases as the card (removed, deleted, banned, deleting, deleted account).

### MEDIUM 5. Suspended author, held post and an unopened question still get a card in every size
- Ran: SUSPENDED author → card, story, square all 200; HELD post → 200 (the card falls back to the question text); post whose question is SCHEDULED or DRAFT → link created (201), card, story, square and page 200. Origin/main gives the same for card and story; the square is new. Your brief says these should have no card.
- Removed and deleted-by-author posts → 404 on all three sizes (good).

### MEDIUM 6. Burst of concurrent card requests is not limited
- `share.controller.ts` allows 60 story/square requests a minute per address. I sent 100 at once (50 codes x story and square): all 100 were 200. The 60-limit then applied (98 of the next 100 were 429). 100 draws took 3.9 s and about +150 MB RSS on the test machine; a second pass of the same specs returned from the cache. The cache is bounded (`story-cache.ts`: 200 entries, 64 MB). Guests can create share links without signing in (`POST /share/links` returned 201 with no token), so a guest can feed it many distinct specs. Not exploited further.

### LOW 7. A control character in a post makes every card for it 404
- Ran: a text answer containing BEL and ESC is accepted (201). Its card row goes `FAILED` ("a non-XML character '\u{7}' found") and `card`, `story` and `square` all return 404 for ever; the page is 200. `card-renderer.ts:266` (`esc`) escapes `& < > "` only. Old behaviour for the card, now also the square and story. A NUL in a text answer gives 500 (database refuses it): old.

### LOW 8. Smaller points
- `anonymous` is now accepted with any boolean, including `false`; on origin/main the same body was 422 (`property anonymous should not exist`). Expected.
- Suspended writer: the unnamed reply is still listed (same as a named reply by a suspended person; the list does not filter by author status).
- The rollback file checks then drops the column without a lock between the two statements (`rollback.down.sql`): a reply posted unnamed in that window loses its flag. Only matters during a rollback.
- Account deletion lowers the answer's `replyCount` for all replies of the person (named or not): the same visible effect for a named reply, but a person who deletes their account takes their unnamed reply with them, so someone watching one thread can correlate. Not run.

## The two changed specs
`share.spec.ts` and `mood-card.spec.ts`: I read both diffs. They only swap "square is null / 404 for a non-mood card" for "square URL present / 200, 1080x1080", and keep "unknown link is 404". They hide nothing else, but they also leave the cases in finding 4 and 5 untested (no spec asks for a banned or deleting author's square).

## Proved by runs
- Merge clean; contract byte-identical; `tsc --noEmit` exit 0; eslint on the 29 changed `.ts` files: 0 errors, 0 warnings from the builder's files (one pre-existing warning in a main file).
- Targeted suites on the merged tree: `test/talk/anon-reply.spec.ts`, `test/reach/fixd-cards.spec.ts`, all of `test/reach`, `test/talk`, `test/mail`, `test/privacy`: **39 suites, 432 passed, 1 skipped, 0 failed**.
- Full API suite (`jest --runInBand`) on the merged tree: **102 suites, 1157 passed, 1 skipped, 0 failed** (432 s). `npm run test:audio` was not run.
- Old-request comparison: 16 calls without `anonymous` (post reply, replies list with and without stance filter, people reply lists, profile, answer, notifications, `/me`, delete) as guest, writer, other and answer author, run on origin/main and on the merged tree with ids/times normalised: **identical JSON**. My first attempt differed only because it sent `anonymous:false`, which main refuses.
- Privacy crawl: 18 routes (answer, replies and stance filter, question, question answers, feed new/trending, search, news, notifications, saved, my answers, profile by handle, people replies, what-next) x 9 viewers (guest, other, answer author, blocker, blocked-by-writer, editor, writer, moderator, admin), response bodies scanned in full for the writer's id, handle, wawu id, display name and state: the writer appeared only on their own profile route (expected). The receipt, the replies list and the stored and served notification carry no writer. Mail to the answer's author: whole relay payload and headers contain no writer id, handle or name; subject, heading and text say "Someone"; no unsubscribe link in this mail.
- Profile of the writer as a guest before and after an unnamed reply: no field changes (`replyCount` unchanged); the writer's own `/me` shows only their allowances moving. Rate-limit headers on an unnamed and a named reply have the same shape (they are the caller's own).
- Moderation list and detail: admin and moderator 200 (author visible, per the ruling); editor and ordinary member 403.
- No edit route for replies exists (only POST, GET list, DELETE). `GET /replies/{id}` is 404. Another member cannot delete the reply (403).
- Migration: applied every migration except fix_d to a fresh database with two reply rows, then fix_d: both rows `anonymous=false`; the column is `boolean not null default false`; a Prisma schema diff shows nothing about `Reply`; rollback with an unnamed row raised "rollback refused" and left the column; rollback with none dropped it and kept both rows.
- Cards: question, answer, poll result and profile give story 1080x1920 and square 1080x1080; text with markup, right-to-left, emoji, 10 000 characters and combining marks all draw at all three sizes; an anonymous answer's page and cards carry no handle, name, place or invite code (checked in the share page JSON for each text). A card for a removed or deleted-by-author post is 404 in all sizes.
- Events: a guest can post 20 identical `recording_started` events and 20 rows are written (no de-duplication on the server, so a guest can inflate counts; only the 300 a minute address limit applies). A row stores `userId` or `guestId` against the link only; the only reader found is the aggregate on the admin Today page, so nobody sees who clicked.

## Read only
- `Reply.author` and `isMine` code paths (`talk/views.ts:160-172`, `me/views.ts:311-333`); counts kept on create, delete and moderation (`posts.service.ts:508-593`, `moderation.service.ts:1208-1235`).
- Voice reply clip: `clipView` carries no owner; the play key is a random uuid (`object-store.ts:160`); a clip is fetchable by anyone only while attached to a published post (`clips.service.ts:373-388`). Not run with a real voice reply.
- Data export of the writer (`export.service.ts:165-235`) includes the writer's own replies without a flag; not run (storage not configured).
- Weekly report, search and feeds read no reply author.
- No "verified tick" field exists in the author view used for replies (`authorRef`), so there is no tick to show.
- The web side of the outbox and the contract text.

## Not proved
- A reply whose write fails half way (no fault injection done).
- Concurrent first send from two tabs (web side).
- A voice reply with a real clip through the whole path; an unnamed reply by a suspended or deleted person in the export; account deletion of the writer with an unnamed reply; the weekly report for a thread with unnamed replies.
- Anonymous answer oracle (finding 2) on the answers list.
- Memory over a long guest loop beyond the 100 draws measured.

My attack specs and scripts stay uncommitted (scratch worktrees outside the repo). Everything I started is stopped.
