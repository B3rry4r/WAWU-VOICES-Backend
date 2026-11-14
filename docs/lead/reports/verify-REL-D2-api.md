VERDICT: FIX

# Verify REL-D2 (API)

Checked on origin/main 21fa85a (branch `verify/rel-d2`). No product code or existing test was changed. My own attack specs were not committed. Nothing live was called. Today is 14 Nov 2026.

"Before today" below means commit 95fe0a0.

## Findings, most severe first

### HIGH

**H1. An admin's NAMELESS reply is lifted to the top of the thread, for every viewer.** New today.
- Where: `api/src/talk/posts.service.ts:1023` (`adminWhere` in the replies list). The comment above it still says replies have no `anonymous` flag. That stopped being true when migration `20261114200000_fix_d` added `Reply.anonymous`. The answers version of the rule has `anonymous: false` (`api/src/feed/feed.service.ts:991-996`); the replies version does not.
- Steps: person C posts an answer. Four ordinary people reply (named). An ADMIN replies nameless (`anonymous: true`), then replies named. `GET /api/v1/answers/{id}/replies` as a guest, as another member, as someone who blocked the admin, and as the admin.
- Seen, identical for all four viewers: `NAMED-ADMIN | ANON-ADMIN(nameless) | p0 | p1 | p2 | p3`. The nameless reply is the newest, yet it sits above four older replies. The name is hidden, but any reader can now tell that a nameless reply was written by a current admin. The person who blocked the admin sees it too, because this query skips the block filter.
- Rule broken: B, "admin-first ordering must not move an admin's NAMELESS post to the top".
- Fix: add `anonymous: false` to `adminWhere`, and add a spec with a nameless admin reply.

**H2. 500 errors when an editor's decision, a moderator's removal and an account purge hit the same post at the same moment.** Not new today (the code and lock order are unchanged since 95fe0a0), and today's lock fix does not cover it.
- Cause 1: the editor's decision (`api/src/admin/trust/news.service.ts:226`, `lockRow` = plain `FOR UPDATE` on the Answer, then `moderationItem.upsert` at :305 for "send to moderation") takes the locks in the opposite order from a moderator's action (`api/src/admin/trust/moderation.service.ts:691` locks the item first, then the Answer, then inserts a Strike at :819). Postgres log: `INSERT INTO "ModerationItem"` blocked by `UPDATE "Answer" SET status` and the reverse.
- Cause 2: the account purge (`api/src/me/deletion.service.ts:156-157`, User row first, then the Question counter at :217, then the Answer rows at :219) is the reverse of a removal (Answer, then Question counter, then Strike, which needs the User row).
- Numbers, 200 rounds each, real HTTP, all on one post:
  - decide + remove: 38 decide 500s and 2 remove 500s (the 40 rounds that send the post to moderation).
  - decide + remove + edit: 25 decide 500s, 17 EDIT 500s (the author), 1 remove 500.
  - decide + remove + report: 22 decide 500s, 1 report 500 (a reader).
  - decide + purge: 32 decide 500s, 8 purge 500s.
  - remove + purge: 47 remove 500s, 152 purge 500s.
  - purge + remove + decide: 86 purge, 86 remove, 42 decide 500s.
- Postgres log (`log_lock_waits` on, `deadlock_timeout` 200 ms): 611 "deadlock detected" in the whole run. Every one involves a ModerationItem insert, a Strike insert, a removal's Answer status update, or the purge. None involves edit, second edit, delete, reply, nameless reply, reaction, like, save, report, flag, Verified News request, share draw or the charge sweeper.
- How likely: it needs two staff, or staff and the purge job, on one post inside about 50 ms. A deadlock rolls the whole transaction back, so no data is lost and every counter and ledger check afterwards was clean. A person does see a 500. The purge job loses one run for the batch (`purgeDue` has no per-person catch) and tries again.
- Fix: take the editor's lock with `FOR NO KEY UPDATE` and lock the moderation item before the Answer in `decide`, or make the removal take the Answer first; make the purge take the Answer rows before the User row, or catch and continue per person.

