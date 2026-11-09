# Verifier report: VOICES bundle F (money), LCH-10 and LCH-12. Tier T2

Branch v/lch-f. Backend abeff18, web 5781c5e. Base origin/main (b18eb26 backend, febaa3d web; both merge clean, git merge-tree).
Verifier: separate session. Nothing committed or pushed. Stand-ins only (Flutterwave fake, Gemini stand-in, no Spaces).

## VERDICT: FIX

No data-loss or double-charge defect found: the ledger, the daily limit, the idempotency and the payments all held under
every attack. The FIX verdict is for one price mismatch the person sees (F1), one privacy/legal gap (F2, F3) and the
weak meaning guard (F4). F5 onward are lows.

## Findings (severity, place, rule broken)

F1 MEDIUM-HIGH. Voice price shown is not the price charged for 30.0 to 30.5 s. web src/features/speak/SpeakScreen.tsx:437
  prices with `Math.ceil(seconds*1000 - 500)`; server api/src/units/units.ledger.ts costOf (POST_VOICE) uses `ms <= 30000`
  with no tolerance. Measured: 30.1 s, 30.3 s, 30.5 s: button says "Send for 78 tokens", server charges 100 (22 tokens more).
  (Free boundary has the +500 on both sides and agrees; the 60 s edge agrees.) Rule: PRICING.md "the price is shown first"; money T2.
F2 MEDIUM. Fix my text keeps the person's corrected text. POST /text/fix goes through IdempotencyService, which stores the
  whole response (fixedText and every from/to) in IdempotencyRecord.responseBody for 24 h; nothing deletes expired rows
  (only a lazy delete on key reuse) and DeletionService never touches the table. Seen in vf_atk: SECRETWORD text in
  IdempotencyRecord, expiresAt +24 h. privacy.md line "used for nothing else" and CLAIMS say nothing about our own copy.
  api/src/textfix/textfix.controller.ts:47, api/src/talk/shared/idempotency.service.ts. Rule: brief attack 4 ("nothing about the text stored beyond what the privacy line says").
F3 MEDIUM. "Voice Units" still in a legal text: docs/legal/privacy.md:44 and web content/legal/privacy.md:44
  ("Unspent Voice Units are lost."). V-36 and the brief: no "Voice Units" in any legal text.
F4 MEDIUM. The meaning guard (api/src/textfix/fix-diff.ts checkFix) lets a flipped meaning through and refuses normal fixes.
  Passed the guard: "I agree..." to "I disagree...", "possible" to "impossible", "legal" to "illegal", "fair" to "unfair",
  "happy" to "unhappy", "trust" to "distrust", "I hate the governor" to "I have the governor", "I support him" to "her",
  "Yes I voted" to "Yet I voted", "He is guilty" to "guilt", "Tinubu is leading" to "bleeding". (Only the NEGATIONS word list and a
  Levenshtein cap of half the word protect against this.) Refused normal fixes (free, 502): "i dont no wat to do", "Me and him was
  late", "Im tired.i will sleep", "pls cm 2 mi hse 2day" (digits), "it cost 500 naira" to "It costs N500". The builder's
  "meaning set" (api/test/talk/text-fix.spec.ts MEANING_SET) is a typo dictionary stand-in checked against itself, so it
  cannot show a meaning change is caught; only 7 hand-written refusals exist. Rule: V-37/LCH-12 "never meaning".
F5 LOW. Edit after paying: a paid message of 1 character (cost 0.03 tokens) can be edited to 150 characters (status 200);
  floor is price_chars (api/src/talk/posts.service.ts, edit path: `paidFor = max(len, price_chars)`). Up to 4.97 tokens
  per message, 20 messages a day. Confirmed by running it.
F6 LOW. Layout: horizontal page overflow at 390 wide (scrollWidth 397) on Write for a person with free posts left and a
  text over 500 characters (the "paid in full" state): .vx-compose, H1 and wrapper reach x=397. Repro: fresh user, type 600 characters.
F7 LOW. Buy screen draws Entry preselected; BuyTokens-390 board has Standard preselected (`picked: 'standard'`). Extra
  note line "You see the full price before you pay..." is not on the board. Subscriptions card is absent (correct, V-38 c).
F8 LOW. Two new curly apostrophes in copy: web WriteScreen.tsx banner "That is today's limit" (curly), and api
  src/admin/config-catalogue.ts "pack's tokens" (admin error). RULES.md bans curly quotes and apostrophes.
F9 LOW. terms.md "Your first 10 posts are free." is now too short: a free post covers 10 s of voice or 500 characters; longer pays in full (V-38 b).
F10 LOW. Data download key `voiceUnitsHistory` (api/src/me/export.service.ts:225) is read by the person; code comments still say Voice Units (harmless).
F11 LOW. 429 DAILY_LIMIT_REACHED also carries Retry-After: 60 and details.retryAfterSeconds 60 (generic filter,
  all-exceptions.filter.ts:91) although resetsAt is hours away. A client that obeys the header retries every minute.
