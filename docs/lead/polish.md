# VOICES polish batch (fix batch before the Fable walk). Lead list; each item from a verifier or the lead's own picture look.
## W5 vote (merged 7e5b199)
- Results: "Explain my vote" sits in a card as drawn (Results board).
- WhatNext: "Most challenged" tab (board) if the API can sort by challenges; else a GAP row.
- Vote: the "N free posts left" line the board draws.
- Vote/Results: a poll that opens by its dates while the page is open flips without a reload.
- Stray 404 on first Vote load (trace).
## W7 units (merged)
- Buy at 1440: right rail as drawn (What units pay for + always-free note in the Rail, not below the column).
- PaymentDone success ghost link "Download receipt" (board) not "Receipt".
- Failed state with no receipt number: show a short reference, not the raw voices-<uuid> wrapping at 390.
- PaymentDone 1440 details card grey as drawn.
- OutOfPosts: the sheet over the question page, not an empty page; no focus ring on X at rest.
- Wallet 1440 extra-voice titles "Extra voice, 30 seconds"; Receipt link inline.
- Two tabs on one pack make 2 INITIATED payments (key per tab): low, consider a per-pack key in localStorage.
## vx (SHARED-1c)
- Poll chip says "OPEN POLL" on a closed poll; "1 votes" plural.
## Shell (SHARED-1b part 2)
- /s unknown wording is the builder's default (no board): "We could not find that link".
- Deploy must set VOICES_API_BASE for server-side fetches (reach.ts serverApiOrigin) -> RUNBOOK.
## W9 admin (round 1 queued after SHARED-2 merges)
- CalendarPage QuestionRow.save: send the question's own kind (AdminQuestion.kind) or omit it.
- Fetch lists only after the role gate passes (OverridePage.tsx:81 and others).
- Non-admin page title is not "Admin | VOICES".
- AdsPage.tsx:17 "Wallet offer" -> "Voice Units offer" (V-9).
- Calendar rows: buttons or links with keyboard access, not clickable <tr>.
- Override start/end shown as "Mon 30 Nov, 10:30am" (board) not the native format.
- Board change list (owner/design): Moderation tabs "This is about me" + "Appeals"; ProfileSetup "Your name"; Verified News "Source name".
## W3 talk (after round 2)
- Most Relatable / Most Debated badges; "Read transcript" row (check with a READY transcript); replies indented with a rail at 1440; Thread answer flat at 390 (not a card).
- Report-sent: shield icon, "You will not see their voices or replies." line, over the Question page.
- Posted: WhatsApp Status and Instagram Stories buttons (V-19 more share targets).
- Seed: "Prices, Black Friday and the Empty Wallet" topic title shows "Wallet" to users (V-9 word rule): owner content, ask before changing.
- W3: "1 reactions" plural (Question card, and wherever the count is shown); Question 1440 right rail empty: build as the board draws (Trending / free posts) with the shell Rail slot.
## From SHARED-1c (shell pass part 2 / later)
- Remove the shell-class workarounds left by builders: features/talk/lib.tsx and PostResultPage <style> on .sh-topbar/.sh-bottombar; RailPortal.tsx and results/shared.tsx lookups of .sh-rail (use the shell Rail slot).
- Hand-rolled ClipPlayers in profile, share, news: switch to vx VoicePlayer once its progress prop is live.
- Results: Reply and Report on result comments do nothing (drawn): wire or hide (show only what is built).
- Person/Me Voice Card bars are decorative (vx ProfileHeader): draw them from the clip's real waveform peaks when the voice card has a clip.
- MePage / ProfileHeader unitsHref uses WALLET_LIVE ? "/wallet" : false. Voice Units is built at /units: flip to /units (SHARED-1b part 2, flags).
- Reaction tray sits before the React button in tab order (pre-existing).
## W1 sign-up (merged)
- SignIn at 1440: the backdrop is drawn with the shell (side menu, rail, the voice preview); ours is the bare question page. Draw the backdrop as the board does, or the Home page behind the sheet.
- Topics: alert switches default on for every picked topic; the board shows only the first two on. Check the board's rule.
- Terms, Privacy, Support links: screens not built (show only what is built) -> owner: texts needed for launch? (legal pages)
## POLISH-B additions (lead)
- THEME RULING: device choice wins over the account default (MePage applyTheme must not wipe localStorage voices-theme when the account says system); Settings writes both.
- Profile photo: uploadAvatar calls POST /uploads/{fileId}/complete then PATCH /me/profile avatarFileId; remove AVATAR_UPLOAD_LIVE; works from ProfileSetup (W1) and EditProfile (W6). Test with the local S3 stand-in.
## POLISH-C (after POLISH-B + COLOUR-CALM merge, with the TYPE-AUDIT findings)
- EditProfile 1440: as drawn (white card around photo, handle, place; Voice Card after them; topic chips as drawn).
- Settings 390: rows as drawn. Country (no route to change after sign-up: README-2 gap 3, show only if built), Language (PATCH /me/profile languages: build), Quiet hours (only if the API stores it; else not drawn), Flash polls default off as drawn, Appearance control not drawn on the board: owner call or keep (theme switch has to live somewhere).
- TYPE-AUDIT findings (copy, links, hierarchy).
- LEGAL PAGES: Terms, Privacy, Refunds as the Rules board tabs. Draft from WAWU's own pages (WAWUAfrica src/app/(app)/terms, (app)/privacy, src/app/legal), adapted to VOICES (Voice Units non-cashable, no refunds except overpay V-23, data held, deletion V-16, WAWU ID sign-in). OWNER APPROVES THE TEXT before launch.
- From V-POLISH-B lows: Instagram Stories card is 1200x630 (API card renderer ignores ?size=story: add a 1080x1920 story size in api/src/reach/card-renderer.ts); Report sheet on result posts: in-flight guard; reporting your own result post: plain message, not "could not send".

