VERDICT: FIX

# Verify V-TOPIC-MAILS-2, fourth check (code e81847d, round 4; `git merge origin/v/topic-mails-2` was clean)

Verifier run, 14 Nov 2026. Own PostgreSQL 16 (port 55590) and Redis (56590), both stopped at the end; one throwaway worktree of origin/main for item 8, removed. No live provider, no .env or key file opened. My attack specs (`api/test/mail/zz-v4-attack.spec.ts`, `zz-v4-attack2.spec.ts`, `zz-v4-attack3.spec.ts`, `zz-v4-acct.spec.ts`) are not committed. Relay stand-in on local ports; the clock is passed in (a tick a minute of simulated time, account mail logged every minute where said).

**In one line.** Rulings 2, 4, 6, 7, 8, 9 hold; ruling 3 (your S2) holds; the claim of ruling 5 is false for C02. But ruling 1 is not met: a good person is put on a 24 hour skip by a fault that is not their address in three shapes (relay in turns, nine refused one accepted, a relay that breaks twice in one window), so a person can still lose the day's mail (H1). 

## Round 3 findings and their state

| Round 3 | State | Run |
|---|---|---|
| H1 (fault after first mail puts everybody on 24 h) | **Closed for the template fault (S2)**: 0 rows on 24 h, 505 of 505 mailed. **Open in other shapes**: see H1 below (the 24 h rule is still reachable by a good person) | S2, S3, twice-break |
| M1 (thousands of dead addresses at the head) | Accepted by the lead, not counted | |
| M2 (address kept after deletion) | **Closed**: no address column; rows go at deletion start and in the purge; not in the export | item 4 |
| M3 (corrected address not asked in a running server) | **Closed**: asked on the next tick, C01 and C02, one server and two servers, and after a restart | M3 runs |
| L1, L3, L4 | Accepted | |
| L2 (admin cannot see a stopped run) | **Closed**: fields present, see item 7 | |
| N3, N4 | unchanged, not re-run | |

## Proved by runs (own relay stand-in, own seeds)

### 1. Ruling 1: first refusal is never more than one hour; shapes that put a good person on 24 hours
- **After ONE refusal: never 24 hours.** No shape found. The 24 h row needs a prior row of the same template and address hash that ended in the last 6 h, plus a mail logged for another person after it (`earnedLong`, `topic-mail.service.ts:397`). A row written by a second server at once is not "ended", a corrected address is a new first refusal, ten-in-a-row rows are always one hour (`flush(true)`).
- **A good person on 24 hours through a fault that is not their address: YES, three shapes.** 200 people (505 for the last), C01, a tick a minute, account mail logged each minute:

| Relay | Mailed | Good people on a 24 h row (`again`) | Calls |
|---|---|---|---|
| 404, 200, 404, 200 (in turns) | 150 of 200 | **50** | 300 |
| nine 404 then one 200, repeating | **38 of 200** | **162** (+18 one-hour) | 380 |
| first nine 404, then good | 200 of 200 | 0 | 209 |
| 429 after 30 | 30 (`capped`) | 0 | 31 |
| 500 to all | 0 | 0 (no rows; 300 error lines, 4,500 calls) | 4,500 |
| 505 people: refuses C01/C02 from the 101st mail, put right at 120 min, good 120 to 150, breaks again 150 to 270, good after (C01 window to 22:00 Lagos, 900 ticks) | **500 of 505** | **5** | 1,555 |
| same on C02 (all day) | **500 of 505** | **5** | 1,555 |
| same, second break from 140 to 260 | 500 of 505 | 5 | 1,755 |

  The five of the last rows are the tail group (505 mod 10): a refusal group of ten always gets `stop` rows (one hour), but a group of fewer than ten is evaluated by `earnedLong`; in the second break they are refused a second time with other people mailed between, so 24 hours. They are not mailed at minute 900.
- **Your S2 exactly** (relay refuses C01 and C02 from the 101st mail on, account mail flows, put right 2 hours later, 505 people, no restart), C01 and C02 identical: tick 1 sends 100, 10 refused in a row, `stopped`, **110 calls**; each later tick at most **10 calls** (80 `stopped` ticks in all, 1,315 calls in all, 405 of them after the fix, one each). Rows: 400 `stop` (one hour), 5 `first` (one hour), **0 on 24 hours at any minute**. Mailed 100 at minute 119, 140 at minute 125, **505 at the end of the window**. Holds.