### MEDIUM

**M1. Admin-first ignores the word and tag filters.** `api/src/feed/feed.service.ts:991-1004` builds the top 20 without `q.mood` or `q.tag` (the normal query has them at :1029-1030). With `?mood=ANGRY` (and `TIRED`) a guest's first page showed 10 admin answers of the other word, under NEW, TOP and DEBATED. I measured it as a guest; the code path is the same for everyone. New today. If the rule is "only matching posts", this is wrong; if the rule is "always on top", the filter tab shows posts that are not in it. Needs a ruling.

**M2. An admin post shows twice when an admin posts between page 1 and page 2.** Reader opens page 1 (7 per page), an admin posts, reader opens the next pages: 1 answer appears twice under NEW and under TOP (items 91 and 92, duplicates 1). The top-20 cap shifts, so the admin answer that fell out of the top 20 comes back in the normal list. Same shape in the replies list. New today. Rare race.

**M3. A question with no word choices gets the "Pick one word" picture.** `api/src/reach/share.service.ts:114-121` sets `pick` for any open question with seconds known, and `card-renderer.ts:412` draws it; `words` is `[]`. Measured: the card served for a question with `moodOptions = []` has the same bytes (sha1 c3f536f036) as the pick layout drawn with zero words, not the plain question layout (8467308d98). Rule D says the pick picture is only for a question with word choices. New today (#27).

**M4. A paid edit holds a database connection and asks for a second one.** New today. `api/src/talk/posts.service.ts:654-684`: the edit transaction holds the post lock, then `units.charge` opens its own transaction (the ledger cannot join the edit's). At 95fe0a0 the charge ran before any transaction. With a small pool this starves: `DATABASE_POOL_MAX=4`, 8 edits of 8 different posts at once: 3 ok, 5 x 500, 5.2 s. `DATABASE_POOL_MAX=3`, 10 edits: 7 x 500, 3 x 503, 10 s. At the real setting (20, `infra/env/api.env.example`) 10, 60 and 200 edits at once all answered 200 (worst 3.8 s), and at pool 10 with 40 edits all 200. So it is a latent trap, not a live fault; any rise in other traffic or a lower pool setting makes it real.

### LOW

- L1. DM 404s are not byte-identical to an unknown route's 404: `/dm/*` carries `ratelimit-limit/remaining/reset` headers, an unknown route does not (65 of 95 compared requests; status and body were equal in all 95). A scanner can tell "DMs exist but are off".
- L2. A clip with purpose `DM` is refused with 422 (good), but the unknown-purpose error lists `DM` among the allowed values, so it tells a caller DM exists.
- L3. While DMs are off the recipient of an old DM can still report it (201; a random id gives 404). It creates a Report and a moderation item, not a DM row.
- L4. Scrub gaps (AI summary draft): a bare domain on an ending not in the list survives (`evil.travel`, `foo.bar`, `a.museum`, `xn--e1afmkfd.xn--p1ai`); `@ jane_doe` (space after @) and `dm me jane_doe99` survive; `jane dot doe at gmail dot com` becomes `jane dot [removed]`; `jane@gmail` + newline + `.com` leaves `jane@`. Emails, links with a scheme or path, phones in many shapes, `@handles`, `ig: name` and spaced-out `h t t p s` were all removed (about 85 shapes tried). A person edits the draft before approval, so this is polish.
- L5. Rollbacks that do not refuse and do lose something: `20261114280000_fixb_paid_chars` drops `paidChars` (people then pay twice for the same length in the old code; the file says so); `20261114290000_free_posts_5` and `130000_verification` reset every person's free posts. All documented in the files. Refusals work where claimed (see G).
- L6. Guests see a role removed from an admin up to 5 s late (guest page cache, 5 s in production). Members see it at once. A changed text limit takes up to 5 s (config cache).
- L7. Proposals keep their own 500-character limit (`proposal.max_chars`), not `text.max_chars`. By design in the code; the brief says proposals obey the 2,500 limit. Needs a ruling.
- L8. Tests that depend on the clock or on timing: `test/reach/scrub-round4.spec.ts` and `scrub-round5.spec.ts` failed once in the full run (53.7 ms against a 50 ms limit) while my attack runs shared the machine; they passed 3 of 3 alone. `fixb-r4-edit.spec.ts` "R4-1: 2 identical longer edits at once" failed in 1 of 10 runs on the loaded machine (see below) and 0 of 10 on a quiet one.

## Section results

### A. Deadlocks and lock order
Ran: all 120 pairs of 16 actions on one post (edit, second edit, delete, reply, nameless reply, reaction, like, save, report, news flag, Verified News request, editor decision, admin removal, share-card draw, charge sweeper, purge of the author), 75 pairs at 200 rounds and 45 pairs at 50 rounds, plus 25 chosen triples at 200 rounds (about 22,000 rounds, not all 560 triples). Real HTTP, a fresh author with a paid wallet each round, per-request addresses so the throttles did not decide the result. First pass was spoiled by expired test tokens and throttles (401 and 429); every spoiled combo was run again.
- 5xx: only in combos with decide, remove or purge (H2). Everything else: 0 of about 20,000 rounds.
- After each combo (121 checks): like, reply, reaction and flag counts equal the rows; at most one OPEN Verified News row per post; every ledger transaction sums to zero; every wallet equals its ledger; no duplicate charge key; no reversed charge without its reversal; no published post with a reversed charge; never more than 2 live edit charges on a post. 121 ok, 0 failed. This held even in the rounds that returned 500.
- The two "lock the post first" statements (`posts.service.ts:641`, `news.service.ts:359`) are `FOR NO KEY UPDATE`. Edit against reply, reaction, like, save, report, flag, request, delete, second edit, and the three-way mixes, never deadlocked. Lock waits over 200 ms (144) were all edits queueing on the post, which is the intent.
- Wallet versus post lock: reading `units.ledger.ts`, the wallet transaction touches only Wallet, Charge, ledger, usage and free-allowance rows, never an Answer. No path holds the wallet and waits for a post. The one place the two meet is M4 (post lock, then a second connection for the wallet).
- Purge of the author versus an edit: unreachable in practice. A person being deleted fails the writer check before any lock, so the edit never races the purge. I could only race the purge against others.

### B. Nameless posts and replies never expose the writer
Ran: 3 writers (plain, ADMIN, verified), viewers guest, other member, blocker, blocked person, the writer, 35 routes each (question answers under NEW/TOP/DEBATED, answer, replies, search by text, name and handle, home, feeds, today, news, share page, people by id and handle, notifications, weekly reports, saved, my answers, what-next, moods and more). Searched every body for the writer's id, handle, name, WAWU id and picture key.
- 0 leaks. The writer sees only `isMine: true`. `author` is null for every viewer.
- Block and unblock, by the reader and by the writer: list size, presence of the nameless post and reply, and the whole body were identical before, during and after.
- Profile of the writer: voice, reply and reaction counters 0; the question's recent faces did not include them.
- Admin nameless ANSWER sat at place 26 of 27 under NEW, TOP and DEBATED (not first). The nameless REPLY is the exception: H1.
- Name switch toggled on a retry with the same key: 409 `IDEMPOTENCY_KEY_REUSED` for an answer and for a reply; the stored post stays nameless. Notification to the owner of a thread says "Someone replied", no name.
- Share: page and link JSON, subject and card spec carry no handle, name, invite code, id or town for a nameless answer by an admin with "show my name" on; card, story and square all draw (1200x630, 1080x1920, 1080x1080). I did not read the pixels; I read the data the pictures are drawn from.
- Poll explanations and proposals have no nameless mode (no `anonymous` in `vote/` or `results/`).

### C. Admin posts first, pictures, Admin mark
- Answers: 25 named admin answers plus 5 nameless plus 60 others, 7 per page, every sort, guest, member and blocker. Top 20 are the newest named admin answers in newest-first order; nameless admin answers never in the top; on the first page only; no duplicates in a quiet crawl; the 5 older admin answers appear once later. The blocker still sees the top 20 (the intended exception).
- Role taken away: the admin's answers left the first page at once for a member (guests: up to 5 s, L6).
- `avatarUrl` and `admin: true` on the admin's author; a suspended admin shows `avatarUrl: null` and still `admin: true`; an account in deletion shows no picture.
- Picture address: built only from files of kind AVATAR, not purged, under the CDN base (`common/people.ts:60-80`). I could not create a private-kind file to test it end to end (the enum refused my rows), so this is from the code.
- Failures: M1, M2, H1.

### D. Share card
- Question with words and no fallback: 1200x630 pick picture. Question without words: M3.
- Story (1080x1920) and square (1080x1080) drew for a question with and without words. The existing spec `fixd-cards.spec.ts` covers every object type and passes.
- Before a question opens: link creation answers 404 for an unopened question, so there is no page, card, story or square; every read route (question, answers, moods, what-next, proposals, polls, search, home, today, calendar, trending, categories) answered 404 or held nothing of its text or words.
- Burst: 200 cold story draws from 200 addresses at once: 200 ok, 13.9 s, heap 133 to 134 MB, rss 473 to 724 MB (peak, then 616 MB after the next burst; heap 125 MB). 200 square draws on top: 171 ok, 29 x 503. One address, 200 requests: 60 ok, 140 x 429. Gate constants are 3 at once and a queue of 60 (`share.service.ts:34-35`). I did not capture a 503 body; the code throws a clean `UNAVAILABLE`.

### E. Direct messages are off
`DMS_LIVE` truly unset (I used a copy of the harness that deletes it). 95 requests against `/dm/*` for guest, member, verified, suspended and a bad token, all methods including HEAD and OPTIONS, valid and invalid ids, compared with the same request to an unknown route: same status (404), same body, same content type; only L1 differs. `/config/public` says `dmsLive: false`. Clip with purpose DM: 422, refused (L2). Settings, wallet, home, notifications, blocks, friends and people answers carry no DM data. Existing DM rows (md5 of the rows) were identical before and after every route call. The data export build includes the old message text. Purge of the recipient leaves the message for its sender (by design in `deletion.service.ts`).

### F. 2,500 characters, news tags, alerts, summaries
- Limit: answer 2,500 ok and 2,501 refused with "Keep it to 2500 characters."; 2,500 and 2,501 emoji the same (counted as characters); reply the same; edit to 2,501 refused; text fix 2,501 refused. An old 4,000-character post reads, shows in the list, can be shortened to 2,000, and can be deleted (204). An edit that keeps it over the limit (4,001 or 3,000) is refused with the clear words; re-saving the same 4,000 characters is refused too. Admin sets 3,000: `PUT /admin/config/text.max_chars` 200; 5,001 and 0 refused (422); a post of 3,000 took effect after the 5 s cache (L6). Proposals: L7.
- News: 8 parallel Verified News requests: 1 x 201, 7 x 409, exactly 1 OPEN row. Approved by an editor, a new request: 409 `ALREADY_VERIFIED`. Edit of a Verified post: 409. Paid length 1 to 100 to 50 to 100 to 120 to 100 to 120 cost 3300, 0, 0, 670, 0, 0 milli: nobody paid twice; `paidChars` ended at 120. Decision against edit: in the pair and triple matrix, no ledger fault.
- Alerts: 120 followers (30 with alerts off, 1 with the row off), a fresh question, a question marked by the backfill, an old unmarked question (40 h) and a future one. Six parallel ticks: 90 notices for the fresh question, 0 duplicates per person, 0 to opted-out people, 0 for the marked, old and future questions. Poll-close notices: I could not set up poll votes in time, so not proven (existing specs cover it).
- Summaries: the scrub is L4. "[removed]" in main view, opposing view, poll line or next steps with `approve` gives 422 "Take out or rewrite the marked places before approving" (`admin/topics.service.ts:1160-1170`); that is the only writer of the summary row.

### G. Migrations on live-shaped data
Database: 300,000 users and settings and wallets and free-allowance rows, 1,000,000 answers, 600,000 replies, 1,000,000 charges, 20,000 DM conversations and 60,000 DM messages, 400 old questions, the launch question, 40 polls, config overrides. Applied everything except `160000`, `200000`, `230000`, `280000` and `350000`, then ran `prisma migrate deploy`: all five applied cleanly out of order in 2.3 s in total. While it ran, 2,744 writes and reads on Reply, Answer, Question, Poll, UserSettings, FreeAllowance and ConfigEntry: slowest 20 ms. Results: `text.max_chars` 5000 became 2500 (a different admin value is left alone), one ConfigChange row; the backfill marked 400 of 400 started questions and 20 of 20 ended polls and left the launch question unmarked; free-posts, launch-hint and launch-now re-ran as no-ops or fast (1.5 s for the 300,000 free-allowance rows). Schema drift after migrating: only older items (search columns, a handle index, an index name), nothing from today.
Rollbacks (`rollback.down.sql`) all ran. Refusals: tag alerts off (`230000`), anonymous replies (`200000`), DM rows (`140000`), verification rows (`130000`) refused as written; after clearing the cause they ran. `280000` and `160000` drop columns without refusing (L5). Not covered: the subscriptions, verification and DM tables were empty when I seeded; I did not fill them with live-shaped rows.

## What held
tsc clean; eslint 0 errors (51 warnings, all old, no `--fix`); both lock statements; no deadlock outside the editor/moderator/purge group; counters and money in every round; nameless answers and replies hidden on 35 routes for 5 viewer kinds and 3 writer kinds; block and unblock changed nothing; DMs off for every viewer; the 2,500 limit and old posts; one OPEN Verified News row; no double pay for a length; alerts once per person; migrations fast, additive and out-of-order safe.

## What I ran, with totals
- Set-up: Postgres 16 and Redis, `npm ci`, `prisma generate`, `tsc --noEmit` (clean), `eslint` without `--fix`.
- Whole suite on a fresh database: 145 suites, 143 passed, 2 failed (`scrub-round4`, `scrub-round5`, L8, pass alone 3 of 3); 2,404 tests: 2,401 passed, 2 failed, 1 skipped. `npm run test:audio`: 13 of 13 pass (run on its own, because jest returned non-zero). The `vote.spec.ts` failure in the join report did NOT happen here.
- `test/talk/fixb-r4-edit.spec.ts` ten times, machine loaded by my attack runs: 21 of 21 passed in 9 runs; run 6 failed `R4-1: 2 identical longer edits at once` at line 144: statuses `[200, 409]` instead of `[200, 200]`. Cause: the poster's Verified News request got the post lock before the second edit, so the second edit was correctly refused (an open request locks the text). The test assumes the 100 ms stagger decides the order. Product answer is right, the test is timing-dependent. Ten more runs on a quiet machine: 10 of 10 passed.
- My own specs (not committed): concurrency matrix, nameless canary scan, admin-first, share card and burst, DMs off, text limit and news, alerts, pool starvation, scrub fuzz (about 85 shapes), migration run.

## What I could not prove
- Nameless VOICE answers and replies (needs real clip uploads), the pictures' pixels, the weekly report and export text of nameless items, admin list screens.
- Poll-close alerts under parallel ticks.
- A stale news-flag read: `news.service.ts:271-310` reads the post's review status before its transaction and can set FLAGGED after an editor decision; I could not time that race.
- The charge sweeper racing a real orphan charge (existing specs cover it); my sweeper rounds ran with nothing to reverse.
- Triples beyond the 25 I picked; volume above one machine; anything live.
