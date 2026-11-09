# Bundle A2 (follow-up): before-launch fixes. Tier T1. Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/lch-a2` in the repos you change, from origin/main (bundles A, B, C, F merged).
Read `docs/agents/RULES.md`, the verifier reports `docs/lead/reports/v-lch-a.md` and `v-lch-c-round2.md`, LAUNCH-SPEC §1
to §3 and §7, DECISIONS V-35, the boards Go-390 and Landing-390. Resources: ports 15020-15039, Redis db 13, Postgres
databases `lcha2_*`. Bundle E (media) is building at the same time on 15000-15019 and db 12.

## Fix
1. CONTRACT SOURCE (must): bundle C added /me/invite, /me/invite/claim, /me/friends and the schemas MyInvite,
   ClaimInviteRequest, Friend, FriendsPage to `docs/contract/openapi.yaml` by hand, not to `docs/contract/src`
   (routes.py, schemas.py). Add them to the source so `python3 docs/contract/src/build.py <out>` regenerates the
   current `openapi.yaml` byte-identical (descriptions included). Prove it with the diff (no output).
2. www.usevoices.com: works and redirects to https://usevoices.com with the path kept (nginx server_name for both,
   certbot for both names, a 301 from www); RUNBOOK DNS step adds the www record. A test or a config check.
3. A guest on Write (“Type it instead” from /go at 390) sees a Sign in button with the plain words, returning to the
   same Write screen with the word kept after sign-in, the way Record does.
4. The /join onboarding slide still says “Nigeria is talking”: the landing words there too (LAUNCH-SPEC §1).
5. The invited-by line on /go (Go-390: “@ada.okafor asked how you feel.” with the inviter’s avatar): read the stored
   invite code (bundle C’s cookie) and show the inviter’s handle only; a public route that turns a code into the handle
   only (no other data), rate limited, a bad code shows no line. Privacy line if needed (list it for the owner).

## Tests
The contract regenerates identical; www redirect config; the guest Write path end to end; the onboarding slide words;
the invited-by line (good code, bad code, rate limit, only the handle returned).
Pictures: /go with the invited-by line, the guest Write screen, at 390 light and dark, in `/tmp/voices-shots/lch-a2/`.
Hand back per `docs/agents/RULES.md`.
