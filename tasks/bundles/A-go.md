# Bundle A (go): LCH-01 + LCH-08, plus one before-launch fix. Tier T1. Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/lch-a` in BOTH repos, from origin/main (bundles B and F merged). Read
`docs/agents/RULES.md`, the task files LCH-01 and LCH-08, `docs/launch/LAUNCH-SPEC.md` §1 to §3, DECISIONS V-30 and
V-35, the boards `docs/design/launch/Go-390`, `Landing-390`, `Landing-1440`, and `docs/lead/polish.md` (the BEFORE
LAUNCH line). Resources: ports 15020-15039, Redis db 13, Postgres databases `lcha_*`.
Bundle C (share) is building at the same time on `v/lch-c`: it owns `/go/<code>` (keeps the invite code, then redirects
to `/go`). You own the `/go` page; do not build `/go/<code>`.

## Build
- LCH-01: the landing words on Landing (phone and desktop) and wherever the old headline or intro repeats (page title,
  share metadata), exactly as the boards and LAUNCH-SPEC §1 say.
- LCH-08 /go: the page as Go-390 draws it: the landing words, today’s question card (the launch question with the four
  word buttons opening the pick screen when it is a mood question; otherwise today’s question as Home shows it), “Listen
  as a guest”, “Add your voice”, and the bottom bar. A guest who taps a word and signs up comes back to that pick.
  The invited-by line (“@ada.okafor asked how you feel.”) shows only when bundle C’s stored invite code is present
  (read it the way C stores it; if C is not merged when you hand back, leave the line out and say so).
- LCH-08 address: usevoices.com is VOICES’ address (V-35): PUBLIC_WEB_BASE and every default that names
  voices.wawuafrica.com (api and web), share links and cards, the nginx server_name and certbot domains in `infra/`,
  the env examples, `infra/spaces/cors.xml`, RUNBOOK (DNS, TLS, the WAWU ID allowed-origin paste now
  https://usevoices.com, the Spaces CORS origin), the legal pages’ address mentions (list them for the owner), the
  support email stays support@wawuafrica.com unless a ruling says otherwise. Grep both repos: no
  voices.wawuafrica.com left except in history notes.
- BEFORE LAUNCH: the Fix my text cleanup runs every minute so the privacy line “up to 10 minutes” is true; a test.

## Tests
Landing words (the old strings gone); /go renders for a guest and signed in; a word tap goes to the pick screen and
survives sign-up; no voices.wawuafrica.com anywhere in either built bundle or config; the cleanup interval.
Pictures: Landing and /go at 390 light and dark and 1440 beside the boards, in `/tmp/voices-shots/lch-a/`.
Hand back per `docs/agents/RULES.md`.