### 2. Ruling 2: ten in a row always end the run
5 mailed, then 10 refused (422): `stopped`, sent 5, **1 error line**, 10 rows all `stop`, until exactly 60.0 minutes. Next tick: `done`, sent 45 (the other people). Second shape (3 mailed, 10 refused, next tick 17 mailed and 15 refused, next 35): each ten stops with its own error line (2 lines), the two tens have `stop` rows, the 5 tail refusals `first`, 55 mailed. Nine refused and one accepted never stops (as ruled, only a sent mail resets).

### 3. Ruling 3: S2 above; S3 above. S1 (second check N1) still holds: the builder's S1 tests pass (below) and my 10-refused-ten-per-tick runs mail all good people.

### 4. Ruling 4: no address in `TopicMailSkip`
- Schema `api/prisma/schema.prisma:1385` and migration `20261114270000_topic_mail_skip_2` (`DROP COLUMN "address"`, `addressHash`, `refusedAt`). Columns after a run: `addressHash, createdAt, id, reason, refusedAt, template, until, userId`; 0 foreign keys. A real row: `{userId "r4-0003", template "C02", reason "first", until, refusedAt, addressHash "4ced7fa5…305c492"}`. Whole row dump contains no `@` and no domain.
- The hash is `HMAC-SHA256(VOICES_PHONE_PEPPER, "topic-mail-skip|" + address)` (`topic-mail.service.ts:61`, same secret as the phone hash; no new setting). I checked the stored value equals that HMAC. **Someone with the database only cannot work the address out** (needs the secret; in production `phonePepper()` throws without it; in dev and test the pepper is a constant in the source, not a production risk). Same address in C01 and C02 gives the same hash (equal rows show it is the same address); the pepper is shared with the phone hash, so one leaked secret serves both (LOW, not a finding on its own).
- A changed address is asked on the next tick in a running server: 0 calls while waiting, address fixed, next tick `sent 1`, new address reached, C01 and C02; after a restart (new service object) also asked at once; two servers: the first to tick mails it once, the second sends 0 (no double).
- **Rows of a person are gone when deletion starts** (DELETE /me: 0 rows) **and after the purge** (a row written after the start, 0 after `purge`). A person set `DELETION_PENDING, mailTo null` after being skipped: no row left. **Not in the account export**: no reference to `topicMailSkip` in `src` except `topic-mail.service.ts` and `deletion.service.ts` (grep), so `export.service.ts` cannot carry it (read; I did not run the real export, it needs storage keys).

