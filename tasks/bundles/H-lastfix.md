# Bundle H (the last walk's fixes). Tier T1, with the arrival path walked again by the verifier. Lead brief, 10 Nov 2026

Builder: one Sonnet agent. Branches `v/last-fix` in the repos you change, from origin/main (backend 2c3da2a or later,
web cefd824). Read `docs/agents/RULES.md`, `tasks/bundles/WALK-launch.md`, the last walk's reports
(`docs/lead/reports/last-walk-a.md`, `last-walk-b.md`, `last-walk-c.md`), LAUNCH-SPEC, DECISIONS V-36 and V-40,
`docs/lead/polish.md`. Resources: ports 15000-15019, Redis db 10, Postgres databases `vh_*`. Others use 16020-16059.

The last walk: B and C passed, A failed on one SERIOUS. These are its findings and the lows worth fixing before launch.

| # | Finding (walker) | Fix |
|---|---|---|
| H1 | SERIOUS (A). Search crashes on submit: /search, type "prices", Enter: "Application error: a client-side exception" (TypeError reading 'totals'), guest and signed in, every size. `SearchScreen.tsx` keeps a "ready" state with a null result from the empty query for one render after the query changes; `Results` reads `r.totals`. Opening /search?q=... directly works. | No render ever reads a result that is not there; a test that types a query and submits (red on main), and the same in a browser on a production build. Grep the web for the same pattern (a status set apart from its data) and say what you found. |
| H2 | MEDIUM (A). Explain my vote fails on the real launch-week data: the week 1 poll is a WEEKLY poll with no question of its own and the launch question is slot 4; the web shows the launch question's four words, the API posts the reason to slot 1, which has no words, so the mood is refused (422 "Some details need fixing"). The first walk used a hand-made poll. | On `seed:launch` data, a voter explains their vote in words, with and without an answer of their own, and it posts under the question whose words they were shown. Say how a weekly poll's reason finds its question, with a test on seed:launch-shaped data. |
| H3 | MEDIUM (B). The Delete account sheet (`DeletionPending.tsx`) reads "...unspent tokens are gone. tokens are never paid back as cash." and opens with "Your account is set to be deleted" before the person has confirmed. | Sentence case, no repeat, and the words before confirming say what will happen, not that it has; the words match `docs/legal/terms.md` and CLAIMS.md. |
| H4 | LOW taken as MEDIUM by the lead (B). A new share card answers 202 with an empty body for about 2 s, so WhatsApp or a link preview that fetches the og:image at once gets no picture (and keeps that). | The first fetch of a card's image always gets a picture (render it before the link is handed out, or have the image route wait for the render; your choice, say why); a test of the first fetch. |
| H5 | LOW taken as MEDIUM by the lead (C). The weekly report only warns when a theme has fewer voices than `weekly.min_group_size` (20), so an editor can publish groups too small to stay anonymous; and after publishing, the page still says "Weekly report approval" and "AI DRAFT, EDIT BEFORE PUBLISHING". | Approve and publish are refused, with the reason, while any theme is under the minimum; after publishing the page says it is published. Tests. |
| H6 | Lows (A, B, C). A word tapped on /go in the first second after load does nothing; /p/<handle> with the API down or busy has the heading "We could not load this" (the busy words only under it); the payment-done page at 1440 says "Receipt" where 390 says "Download receipt"; the VIDEO_READY notice says only "Open it to read more."; the export download has no file name; POST /payments without a returnPath falls back to /wallet/paid, a 404; a removed answer's card answers 200 with a plain question card where /story and /square answer 404; a result sent to moderation still shows "to check" in Posted results; Home still offers Speak after the person answered. | Each as its board, the spec and the other pages do. |

Not changing: an export lists the person's own friends' handles (their own relationships); G8 (polish); the suggested
handle when the first name is taken (polish, with the walker's note).

## Tests and proof
A test for each code row, red on main where behaviour changes. H1 and H2 also in a browser on production builds with
`seed:launch` data. Every existing check EXIT 0 (backend eslint, tsc, build, the full api suite on a fresh database; web
tsc, lint, vitest, build, `sync:shared --check`). Pictures of every touched screen at 390 light and dark and 1440, beside
its board, in `/tmp/voices-shots/last-fix/`. Hand back per RULES.md.
