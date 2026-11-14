# V-HOTFIX-1: three live faults

Branch `v/hotfix-1` from `origin/main` (755aa15). Code under `api/`. No migration. No route, response field or config key renamed or retyped; one config key added.

## Fault 1: "also block" on a nameless post

Rule as built: on a post made without a name, a report is recorded exactly as before, no Block row is created, the response says `blocked: false`. A named post blocks as before.

- `api/src/talk/engagement.service.ts:435-448` and `:585`: the ANSWER case sets `nameless` from `answer.anonymous`; `alsoBlock` only blocks when `!nameless`.
- Other places a block can be created: only `PUT /me/blocks/:userId` (by person id, `me/blocks.ts` `block`) and this report path. Shares, notifications and replies create none. A Reply has no `anonymous` flag on this model, so the REPLY case is unchanged; when the flag is added, set `nameless` from it there (comment in place).
- Spec: `test/talk/hotfix1-block-report.spec.ts` (3 tests): block list unchanged, no Block row, report and moderation item present, second report 409; a named post still blocks.

## Fault 2: block / unblock as a test that names the writer

Rule as built: a nameless answer is shown or hidden the same for every viewer whatever blocks exist either way. Blocks never filter it, never change a count that includes it, and never suppress or reveal a notice about it. One helper set in `api/src/me/blocks.ts`: `blockHidesAuthorOf`, `answerNotBlocked`, `answerNotBlockedSql`, `answerAuthorVisible`, `replyNotBlocked`.

Every read path found and changed:
1. `talk/posts.service.ts` `visibleAnswer` (answer by id / direct link 404).
2. `talk/posts.service.ts` `getAnswer` reply count recount (via `replyNotBlocked`).
3. `talk/posts.service.ts` `createReply` block 404 checks (skipped for a nameless answer).
4. `talk/posts.service.ts` reply notice and reply mail to the answer's author (not suppressed for a nameless answer).
5. `talk/posts.service.ts` `listReplies` and `stanceCounts` (through `replyNotBlocked`; replies are named, behaviour unchanged).
6. `talk/engagement.service.ts` `publishedAnswer` (like, react, save, helpful 404).
7. `talk/engagement.service.ts` reaction notice fold to the author.
8. `talk/engagement.service.ts` `listen` (play report 404).
9. `feed/feed.service.ts` `answerWhere` (question answers list, trending answers, category lists, counts built on it).
10. `feed/feed.service.ts` search raw SQL (answers, totals).
11. `feed/ranking.service.ts` `person` (rank score and so trending order no longer move with a block on a nameless answer).
12. `news/news.service.ts` list and get.
13. `me/people.service.ts` saved answers (`answerAuthorVisible`).
14. `reach/reach.service.ts` `render` (reply notices; also feeds `unread`): a notice about a reply on a nameless answer is served, the blocked replier shown as "Someone".

Looked at and left unchanged (not about a nameless post): `visibleUser` on a person's page and lists of a person's replies (about the person, replies are named), `faces`/`recentVoices` (already `anonymous: false`), results posts (no anonymous flag), invites, proposals.

Spec: `test/talk/hotfix1-block-oracle.spec.ts` (4 tests). 13 routes captured for V (home, question, answers NEW/TRENDING/DEBATED, trending, new, search x2, news, answer, replies, replies by stance); identical before, after V blocks W, after W blocks V, after both, after unblock. A named post by W still vanishes. Replies to the nameless answer succeed and notices are served under blocks both ways. Rank score unchanged when W blocks a liker. Confirmed failing when the helpers ignore `anonymous`.

## Fault 3: expired key refunds a posted answer

Rule as built: a reversal only undoes a charge this request created. If the charge existed before the request asked for it, it is never reversed. If its post is stored, that post is returned and nothing is written, charged, reversed, given back, notified or mailed. If the same charge is sent with other content and it belongs to a stored post, 409 `IDEMPOTENCY_KEY_REUSED`.

- `talk/posts.service.ts` `spendThen` (about `:120-175`): pre-reads the charge row; `replayed = !!prior`; `find` callbacks in `createAnswer` and `createReply`; after a successful write the charge gets `refType/refId` (existing columns).
- Stored post lookup: by `refId` plus content, else for old charges by clip, or author + target + same text since the charge time.
- Retention: `talk/talk.controller.ts` passes 8 days for answers and replies; config key `idempotency.post_keep_days` (default 8, `talk/shared/config-reader.ts`, `admin/config-catalogue.ts`). Other routes keep 24 hours. Note added to `docs/contract/CONVENTIONS.md`; `openapi.yaml` regenerated output is byte-identical (unchanged).
- Specs: `test/talk/hotfix1-money.spec.ts` (9 tests): paid voice replay x3 (balance, ledger, one answer), free post, old charge without link, different body refused after expiry, honest reversal once, six at once, different clip refused (before and after expiry), 8 days and config override, reply replay. 6 of 9 fail with the fix disabled.