### 5. Ruling 5: a real dead address (3 dead among 30, one tick a minute; C01 for 7 days, C02 for 7 days at a tick every 2 minutes)
- **C01:** calls for the 3 dead per day `[6,3,3,3,3,3,3]` = day 1: 2 each, from day 2: **1 a day each**. The claim holds for C01 when the address is bad from the start.
- **C01, one address that turns bad late (first refusal 10:30Z, 11:30 Lagos):** calls per day `[1,2,1,1,1,1,1]`: **day 2 costs 2** (the first refusal's hour ends outside the window, more than 6 h before the next day's mail, so the day-2 refusal is a first one again). Bounded and small (LOW, L5).
- **C02: the claim is false.** Calls for the 3 dead per day **`[6, 48, 51, 51, 51, 51, 51]`**: day 1 is 2 each, but from day 2 each dead address is asked **every 62 minutes all day (about 17 a day, 120 for the topic's week)**. Reason: the second refusal earns 24 hours only when someone else was mailed after the first refusal; once everybody has the week's mail nobody is, so every refusal is `first`, one hour, for ever (M4). With 10 or more dead due together it is the `stop` rows, one hour for ever as well (the builder's own 54 calls on day 1 and 52 on day 2 for 12 dead on C01).

### 6. Many servers (400 people, 12 bad, budget 500, C01 and C02 together, 6 minutes, all servers ticking in parallel each minute)
| Servers | C01 | C02 | Total | Mailed twice | Skip rows | Duplicate (person, template) rows | unique-key/deadlock lines | Calls |
|---|---|---|---|---|---|---|---|---|
| 2 | 388 | 112 | 500 | 0 | 24 | 0 | 0 | 545 |
| 5 | 257 | 243 | 500 | 0 | 24 | 0 | 0 | 570 |
| 10 | 388 | 112 | 500 | 0 | 24 | 0 | 0 | 594 |
Budget 500 kept; C02 under its half (250) while C01's window is open; one row per person and template; `again` 0. Calls on the bad addresses are low in this run (545 to 594 in all).

### 7. Ruling 7: `/admin/today` (HTTP, own run)
Right after a run, `stats.weeklyTopicMailRun`: `done` → `{state:"done", sent:34, refused:0, onSkip:0}`; `stopped` (12 refused, 4 sent) → `{state:"stopped", sent:4, refused:10, onSkip:10}`; `budget` (max 5) → `{state:"budget", sent:5, refused:0, onSkip:0}`. Keys exactly `state,at,sent,refused,onSkip`; no address, no id, no handle (regex `@|r4-` finds nothing). Roles: EDITOR 200, MODERATOR 200, AD_MANAGER 200, a plain person 403, no token 401 (the existing `ops.spec` role matrix passes too). In the contract the fields are optional (`?dailyQuestionMailRun`, `?weeklyTopicMailRun`, `TopicMailRun` with `?state`, `?at`). `state`, `sent`, `refused` are of the answering server, in memory (named by the builder): another server or a restart shows no `state`. A run that returns early (`done` without a scan) does not update them, so after a `budget` run followed by a later pass it shows that later pass (`done`, 29).

### 8. Account and sign-in mail
B11 through `MailService.send`, statuses 422, 404, 400, 401, 403, 410, 429, 500, 503, 200: branch and origin/main **identical**: `failed:1 failed:1 failed:1 failed:1 failed:1 failed:1 capped:1 failed:3 failed:3 sent:1` (outcome:calls); never `refused`; 0 skip rows on the branch. Sign-in mail is outside this code.

### 9. Migration `20261114270000_topic_mail_skip_2`
Database migrated from origin/main (its migrations), then this branch's earlier ones up to `…250000` (old table with `address`), 1 user and 2 skip rows in it: `migrate deploy` applied only `…270000`, "successfully applied"; table 0 rows (old rows deleted by the migration, as written), columns `addressHash, createdAt, id, reason, refusedAt, template, until, userId`, user kept. One new row inserted; `rollback.down.sql`: table 0 rows, columns back to `address, createdAt, id, reason, template, until, userId`, user kept, the `…270000` migrations row gone, the `…250000` row kept; `migrate deploy` again: applied, columns back, 21 rows in `_prisma_migrations`, 21 distinct; `migrate status`: "Database schema is up to date!". The stamp `20261114270000` is unique in the migrations directory and in every remote branch (only `origin/v/topic-mails-2` holds it).

### 10. Spec assertions changed in `948af63..e81847d`
Read every changed line. `budget2` and `relay-trouble` (24 hours to one hour, 9 hours later to 30 minutes later, 24 hours later to one hour later): the new rule only. `topic-mail-skip.spec`: `relay-trouble`/`refused` to `stop`/`first`/`again`; 12 bad day one 12 calls to 54 and 0 to 4 stopped ticks (rules 1+2); "10 bad in a row" now `stopped` sent 40, 1 error line, `stop` rows one hour, next tick 50; "25 bad after a first mail": three ticks instead of one, `again` count 0; "mail logged lately" test now `first` and one hour; fixtures `address` to `addressHash`. Each is the new rule and nothing else; nothing weakened. **No assertion covers the shapes in H1** (the builder's own S3 spec asserts `again: 50` and `again: 162` as expected values, i.e. it asserts the 24 h skip of good people).

### 11. Checks (exact counts, my attack specs excluded)
- `npx tsc --noEmit`: exit 0 (with my specs in the tree it fails on my own spec; removed, 0).
- eslint on `topic-mail.service.ts`, `mail.service.ts`, `today.service.ts`, `deletion.service.ts` and `test/mail/topic-mail*.spec.ts`: exit 0.
- `test/mail` three times: 10 suites, 160 tests, passed 3 of 3 (160/160).
- `admin/ops` and `admin/overrides` (read `/admin/today`): 2 suites, 68 tests passed.
- `test/privacy`, `me/wf2-deletion`, `h6-export-name`, `wf5-undo`: 12 suites, 36 tests passed.
- Full API suite (`jest --runInBand`): **107 suites passed of 107; 1298 passed, 1 skipped, 1299 total.** (Audio node tests not run.)
- Contract: `python3 docs/contract/src/build.py` into a scratch file; `cmp` with `docs/contract/openapi.yaml`: identical.

## New findings

### BLOCKER
None.

### HIGH

**H1. A good person is still put on a 24 hour skip by a relay fault, and loses the day's mail (ruling 1 not met).** `api/src/mail/topic-mail.service.ts:397` (`earnedLong`), `:667` (`flush`), `:754` (stop only for ten in a row).
- What I did: C01, 200 people, relay answering 404 and 200 in turns, then nine 404 and one 200 repeating; and 505 people with a relay that refuses C01/C02 after the 101st mail, is put right at 120 minutes, good for 30, broken again for 120 (also a 20 minute gap). Account mail logged every minute.
- What happened: in turns **50 good people on 24 hours (150 of 200 mailed)**; nine-one **162 on 24 hours, 38 of 200 mailed**; twice-broken **5 of 505 on 24 hours, 500 mailed at minute 900** (C01 and C02 alike; for C01 those five lose the day's question, for C02 a day). Cause: a person refused twice, an hour apart, with any other person mailed in between, is read as "bad address", and a group of fewer than ten refusals is never turned into `stop` rows.
- Should be: no fault of the relay may cost a good person 24 hours. The relay's refusal rate is the evidence the rule lacks: for example 24 hours only when, in the last hour, fewer than a few percent of the asks for that template were refused (or the same person was refused a second time while at least N, say 20, others were mailed in the same hour and the refused were a small share); otherwise one hour. Or no 24 hour row at all and accept hourly asks (C01 window 5 a day per dead address). Your ruling 1 list ("a template fault, a relay that fails in turns, nine refused then one accepted repeated, a relay that is right, breaks for 2 hours, and is right again, twice in one window") is three of four reached, the template fault is closed.
- Is it likely? The same fault types the lead named; "in turns" and "nine in ten" are my stand-ins for a flaky relay, the twice-broken shape is an ordinary two outages in one morning.

### MEDIUM

**M4. A real dead address on C02 is asked about 17 times a day for the whole week (the claim of ruling 5, "1 a day after", is false for C02).** `topic-mail.service.ts:397`-`:430` (`earnedLong` needs another mail logged after the first refusal; on C02 day 2 and later nobody is mailed any more). Run: 3 dead among 30, C02, 7 days, a tick every 2 minutes: calls per day `[6, 48, 51, 51, 51, 51, 51]`, each dead address asked at +62 min, +124, +186 ... all day, every day. With 10 or more dead due together (the `stop` rows) the same on C01 (builder's 52 on day two for 12 dead). Costs relay calls shared with account mail (whether the relay counts refused calls: not proved), not a lost mail. Should be: the evidence for "the address is the fault" should be "others have the mail of this event" (a mail of the same event key to someone else, logged in the last 6 hours or at all), not "mail sent after the refusal"; and the fault-shape rule of H1 must stay satisfied.

### LOW

**L5.** A dead address on C01 whose first refusal comes late in the window (the next ask is outside the window, more than 6 hours later) costs 2 calls on day 2 instead of 1: calls per day `[1,2,1,1,1,1,1]`.
**L6.** `runInfo.state` maps a mid-run `nothing-open` to `done` and is not updated by runs that return early; `state`/`sent`/`refused` exist only on the server that answers (named by the builder, in memory).
**L7.** Many servers ask the bad addresses before another server's row is written (545 to 594 calls for 24 needed in 6 minutes; the builder's four-round run: 36, 93, 186). Harmless, named.

## Read only
`topic-mail.service.ts` in full; the migration and rollback; `deletion.service.ts` (lines 86, 447); `today.service.ts`; `export.service.ts` (no reference to the table); `phone.ts` (pepper handling); the three spec diffs.

## Not proved
A real relay (which statuses it gives, whether refused calls count against its 5,000 a day, whether a real fault looks like my stand-ins); real processes and a real tick timer (one Node process with several service objects over one pool; "restart" is a new service object); a real export file (needs storage keys); the real `VOICES_PHONE_PEPPER` (I cannot see it, so how guessable it is I cannot say); the audio node tests; N3 and the 401/403 noise were not re-run.
