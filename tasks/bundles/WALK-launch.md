# The full Fable walk before launch (L2e). Lead brief, 9 Nov 2026

Three walkers, Sonnet, each a fresh agent that built none of the launch work. Read-only: no code changes; findings only.
Code: backend and web main AFTER bundle D merges (the lead names the exact heads in your prompt). This is the walk on the
exact code that deploys (WORKFLOW.md, Release). Read `docs/agents/RULES.md`, `docs/WORKFLOW.md`, `docs/launch/LAUNCH-SPEC.md`,
`docs/launch/PRICING.md`, `DECISIONS.md` (V-30 to V-38), `docs/lead/polish.md` (known lows: do not re-report them unless
worse) and `docs/lead/phone-list.md`. Boards: `docs/design/launch/*.dc.html` (render with
`node scripts/design/render-boards.cjs <dir> <Board> --port <yours>`) and the first-plan boards on the canvas.

Each walker runs its own production builds (api and web) against stand-ins only, on its own ports and databases, seeded
with `seed:launch` and realistic data. Every path at 390 light and dark and at 1440, from a cold start and from a refresh.
Every picture looked at, beside its board. Write findings as you go to `/tmp/voices-reports/walk-<letter>.md`: severity
(SERIOUS stops a person or loses money or privacy; MEDIUM wrong but passable; LOW polish), the steps, the picture, the
expected (board, spec or ruling) and the seen. Verdict PASS (no SERIOUS) or FAIL.

## Walker A: the broadcast arrival (guest, new user, voter)
The SMS and email link usevoices.com/go and www.usevoices.com/go (as far as a local stand-in can show the redirect); /go as
a guest; pick a word; listen to voices; type it instead; sign in and come back with the word; sign up as a new person
(onboarding with the landing words); answer the launch question by voice and by text; where you sit (Nigeria and World,
the 50 floor); You're live and the share message; vote on a poll; explain my vote; Home, Discover, search; the busy page
(stop the api: the plain words, no error page); the invited-by line from a friend's link (/go/<code>).

## Walker B: money and sharing (payer, sharer, friend)
Buy tokens (every pack, the payment result on the Flutterwave stand-in, cancelled and failed payments, receipts); the 10
free posts then paid posts (text by length, voice 78 and 100); the 20 a day (Lagos midnight); Fix my text (5 tokens,
once per key, the meaning guard, the result kept 10 minutes); invite links and friends who answered (Share my word on
and off, anonymous answers never shown); the share card (3 sizes, name switch); a voice video (make, wait, ready notice,
share, 5 a day, delete the answer and the video is gone); the data export and account deletion (videos, invites,
friends, cards all gone). Every money attack once more: double taps, two tabs, a replayed payment, the ledger balanced.

## Walker C: the team (moderator, editor, admin, ad manager)
Every admin page as each role (wrong roles refused); moderation and appeals; the launch question and the calendar; the
weekly report draft, approval, publish, and the Instagram pictures download (zip and PNGs beside the boards); adverts;
token corrections; a suspended person's content; the share pages of removed and blocked answers ("We could not find
that").

Hand back in 10 lines: verdict, SERIOUS and MEDIUM findings with steps, counts of paths walked and pictures looked at,
anything NOT RUN with the reason. Clean up your builds, ports and databases.
