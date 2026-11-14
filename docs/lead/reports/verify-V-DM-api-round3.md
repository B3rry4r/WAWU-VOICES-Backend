VERDICT: MERGE

# Verify V-DM (direct messages), API side, third check

Code under test: `v/dm` at b895eee (held by `verify/v-dm`, which also carries the builder's reports), whole tree, with origin/main 4fa9d50 already merged in it. Own PostgreSQL 16 on port 55433 and Redis on 56380 (both stopped at the end). No live provider called, no `.env` or key file opened. My attack specs (`api/test/dm/vr3n1`, `vr3n1b`, `vr3n2`, `vr3q`, `vr3ex`, `vr3pm`) are not committed and were taken out of the tree for the suite runs; nothing of the builder's code was changed.

**All seven findings from the second check are closed on this head.** I found no BLOCKER, HIGH or MEDIUM. Two LOW items are new, one of them a small gap in how completely N7 is closed (a window of a few milliseconds inside the write). Merge, and take the LOW items when convenient.

## N1 to N7

| # | Finding | State | The run |
|---|---|---|---|
| N1 | A blocked person could tell "blocked" from "messages off" | **CLOSED** | 4 modes (they blocked me / messages off / suspended / banned), each with the same chat (3 messages, 2 unread for me, two other chats around it), 15 steps per mode on every DM route: status, headers and body identical after the ids, times, handles and cursors are masked. Timing over 200 calls per mode (random interleaved order) on inbox, `with`, messages and send: p25, p50 and p75 equal within noise. All the edges (below) hold. |
| N2 | A renewed person was refused for up to 10 minutes | **CLOSED** | Matrix of 13 states below: renewed (ACTIVE or QUEUED plan) sends at once; everyone else who must be refused is refused; `fresh()` never changes a status. 50 sends at once from a person who needs healing: 50 x `201`, exactly 1 write to `verifiedUntil` (trigger on the column). A normal verified sender costs 33 statements and 0 subscription queries. |
| N3 | Contract stale (`ErrorCode`, bucket) | **CLOSED** | `build.py` regenerates `openapi.yaml` byte for byte (`cmp`). `ErrorCode` has 45 values, `dm_unavailable` and `verification_required` in, `blocked`, `dm_closed`, `recipient_unavailable` out. Every code in `src/dm` is in the enum (no code missing). Every code my runs saw from the DM routes is in it. `sendDm` says "30 a minute per account". |
| N4 | `build.py` silent on three mistakes | not asked (left by the lead) | not re-run |
| N5 | In-memory rate bucket | not asked (left by the lead) | not re-run |
| N6 | Export took the oldest 50,000 | **CLOSED** | 49,990 + 10 messages: 50,000 in the file, `directMessagesTruncated` false, note null. One more: 50,000 in the file, flag true, note "Only your newest 50000 direct messages are in this file." 50,010: the 10 oldest are the ones left out (checked by id against the database), all newest 50,000 in, ascending order by time. Nothing of the chats between other people (500 rows marked `SECRET` between two others, 5 more between a third and a fourth): not in the file; the fourth person's handle is not in it. 13.7 MB, built in about 2 s. |
| N7 | The write did not re-check the receiver | **CLOSED for the window the charge opens; a few milliseconds remain inside the write (LOW-1)** | Six changes made between the check and the write (messages off, suspended, banned, deletion pending, receiver blocks sender, sender blocks receiver), price 5 tokens per 150 characters: all `403 dm_unavailable`, 0 stored, wallet 1,000,000 -> 1,000,000, the charge row `REVERSED`, ledger net on the wallet 0, no unbalanced transaction, the day's count given back. |

## New findings

### BLOCKER, HIGH, MEDIUM

None.

### LOW-1. The re-check inside the write is a plain read: a block, "messages off" or a suspension that commits during the write is not caught

`api/src/dm/dm.service.ts:305-326` (`store`). The transaction counts blocks, reads the receiver's status and `dmOpen`, then upserts the conversation and inserts the message, at the default READ COMMITTED level with no lock. A change committed after those two reads and before the insert commits is not seen.
Run: I held an `ACCESS EXCLUSIVE` lock on `DmConversation` from a second connection so the write waited after its checks; during the wait the receiver (a) blocked the sender, (b) switched messages off, (c) was suspended. After the lock was released, in all three: the send answered `201`, the message was stored. For (a) the block's own `204` came back before the send's `201`; the blocker's inbox, unread and `messages` stayed hidden (0), and after unblocking their unread read 2 (the earlier message and the one that slipped through). For (b) and (c) `with` then says `acceptsMessages:false`, and the one message is in their inbox.
How wide: the few milliseconds between the re-check and the commit. The race stress I tried (12 parallel sends, a block at a random 0 to 8 ms) did not hit it in 40 trials (it stored one message per trial before the block landed and refused the rest); only the held lock made it happen. Before round 3 the window was the whole charge transaction; now it is the write alone.
Should: take a lock that the other side also takes, for example `SELECT ... FROM "User" WHERE id = receiver FOR SHARE` in `store` plus the same row `FOR UPDATE` in the block and settings writes, or a per-pair advisory lock in both. One message at most, and a blocker never sees it while blocked. Not a reason to hold the merge.

### LOW-2. After a failed store, a retry with the same Idempotency-Key is `409 CONFLICT`, for good

`api/src/units/units.ledger.ts:304-309` (shared ledger rule, not DM code; same on main for posts). Run: `store` made to fail once, the send answered `500`, the charge was reversed (balance back, 0 messages); the same key again: `409 CONFLICT` "That attempt was reversed. Start again with a new key.", balance delta 0, 0 messages. So a client that keeps the key on a retry after a `500` (the web builder's round 3 does this "unless the answer was a 4xx") gets a 409 and has to be told to make a new key. Nothing is lost or charged twice. Should: the web treats a `409 CONFLICT` on a DM send as "make a new key and send once more", or the ledger lets a reversed key be used again. Not proved on the web side (not asked).

### LOW-3 (note). The export reads `DmMessage` by `OR (senderId, recipientId)` ordered by time

`api/src/me/export.service.ts:215-224`. The table has no index on `senderId` or on `(recipientId, createdAt)` (`@@index([recipientId, readAt])` only). With 50,010 rows for one person the export took about 2 s, on a table of about 50,500 rows. A table of millions of rows would scan. The export is a background job, so this is a note, not a fault. The note text says "50000" without a comma.

## Detail

**N1, field by field.** For each mode the same 15 steps ran as the blocked-out person (S), with the other (R) changed to the mode: unread total, inbox, inbox `?limit=1`, messages, messages `?limit=1`, `with`, limits, mute, inbox, unmute, mark read, unread, inbox, send text (`403`), send voice (`403`). Compared: step, status, every header except `date`, `ratelimit-remaining`, `ratelimit-reset`, `x-request-id`, `content-length` (these differ per call or with the length of a random handle) and `etag`, and the body. Result: blocked equals off equals suspended equals banned on all 15 steps. The blocked transcript: unread 4 (2 from R, one each from two other people) and 2 after reading R's chat, inbox 3 rows in the same order, `acceptsMessages:false` on R's row, messages `200` readable with `acceptsMessages:false`, `with` `200` with the same `conversationId`, mute `204`, send `403 dm_unavailable` "This person is not taking messages.". Timing (p25 / p50 / p75 ms), 200 calls per mode, interleaved: inbox 11.0/15.4/18.0 blocked, 10.7/15.3/17.5 off, 11.1/15.2/17.7 suspended, 11.5/14.9/17.5 banned; messages 2.10 / 2.09 / 2.05 / 2.10 at p50; send 1.71 / 1.70 / 1.70 / 1.73 at p50; `with` first looked uneven at p50 (4.35 / 1.99 / 3.27 / 4.29 ms) because the distribution has two humps on this machine and the median fell between them; four more rounds of 200 each: p50 5.88 / 5.87 / 5.86 / 5.79, then 4.53 / 4.68 / 4.34 / 4.23, then 1.93 / 1.97 / 1.99 / 1.94, then 1.84 / 1.80 / 1.75 / 1.81 (blocked / off / suspended / banned): inside each round the four are equal; the difference between rounds is the machine, not the mode.

**N1, the edges.**
- A new message can never reach the blocker: 25 parallel sends from the blocked person: 25 x `403 dm_unavailable`, 0 stored for the blocker, the sender's wallet unchanged.
- The blocked person's old unread count: unchanged (4 before and after the block, same as with messages off); the chat stays readable (3 messages).
- Unblock: the blocked person's whole view equals what it was before the block (field for field); the blocker's chat comes back with its 5 messages and its unread count; sending works again and is charged.
- Both block each other: both hide the chat (inbox 0, messages `404`, `with` `200` with `conversationId` null and `acceptsMessages` false). One unblocks: the other side stays hidden, this side sees "messages off"; both unblocked: back, send `201`.
- The blocker reports an old message from the hidden chat: `201` (queue item made), the blocked person's views carry no change and no word about reports or blocks; a second report of the same message with `alsoBlock`: `409 CONFLICT` (same as for any double report).
- Block, then the blocker deletes the account: while the deletion is pending, the blocked person sees the same as with messages off; after the purge the row reads `deleted: true`, `acceptsMessages` false, messages `200` readable (no body of the deleted person's own messages), `with` `404`, send `404`; no `Block` row is left; nothing in the body says "block".
- A block made in the middle of a send: the builder's case (the block lands between the check and the charge) is refused, not stored, not charged. The case inside the write is LOW-1.
- From the blocker's side: inbox 0, messages `404`, read `404`, mute `404`, unmute `404`, unread 0, `with` `200` with null conversation and `acceptsMessages` false, send `403 dm_unavailable`.

**N2, the matrix** (all with a receiver who takes messages; "until" is `verifiedUntil`):

| State of the sender | Gate | `fresh()` on it |
|---|---|---|
| approved, until 1 day ago, new ACTIVE plan to +60 days | `201` | moved until to the plan end |
| approved, until 1 day ago, new QUEUED plan from today | `201` | moved |
| approved, until 1 day ago, no plan | `403 verification_required` | unchanged |
| approved, until 1 day ago, only an ENDED plan | `403` | unchanged |
| approved, until 1 day ago, only a CANCELLED_DELETED plan | `403` | unchanged |
| approved, until 100 days ago (past RESUME_DAYS), new plan | `403` (documents again) | unchanged |
| approved, until null, plan | `403` | unchanged |
| rejected, lapsed, plan | `403` | unchanged, status REJECTED |
| pending, lapsed, plan | `403` | unchanged, status PENDING |
| expired, lapsed, plan | `403` | unchanged, status EXPIRED |
| never requested (null), plan | `403` | unchanged, status null |
| rejected, until in the future (stale column), plan | `403` | unchanged |
| approved, running | `201` | unchanged |

In every row the status in the database was the same before and after the send. 50 sends at once from the healing person: a database trigger on `User.verifiedUntil` logged 1 update with 1 old and 1 new value, 50 messages stored. Statements for one send (Postgres log): 33 for a verified sender, 33 again on the second send, 36 for the one that heals (one extra user read, one subscription read, one update), 33 on the next send.

**N6, the shape.** Each message has `id, direction, otherHandle, kind, body, voiceSeconds, sentAt, readAt`; no voice file, no clip id. A person with 5 messages: `directMessagesTruncated` false, 5 rows.

**Money and privacy on this head.** A guest (no token and `X-Guest-Id`) on all 9 routes: `401` both ways. A third person: inbox and unread show nothing of the chat, messages / read / mute / unmute `404 NOT_FOUND`, `with` shows only their own pair; report of the message by the third person or by the sender: `404`, by the receiver `201`. Voice: the sender and the receiver `200` on `/voice-clips/{id}/play`, a third person and a guest `404`; the clip cannot be sent again (`409`). Money at price above 0: the same key twice: one message, one charge (balance moved once, 78 tokens), one `Charge` row; 5 sends plus 6 parallel with one key: 6 messages and 6 committed charges; a failed store: balance back, the charge `REVERSED`; every ledger transaction on the wallet sums to 0 and starting balance plus all entries equals the balance.

**The merge with main.** Counts below, on the whole tree, my specs taken out:
- `npx tsc --noEmit`: exit 0, no output.
- `npx eslint "{src,test}/**/*.ts"` (no `--fix`): exit 0, no output.
- `test/dm` 1 suite, 58 tests, all pass. `test/verify` 1 suite, 46 pass. `test/me` 12 suites, 108 pass. `test/admin` 24 suites, 241 pass. `test/units` 6 suites, 115 pass. `test/talk` 10 suites, 211 pass. `test/mail` 6 suites, 75 pass.
- Full `npm test` (jest, then `test:audio`): exit 0, 104 suites, 1,271 passed, 1 skipped, 1,272 total. The one skipped test is `test/reach/story-cache.spec.ts:293`, `it.skip` unless `STORY_TIMING` is set; the same line is on origin/main.
- No failure anywhere, so there was nothing to compare with origin/main alone.

**The migration `20261114140000_direct_messages`.** Database migrated by `prisma migrate deploy` from origin/main's own `api/prisma` (18 migrations: through `20261114170000_subscription_terms`, with verification and admin money), then filled: 5,000 users, 5,000 settings rows, 5,000 charges, 2,000 reports. Then `migrate deploy` on this head: applied one migration, `20261114140000_direct_messages` (it sorts before `admin_money` and `subscription_terms`, which were already applied; Prisma applied it anyway, no error, `migrate status` says up to date). After: `User`, `Charge`, `Report` row text hash identical to before, `UserSettings` 5,000 rows all with `dmOpen` true, the three tables there. Then DM rows added (2 messages, a conversation, a mute, a `DM_TEXT` charge, a `DM_MESSAGE` report, one person with `dmOpen` false) and the rollback `rollback.down.sql` run four times: with messages: `rollback refused: DmMessage has rows`, nothing changed (counts the same); messages and mute removed: `rollback refused: a direct message charge exists`; charge removed: `rollback refused: a report about a direct message exists`; report removed: it ran (`BEGIN`, drops, `COMMIT`), the three tables and `dmOpen` gone, other tables untouched. Then I deleted the `_prisma_migrations` row and ran `migrate deploy` again: applied again without error (the enum values are `ADD VALUE IF NOT EXISTS`), 5,000 settings rows with `dmOpen` true. Note: my row hash for `UserSettings` after the rollback differs from the one before because I updated one row and the hash I used is order-dependent; the other three tables, which I did not touch, match.

## Proved by runs

Everything in the table and the Detail section above, each by a run I saw: the four-mode comparison and its timing, the edges, the gate matrix, the 50-at-once heal and its single write, the statement counts, the six N7 interleavings with the ledger, the held-lock window for LOW-1, the export at 50,000 / 50,001 / 50,010 with a third-person check, the contract regeneration and code comparison, third person and guest on 9 routes, the voice clip, the money cases, tsc, eslint, every listed folder and the full suite, and the migration with rows, the rollback in four states and the second deploy.

## Read only

`dm.service.ts` (whole), `dm-access.ts`, `dm.controller.ts` (every route has `WawuAuthGuard`, `RateLimitGuard`; `send` goes through `requireWriter` and the idempotency service), `verification.service.ts` (`fresh`, `syncOne`, `targetFor`, `syncAll`), `verified.ts`, the delta of `export.service.ts`, `clips.service.ts`, `posts.service.ts` and the contract sources between b1a6afc and b895eee, `engagement.service.ts` report and appeal branches for `DM_MESSAGE`, `deletion.service.ts` (a purge removes blocks and blanks the person's messages).

## Not proved

- A real race under load for LOW-1: my random stress did not hit it in 40 trials; the held lock proves the window exists, not how often it opens.
- The web side: whether it makes a new key after the `409` of LOW-2; this report is server side only.
- N4 and N5 (left open by the lead's ruling) were not re-run.
- Timing is in process through supertest on one machine, with no network and no TLS; a person would see network noise on top. Equal medians per round show the code paths do not differ by mode, they do not exclude a difference below the noise.
- A `DELETION_PENDING` or deleted *receiver* was compared with the other modes only in the second check; this round covers deletion for the blocker.
- Sends that arrive while a person's plan ends in the very same second (the gate reads once).
- Mail and push on a DM: the module sends none (no call found), so there is nothing to compare for timing or content.
- Production-size data: the migration ran on 5,000 rows per table, the export on about 50,500 messages.
