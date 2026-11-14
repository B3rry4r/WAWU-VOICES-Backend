Tested commit: daeeab4e80b0ae3b457485fc65db7ad217af054a (origin/v/hotfix-1)
VERDICT: FIX

# Verify V-HOTFIX-1 (first version, written at once after finding a BLOCKER; updated below as the run goes on)

## BLOCKER 1. `GET /people/{userId}/replies` still filters by block, so block/unblock still names the writer of a nameless answer
- Code: `api/src/me/people.service.ts:146` (`answer: { status: PUBLISHED, author: visibleUser(viewer.userId) }`). The builder changed the saved-list path (`:208`, `answerAuthorVisible`) but not this replies list.
- Ran (my own crawl spec, branch tip): writer W posts a nameless answer; person R replies to it (named); viewer V reads `GET /people/{R}/replies`: 1 item. V then `PUT /me/blocks/{W}`: the same call returns 0 items; `DELETE` the block: 1 again. Same when W blocks V (`PUT` by W), and the same for a neighbour X and for R themself. For a guest there is no change (no block possible).
- Meaning: a person who suspects someone can block them and read R's reply list; the reply vanishes only if the suspect is the writer. This is the same oracle the hotfix is meant to remove (rule 2: blocks never filter or count a nameless post's things), on one route the builder missed.
- Should: a reply on a nameless answer is shown the same whatever blocks exist between the viewer and the answer's author (the answer's author status still applies as for everyone). Use `answerAuthorVisible`-style logic there too, or the same helper.
- Control on origin/main (same spec): the same block/unblock changes `/answers/{id}`, `/answers/{id}/replies` (list and stance filter), the question's answer list in every sort, search, `/people/{R}/replies`, `/me/saved`. On the branch only `/people/{R}/replies` (and `/me/blocks`, which is the viewer's own list, expected) still changes. For the named answer the branch changes all of them as on main (expected).

## Proved by runs so far
- tsc 0 errors; eslint on src and the builder's specs 0 errors (4 warnings); builder's 3 hotfix1 specs: 3 suites, 16 tests pass.
- Crawl: 4 viewer kinds x 2 directions x 2 writers (nameless / named) x ~45 routes, branch vs origin/main (above).

(Report continues in the next commit.)
