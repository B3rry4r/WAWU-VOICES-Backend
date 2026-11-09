# Bundle G (the walk's fixes): the fix batch after the full Fable walk. Tier T2. Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/walk-fix` in the repos you change, from origin/main (backend ea55497 or later,
web e457dea). Read `docs/agents/RULES.md`, `tasks/bundles/WALK-launch.md`, the three walk reports
(`docs/lead/reports/walk-a.md`, `walk-b.md`, `walk-c.md`), LAUNCH-SPEC, DECISIONS V-36 and V-40, `docs/lead/polish.md`.
Resources: ports 15000-15019, Redis db 10, Postgres databases `vg_*`. Other agents run on 15020-15059 and 16020-16079.

All three walkers passed (no SERIOUS). These are their mediums and the lows worth fixing before launch.

| # | Finding (walker) | Fix |
|---|---|---|
| G1 | A, low taken for launch day. With the API down or answering busy, pages say "This did not load. Something went wrong on our side." | Where a page or a load fails because the API cannot be reached or answers busy (connection refused, 502, 503, 504, the busy answer from `api/src/common/busy/busy.ts`), the person sees "We are busy. Try again in a minute." (the words of `infra/nginx/busy.html` and the share page). Other errors keep their words. Pictures 390 light and dark, 1440. |
| G2 | C, medium. A result sent to moderation from Posted results shows in the Moderation queue as a raw "Result_review / text" row. | A readable row as the board draws it (the numbers and the place), in the queue and the item view. |
| G3 | C, medium. Suspend on a reported post or answer leaves it public. | Lead ruling V-40: suspending a person from a reported post or answer also takes that post or answer down, as Remove does; a suspension from an account item removes nothing; the Suspend choice says the post comes down; an appeal that wins puts it back as for Remove. Tests for each. |
| G4 | B, medium. The receipt (`ReceiptScreen.tsx`) labels the count "Units" and references start "VU-". | V-36: tokens in every word a person reads, receipts included. Existing references keep working wherever they are looked up; say whether new references change their prefix and why. Grep the web and the API's user-facing strings for any other "Units" or "Voice Units" left. |
| G5 | B, medium. The Fix my text limit (10 in 10 minutes) counts same-key replays, so a double tap uses the budget. | A replay of the same key is answered from the first result and not counted. |
| G6 | B, medium. The payment-start limit is not atomic: 12 parallel starts all got 201 against a limit of 10. | At most the limit gets through under parallel requests (prove with 20 at once). |
| G7 | B, low. The share card's link line shows only the host; the boards draw `usevoices.com/go/<code>`. | As the boards draw it, all three sizes, name on and off; pictures beside the boards. |
| G8 | B and C, low. `/s/<code>` of a removed or unknown answer answers HTTP 200 with the "We could not find that" page. | The same page with HTTP 404 (noindex kept). |
| G9 | A and C, lows. The PROUD chip on /go in dark is nearly the card's colour; onboarding slide 1 at 390 x 844 clips its last line behind the dots; the 1440 onboarding headline is not the landing words; Explain my vote on a mood question asks for the word again; an `http://` advert link passes the "working link" check though the hint says https; the weekly Instagram cover headline leaves one word alone on its last line. | Each as its board, the landing words (LCH-01) and the hint say; tokens only. |

Ruled, no change: a guest cannot type before signing in (A2 item 3: Sign in, then back to Write with the word); answers
stay public during the 14-day deletion grace (V-16, privacy.md); curly quotes in admin copy are the rule (RULES.md);
the Adverts menu stays "Adverts" (the board's "and surveys" is not built, so it is not named).

## Tests and proof
A test for each code row, red on main where behaviour changes. Every existing check EXIT 0 (backend eslint, tsc, build,
the full api suite on a fresh database; web tsc, lint, vitest, build, `sync:shared --check`). Pictures of every screen
you touched at 390 light and dark and 1440, beside its board, in `/tmp/voices-shots/walk-fix/`. Hand back per RULES.md.
