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
| Ma3 | Sender (owner, 12 Nov): WAWU Africa's existing sender and reply-to for now, designed as VOICES; an optional `VOICES_MAIL_FROM` (unset = today's sender) switches it later. | the setting switches the sender with no code change |

## M-b: VOICES notification emails (VOICES API). Branch `v/mail-notices` in this repo.
| # | What | Done when |
|---|---|---|
| Mb1 | `docs/mail/CATALOGUE.md`: all 83 templates, one row each: the VOICES event that sends it (file:line) or "no such event"; account (M-a) or notice (M-b); the words changed to match VOICES and why; sent or kept unsent. | 83 rows, none blank |
| Mb2 | Every B to H template whose event exists is sent from the VOICES API through WAWU ID's mail relay (the way the Hub sends notices), in VOICES' look (the owner's HTML and text, merge fields filled from the system), respecting the template's send limit and the person's notification settings; a failure to send never breaks the action that caused it. | each wired event sends one mail, once, to the right person |
| Mb3 | The VOICES logos served the way WAWU ID serves its own mail header image (owner, 12 Nov: WAWU Africa's setup for now), used by every mail. | images load in a mail |

## Checks
Every existing check EXIT 0 in each repo touched. A rendered picture of every wired mail (HTML at desktop and phone width,
light and dark where the template has both) beside the owner's index.html preview. Never send a real mail from a test.
Hand back in 10 lines with the heads, the catalogue counts (sent, unsent, changed words) and the pictures folder.

## State: M-b builder hand-back (12 Nov 2026)
Branch `v/mail-notices` (API) head 8525a11, from origin/main 165d065. No web change: the owner's 12 Nov ruling replaced "serve /email-assets on the web app".
- Done: Mb1 `docs/mail/CATALOGUE.md` (69 B to H rows: 16 sent, 53 kept unsent; A rows are M-a's). Mb2 16 mails wired: B03, B11, D01 to D04, E01, E02, E04 to E11. Mb3 logo URL is `<WAWU_ID_BASE_URL>/assets/voices-wordmark-white.png` (setting `VOICES_MAIL_ASSET_BASE` overrides); the file is `api/src/mail/assets/voices-wordmark-white.png`.
- How mail reaches the relay: `api/src/mail/mail.service.ts` POSTs `/internal/mail/send` on `WAWU_ID_BASE_URL` with `X-Service-Key: INTERNAL_SERVICE_KEY` and an `Idempotency-Key`, 3 tries on 5xx or network error, never throws; either setting unset means no mail. Sender and reply-to are WAWU ID's (the relay has no from field).
- Address: VOICES had none, so `User.mailTo` (nullable, additive) is copied from the token's email claim on every signed-in request and on sign-up, cleared on account deletion. A person who has not opened the app since this ships has no address and gets nothing until they do.
- Send limits and switches: `MailLog` (new table) makes one mail per event and holds B03 to one per voice per 30 minutes. B03 and B11 obey the Replies switch; money, safety and appeal mail is always on, as the owner's catalogue says.
- SHARED (fenced) changes for the lead: `api/prisma/schema.prisma` (User.mailTo, MailLog, migration 20261112100000_mail_notices), `api/src/app.module.ts` (MailModule import), `api/nest-cli.json` (template assets copied to dist).
- NEEDS WAWU ID (not edited): serve `voices-wordmark-white.png` at `/assets/voices-wordmark-white.png` like `email-header.controller.ts` does for its header (the PNG is in the API branch under `api/src/mail/assets/`). Until then the logo in a mail does not load. Env for the VOICES API droplet: `WAWU_ID_BASE_URL`, `INTERNAL_SERVICE_KEY` (the same service key WAWU ID checks).
- Owner words still open: the legal company line and registered address (the template had `[REGISTERED ADDRESS]`; removed from sent mail), and whether to mass-send C and H groups (they would share WAWU ID's 5,000 a day relay cap with sign-in codes).
- Event exists but not wired this run (see catalogue): B01, B09, B12, C06 (mass), C12 and C13 (inside the T2 money ledger), G01, G04 to G06, G09, H04.
- Pictures: `docs/lead/pictures/M-b/` 64 files (16 mails, desktop 700 and phone 390, light and dark), rendered from the real templates with sample fields. NOT RUN: a side-by-side with the owner's index.html previews.
