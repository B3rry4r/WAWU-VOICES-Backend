# Claims in the legal text, with proof

Paths are in this repo. "FIX" = true once branch v/privacy-fix is merged (the lead's brief for it); recheck there. DECISIONS = DECISIONS.md. PRICES = docs/contract/PRICES.md. WAWU = /home/user/WAWUAfrica/src/lib/legal/master-agreement.ts (read only).

## Owner gaps (in the markdown, never shown on the page)
terms.md: approval date; company name and address. privacy.md: approval date; payment-record retention under Nigerian law; company name, address and data protection contact. refunds.md: approval date. Total 6.

## Removed on purpose (not true of the code)
- Anonymous posting: the web has no way to post anonymously.
- "Scrambled device fingerprint" and "device type (user agent)": the Device table exists (schema.prisma:477) but no API code writes it (grep prisma.device: only deletion.service.ts:246 deletes). Not claimed. If a task starts writing it, add a line to Privacy.
- Any naira price or exact free count that is config.
- Adverts by the topics you follow: ads.ts picks by the question's topic and your state only.
- Droplet or server backups (only the nightly database copies are claimed).

## Terms
| Claim | Proof |
|---|---|
| Run by WAWUAfrica, contact support@wawuafrica.com | WAWU lines 466, 678 |
| Governing law, word for word | WAWU line 637 |
| Sign in with a WAWU ID | DECISIONS V-2, V-20; api/src/common/auth/wawu-jwt.strategy.ts |
| 18 or older, accept rules and Terms at joining | api/src/me/me.service.ts:304 and :309 (refuses without them); web SignIn.tsx consent line |
| Must finish profile to post | contract createAppeal/post routes: "signed in with a finished profile" (openapi.yaml, appeals ~2084) |
| Reading, listening, liking, sharing always free | PRICES cost.like_share_read_listen_milli = 0 (line 44); DECISIONS V-15 (guests can like) |
| First 5 posts free, then posts cost tokens | PRICES allowance.free_posts (5), DECISIONS V-8, V-38 b, V-46; api/src/units/units.ledger.ts (charge) |
| Votes and reactions cost tokens after the free daily amount | PRICES lines 35, 37 (free_reactions_per_day, free_votes_per_day; cost.vote_milli, cost.reaction_milli); numbers left out because they are config |
| Posting result numbers is free and uses no free post | PRICES cost.result_post_milli = 0 (line 42), V-8 |
| Tokens: count, bought with naira (the naira price is left out of the text: it is config), exactly the tokens paid for, no bonus, no cash value, not sent to others | V-9, V-36; PRICES units.base_rate_kobo=100, packs with bonusMilli 0, units.cashable=false; docs/launch/PRICING.md |
| Text costs 5 tokens per 150 characters in proportion, up to 5,000 characters | PRICING.md; api/src/units/text-price.ts (textCostMilli); PRICES cost.text_post_milli, text.price_chars, text.max_chars |
| Voice costs 78 tokens up to 30 seconds and 100 over 30 up to 60 seconds, at most 60 seconds | PRICING.md; PRICES voice.extra30/60.price_kobo (kobo, 100 kobo = 1 token); api/src/units/units.ledger.ts (costOf) |
| Charged when the message is sent; a cancelled recording costs nothing; a message that fails to send is not charged | api/src/talk/posts.service.ts (spendThen reverses the charge on failure); clips are never charged |
| Up to 20 messages a day, free ones included, day ends at midnight in Lagos; reading, listening, likes, shares and reactions do not count | PRICES allowance.messages_per_day; api/src/units/units.ledger.ts (DAILY_LIMIT_REACHED, lagosDay) |
| Fix my text: spelling, typos and grammar only; you choose to use it; 5 tokens, charged once per request and only when a fix comes back; text sent to the AI provider to be corrected and used for nothing else | V-37; PRICES textfix.cost_milli; api/src/textfix/ (fix-diff.ts meaning guard, textfix.service.ts charge after the fix) ; privacy.md "Who else handles it" |
| Fix my text result kept up to 10 minutes only (a retried request is not charged twice), then deleted; also deleted with the account | api/src/textfix/textfix.service.ts (TEXT_FIX_KEEP_MS), textfix-cleanup.service.ts, api/src/me/deletion.service.ts (idempotencyRecord.deleteMany); tests text-fix.spec |
| First 5 posts free means a voice up to 60 seconds or text up to 500 characters; longer is charged in full and keeps the free post | V-38 b, V-46; PRICES allowance.free_post_text_chars; units.ledger.ts (freeCovers) |
| A longer edit of a paid message pays the difference in proportion | api/src/talk/posts.service.ts (EDIT_TEXT), units.ledger.ts |
| A token bought before the new prices stays and covers one message | V-36; api/src/units/units.payments.ts (existing EXTRA_VOICE payments still credit; no new ones start); api/src/media/clips.service.ts (a held token) |
| Payments via Flutterwave, VOICES confirms them itself | V-11, V-21 |
| Suspension without end date lasts 7 days; banned and suspended can appeal | V-28 |
| Appeal decided by someone who did not take the action (a moderator or an admin who took it is refused) | privacy fix P1 appeals-privacy.spec.ts; contract /appeals openapi.yaml:2076 |
| New text replaces the old on the page (no date shown, so none is claimed) | Last updated line hidden while the date is an owner gap: web/src/features/legal/LegalPage.tsx |
| Blocking hides both, unblock from profile | V-24 |
| News tags: Unverified News or Gossip; only editors and admins mark Verified News | docs/boards/Rules.md rule 4; openapi.yaml EditAnswer/CreateAnswer: "VERIFIED_NEWS needs an editor or admin role" |
| Results: WAWU posts none, people post numbers, Verified or Not verified, photo seen by team only | V-7, V-8 |
| Adverts are labelled with the brand | web/src/components/vx/sponsored.tsx:31, :42 (aria and label); api/src/reach/ads.ts label field |
| Delete: 14 days, then unspent tokens lost | V-16; api/src/me/deletion.service.ts:16 (GRACE_DAYS = 14) and :152 |
| Votes, result totals, payment records stay without your name | deletion.service.ts header comment (votes, ledger, payments kept); result totals FIX |
| Plans: a set number of tokens a month for a set number of months, paid once up front; the app shows each plan, its length, price and monthly tokens (generic wording, no names or prices in the text: the plans are config rows) | api/src/units/units.defaults.ts:252-277 (three plans: CONNECT 3 months, PLUS 6, INFINITY 12; "paid once up front, tokens credited monthly"); api/src/units/units.controller.ts:65-68 (GET subscription-plans); api/src/units/units.payments.ts:136 (kind SUBSCRIPTION through the same checkout) |
| A plan does not renew; no card kept; can buy again when it ends | api/src/units/units.subscriptions.ts:285 (fixed endDay = start plus months), :423-424 (status ENDED only); no charge code in units.subscriptions.ts; the only plan routes are units.controller.ts:65-75 |
| A plan is not refunded once paid, except where the law says it must be; nothing to cancel (OWNER RULING 14 Nov 2026, answer 2) | api/src/units/units.controller.ts:65-75 (no cancel or refund route for a plan); api/src/units/units.payments.ts:741-765 (the only refund path is the by-hand flag on an overpayment) |
| First month's tokens added when the payment is confirmed; later months on the same day of the month, or the last day of a short month | api/src/units/units.subscriptions.ts:114-117 and :291 (monthly credit, clamped; addMonthsClamped at :285); the hourly job in the same file |
| Plan tokens are ordinary tokens, no cash value, unspent ones stay after the plan ends | api/src/units/units.defaults.ts:252 ("unused tokens carry over"); api/src/units/units.subscriptions.ts:423-424 (the end touches the status only, no ledger entry) |
| One plan at a time; token packs still allowed | api/src/units/units.subscriptions.ts:197-209 (SUBSCRIPTION_ACTIVE: "You can still buy token packs.") |
| You pay the price plus VAT plus a payment charge; the app shows Price, VAT, Payment charge, Total; you pay the total; tokens or plan are those of the price (owner confirmed 14 Nov 2026: VAT 7.5%, charge 1.4% never more than 2,000 naira, both on top of the price; no rate is written in the text) | api/src/units/units.charges.ts:34-50 (computeQuote); api/src/units/units.defaults.ts:144-167 (charges.vat_rate_bps 750, charges.fee_rate_bps 140, charges.fee_flat_kobo 0, charges.fee_cap_kobo 200000; still flagged placeholder in code, to be cleared by a later task); api/src/units/units.payments.ts:231 and :279 (the total is stored and charged); web/src/features/units/Plans.tsx:24-25 and ReceiptScreen.tsx:42 (labels) |
| Verification: ask if you have a running plan; send a photo or PDF of a government ID and a utility bill; a WAWU admin checks; tick shows beside your name while the plan runs | api/src/verify/verification.service.ts:40 and :332 (403 subscription_required "Subscribe to get verified."); api/src/verify/sniff.ts (JPEG, PNG, WebP, HEIC, PDF); api/src/verify/verification-admin.controller.ts:28-41 (ADMIN only); api/src/verify/verified.ts:8 (verifiedUntil is the end of the plan chain) |
| The tick means WAWU checked your documents, not what you say | no code ties the tick to what a person says; api/src/talk/views.ts and web/src/features/verify/VerifiedTick.tsx show it beside the name only |
| A verified person can suggest ideas on What Next; the tick ends with the plan; back within 90 days without new documents, after 90 days new documents | api/src/vote/vote.controller.ts:276-277 (requireVerified); api/src/verify/verification.service.ts:25 (RESUME_DAYS = 90) and :150, :200 |
| You can post an answer without your name; others cannot see who wrote it; staff who handle reports can see who; may be told to the authorities where the law requires; Community rules still apply; the same steps (remove, warn, suspend, ban) apply | api/src/talk/posts.service.ts:345 (anonymous stored); api/src/talk/views.ts:127 (author null); api/src/admin/trust/moderation.service.ts:189-199 and :458 (reporter view loads the author and the anonymous flag); web/src/features/talk/AnonymousSwitch.tsx:5 (ANON_NOTE); nothing in the code discloses an identity by itself: any disclosure is by hand |
| Emails: the day's question and the topic of the week, each can be turned off from the link in the email or in Settings; mail about your account | api/src/mail/topic-mail.service.ts:243-262 (C01) and :312-330 (C02); api/src/me/me.service.ts:56-57 (both switches default on); api/src/mail/mail-templates.ts:176-183; api/src/mail/mail.service.ts:247-248 (List-Unsubscribe headers); api/src/mail/mail-unsubscribe.controller.ts:41 and :54 (GET page, POST turns off that kind) |

## Refunds
| Claim | Proof |
|---|---|
| Buy tokens with naira through Flutterwave; price shown first | V-9, V-11; web BuyUnits (prices from API) |
| Tokens do not expire now | PRICES units.expiry_months = 0 |
| Spent tokens not refunded; deleting a post returns no tokens or free post | api/src/talk/posts.service.ts:328 comment "A free post is never given back"; PRICES (deleting never returns one); engagement.service.ts:251 removing a reaction never refunds |
| Unused token stays; used token not refunded | PRICES voice.token_expiry_days = 0; schema.prisma:1466 ExtraVoiceToken |
| Failed recording does not use up the token | api/src/media/clips.service.ts:349-361 (releaseToken on FAILED) |
| Failed or unconfirmed payment: no charge, no tokens | V-11, V-21; payment status flow (schema.prisma:1416) |
| Late confirmation picked up within 72 hours; then by hand | V-23 |
| Tapping Pay twice never makes two payments | Idempotency-Key, docs/contract/CONVENTIONS.md:67; payment unique (userId, idempotencyKey) schema.prisma:1446 |
| Overpay credited once, extra refunded by hand; underpay refused | V-23; schema.prisma:1434 overpaidKobo |
| Unspent tokens lost on deletion, not refunded | V-16 |
| Tokens from a plan are added month by month and then treated like other tokens (spent not refunded, kept ones do not expire) | api/src/units/units.subscriptions.ts:114-117 and :291; api/src/units/units.defaults.ts:252; PRICES units.expiry_months = 0 |
| A plan is not refunded once paid, except where the law says it must be; it does not renew | same evidence as the Terms row of the same name (OWNER RULING 14 Nov 2026) |
| A running plan stops on account deletion; months not yet added are not added | api/src/me/deletion.service.ts:197-200 (plan set to CANCELLED_DELETED in the deletion transaction); api/src/units/units.subscriptions.ts:90 (NO_CREDIT_USER: DELETION_PENDING, DELETED) and :276 |
| Pack, price, VAT, payment charge and total shown before paying; a payment is refused under the total, and over it the pack is credited once and the difference refunded by hand | api/src/units/units.payments.ts:716-723 (want = the stored total; paid < want is a mismatch; overpaid is recorded), :741-765 (flagged for an admin refund) |

## Privacy
| Claim | Proof |
|---|---|
| WAWU ID number and email address kept (the email is kept for the emails, removed when the account is deleted after the 14-day wait); phone number not kept (CORRECTED 14 Nov 2026: the old row said the email was not kept) | api/prisma/schema.prisma:423 (User.mailTo: copied from the WAWU ID token, cleared on deletion); api/src/me/me.service.ts:168-181 and :459 (copied in); api/src/me/deletion.service.ts:471 (mailTo: null); api/src/mail/mail.service.ts:220 and :265 (mail goes to it); api/src/mail/mail-audience.service.ts:32-48 (listed for a bulk send) |
| Phone never stored; one-way code; one account and one vote per phone | V-17; schema.prisma:386 phoneHash; api/src/me/phone.ts (phoneHashOf); votes keep the code: FIX |
| Handle, country, 18+ confirmation, terms time | schema.prisma:392 countryCode, :397-399; me.service.ts:376-377; country chosen on web/src/features/entry/Country.tsx, sent by ProfileSetup.tsx:96 |
| Profile: display name, photo, bio, languages, state, city, topics | schema.prisma:388-395, UserCategory |
| Posts, transcripts, votes, reactions, likes, saves | schema (Answer, Reply, Vote, Reaction, Like, Save, Transcript) |
| Listen counts | schema.prisma:723-724 listenCount, listenThroughCount; web/src/lib/api/talk.ts:84 |
| Which voices you play and how much of each, to rank answers (LISTEN-1) | schema.prisma model AnswerListen and migration 20261109000000_answer_listen; written by api/src/talk/listen-record.ts upsertListen via engagement.service.ts listen(); read only by api/src/feed/ranking.service.ts (the `listeners` count) |
| Nobody else sees it | no route returns it: test/talk/listen.spec.ts "no API response or contract field exposes who listened" (answer and answer-list bodies, and openapi.yaml has no listener field); the admin has no screen for it |
| It is deleted with your account | api/src/me/deletion.service.ts purge() `tx.answerListen.deleteMany`; test/talk/listen.spec.ts "the account purge deletes that person's listen rows" |
| For visitors who are not signed in, 90 days after their last listen | api/src/talk/listen-retention.service.ts purgeGuests (hourly, config privacy.listen_guest_days, default 90; counts from lastAt, the last report); test "guest rows older than 90 days are deleted". A visitor is stored under a keyed hash of a random browser id (listen-record.ts visitorKeyOf), never the id and never an address |
| Your data download includes your listen rows | api/src/me/export.service.ts (`listens`); test "the data export includes the person's own listen rows" |
| Random visitor id cookie, up to a year | web/src/lib/api/visitor.ts (VISITOR_COOKIE, Max-Age 31536000, SameSite=Lax); tests/listen-report.test.ts |
| Reports, decisions, appeals | models Report, ModerationAction, Appeal; moderation.service.ts:454-470 |
| Referral code, who invited you | schema.prisma:401-402, :493 Referral; me.service.ts:393 |
| Invite links: you get a personal link; if you open someone's link, then join and answer, we keep that they invited you (LCH-06) | schema.prisma models Invite and InviteFriend, migration 20261110070000_invites; api/src/me/invite.service.ts (codeOf, claim); test/me/invite.spec.ts "the code", "who counts" |
| The inviter sees the count and each friend's handle; a friend's word only if "Share my word" is on; on unless turned off; off takes effect straight away; nobody else sees it | api/src/me/invite.service.ts friends() (word read at request time from the friend's own mood answer, only when UserSettings.shareMyWord, default true, is on); GET /me/friends is the only route that returns it to another person, for the inviter only (your own data download lists the same friends and words for you); an anonymous answer never counts or shows (lead ruling LC, 9 Nov: NAMED_ANSWER in invite.service.ts; test "anonymous answers"); test/me/invite.spec.ts "Share my word" and "who can read a friend's word" |
| Turn it off in Settings or when you pick your word | api/src/me/dto.ts UpdateSettingsDto.shareMyWord, PATCH /me/settings; web SettingsPage.tsx and MoodPickScreen.tsx (switch "Share my word") |
| Invite code kept in the browser for 30 days, only the code | web/src/lib/invite.ts (INVITE_COOKIE, Max-Age 2592000, first link wins, code only); web/src/app/go/[code]/route.ts; tests/invite.test.ts; the Share my word choice made before sign-in waits in browser storage: web/src/features/mood/share-word.ts |
| Invite links removed on deletion, both ways | api/src/me/deletion.service.ts purge() `tx.inviteFriend.deleteMany` (inviter or friend) and `tx.invite.deleteMany`; test/me/invite.spec.ts "the purge removes the links both ways" |
| Your data download includes your invite code, who you invited and who invited you | api/src/me/export.service.ts (`invites`); test/me/invite.spec.ts "the download holds my invite code" |
| Support message text, topic, payment, optional email, account link | schema.prisma:1170 SupportMessage; api/src/talk/talk.controller.ts:384, engagement.service.ts:629-644 (no web screen yet: API only) |
| Payments keep status, amount, currency, reference, Flutterwave id, charged amount, date, card brand and last 4 | schema.prisma:1416-1440 (method, cardLast4); FIX trims the rest; email sent to Flutterwave (CORRECTED 14 Nov 2026: the "not kept in our records" sentence is gone, because User.mailTo keeps it: see the row above) |
| Share and advert events tied to account or guest id | schema.prisma:1311 ShareEvent, :1546 AdEvent; web/src/lib/api/reach.ts:81, vote.ts:86 |
| Guest id in your browser | web/src/lib/api/feed.ts:14-23 (random id in browser storage) |
| Network address seen to limit abuse | api/src/admin/admin-access.ts:60 (req.ip for a limiter key); not stored |
| Result sheet photo never public, totals only | V-8; api/src/results/results.service.ts (photoFileId); deletion of the photo: FIX |
| Adverts chosen by your state and the topic of the question on screen | api/src/reach/ads.ts:126-131 (categoryId from the question, me.state); NOT the topics you follow |
| No ads on sensitive topics | api/src/reach/ads.ts:88 |
| DigitalOcean, Spaces bucket for recordings, photos, share cards | V-2, V-3 |
| Nightly database copies kept 7 days | infra/backup/backup.sh:2, :12, :37 (BACKUP_KEEP_DAYS default 7) |
| Flutterwave payments | V-11 |
| Gemini: transcripts and weekly draft; handles and phone numbers removed first | api/src/audio-ref/transcribe.ts:3; api/src/reach/weekly-draft.ts:69-73 and :54 (never name or quote a person) |
| 14-day grace, then posts and replies blanked incl. self-deleted | deletion.service.ts:16, :188 and :212 (answers and replies blanked); "including deleted by yourself" and event unlinking: FIX |
| Likes, reactions, saves, blocks, notifications, settings deleted; transcripts wiped; tokens lost | deletion.service.ts:229-262 (likes through transcripts) and :268 (the user row), :152 |
| Recordings, photos, data download files and share images deleted by a regular clean-up; unfinished uploads removed after 24 hours | deletion.service.ts header comment (media housekeeping job) and the DATA_EXPORT and share-card steps in purge(); privacy P2-2 specs purge-exports-cards, purge-export-race, purge-card-race; 24 hours: FIX |
| No advertising or tracking cookies; browser storage list | web/src/lib/auth/session-storage.ts:1 (session); theme-script.ts:5 (theme); lib/api/feed.ts:14 (guest id); lib/auth/entry-draft.ts:6-7 and :64 (sign-up draft, return path); features/talk/lib.tsx:84 and features/units/draft.ts:5 (text drafts, held drafts); features/speak/draft.ts:33-34 (recording drafts, IndexedDB) and :110 (payment pending); features/units/attempt.ts:11 (payment attempts); features/share/ShareActions.tsx:11 (share link opened note) |
| Export data and delete account in Settings | web SettingsPage.tsx (Your data section); POST /me/export, DELETE /me |
| Rights, complaint to authority | WAWU lines 450-466 (user rights); Nigerian law, general |
| Payments also keep the VAT and payment charge; a plan keeps which plan, start and end, and the months credited; these stay without your name after deletion | api/prisma/schema.prisma:1569-1571 (Payment vatKobo, chargeKobo, totalKobo); api/src/units/units.payments.ts:373 and :558; api/src/me/deletion.service.ts:197-200 ("The subscription, its credits and its payment stay as money records") |
| Posts made without your name: the author is still kept, hidden from others, visible to staff who handle reports | api/src/talk/views.ts:127; api/src/admin/trust/moderation.service.ts:458 |
| Verification files: only an ADMIN can open them, through a link that stops after 5 minutes, and each opening is recorded (who and which, never the link) | api/src/verify/verification-admin.controller.ts:28-41 (ADMIN only); api/src/verify/verification.store.ts:16 (DOC_LINK_SECONDS = 300); api/src/verify/verification-admin.service.ts:147-165 (audit row) |
| Verification files: decline keeps them 90 days after the decision; new files after a decline delete the old at once; unsent files deleted after 14 days; plan ending does not change the dates; tick restored within 90 days without files | api/src/verify/verification.service.ts:23-27 (DOCS_KEEP_DAYS 90, RESUME_DAYS 90, DRAFT_KEEP_DAYS 14), :392-425 (replacement deletes the old at once), :526-554 (daily pass) |
| The data download has the verification result, dates and reason, never the files | api/src/me/export.service.ts:199-200 and :271 |
| Emails: the email on your WAWU ID is used for the day's question, the topic of the week and account mail; sent through WAWU ID's mail service; unsubscribe link; each can be turned off in Settings; unsubscribing does not stop account mail; the address is not sold; removed on deletion after the 14-day wait | api/src/mail/topic-mail.service.ts:243-262, :312-330; api/src/mail/mail.service.ts:223 (activeOnly), :247-248, :265; api/src/mail/mail-unsubscribe.controller.ts:41-73; api/src/me/deletion.service.ts:471 |
| Voice recordings may be sent to Gemini to be written down; the recording is not published by it (written "may" because voice to text is off while no key is set) | api/src/audio-ref/transcribe.ts:13-16 (throws when GEMINI_API_KEY is not set) |
| Videos: made only when you ask, of your own voice answer; the question, a moving waveform, captions from the stored transcript, your name only with "Show my name on the card"; only you can see or save it; not published (LCH-07) | api/src/media/voice-video.controller.ts (every route needs the author; POST by anyone else is 403, list and file are 404); api/src/media/voice-video.service.ts request(), list(), file() (author check on every fetch, nothing public); voice-video-render.ts (who is null unless showNameOnCard and not anonymous); test/talk/voice-video.spec.ts "only the answer's author can ask, list or fetch" |
| A video is deleted when its answer is deleted or removed, and when your account is deleted; stored with the recordings in Spaces | api/src/media/voice-video.service.ts sweepGone() (REMOVED, file handed to the storage purge; every fetch also checks the answer is published), storage-purge.service.ts run() and STORED_FILE_REFS; api/src/me/deletion.service.ts purge() (VoiceVideo); object-store.ts putVideo (video/ in the same bucket); test/talk/voice-video.spec.ts "a removed answer's video", "an answer the author deleted", "the deletion purge removes" |
