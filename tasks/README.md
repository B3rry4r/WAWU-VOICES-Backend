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
| LCH-14 | Design the launch screens (the designer) | design | none |
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

## Open questions for the owner
1. Launch date: the site was planned for Thu 12 Nov; the launch question is "on the 15th". Is the launch now Sun 15 Nov?
2. Address: usevoices.com/go is in the broadcast. Is usevoices.com the app’s address (instead of voices.wawuafrica.com),
   or does it forward to it?
3. Do the 10 free posts stay, and is the 10-second launch answer free? The price list charges every voice and text.
4. The name people see: "VOICES Tokens" or "Voice Units"?
5. Subscriptions: one payment up front, or monthly? Unused monthly tokens carry over? Refunds?
6. The price of one AI text fix.
7. New prices at launch or after? (Lead: pay-as-you-go at launch if answered by 9 Nov; subscriptions after.)
8. The broadcast: can it go out in waves (for example 100,000 an hour), and what droplet size is approved for launch day?