F12 LOW. A whitespace-only change (double space collapsed) is returned as a fix and charged 5 tokens (textfix.service.ts: changes.length>0).
  Terms promise no charge when there is nothing to fix.
F13 LOW. A pre-V-36 SECONDS_30 token now covers any recording up to 60 s (clips.service.ts maxMs = 60 s for token clips; prepaid = no charge).
F14 INFO. Counting is by code point, same file on both sides: emoji 1, flag 2, family emoji 5, "e + combining accent" 2 (NFC "e" 1);
  the same Yoruba/Igbo word typed decomposed costs more than typed precomposed. Same count web and server, as asked; owner may want grapheme counting.
F15 INFO. checkFix is O(n*m): 5,000 chars of one-letter words took 135 ms and ~100 MB transient (after the AI answers; limited to 10 fixes per 10 minutes).
F16 INFO. Guard-refused and no-change fixes cost an AI call and nothing is charged (bounded by the 10 per 10 minutes limit and a balance of 5 tokens). Migrations have no rollback.down.sql (data only, optional). payments.spec comment "paid N6,900 for a N732 pack" is stale.

## Attacks (command / result)

1 Prices. PASS. Real ledger through jest (zz spec, deleted): text 1, 149, 150, 151, 499, 500, 501, 1000, 4999, 5000 =
  0.03, 4.97, 5, 5.03, 16.63, 16.67, 16.7, 33.33, 166.63, 166.67 tokens; 5,001 refused over HTTP (422, nothing charged).
  Voice 300 ms to 30,000 = 78; 30,001 to 60,500 = 100; 60,501 VOICE_TOO_LONG. Pack table: all 7 packs, exact, no bonus,
  books balance ("paymentsMilli 28365000 = ledgerMilli", sum of entries 0). Web text-price.ts byte-identical to the backend
  (diff, sync:shared --check). Free: 10.5 s voice and 500 chars free, 501 chars pays 16.7 and keeps the free post
  (free left 1 after); no abuse found except F5 (edit) and the 30 s display mismatch F1.
2 Charged only on send. PASS. HTTP: closed question (409), 5001 chars (422), blank (422), unknown clip (404), no key (400):
  0 charges, 0 usage counters, balance unchanged. Failed write after charge: reversed once (builder test, re-run, passes).
  Cancelled recording: POST /voice-clips costs nothing. 20 parallel answers (distinct keys): 20 ok, 20 charges, balance minus 20 prices, ledger sum 0.
  10 parallel taps with one key: one charge (builder test, passes).
3 20 a day. PASS. 19 used then 20 parallel HTTP answers: exactly 1 lands, 19 are 429 DAILY_LIMIT_REACHED, never charged. Free posts
  count; a reply is the 20th, the next answer and reply are 429; reactions still free at the limit; fix is not a message
  (works at 20/20). Midnight Lagos over HTTP with the clock moved: 20 sent at 23:59:59.5 Lagos, 21st 429 with resetsAt
  2026-11-09T23:00:00Z, first at 00:00:00 goes. Plain message shown (picture). F11.
4 Fix my text. PARTIAL. Once per Idempotency-Key under 20 parallel (one charge, one AI call), 20 parallel different keys with balance
  for 3: exactly 3 fixes, 3 charges, balance 0, ledger sum 0. Failure (502), guard refusal, no change: balance untouched.
  Rate limit 10 per 10 minutes (builder test passes). Same key with another text: 409. F2, F4, F12, F15.
5 Payments (Flutterwave fake). PASS. Success (every pack), pending (200 PENDING), failed, cancelled (200 FAILED, nothing credited),
  underpay 731.99 (422 PAYMENT_AMOUNT_MISMATCH, nothing credited, later exact payment credits), overpay 1830 vs 183 (credited the
  pack once, overpaidKobo 164700 for a hand refund), two tabs one pack (6 parallel verifies = one credit; unpaid tab 409;
  both paid = 2 credits; reconcile racing verifies = no double), ledgerCheck ok. POST /payments EXTRA_VOICE: 422 for both kinds
  and any shape, no payment row, no Flutterwave init. An old EXTRA_VOICE payment row still credits a token (builder test, passes).
  Migration: applied to a live-shaped DB (old defaults, one admin-edited text price 700, old packs): edited value kept, old packs
  switched off not deleted, tiers config moved, enum TEXT_FIX added.
