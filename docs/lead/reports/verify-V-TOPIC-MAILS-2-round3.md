VERDICT: FIX

# Verify V-TOPIC-MAILS-2, third check (code 948af63, merged clean into verify/v-topic-mails-2)

FIRST VERSION (written when the first verdict-changing finding was proved; the full report replaces it).

## H1 (HIGH). A relay fault that starts after the first mail of a run puts EVERY remaining good person on a 24 hour skip, and nobody asks them again when the relay is put right
`api/src/mail/topic-mail.service.ts:~548-575` (refusals after `sent > 0` never stop the run, `pending` is flushed with `long = sent > 0 || relayDeliveredLately`) and `:~346` (`relayDeliveredLately`: ANY MailLog row in the last 6 hours, of any template, counts).
Own relay stand-in, own seeds, C01, 505 people, budget 5000, a tick every minute 07:00-12:00 Lagos:
- Relay answers 200 for the first 100 topic mails, then 404 to C01/C02 only (account mail B11 still goes through and is logged), put right at 09:00 Lagos (2 hours into the window): tick 1 sent 100, refused 405 in one pass; **405 rows of `reason=refused`, 24 hours each; mailed 100 of 505 at the end of the window; the other 405 get no mail that day** (300 ticks: 0 further calls). The relay was healthy again 3 hours before the window closed.
- Relay that fails in turns (404, 200, ...): 200 people: 100 mailed, 100 on 24 h skip, 0 further calls all window.
- Nine 404 then one 200, repeated: 20 of 200 mailed, 180 on 24 h skip.
- First nine refused, then good: 191 mailed, 9 on 24 h skip (the nine are the "bad" ones here, as designed).
So yes: a template fault can put hundreds (here 405 of 505, in proportion thousands) of good people on a 24 hour skip, and for C01 (a daily mail, window 5 hours) a 24 hour skip is the whole day's mail lost for a fault that is not their address. Sign-in mails do not count as "any mail was logged in the last 6 hours" (they are sent by WAWU ID and write no MailLog row in VOICES); account mails (any MailService mail) and the other topic template do.
Should be: after the relay refuses (or a run has refused) many people close together, or after any success again, the refusal should be short (the one-hour row) for everyone not clearly bad, or a person with a 24 h row should be asked once more when a later mail to somebody else in the same window succeeds.

## Closed
N1 (the second check's HIGH) holds: 10 bad first among 500 good, C01 and C02: tick 1 `stopped` 10 calls, tick 2 `done` sent 500; 12 bad among 300, day 1 and day 2, with and without restart: 288 of 288 mailed each day, C01 and C02.

(Rest of the report follows in the full version.)
