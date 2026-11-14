VERDICT: FIX

# Verify LAUNCH-MAIL (C14 "VOICES is open")

Checked head: `e3b14c5` (origin/v/legal-lines), as expected. Branch `verify/launch-mail`. Only the C14 mail was checked. I fixed nothing.
Own PostgreSQL 16 (port 54329) and Redis (63791). The relay was a local fake on 127.0.0.1 (same way as `api/test/mail/*.spec.ts`). No live provider, no `.env`, no key files. My attack spec (`api/test/mail/zz-attack.spec.ts`) is not committed.

## Findings (most severe first)

No HIGH. One MEDIUM, three LOW.

### MEDIUM-1. A person whose mail fails once is never mailed again until the server restarts
- File: `api/src/mail/topic-mail.service.ts:484` (`if (run.state === "done") this.launchDone = true;`), with `sendAll` loop ending in "done" at line 435-436.
- What I did: 20 people, the relay answers 500 to one person on all 3 tries (the relay client tries 3 times), fine for everyone else. Then I ran `runLaunchOpen` three times (now, +11 min, +61 min).
- What happened: run 1 = `done, sent 19`. The person's row was given back correctly (19 rows, not 20). But a run that ends with fewer than 5 failures in a row counts as `done`, and that sets `launchDone = true`. Runs 2 and 3 return `done, sent 0` and never look again. The person got no mail. After a simulated restart (`launchDone` reset) the next run sent exactly 1 mail to that person, nobody twice.
- What should happen: M5 says the people left are carried on with. `launchDone` should be set only when nobody is left (no failures in that run), or a run with failures should retry after a wait.
- Way round: restart the API once after the run (the restart picks up the people with no row, and cannot double-mail because of the unique row). Also a short relay blip during the 17 minute run leaves some people out.
- Impact: a few people miss the apology mail. Nobody gets it twice, so not HIGH.

### LOW-1. `tick()` is held for the whole C14 run, so C01/C02 skip ticks meanwhile
- File: `api/src/mail/topic-mail.service.ts:153-156` (C14 awaited inside `tick`, `running` flag stays true).
- Ran: second `tick` started while the first was in C14: it returned `null` (skipped). With 5,000 people at 5 per second the run is about 17 minutes (1,000 s of pacing plus about 23 s of work).
- Effect: only if C14 runs when C01 (07:00-12:00 Lagos) or C02 (from 06:30) is due, for example a late deploy. C01 is then late by up to the run length, but not lost (window to 12:00). At 00:00 Lagos no overlap. Not an issue on the planned launch time.

### LOW-2. C14 and C01 for the same question go to the same people hours apart
- Ran C14 then C01 and C01 then C14 for the same people: both go (by design, M4 asks that C01 still goes to the same people). A person created before launch gets "VOICES is open" at 00:00 and "Today's question" about the same question at 07:00. Product call, not a fault. C14 mails also use the relay's UTC-day cap, which `TOPIC_MAIL_DAILY_MAX` does not count (that is what M4 asks). If C14 runs on the same UTC day as C01/C02 and the relay cap is small, the relay could answer 429 to C01 (C01 then stops for the day). Planned start (23:00Z the day before) is a different UTC day from the 07:00 Lagos C01 (06:00Z), so no clash as planned.

### LOW-3. Wording and cost notes
- A person with no display name is greeted with the handle: `Hello n20x25622,` (both parts). Reads fine, never empty, never `{{...}}`. A name with HTML (`<b>Ev&il</b>`) is escaped in html, plain in text.
- With the relay not configured the run is "stopped" and retried every 10 minutes; each try scans all people twice (the run and the "left" log line). Cheap in practice (9 statements for 5,000 people).

## What passed (no fault found)
- M1 once only: held in all my tests (table).
- M2 audience: ACTIVE, address, daily-mail not off, created strictly before `startsAt`.
- M3 not before open, goes after open, without restart.
- M4 budget and C01 untouched.
- M5 failure and 429 waits: holds (row given back, 5 failures = 10 min wait, 429 = 30 min wait, then the rest).
- M6 off switch and unconfigured relay.
- M7 rendering: subject exact, no dash, no "Rant", no `{{`; footer identical to C01 (diff of both footers is empty).
- M8 cost: after done, a tick does no C14 query.