6 Existing test changes. PASS. Read every diff (api: ops, wf6a, shared1a, shared2, me, talk, media, tokens.int, ledger, wf-payments,
  payments, payments-privacy, feed; web: units-screens, units-format, talk, w4-speak, w5-vote, w6, wf6b, w1-entry, home-redraw).
  Each follows V-36 (name, extra voice gone) or V-38 (prices, 20 a day, 5,000). None weakens a check: values and pack names renamed;
  shared2 "30 posts at once" is now "22: 20 go, 2 get 429" (daily limit); tokens.int swept-token case 409 to 402 plus a new assertion;
  w4-speak lost the ExtraVoice sheet tests with the sheet (V-36); units-screens lost "Buy token" and the pay-method tabs with the board
  (BuyTokens-390 has neither). No test deleted without its feature.
7 Words. FAIL on F3, F8, F10. No "wallet" word on any screen (only an icon name and API route names; "Wallet history" gone), no
  "Voice Units" on a screen, receipt or notification (grep of web src and api src strings), no em-dash or en-dash added, no
  American spellings added, no "Rant".
8 Legal. PARTIAL. terms, refunds, CLAIMS rows match the code (prices, 20 a day, charged on send, reversal, 5 tokens). Gaps: F2 (privacy), F3, F9.
  web content/legal identical to docs/legal (sync check).
9 Pictures. Builder's 9 in /tmp/voices-shots/lch-f/ compared to the board source (the boards need support.js and ds/voices which are not in the repo,
  so I compared to the board HTML text and styles): Buy and Fix match except F7 and the punctuation in the change marks (built strikes "cna,"
  with the comma, board strikes "cna"). Mine in /tmp/voices-shots/vf-lch-f/ (Buy, Wallet, Write typed, Fix result, Fix poor, Daily limit, Daily limit full,
  Long text on free posts, Out of posts; 390 light and dark, Buy and Fix result also 1440). Looked at each of the 390 ones listed. 1440 Buy: the cost list
  in the right column wraps the Text row to 6 lines (cosmetic). F6 seen in the Long text picture.
  Bundle host grep: built with NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:15041/api/v1 and NEXT_PUBLIC_WAWU_ID_BASE=http://127.0.0.1:15042;
  wawuafrica.com appears only in legal HTML/rsc and the share-card display text "voices.wawuafrica.com" (not a call); browser run: 0 requests outside 127.0.0.1.
10 Checks (EXIT lines), fresh database vf_full.
  api: eslint "{src,test}/**/*.ts" EXIT 0 (0 errors, 34 warnings, mostly unused eslint-disable directives, two in files the builder touched);
       tsc --noEmit EXIT 0; jest full run EXIT 0 (65 suites, 774 passed, 1 skipped); test:audio EXIT 0; npm run build EXIT 0.
       contract regen (docs/contract/src/build.py) equals the committed openapi.yaml; web contract copy identical.
  web: npm run lint EXIT 0; typecheck EXIT 0; npm test EXIT 0 (593 passed); npm run build EXIT 0; types regen (openapi-typescript) identical;
       sync:shared --check (VOICES_BACKEND_DIR at my worktree) EXIT 0 "all copies up to date".

## Fix list for the builder
F1 (apply the same 30 s tolerance on both sides, or none), F2 (do not store the fixed text: store only the charge in the replay record,
or purge, and say it in privacy.md), F3, F4 (add prefix-negation and short-swap checks; a real meaning set), then F5 to F13.

# Round 2 (backend 29a9012, web 72c4e3c, main merged in). Verdict: MERGE

Cleaned: worktrees, vf_* databases, Redis db 11, my PIDs (8635, 8638, 8675, 8676). No commits.

## Round 1 must-fix attacks, re-run
F1 FIXED. Web SpeakScreen now calls voicePriceMilli, which is the shared voiceCostMilli(Math.round(s*1000)); web text-price.ts byte-identical to the
  backend copy; the server uses the same function with the same 500 ms grace. 30,501 ms = 100, 30,500 = 78 on both sides (token covers 30.4 s, not 30.501 s: below).
F2 FIXED. Fix result row expires in 9.998 min; cleanup job (every 5 min) deleted it when the clock was moved 11 min; account purge
  deletes the actor's records (deletion.service.ts); after cleanup the same key replays with no second charge (charges stay 1, balance 45000);
  privacy.md says 10 minutes and deletion. Note R2-2.
F3 FIXED. privacy.md (docs/legal and web content/legal) says "Unspent tokens are lost"; no "Voice Units" left on a screen or legal text.
F4 MOSTLY FIXED. See guard attack below. F5 FIXED (a longer edit pays the difference; see below). F6 FIXED (scrollWidth 390 at 600 characters
  with free posts). F7 FIXED (Standard preselected, matches board). F8, F10, F9 (terms now says 10 s / 500 characters) FIXED.
  F11 FIXED (Retry-After 44126 s = until 23:00Z). F12 FIXED (whitespace-only fix: 200, changed false, cost 0).

