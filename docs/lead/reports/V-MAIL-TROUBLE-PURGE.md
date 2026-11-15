# V-MAIL-TROUBLE-PURGE

Fix: a person's TopicMailTrouble rows are now deleted when they ask to delete and when they are purged.

## The two lines added (api/src/me/deletion.service.ts)
Lines 89 544 (request, then purgeOnce), each right after the topicMailSkip delete, in the same transaction:
- request: `await tx.topicMailTrouble.deleteMany({ where: { userId: me.id } });`
- purgeOnce: `await tx.topicMailTrouble.deleteMany({ where: { userId } });`

No catch, no schema change, no migration, lock order unchanged, topic-mail.service.ts untouched.

## Spec: api/test/me/mail-trouble-purge.spec.ts (3 tests)
Creates no question and no post. afterAll deletes the TopicMailTrouble rows it made. No moderation rows.

On origin/main product code (deletion.service.ts restored from origin/main): 2 failed, 1 passed
- "asking to delete clears both rows at once..." Expected: 0, Received: 2 (line 62)
- "the purge clears the person's rows..." Expected: 0, Received: 2 (line 85)
- "the purge of a person with no such rows works as before": passed

With the fix: Tests: 3 passed, 3 total.

## What I ran (fresh Postgres 16 and Redis, started locally)
- npm ci, prisma generate, tsc --noEmit: clean.
- eslint (no --fix) on the two files: 0 errors, 0 warnings. prettier --check clean.
- Spec + wf2-deletion + wf5-undo + fixd-reply-deletion + test/mail/*: 18 suites, 271 tests, all passed.
- Full npm test: NOT completed. I started it with a 900 s cap; it was cut off before Jest printed totals (the 30 minute budget ran out). No FAIL line was seen, but I have no totals to give.

## Not proven
- Not run against the live database or the real migration history on the server (the table is created by the migration already on main; the test database applies it through migrate deploy).
- The hourly sweep and noteTrouble were not exercised.