## Unsubscribe link (plainly)
The C14 mail carries a signed link, kind `dq`. GET gives 200, the one-click POST gives 201. It switches off **`notifyDailyQuestion` (the "daily question emails")** for that person only. It does not touch `notifyWeeklyTopic` (stayed `true`), replies or any other setting. It is the same switch C01 uses, so it also stops tomorrow's C01 for that person. The footer says "unsubscribe from this type of email".

## What I ran
| # | RAN / READ | What | Result |
|---|---|---|---|
| 1 | READ | `topic-mail.service.ts` whole, `mail.service.ts` whole, `mail-render.ts`, `mail-unsubscribe.ts`, templates C14 html/text, diff vs origin/main | as above |
| 2 | RAN | 200 people, two `runLaunchOpen` at once, one service | relay calls 200, max 1 per person, MailLog rows 200, max 1 per person (runs sent 10 and 190) |
| 3 | RAN | 200 people, two service instances at once | relay calls 200, max 1 per person, rows 200 (200 and 0 sent) |
| 4 | RAN | one person fails 3 tries (500), others fine | run `done sent 19`, 19 rows (row given back), runs at +11 min and +61 min `done 0`: person not mailed (MEDIUM-1); after restart 1 sent |
| 5 | RAN | 5 failures in a row (15 relay 500s), then relay works | `stopped sent 0`, 0 rows, next tick `waiting` (no relay calls), run at +11 min `done sent 30`, 30 rows |
| 6 | RAN | relay 429 on 11th call, then works | `capped sent 10`, 10 rows (refused person has none), at +29 min `waiting`, at +31 min `done sent 20`, 30 rows total, nobody twice |
| 7 | RAN | created 1 ms before / at / 1 ms after `startsAt` | only the 1 ms before is mailed (strict "before") |
| 8 | RAN | excluded: DELETED, DELETION_PENDING, SUSPENDED, BANNED, mailTo null, mailTo "", daily mail off | none mailed; weekly-off but daily-on person is mailed |
| 9 | RAN | question not open (22:00Z, 1 ms before start), DRAFT, CLOSED, then open at exactly `startsAt` | 0 calls, 0 rows; at `startsAt` sends 5 of 5 |
| 10 | RAN | `TOPIC_MAIL_DAILY_MAX`=3, 10 people: C01 then C14, and C14 then C01 | C01 sent 3 and stopped at budget; C14 sent 10 both ways; budget left 0 only from C01's 3; C14 not stopped by budget |
| 11 | RAN | `LAUNCH_OPEN_MAIL=OFF` | `off`, 0 calls, 0 rows |
| 12 | RAN | relay not configured, two tries, then configured | `stopped`, `stopped`, 0 rows, 0 calls; once configured and wait over: `done sent 5` |
| 13 | RAN | render for name, no name, blank name, HTML name; unsubscribe GET/POST and settings | see wording and unsubscribe sections |
| 14 | RAN | 5,000 members, one run (pause mocked) | 5,000 sent, 1 relay call each, 5,000 rows, 23 s, about 20,000 SQL statements (about 4 per person); real pacing 5/s adds about 1,000 s |
| 15 | RAN | after done: 10 ticks outside the C01 window | 11 SQL statements in all (C01/C02 only), none over all people, 142 ms |
| 16 | RAN | restart after everyone was mailed | one scan, 9 statements, 0 mails, then `done` |
| 17 | RAN | tick while another tick is in C14 | second tick returns `null` (LOW-1) |
| 18 | RAN | `npx tsc --noEmit` | clean, no output |
| 19 | RAN | `api/test/mail` (7 suites) | 82 of 82 pass |
| 20 | RAN | `api/test/mail/launch-open-mail.spec.ts` x5 | 7 of 7 pass, five times |

Not checked (out of scope): the 5 free posts, the launch line, the legal texts.