## Guard attack (api/src/textfix/fix-diff.ts, 10,000-word list, run through checkFix)
Refused correctly (all 45 of these): can/can't, will/won't, do/don't, is/isn't, can/cant, have/havent, should/shouldnt; two/three, twenty/twelve,
  hundred/thousand, ten/tan; Capitalised names (Tinubu/Tinubo), @handles, #tags; he/she, him/them, his/her, we/they; lawful/unlawful, loyal/disloyal,
  wise/unwise, valid/invalid, trust/distrust, trust/mistrust, fair/unfair, able/unable, alive/dead, pro/anti, PDP/APC, won/lost, nobody/somebody, never/ever,
  "not guilty" to "guilty", "i no fit come" to "i fit come", "dem no dey pay us" to "dem dey pay us", a trailing "not". Also through HTTP: "I agree..." to "I disagree..." is 502, nothing charged.
R2-1 LOW, slips through: a lowercase name is judged as a typo: "i support peter obi" to "peter obe" and "vote tinubu" to "vote tinubo" are accepted (the name rule needs a capital letter).
Messy English and Pidgin. FIXED (accepted): "abeg i no fit come" to "Abeg, I no fit come."; "dem dey owe us salary" to "Dem dey owe us salary."; "wetin dey hapen" to
  "wetin dey happen"; "i dey come tomorow"; "no light for 3 days becuase of NEPA"; "the goverment dont care abut us" to "The government doesn't care about us";
  "I has no money"; "she dont like it"; "Their going to lagos"; "i dont no wat to do"; "I recieved teh mony"; "salary neva land since octobar"; "alot of people"; "thier is no light".
  LEFT ALONE: Pidgin words are never rewritten into English by the guard only if the model leaves them (it refuses a rewrite). REFUSED (free, 502): "dem dey owe us salary" to
  "them dey..." or "They are owing us salary"; "wetin dey happen" to "What is happening"; "we are suffering in dis country" ("dis" to "this"); "wat r u doin"; "pls cm 2 mi hse";
  "Me and him was late" to "He and I were late" (person rule); "Im tired.i will sleep"; "us bad" to "badly". Refusals cost nothing.

## F13 (token covers its own length plus 500 ms), tested by me through HTTP with a real 30 s token, clip durations set in the database
15 s: charged 0, token USED. 30.4 s: 0, USED. 30.501 s: 100 tokens, token left RESERVED (swept back to AVAILABLE later, so the person keeps it). 45 s and 60.4 s: 100 tokens, token RESERVED. PASS.
  (If the client still sends extraVoiceTokenId for a clip the token no longer covers, the post is refused 422; the web only sends a covering token.)
F5 by test: "a" paid (0.03), edit to 150 charges 4.97 more, to 300 charges 5 more, shrink to 10 free, regrow charges 4.67; 10 parallel identical edits charge once, ledger zero, edit does not count toward
  the 20 a day. R2-3 LOW: a free 1-character post edited to 500 characters pays 16.64 (the difference from 1 character), though a fresh 500-character post would be free. Conservative, not a leak.

## Merge of bundle B
poll.service.ts differs from main only in the explain text limit (text.max_chars to proposal.max_chars, 500, so 5,000 does not widen What Next? explanations). Contract: regeneration
  (build.py) equals the committed openapi.yaml, nothing of B removed, web contract and generated types identical. B suites pass on this branch (mood.spec, launch-seed, mood-card including turning the card name off, share, vote).

## Pictures
Builder's /tmp/voices-shots/lch-f/ looked at (BuyTokens 390 light/dark, WriteLong, FixTextResult 1440 and others): match the boards (Standard preselected, strikes without the comma). Mine of the merged build:
  /tmp/voices-shots/vf2-lch-f/ (Buy, Wallet, Write, Fix result, Fix poor, Daily limit (and full), Long text on free posts, Out of posts; 390 light and dark, 1440 for Buy and Fix). No request left 127.0.0.1.
  Cosmetic LOW: in the 600-character state the "600 / 5,000" counter sits on top of the last line of text.

## Other lows
R2-2 LOW: privacy says the corrected text is kept "up to 10 minutes", but the cleanup runs every 5 minutes, so a row can live up to about 15. F14, F15, F16 left as info (code-point counting, checkFix cost, no rollback file): accepted.

## EXIT lines (fresh vf_full)
api: eslint EXIT 0 (0 errors, 33 warnings); tsc EXIT 0; jest EXIT 0 (69 suites, 846 passed, 1 skipped); test:audio EXIT 0; build EXIT 0; contract regen identical.
web: lint EXIT 0; typecheck EXIT 0; test EXIT 0 (610 passed); build EXIT 0 (stand-in bases; bundle host grep: only legal text and the share-card display text); types regen identical; sync:shared --check EXIT 0.
