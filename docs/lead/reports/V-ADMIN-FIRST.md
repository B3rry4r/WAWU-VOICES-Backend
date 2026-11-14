# V-ADMIN-FIRST report

Branch `v/admin-first`. Commit `d550264` (code and spec); this report is the second commit.

## What changed (`api/src`, 121 lines added, over the 100-line limit, so see the commit)
- New `me/admin-first.ts`: `adminIdsOf` (one query on UserRoleGrant, role ADMIN) and the cap (20).
- `feed.service.ts` `questionAnswers` and `posts.service.ts` `listReplies`: first page fetches the named posts of current admins (newest first) and puts them on top; every page leaves those same ids out of the normal query.
- Changed lists: answers under a question, replies in a thread. Not changed: Home trending, profiles, search, weekly report, any other list.
- No schema change, no response shape change, no stored flag. Contract rebuild equals `docs/contract/openapi.yaml` (cmp clean).

## Paging
Admin posts go ON TOP of the first page, not inside `limit`. `limit` keeps counting ordinary posts, the cursor still means "last ordinary post", so a client asking for `limit` never loses ordinary posts and never loops. Cost: the first page can hold up to 20 more items than `limit`. Beyond 20 admin posts in one list, the older ones stay in their normal place (none lost, none doubled).

## Block exception
Only named posts of a current ADMIN: `feed.service.ts:910` (answers) and `posts.service.ts:794` (replies). Those queries skip the block filter. `blocks.ts` is unchanged. Nameless admin answers still follow the old block rule. Replies have no anonymous flag, so all admin replies count as named.

## Cost (SQL statements, one member viewer, 5 answers, 2 admin)
First page answers 26 -> 33. Later page 26 -> 28. First page replies 14 -> 19. Later page 14 -> 16. (Prisma include counts as several statements.)

## Assertions changed
None. No existing spec pinned an order this rule changes.

## Commands
- `npx tsc --noEmit`: clean. eslint on touched files: 0 errors.
- `docs/contract/src/build.py` + `cmp`: same.
- New spec `test/talk/admin-first.spec.ts`: 14 passed.
- `jest test/talk test/feed`: 28 suites, 314 tests passed.
- Whole suite, fresh PostgreSQL 16 (port 55432) and Redis (56379): 122 of 123 suites passed, 1381 tests passed, 3 failed, 1 skipped, 844 s. The failure is `hotfix1-block-oracle.spec.ts`: it compares two captures whose `/feed/new` cursor carries an issue time that differed by 378 ms under load; the other two failures followed from the block it left in place. That route is untouched. The spec passed twice alone (4/4).

## Not done or unsure
- I cannot see the website. A client must NOT re-sort these lists itself, must NOT assume the first page is at most `limit` long, and must NOT mark or style items as "admin" from position.
- Replies keep the stance tab filter (admin replies of another stance are not shown under a tab); answers ignore mood and tag filters as ordered. Say if replies should ignore the tab too.
- Guests get a cached page, so a role change shows for them after the guest-cache TTL.
- Commit trailers use the session's own attribution, not the ones in the brief.
