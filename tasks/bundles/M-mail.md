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
