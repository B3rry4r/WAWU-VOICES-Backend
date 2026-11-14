# REL-D2 join (phase 1)

Branch `v/rel-d2`, from origin/main 18704b8. Merged as separate merge commits: v/people-on-posts (52c748f), v/fix-c (51d3e2c), v/fix-b (32a00ff).

## Conflicts and how they were settled
- people-on-posts: main had an adapted copy of the pictures code (`avatarUrls`). The branch's `personMarks` (picture plus Admin mark) now carries it in common/people.ts, groups.service, dm.service, feed/present.ts, feed.service.ts, me/views.ts, reach/share-subject.ts, results/author.ts, vote/*, talk/views.ts. `avatarUrls` is kept in common/people.ts (an unnamed-by-status account has no entry) so main's tests stay as written.
- talk/views.ts replies(): the branch dropped main's nameless rule; restored (`author: r.anonymous ? null : ...`, nameless writers skipped in the marks query). `reply()` still accepts a bare picture string (main's anon-reply-picture spec passes one).
- talk/posts.service.ts replies page: kept main's `[...top, ...page]` (admin posts first).
- test/people/people-on-posts.spec.ts (add/add): main's assertions kept, branch's added (eslint header merged).
- docs/contract/src/schemas.py, build.py: branch's `?admin` on DmPerson kept; build.py keeps both the /admin/users and the /admin/proposals questionId rules. openapi.yaml rebuilt, twice, same bytes.
- fix-c users.service.ts (admin users list): main's list (counts, search by name, optional q) kept; fix-c's wildcard escape (% and _ match themselves) and "@" alone = empty result added. Test added in users-list.spec.ts.
- fix-b feed.service.ts / present.ts: both kept (faces pictures and override media). `fileUrl` (removed on main) restored in present.ts as a thin call to `avatarUrl`.

## Migrations
Added: 20261114350000_text_max_2500 (from people-on-posts), 20261114230000_fixb_alerts_2, 20261114280000_fixb_paid_chars. No duplicate stamps, none renamed.

## Checks
- tsc clean. eslint: no errors on touched files (warnings only, all in existing tests).
- Contract rebuilt; second build gives the same bytes.
- Whole suite (`npm test`, fresh Postgres 16 and Redis): 143 of 144 suites pass, 2398 tests pass, 1 skipped, 1 fails: `test/vote/vote.spec.ts` "serves a guest the live counts, cached in Redis" (`redis.getJson` is null). It fails the same way on a clean origin/main checkout, so it is not caused by this join. Not touched. Not proven: whether it is my local Redis or a real fault.
- The `test:audio` step needs ffmpeg and ran only if jest passed; it did not run because of the one failure above.

## Rules and their proof
- Nameless never exposes the writer (incl. Admin mark): new test "an admin's nameless answer and reply carry no name, handle, picture or Admin mark, for the writer too" (people-on-posts.spec.ts), plus the branch's Admin-mark test and main's anon-reply-picture spec. Polls and proposals have no nameless mode.
- Admin first, share card pick-one-word, DMs off: main's existing specs, unchanged and passing. DMS_LIVE switch untouched.
- 2,500 characters: branch's tests (text limit and public config) and text-max-migration.spec.ts pass.
