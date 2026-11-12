# Bundle M (VOICES emails from the owner's 83 templates). Tier T1 (account mails touch sign-in: verifier at T2 for M-a). Lead brief, 12 Nov 2026

Source: the owner's bundle Voices_Email_Templates (html/, text/, Voices_Email_Catalogue.xlsx with trigger, recipient,
subject, preview, sender, send limit and merge fields; assets/ logos). It was written without knowing how VOICES is
built, so nothing in it is taken on trust: every trigger, word, number and link is checked against the code (V-44).
Read `docs/agents/RULES.md`, DECISIONS.md V-20, V-21, V-32, V-35, V-36, V-37, V-44.

Two builders, in parallel:

## M-a: account emails (WAWU ID and VOICES web). Branches `v/mail-account` in wawu-id and wawu-voices-web.
| # | What | Done when |
|---|---|---|
| Ma1 | WAWU ID (additive): an optional `app` ("voices") on register, the email code start, forgot-password and any other account call VOICES makes; a person's sign-up app is remembered (a new nullable column, additive migration). Account mails for a VOICES request (or a VOICES person, where no request names an app) use the A-group templates that match an event WAWU ID really has, in VOICES' look, with VOICES links (https://usevoices.com/...) and VOICES words; WHO MADE THIS mails are byte-identical to today. | a VOICES sign-up gets the VOICES code mail with the 6-digit code; a WMT sign-up's mail is unchanged |
| Ma2 | VOICES web: "Forgot password?" on sign-in, the request page and the reset page at usevoices.com (by the code or link WAWU ID really sends for email, said in the hand-back), and `app: "voices"` on every WAWU ID call. | a VOICES person resets a password without ever seeing the WHO MADE THIS site |
| Ma3 | Sender: `VOICES_MAIL_FROM` (support@usevoices.com once the owner verifies the domain); unset, the current sender with the name VOICES. Reply-to support@usevoices.com. | the setting switches the sender with no code change |

## M-b: VOICES notification emails (VOICES API). Branch `v/mail-notices` in this repo (and wawu-voices-web only to serve `/email-assets/`).
| # | What | Done when |
|---|---|---|
| Mb1 | `docs/mail/CATALOGUE.md`: all 83 templates, one row each: the VOICES event that sends it (file:line) or "no such event"; account (M-a) or notice (M-b); the words changed to match VOICES and why; sent or kept unsent. | 83 rows, none blank |
| Mb2 | Every B to H template whose event exists is sent from the VOICES API through WAWU ID's mail relay (the way the Hub sends notices), in VOICES' look (the owner's HTML and text, merge fields filled from the system), respecting the template's send limit and the person's notification settings; a failure to send never breaks the action that caused it. | each wired event sends one mail, once, to the right person |
| Mb3 | The logos served at usevoices.com/email-assets/ (from the bundle's assets/) and used by every mail. | images load in a mail |

## Checks
Every existing check EXIT 0 in each repo touched. A rendered picture of every wired mail (HTML at desktop and phone width,
light and dark where the template has both) beside the owner's index.html preview. Never send a real mail from a test.
Hand back in 10 lines with the heads, the catalogue counts (sent, unsent, changed words) and the pictures folder.

## State (M-a, builder report, 12 Nov 2026)
Branch `v/mail-account` in all three repos (see heads in the hand-back). Not yet verified (T2: a separate verifier).
- Owner's sender ruling (12 Nov) applied over Ma3: VOICES mails go from the same `MAIL_FROM` as every WAWU ID mail (no reply-to), optional `VOICES_MAIL_FROM` (unset = today's sender), logos from WAWU ID's own `/assets/voices/`, links to usevoices.com. No DNS step.
- Ma1 (WAWU ID, additive): `app: "voices"` on register, email code start and confirm, login, forgot and reset password, change password and the notice route. New nullable `wawu_users.signup_app` (migration `20261112120000_signup_app` with a rollback that refuses to lose data; applied, refused and rolled back on a scratch database). Sent in VOICES' look: A01 welcome, A02 email CODE (6 digits, 5 minutes, no link), A06 reset LINK to usevoices.com, A07 password changed, A08 sign-in alert (every sign-in, no device or place), A10 and A11 deletion notices (WAWU ID side only; the VOICES API call is not wired here).
- WHO MADE THIS mails byte-identical: `src/mail/wmt-golden.spec.ts` holds the sha-256 of 16 mails sent through the mailer and all 16 notices, taken from babfccf before any change; it passes after.
- Ma2 (VOICES web): "Forgot password?" on Sign in, `/forgot-password`, `/reset-password` (the reset email is a link, so the page reads `token` and `email` from it), `app: "voices"` on every WAWU ID call including the token refresh. No board draws these pages: they reuse the Sign in sheet (lead default). One existing test value changes: `tests/w1-entry.test.tsx:315` (the email confirm body now carries `app`). The stand-in gained the two reset routes.
- Ma3: as above; `VOICES_MAIL_FROM` switches the sender with no code change (tested).
- Catalogue rows A01 to A14: `docs/mail/CATALOGUE.md`. Pictures: `docs/lead/pictures/M-a/` (mail: 7 mails x desktop and phone x light and dark = 28; web: 5 screens x 390 and 1440 x light and dark = 20).
- For the lead: (1) A10, A11 need the VOICES API to call `POST /internal/mail/notice` with `app: "voices"` (kinds `account_deletion_started`, `account_deleted`) from `deletion.service.ts:40` and `:441`: that is `v/mail-notices`. (2) The WHO MADE THIS email-code mail says "10 minutes" while the code lives 5: left alone to stay byte-identical. (3) Web `nav.ts` CHROMELESS_PREFIXES gained the two new routes (a shared shell file). (4) WAWU ID's prisma client was regenerated in the shared `node_modules` (one added nullable field, harmless to the main clone). (5) Footer: the registered-address line is dropped until the owner gives the address.