## Existing specs changed

None. (My first attempt added a `replayed` field to the units port result and broke `test/units/ledger.spec.ts` "same key twice"; I removed the field, the spec is unchanged.)

## Runs (own Postgres 16 on 55432, Redis on 56379)

- `npx tsc --noEmit`: exit 0.
- eslint on `src` and the new specs: 0 errors, 4 warnings, all in existing files.
- New specs: report 3/3, oracle 4/4, money 9/9.
- `test/talk test/units test/me test/reach test/feed test/privacy`: 54 suites, 598 passed, 1 skipped, 0 failed.
- Full API suite (`jest --runInBand`): 103 suites, 1160 passed, 1 skipped, 0 failed. `npm run test:audio` not run.
- Contract: `build.py` output identical to `openapi.yaml`.

## Choices

- Nameless reply notice for a blocked replier is served with "Someone replied" (safest: no reveal, no suppression).
- A nameless answer replied to by someone the writer blocked now accepts the reply and notifies the writer (the rule says blocks never change it).
- Stored post deleted by its author: 404.
- Replay of a charge with no stored post (crash or very old charge): the write goes on under that charge and a failure leaves it alone (never reversed).
- Reply side: no flag exists, so replies still follow blocks.

## Not done / residual

- Old charges without `refId` are matched by content and time; a same-key replay with other content against an unlinked old charge still writes under that charge.
- If the question is closed when an expired key is replayed, the closed-question 409 comes before the stored-post lookup.
- `build.py` parameter text still says "24 hours".
- `test:audio` not run.

# Round 2

## Findings fixed

