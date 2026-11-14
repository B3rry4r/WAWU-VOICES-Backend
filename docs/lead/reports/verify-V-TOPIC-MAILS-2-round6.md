VERDICT: FIX
INTERIM

# V-TOPIC-MAILS-2 round 6: independent check (interim)

Branch `v/topic-mails-2`, head d73d730. It already contains `origin/main` 21fa85a (merge-base is 21fa85a, so main is fully in it). Own Postgres 16 and Redis. The relay was always a local stand-in. No `.env` or key file opened. My attack spec is not committed. No product code or test changed.

## Findings so far, most severe first

### HIGH-1 (still open in a new form). A relay outage after most people were mailed sets good people aside for the day
The lead's ruling: nobody is set aside for the day because of a relay-wide failure. The rule built (`relayLooksUp`, `topic-mail.service.ts:~566`) counts a second trouble when, in the last 30 minutes, at least one send worked and under 40% of sends failed. After a long run of successes the relay still "looks up" for a long time even when it is fully down, so the second trouble of each person counts.
Steps: 200 people (all good), one C01 question, tick every minute from 06:00Z. The relay answers 200 for the first 149 sends, then 500 for everything for 20 ticks, then 200 again for 40 ticks.
- Down 20 ticks after 150 of 200 mailed: **mailed 152 of 200 in the end; 48 good people set aside (TopicMailTrouble.asideAt set) and never mailed that day.** 354 relay calls. Nobody mailed twice.
- 2,100 people, relay down for 60 ticks after 2,000 mailed, then up 30 ticks: **2,046 of 2,100 mailed; 54 set aside.**
- Relay failing about half the requests at random for 60 ticks, 200 people: **192 of 200 mailed; 8 set aside** (the 40% rule does not protect against a 50% failure rate).
The round 6 report only tested an outage when 0 or 50 were already mailed (remaining people too many to go round twice). It owns this as "Not proved", but it is the lead's own case and it loses people their day's mail.
Fix idea: set aside only when the same person fails while the relay took a mail AFTER that person's first trouble (a success in between), or set aside only at the end of the window; or never count a trouble as second when the 5-in-a-row stop fired since their first one.

### Held so far
- Two servers on the same tick plus a restart in the middle of the window, with 5 always-500 people of 200: 195 of 195 good mailed, nobody twice, 5 aside, 220 calls.
- A mail log row already present for a person: that person is not mailed again (0 calls), nobody twice.

## Still to do (full report within the hour)
100,000 people (running), slow relay, named refusals and the brake, 429, unsubscribe, address in logs, C14, migrations and rollback, full suite on branch and on a local merge.