## Server follow-ups from V-PRIVACY-5 (PRIVACY-3 merged)
- MEDIUM share.service.ts:~377-390 createLink: old-file ids read before the card upsert; two overlapping redraws leave the faster one's image unmarked (live person only; swept at deletion by M1b). Fix: read+reset in one tx, or mark all the link's other unlinked live files after the upsert.
- LOW deletion.service.ts:~330 startsWith share/<code>/ does not escape _ or %. Unreachable today (newCode a-z0-9, 7 chars). Add escape / raw LIKE ESCAPE as a guard.
- LOW: commit a real-store card spec (harness scratchpad/pv5/zz-pv5.spec.ts.txt) if the test harness can host the stand-in.

## From V-STORY-CACHE (merged)
- MEDIUM share.controller.ts:140: the 20/min story limit counts cached hits; carrier NAT users share it. Count only cold draws, or raise (e.g. 60/min).
- MEDIUM: cold story draws are still synchronous on the event loop (20 distinct stalled /health ~1.7 s). Move the resvg render to a worker thread (or a small pool) after launch if traffic shows it.
- DEPLOY NOTE: app-config.ts:15-19 trust proxy = 1 hop (nginx). If a DO load balancer or CDN sits in front of nginx, raise the hop count or every user shares the throttle. App Platform (no nginx): 1 hop is right; re-check on deploy.
- LOW: story Cache-Control public max-age=300 lets caches keep a purged person's PNG up to 5 min (server 404s at once).

## From V-COPY-2 (COPY merged) -> POLISH-C WEB
- Singular at exactly 1: SharePageView.tsx:39 and Onboarding.tsx:77 ("N votes so far"), PostRow.tsx:65 and NewsCard.tsx:122/97 ("N reactions"), aria-labels conversation.tsx:325, PostRow.tsx:69, NewsCard.tsx:122 ("N replies"). Use the plural helper.
- API robustness: me.service.ts:526 files.confirm() HEADs the bucket; an unreachable bucket gives 500 instead of a clear 503/422 (pre-existing).
- Board differences noted (not copy): Home Nigeria chip + chat icon; Share page "Open in app" (no app: "Sign in" stays); Weekly archive "Week N publishes" banner + PDF buttons (PDF not built). Check each against the show-only-what-is-built rule in the Fable walk.