- **BLOCKER 1** (`GET /people/{userId}/replies`): `api/src/me/people.service.ts` `listPersonReplies` (the `answer:` filter, was `author: visibleUser(viewer.userId)`) now spreads `answerAuthorVisible(viewer.userId)`, the helper round 1 used for the saved list. A reply on a nameless answer is listed whatever blocks exist; the writer's account status still applies. A named answer still follows the blocks.
- **Found by the audit below** (not in the checker's list): `api/src/reach/reach.service.ts` `render`, the REACTIONS notice. It dropped a blocked reactor from the count and suppressed the notice when every reactor was blocked, also when the answer is nameless. Now, on a nameless answer: the count keeps every reactor, the notice is never dropped, and a blocked reactor is not named ("Someone ..."). `anonymous` is now selected on the answers read there.

## Every place in `api/src` that filters, counts or joins by the viewer's blocks

"Nameless path?" = can a nameless post, or anything attached to it, pass through it.

| Place | What it does | Nameless path? | Done |
|---|---|---|---|
| `me/blocks.ts` `visibleUser` | author relation filter (status + both block directions) | yes, if used on an answer author | callers below; `answerAuthorVisible` is the nameless-safe form |
| `me/blocks.ts` `hiddenUserIdsOf`, `BlocksService.hiddenUserIds/isBlockedEitherWay/assertCanInteract` | lists people hidden | only via callers | callers below. `assertCanInteract` and `isBlockedEitherWay` have no caller in `src` outside `blocks.ts` (grep) |
| `me/blocks.ts` `answerNotBlocked`, `answerNotBlockedSql`, `blockHidesAuthorOf`, `answerAuthorVisible` | the round 1 helpers, nameless exempt | exempt | none needed |
| `me/blocks.ts` `replyNotBlocked` | drops replies by hidden people | a reply is a named post (no flag on replies); it hangs on the nameless answer | left as on main: a named reply by a blocked person leaves the blocker's thread and count. Rule 2 is about a post made without a name; the reply names its writer |
| `me/people.service.ts:146` replies list | answer author filter | **yes** | **fixed** (above) |
| `me/people.service.ts:211` saved list | `answerAuthorVisible` | exempt | none |
| `me/people.service.ts:47-59` `visiblePerson` | person page 404 / "blocked by me" | no (about a person; their page never lists a nameless answer, checked in the crawl) | none |
| `me/people.service.ts:288` block list | the viewer's own blocks | no | none |
| `me/views.ts:384` faces on a question | `visibleUser` on answers with `anonymous: false` | no, nameless excluded by the query | none |
| `me/invite.service.ts:48,187` | inviter counts friends not blocked; needs a named answer | no, nameless answers never count (ruling LC) | none |
| `me/deletion.service.ts:428` | deletes blocks of a deleted account | no | none |
| `feed/feed.service.ts:48` viewer filter, `:1059` search SQL | `answerNotBlocked` / `answerNotBlockedSql` | exempt | none |
| `feed/feed.service.ts:1067` people search | drops blocked people from people results | no (people, not posts) | none |
| `feed/present.ts:111` question faces | filters blocked authors from the faces | no, faces are named answers only | none |
| `feed/ranking.service.ts:48` `person` | block anti-manipulation guard on score signals | yes | exempt for a nameless answer (round 1) |
| `news/news.service.ts:168,205` | `answerNotBlocked` | exempt | none |
| `results/actor.service.ts:69` `blockedEitherWay`, `results/results.service.ts:285` | filters result-thread posts | no: `ResultPost` has no `anonymous` and is not an answer | none |
| `reach/reach.service.ts:234,430` | notification list and unread count | yes | REPLY exempt (round 1); REACTIONS **fixed** (above) |
| `vote/proposal.service.ts:412,427` | notice to the author of an improved proposal | no (proposals, named) | none |
| `talk/posts.service.ts:369` `visibleAnswer` | 404 by direct link | exempt | none |
| `talk/posts.service.ts:382` `getAnswer` reply count | counts replies the viewer can see | counts named replies, not the answer | as on main (named replies) |
| `talk/posts.service.ts:523-536` | reply gate | exempt when `anonymous` (round 1) | none |
| `talk/posts.service.ts:619,634` | notices after a reply / report | exempt | none |
| `talk/posts.service.ts:713,719,768` reply list and stance counts | named replies | as above | as on main |
| `talk/engagement.service.ts:63,228,385` | like / react / save / listen gates and notices | exempt via `blockHidesAuthorOf` | none |
| `talk/engagement.service.ts:586` report `alsoBlock` | makes a Block | exempt for a nameless post (rule 1) | none |

What a nameless post's replies, reactions, saves, reports, notices, share links, mood, listens and counts go through: replies (named, follow blocks like any named post), reactions and likes (gates exempt; the REACTIONS notice fixed), saves (list exempt), reports (no Block row), notices (REPLY and REACTIONS exempt), share links (no block filter in `reach/share*`; crawled), mood (no block filter in `src/mood`, read), listens (gate exempt), counts in feeds, search, question lists (exempt, crawled).

## The crawl spec

`api/test/talk/hotfix1-crawl.spec.ts` (3 tests). A nameless answer on one question and a named answer by the same writer on another; two named replies, saves and likes on the nameless one. 5 viewers (V who blocks, neighbour X, replier R, writer W, a guest) read 36 GET routes of `docs/contract/openapi.yaml` that can carry a post or a count (my answers, saved, person pages and replies, questions and today, the question's answers in each sort, feeds, search, news, answer, replies by stance, where-you-sit, card, videos, moods, polls, what-next, notifications, unread count, share page, friends, invite, weekly report) in 8 or more states: before, V/X/R blocks W and unblocks, W blocks V/X and both ways, cleared. Every response must equal the baseline (status and body; clock fields and page markers masked). Test 2: the named answer is 200, then 404 for the blocked pair only, still shown to others and guest, back after unblock. Test 3: the REACTIONS notice about the nameless answer keeps its count and stays when W blocks or is blocked by a reactor. Where R and W block each other, R's own named reply and person page legitimately leave the thread of that pair; the pair's snapshots are skipped, all other viewers are still compared. Home, today, moods, where-you-sit, card, videos and news detail answer 404 in this setup (no scheduled topic, no card storage): compared as the same 404, not exercised with data. Mutation checks: with the people fix reverted, test 1 fails; with the reach fix reverted, test 3 fails.

## Runs (own Postgres 16 on 5544, Redis on 6390; both stopped at the end)

- `npx tsc --noEmit`: exit 0.
- eslint on `people.service.ts`, `reach.service.ts`, `hotfix1-crawl.spec.ts`: 0 errors, 0 warnings.
- `test/talk/hotfix1*` (7 suites, includes round 3 specs from the other session): 32 passed, 0 failed.
- Crawl spec alone: 3 of 3 passed.
- `test/talk test/me test/reach test/feed test/privacy`: 52 suites, 499 passed, 1 skipped, 0 failed.
- Full API suite (`jest --runInBand`): 107 suites, 1176 passed, 1 skipped, 0 failed. `npm run test:audio` not run.

## Existing specs changed

None changed by me in round 2. (`hotfix1-block-oracle.spec.ts` was edited by the other session in round 3, not by me.)

## Choices

- A reply is a named post: replies by a person hidden from the viewer still leave that viewer's thread, list and counts, as on main. They are not "a post made without a name"; when replies get a nameless flag only `replyNotBlocked` and `blockHidesAuthorOf` change.
- A blocked reactor on a nameless answer is counted but not named (privacy first), for the writer.

## Not done

- Checker LOW 4 / MEDIUM 2 / MEDIUM 3 were left to the other session (round 3 commits touch them); not re-run by me.
- Home, today, moods, where-you-sit, card, videos and news detail were 404 in the crawl's setup, so they are compared as the same 404 only.
- `npm run test:audio` not run. The Prisma client was generated locally (`prisma generate`, gitignored output).
