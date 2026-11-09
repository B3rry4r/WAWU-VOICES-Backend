# VOICES tasks

Each task is one file here. How a task is built and checked: `docs/WORKFLOW.md` (the Fable workflow): a Sonnet builder
makes it on its own branch, a separate Sonnet verifier attacks it (T2 tasks get the money and privacy attacks), at most
two fix rounds, then the lead runs every check on the joined code (`scripts/lead/fullcheck.sh`), merges and pushes.
When every coding bundle is merged, the full Fable walk (separate walkers, every person's path, every picture looked at)
runs on the exact code, then its fix batch, then deploy. Pictures beside the board for every screen touched (390 light
and dark, 1440). Stand-ins only for Flutterwave, WAWU ID, Gemini and Spaces in tests and walks. Rulings: `DECISIONS.md`.
What the launch asks for: `docs/launch/LAUNCH-SPEC.md` and `docs/launch/PRICING.md`. Timeline: `docs/lead/LOG.md`.

## Track 1: coding (the lead and agents, on the build machine)
| Step | What | State |
|---|---|---|
| First plan | 36 tasks, the whole app from 130 boards | done 7 Nov |
| REPO-SPLIT | Two repos, web stands alone | done 8 Nov |
| LCH-14 | Launch screens drawn (canvas v43) | done 9 Nov, owner and designer to review |
| Bundle B | LCH-02 mood question, LCH-04 where you sit, LCH-03 share card | merged 9 Nov |
| Bundle F | LCH-10 token prices and 20 a day, LCH-12 Fix my text | merged 9 Nov |
| Bundle C | LCH-06 invite links and friends, LCH-05 You're live | merged 9 Nov |
| Bundle A | LCH-01 landing words, LCH-08 /go and usevoices.com | merged 9 Nov |
| Bundle A2 | Follow-ups: www redirect, guest Sign in on Write, onboarding words, invited-by line, contract source | merged 9 Nov |
| Bundle E | LCH-13 weekly Instagram pictures, LCH-07 voice video | merged 9 Nov |
| Bundle D | LCH-09 ready for a 1-million broadcast (load test, numbers for the owner) | built, verifying |
| D one-pass | Voice processing in one ffmpeg pass, the sound unchanged (V-39); joins bundle D before it merges | building |
| Full walk | Fable walk on the exact merged code: guest, new user, poster, voter, sharer, payer, admin | after D |
| Fix batch | What the walk finds, re-checked | after the walk |
| LCH-11 | Subscriptions | after launch (V-38) |

## Track 2: deploy and launch (needs the owner's accounts and word)
| Step | What | Waits on |
|---|---|---|
| L3a | Domain usevoices.com and www pointed at the droplet (DNS) | owner |
| L3b | Droplet, Spaces bucket, keys in the server's env (Flutterwave live, Gemini, WAWU ID) | owner |
| L3c | WAWU ID allowed origin https://usevoices.com (one paste) | owner |
| L3d | Legal text approved (tokens words, free posts, Fix my text 10 minutes, invite and Share my word, anonymous) | owner |
| L3e | Deploy the walked code, TLS for both names, smoke check | L3a to L3d, the fix batch |
| L4 | One real payment | L3e |
| L5 | Phone tests on real phones (`docs/lead/phone-list.md`) | L3e |
| L6 | Launch: the question goes live 15 Nov; broadcast in waves | L4, L5, owner's word |
| L7 | First day watched | L6 |

## Answered (9 Nov 2026)
- Q2 address: usevoices.com (V-35, owner, confirmed again 9 Nov). Q4 name: tokens (V-36, owner). Q6 AI fix: 5 tokens per
  fix (V-37).
- Lead defaults the owner can overturn (V-38): Q1 site ready 12 Nov, launch question on 15 Nov; Q3 the 10 free posts stay;
  Q5 subscriptions after launch, paid up front, monthly credit, carry over; Q7 pay-as-you-go at launch.

## Still open for the owner
- The broadcast and the droplet (numbers in docs/launch/LOAD-REPORT.md): waves of 60,000 every 30 minutes on the planned
  2-CPU, 4 GB droplet (about 9 hours for a million), or a 4-CPU, 8 GB droplet and waves of 120,000 (about 4 hours).
  WAWU ID: can it take about 140 sign-ups a minute (270 on the 4-CPU plan)?
- The deploy items in Track 2 (L3a to L3d).
- Colour: keep the launch colours as drawn, yes or no.