## From V-POLISH-C-WEB (merged) -> WALK-FIX batch
- MEDIUM api media.controller.ts ~224 POST /uploads/:fileId/complete: store.head with no try/catch; bucket down -> 500. Same 503 "Uploads are not available right now. Try again in a minute." as file-attach; web shows it.
- LOW EditProfile 1440 vs board: photo card avatar 96px with hint above the button; preview card as drawn (big avatar, Voice Card player, handle in display type, place).
- LOW Settings 390: back button in a circle as drawn. (Footnote "Lock-screen alerts never show what someone said." NOT drawn: there are no lock-screen alerts at launch.)
- LOW Topics 390: back arrow as drawn.
- LOW Escape closes the reaction tray.

## From V-WF-API-2 (wf-api 35369c1 MERGE, ships only with WF-4's web Undo)
- MEDIUM flash announce: a process death mid-announce leaves the rest unnotified (topics.service.ts:970-1000). Add a periodic re-announce of open flash polls (idempotent via skipDuplicates) or an admin "Send alerts again".
- LOW Undo after day 14 is accepted until the hourly purge runs: refuse after deletionScheduledFor.
- LOW Undo by a person with no account says "This account has already been deleted." (me.service.ts ~225).
- LOW present.ts:22 reads 12 then drops hidden: can show 2 faces when older ones exist.
- LOW listen on an unknown answer id is 204 vs 404 for a hidden one (engagement.service.ts:350): make unknown 404 too.
- DOCS docs/contract/CONVENTIONS.md:134 still says signing in again cancels a deletion.

## From V-WF-5 (merged) -> next fix batch
- LOW moderation.service.ts ~664/~688: RESTORE still allowed on a RESOLVED appeal item (after a Keep, a second moderator can Put it back; two RESTOREs both 200 with two "back up" notices). Refuse any action on a RESOLVED APPEAL-queue item.
- LOW appealedKind (~400): a removed-then-restored post still reads REMOVAL.
- LOW AppealSheet.tsx:50: the sent text shows in the sheet and in the notice row behind it.
- LOW SpeakScreen.tsx 'Extra time' line says 'Your first 10 posts stay free.' to someone with none left (V-WF-6).

## From L2c walker C (PASS) -> post-launch polish unless a walker finds worse
- Today "Voices today" counts replies (card counts answers): use voicesCount rule.
- ModerationPage.tsx:206 says "Voice reply on" for a voice answer.
- Weekly "Languages read: written only" ticked while a voice clip exists.
- Moderation header "OLDEST 16M" stale with 0 open until reload.
- Account appeals: a moderator who decided any earlier appeal of that person cannot decide the suspension appeal, so only an admin can (owner should know; may need a second moderator at launch).
- A suspended ad manager sees "This did not load" + Try again in admin: use the plain suspended words.

## From V-LISTEN-1 round 2 (6 Nov, merged 298b4a1)
- LOW listenThroughCount counts guest finishers too (250 in about a minute from one address). Not shown on any screen
  (no web/src use) and not ranked (LS9). If it is ever shown, count signed-in finishers only.
- LOW a clip of about 2 s or less can be finished by a start plus an immediate claim (the 2 s grace). Signed-in only, one
  per person per answer, so the ranking effect is one listener at most.
- DEPLOY CHECK (L3): from outside the droplet, ports 3000 and 4000 refuse (provision.sh ufw allows only OpenSSH and
  Nginx Full), so the web server and API are reachable only through nginx (RT2 relies on it).

## From L2d walker BC (6 Nov, 298b4a1, PASS)
- LOW N-d1 a rate-limited visitor on a good /s link sees "Link not available". A 429 is not "not found" (RX1): show
  "Too many tries. Wait a moment and try again." with Try again.
- LOW N-d2 weekly "Languages read: written answers only" shows although a voice is among the voices (the Gemini stand-in
  returns no language, so not provable either way here). Re-check on the real Gemini at L3.
- LOW M-2 STILL a console 409 on return from a cancelled checkout (screen right).

## From L2d walker A (6 Nov, 298b4a1, PASS)
- LOW the Voices count still includes a person you just blocked until a reload.
- LOW "Trending" label shows on brand-new voices with no engagement (the 6 h fair-chance floor, as ruled). Proposed: the
  label only when the voice has at least one counted input; the floor still orders it.
