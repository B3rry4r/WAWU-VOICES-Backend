VERDICT: FIX

# Verify REL-D2 (API), INTERIM report

This is an interim push because a HIGH was found. The full report replaces this file. Checked on origin/main 21fa85a, branch verify/rel-d2, no product code changed.

## HIGH

### H1. An admin's NAMELESS reply is lifted to the top of the thread, for every viewer
- Where: `api/src/talk/posts.service.ts:1022-1030` (the admin-first query for replies). The comment above it says "replies have no `anonymous` flag". That stopped being true when migration `20261114200000_fix_d` added `Reply.anonymous` (today). The answers version of the same rule (`api/src/feed/feed.service.ts:994`) has `anonymous: false`; the replies version does not.
- Steps: person C posts an answer. Four ordinary people reply (named). An ADMIN replies nameless (`anonymous: true`), then replies named. `GET /api/v1/answers/{id}/replies` as a guest, as another member, as someone who blocked the admin, and as the admin.
- Seen, same for all four viewers: `NAMED-ADMIN | ANON-ADMIN(nameless) | p0 | p1 | p2 | p3`. The nameless reply is the newest, yet it sits above the four older replies. The name is hidden, but a reader now knows that nameless reply was written by a current admin, and the person who blocked the admin still sees it (the block exception applies to it too).
- Rule broken: B, "admin-first ordering must not move an admin's NAMELESS post to the top". The same query is also exempt from the block filter, so the nameless reply of a blocked admin is shown to the blocker in a place no other nameless reply would be.
- New today: yes. At 95fe0a0 there was no admin-first for replies at all; it arrived with #27 and met nameless replies in the join.
- Fix hint: add `anonymous: false` to `adminWhere` in `listReplies`.

(Everything else is still being run and will be added to the full report.)
