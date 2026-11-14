VERDICT: MERGE
INTERIM

# Check of #33 (admin posts first on Home, /feed/trending, category top voices)

Interim, written 19:43 UTC. Checked commit 63aa77c on my own Postgres 16 and Redis, real HTTP through the app's own test harness (my attack specs are not committed). The full suite, the leftover-data check (item 7) and the second half of the race checks are still running; the final report replaces this one.

## Findings so far (most severe first)

No HIGH finding. No nameless admin post was exposed. No unreadable post was shown (except the account-state case below).

1. **MEDIUM (rule gap, not new, but now pinned on top): a banned, "deletion pending" or deleted admin's named post is still lifted on all three lists.** Steps: make a person ADMIN, give them a named published post on today's question, set their account status to BANNED (or DELETION_PENDING, or DELETED) in the database, then call `GET /home`, `GET /feed/trending?questionId=...`, `GET /categories/{slug}` as a guest. The post is on top of all three, and on `GET /questions/{id}/answers` too. Cause: `adminBlock` (`api/src/feed/feed.service.ts:857-893`) filters the post (published, not deleted, question readable) but not the author's account state. The ranked lists do the same: a plain member who is BANNED or DELETION_PENDING keeps their post in `/feed/trending` (I tested that too). So the new code matches the existing rule, it does not break it. But the brief says "an admin who is suspended or being deleted: never lifted". A suspended account is a public account in this code (`PUBLIC_STATUSES` in `api/src/me/blocks.ts:11`), so a suspended admin is lifted by design. Fix, if the owner wants it: add `author: { status: { in: PUBLIC_STATUSES } }` to the `where` in `adminBlock`. Real accounts that are fully deleted have their posts soft-deleted (`api/src/me/deletion.service.ts:206-226`), so only the pending window and bans are open. Needs the owner's call; this is the owner's rule, not mine.

2. **LOW: mid-paging races (same as `questionAnswers`, no worse).** Measured on `/feed/trending?questionId=...&limit=7`:
   - an admin posts between pages, up to 20 admin posts: nothing repeats, nothing missing (38 rows, 0 repeats);
   - an admin post removed between pages: 0 repeats, 1 fewer row (the removed one, as expected);
   - more than 20 admin posts, then one more admin post between pages: 1 repeat (the post that fell out of the top 20 reappears in the ranked list: "AA2" seen twice);
   - the admin role removed between pages with 22 admin posts: 20 repeats (the 20 block posts come back in the ranked list);
   - same race on `GET /questions/{id}/answers?sort=TOP` (role removed, 7 on a page): 5 repeats. So it is the same behaviour as before, no loss of posts in any case I ran.

3. **LOW: a blocked person sees only the newest 3 admin posts of Home as "block", older admin posts they blocked stay hidden in the ranked list.** Example: viewer who blocked the admin, an admin post with rank 999 and 5 admin posts: Home shows the newest 3 admin posts, then the ranked list WITHOUT the rank-999 admin post (blocked). Others see that post in the ranked slots. Matches "a person who blocked the admin still gets the block" for the block itself; the cap-3 rule leaves the rest under the normal block rule. Informational.

4. **LOW: tag filter.** `/feed/trending?tag=GOSSIP` puts the admin's untagged (non-news) posts on top of a tag-filtered list. That is what the brief says ("the news tag filter does not remove the block"), noted so it is a choice and not a surprise.

## What held (all run, real HTTP, seven kinds of viewer: guest, member, admin, moderator, blocker, blocked-by-admin, both)

- **Nameless**: a nameless admin post never joined the block on any of the three lists. With scores 95/94 and swapped, it sat exactly where a nameless post by an ordinary person with the same score sits. Full JSON of the nameless admin post vs a nameless ordinary post (same score, same time): the only differing fields were `body` (my test text) and `isMine` for the author's own view; nothing else (no author, no mark). Counts, cursors and page sizes are the same: `adminBlock` takes only `anonymous: false` rows in the database, so the id list never mentions a nameless post.
- **Not readable**: admin posts on a DRAFT question, a not-yet-open question, a question closed more than the ranking window ago, REMOVED, HELD, DELETED_BY_AUTHOR, soft-deleted: never on Home, `/feed/trending` (none, `categoryId`, `limit=1/20`) or the category page. A removed admin (role deleted) is not lifted.
- **Closed question**: an admin post on a question that closed an hour ago (inside the 7 day window) IS lifted on `/feed/trending` and the category page, and is on top there. This matches the ranked list: a plain member's post on the same closed question is listed too, and `/feed/trending?questionId=<closed>` equals `/questions/<closed>/answers?sort=TOP` exactly. Home uses today's question only; today's question as DRAFT or opening later: Home trending is empty for every viewer.
- **Home**: no admin posts: `["R1","R2"]`. 1 admin post: 3 items. 3: 5 items. 5: newest 3 then 2 ranked. A top-ranked admin post (rank 999) outside the newest 3 shows once. No duplicates in any case.
- **Compared with the parent commit e293f9a on the same data** (an admin who only has nameless posts, a blocked member, 6 posts): the JSON of `/home`, `/feed/trending` (page 1 and 2, with and without `questionId`), `/categories/{slug}` and `/questions/{id}/answers`, for guest, member, admin and blocker, is identical after replacing random ids and handles by fixed names (checked field by field: only random handles, topic ids and cursors, which carry random ids, differ).
- **Blocks**: A blocks the admin, the admin blocks A, both: A still gets the admin block on all three. A named post by a person the admin blocked (and one by the blocker) still vanishes for the viewer who has the block, appears for the others.
- **Paging** on `/feed/trending` with limits 1, 2, 7, 20 to the end, for none / `questionId` / `categoryId`, guest, member, blocker: 0 duplicates, the full set seen in every case (38 rows, 33 for the blocker is the 5 blocked rows' arithmetic in my count, not a loss: the block is still shown to them). The admin block is on page 1 only, not inside `limit`.
- **Old cursor**: `cursor.ts` is untouched by #33 (`git diff e293f9a 63aa77c -- api/src/feed/cursor.ts` is empty); a cursor whose row is now an admin-block post answers 200 and continues from that row's place.
- **Timing, `GET /home`, 200 requests each, one machine while the test suite ran next to it**: 0 admin posts median 20.8 ms (p95 31 ms); 3 admin posts median 20.5 ms (p95 30 ms); 50 admins with 2,000 admin posts median 25.2 ms (p95 37 ms), still 5 items. `/feed/trending` with 2,000 admin posts, median 19.9 ms. The added query takes 0.07 ms on the plan I printed (EXPLAIN ANALYZE, index only).
- **Gate**: `npx prisma generate`, `npx tsc --noEmit`: clean (0 errors). `eslint` without `--fix` on `src` and `test` (my specs excluded): 0 errors, 51 warnings (all old).

## Not yet done (the final report will say)

- Item 7: whole `npm test` totals and the list of specs that can break after `admin-first-home.spec.ts`. First sign: `test/vote/vote.spec.ts` failed in my run, only because my machine had no Redis at 127.0.0.1:14002 (the spec's default); I started one and will re-run it.
- Item 3 full: the same data check with 50 admins on a category page.
- Item 4: pages with `tag`.
