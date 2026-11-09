# VOICES tasks

Each task is one file here. How a task is built and checked: `docs/WORKFLOW.md` (the Fable workflow):
a Sonnet builder makes it on its own branch, a separate Sonnet verifier attacks it (T2 tasks get the money and privacy
attacks), at most two fix rounds, then the lead runs every check on the joined code, merges and pushes.
Pictures beside the board for every screen touched (390 light and dark, 1440). Stand-ins only for Flutterwave, WAWU ID,
Gemini and Spaces in tests and walks. Rulings: `DECISIONS.md`. What the launch asks for: `docs/launch/LAUNCH-SPEC.md`
and `docs/launch/PRICING.md`.

## Where VOICES stands (7 Nov 2026)
- main 298b4a1: the whole app is built from the 130 approved boards; 36 of the 41 first-plan tasks are done; every test
  passes (724 server, 585 website); the final walks passed.
- Left from the first plan: L3 deploy, L4 one real payment, L5 phone tests (44, in the status page and the lead's
  phone list), L6 launch, L7 first day watched. One last walk on the exact code that goes live.

## New launch tasks (owner's team, 7 Nov 2026)
| Id | Task | Tier | Needs first |
|---|---|---|---|
| REPO-SPLIT | Split into WAWU-VOICES-Web and WAWU-VOICES-Backend (DONE 8 Nov) | T1 | done |
| LCH-14 | Design the launch screens (DRAWN 9 Nov, canvas v42; review) | design | none |
| LCH-01 | Landing words | T0 | none |
| LCH-02 | Launch question with a mood word | T1 | Q1, LCH-14 |
| LCH-04 | Where you sit (Nigeria and World) | T1 | LCH-02 |
| LCH-03 | Personal share card | T1 | LCH-02, LCH-04 |
| LCH-06 | Personal invite links, friends who answered | T2 | LCH-02 |
| LCH-05 | Share is the next step ("You’re live") | T1 | LCH-03, LCH-06 |
| LCH-08 | /go and the usevoices.com address | T1 | Q2 |
| LCH-09 | Ready for a 1-million-person broadcast | T2 | LCH-02, LCH-04 |
| LCH-13 | Weekly report as an Instagram post | T1 | LCH-14 |
| LCH-07 | Share the voice as a short video | T1 | LCH-02 |
| LCH-10 | New token prices and the 20-a-day limit | T2 | Q3, Q4, Q7 |
| LCH-11 | Subscriptions | T2 | Q5, LCH-10 |
| LCH-12 | Paid AI text fix | T1 | Q6, LCH-10 |

Suggested bundles: A = LCH-01 + LCH-08; B = LCH-02 + LCH-04 + LCH-03; C = LCH-06 + LCH-05; D = LCH-09 alone;
E = LCH-13 + LCH-07; F = LCH-10 (+ LCH-12); G = LCH-11.

## Answered (9 Nov 2026)
- Q2 address: usevoices.com (V-35, owner). Q4 name: tokens (V-36, owner). Q6 AI fix: 5 tokens per fix (V-37).
- Lead defaults the owner can overturn (V-38): Q1 site ready 12 Nov, launch question on 15 Nov; Q3 the 10 free posts stay;
  Q5 subscriptions after launch, paid up front, monthly credit, carry over; Q7 pay-as-you-go at launch.

## Still open for the owner
8. The broadcast: in waves (for example 100,000 an hour)? Which droplet size for launch day? (LCH-09 brings the numbers.)