- LOW STILL, unruled: A-M4 Voice Card block on Profile setup (built only on Edit profile); Write page "Use voice" switch.
- Coverage note: walker A looked at a sample of the light and 1440 pictures (all script-checked). The walk on the exact
  deploy code (rule 6) looks at every picture.

## From V-LCH-B (9 Nov, bundle B round 1)
- LOW a suspended person's mood card is still served (200). Decide with the general rule for a suspended person's content.
- LOW where you sit counts the person's latest published answer; if it is removed, an earlier one counts (accepted).
- LOW (V-LCH-B round 2) PATCH answers/:id/card resets the stored cards in a second transaction after saving the setting;
  a request in that gap can still get the old card once. Move both into one transaction.

## From V-LCH-F (9 Nov, bundle F round 2, MERGE)
- DONE (bundle A, cleanup every 60 s) BEFORE LAUNCH (legal accuracy): privacy.md says Fix my text results are kept "up to 10 minutes", but the cleanup runs
  every 5 minutes, so a row can live about 15. Run the cleanup every minute (or say 15 minutes). Owner approves the text.
- LOW the meaning guard's name rule needs a capital: "peter obi" to "peter obe", "tinubu" to "tinubo" pass.
- LOW a free 1-character post edited to 500 characters pays 16.64 tokens (the difference rule over a free post).
- LOW the character counter overlaps the text at 600 characters.
- INFO the guard refuses Pidgin-to-English rewrites ("wetin dey happen") at no charge; ordinary Pidgin typos are fixed.

## From V-LCH-C (9 Nov, bundle C round 2, MERGE)
- LOW a claim made while the person's only answer is anonymous is dropped for good and the web forgets the code (only
  reachable by direct API use: the web has no anonymous switch).
- INFO the per-person claim limit lives in process memory: a restart resets it; move it to Redis if the API ever runs
  more than one process.

## From V-LCH-A (9 Nov, bundle A, MERGE)
- In bundle A2: guest Write has no Sign in button (MEDIUM); /join onboarding slide still says "Nigeria is talking";
  www.usevoices.com does not work (the broadcast says usevoices.com/go, people type www).
- LOW dark mode PROUD chip colour sits close to the forest card (readable; board tokens).
- LOW provision.sh copies the nginx site only when missing: a droplet provisioned on the old name keeps the old
  server_name (nothing is provisioned yet). DEPLOY CHECK at L3.
- DEPLOY CHECK the Flutterwave dashboard redirect and webhook URLs, if set there, move to usevoices.com.
- INFO Fix my text: unreadable after 10:00 (expiry checked on replay); the row is deleted by 11:00.

## From V-LCH-A2 (9 Nov, bundle A2, MERGE)
- LOW test/feed/ranking.spec.ts worst latency 189 ms alone against a 200 ms limit: a thin margin that fails when other
  agents' tests run at the same time (248 ms seen). Look at the ranking query before launch-day load (bundle D).
- LOW the invited-by line on /go shows the inviter's handle even if they post only anonymously (the handle is public; they
  chose to share their link). Owner may want a line in privacy.md (listed with the A2 privacy lines).
- INFO the invite lookup limit (60 a minute per address) lives in process memory, like the claim limit.
- INFO docs/boards/Onboarding.md still carries the old slide words (board notes, not code).
- DEPLOY CHECK the www.usevoices.com 301 was proven only by a config spec (no nginx here): check it live at L3.

## From V-LCH-E (9 Nov, bundle E round 2, MERGE)
- LOW sweepGone's lock-free pre-select sits outside its own try/catch (its callers catch it); wrap it too.
- INFO the old deadlock was the sweep racing a test TRUNCATE; with TRUNCATE only the sweep is ever the victim, and tick()
  retries. The periodic sweep is off under NODE_ENV=test for that reason.
- NOT RUN 50 real ffmpeg builds at once (the 50-request queue test uses stubs; 6 real builds timed: a normal request
  peaked at 227 ms). Bundle D measures video builds under launch load.
- PHONE LIST a voice video shared to WhatsApp plays on a real phone.
- OWNER the Instagram slide labels are now THE MOOD, MAIN ARGUMENTS, THE POLL IN FULL, IN THEIR OWN WORDS (the Weekly
  screen's headings) and the closing slide says "Read it all and add your voice" with usevoices.com/weekly.
