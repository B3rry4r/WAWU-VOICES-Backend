# Verifier report: bundle C (share), LCH-06 + LCH-05. Tier T2 (privacy)
Branch v/lch-c: backend d42b105, web 7272910. Verdict: FIX (one privacy defect, small). Everything else holds.

## Findings (ranked)
1. HIGH (privacy) Anonymous answers leak the mood word to the inviter. InviteService.friends() reads the friend's word from
   their latest published mood answer with no `anonymous: false` filter. Probe: friend posts via the real route
   POST /questions/:id/answers {mood:"ANGRY", anonymous:true} (201), claims the inviter's code; inviter GET /me/friends returns
   {handle, displayName, word:"ANGRY"}. The person chose anonymity for that answer; the word is tied back to their identity.
   The web has no anonymous switch today, but the API accepts it and the data download carries the same words.
   Fix: add `anonymous: false` to the answers where-clause in friends() (api/src/me/invite.service.ts), plus a test; an
   anonymous-only friend then shows "Word kept private" (or no word).
2. MEDIUM Claim rate limit is 10 a minute per IP (INVITE_CLAIM_LIMIT, throttler default key = client IP, valid claims count).
   Probe: the 3rd claim from one IP after 8 earlier ones in the minute got 429, and a 429 is swallowed by the web (cookie
   kept, retried only on the next visit to the Posted screen). At the "ask the person next to you" use (venue wifi) or a carrier
   NAT, real friends will be lost silently. Suggest a per-user key or a higher limit; judge before launch broadcast.
3. LOW Non-mood Posted screen is not unchanged: nav.ts adds "/q/*/posted" to FULLSCREEN_PREFIXES, so the tab bar is gone for
   every Posted screen (shot: PostedNonMood-390-light.png). Brief item 6 says unchanged. The boards only draw the mood case.
4. LOW /go/<code> redirects to /go, which is 404 on this branch (the campaign page is bundle A / LCH-08). Merge A with C.
5. LOW Friends WhatsApp text is the builder's default ("How do you feel about Nigeria?\n\nAdd your voice in 10 seconds: <link>"),
   not the spec message. Acceptable, flagged. A friend who shares the word but has no mood answer shows "Word kept private" (label slightly wrong).
6. LOW CLAIMS row says GET /me/friends is the only route that returns the word; the data download (own data) also lists the friends with words
   (same data the inviter sees). Wording only. Stale display fallback "voices.wawuafrica.com" in a card preview string (LCH-08 scope).
7. NOTE a signed-in new account (under 30 days) that opens any link is counted on their next Posted screen with no extra prompt;
   that is the intended design and the Share my word switch is on the pick screen, but worth the owner knowing.

## Attack results (command, result, PASS/FAIL)
1 Privacy. Probe spec against the real app: other person GET /me/friends = count 0; friend themself = 0; no auth = 401; profile of friend 404/no field;
  GET /me/settings only own. grep: shareMyWord/inviteFriend used only in me/ (admin code has no read path). Share my word off: next read word null,
  wordShared false, count stays (no cache: word read per request from answers+settings; no Cache-Control cache layer on the route). PASS except finding 1 (FAIL).
2 Claims. Self-claim 0; claim before answering 0 then counts after answering; two codes: first wins (a=1, b=0); upper case/padded code accepted; account 31 days old not
  counted; 20 parallel claims of 20 different codes by one friend over the real HTTP route: 20x204, 1 row (unique friendId). Rule "under 30 days
  with a published answer": reasonable (stands in for the 30-day cookie). Codes: 7 chars of a-z0-9 from crypto randomInt (~7.8e10); claim always 204
  whether the code exists or not, bad shape also 204 (>32 chars is 422 on length only); /go/<code> never calls the API (no enumeration); throttled (see 2). PASS (note finding 2).
3 Export/purge. The builder's specs "download holds my invite code, who I invited and who invited me" and "purge removes links both ways" pass, and the purge code
  deletes inviteFriend (inviter or friend) and invite in the same transaction; FK cascades both ways as well. PASS.
4 Share screen. Message in the DOM: "I just shared how I feel about Nigeria on VOICES.\n\nI feel HOPEFUL about Nigeria. What about you?\n\nAdd your voice in 10 seconds: <link>" (exact to the task,
  which has the blank lines). WhatsApp: https://wa.me/?text=<encodeURIComponent>. SMS iPhone UA: sms:&body=..., Android: sms:?body=... (smsKindFor); links only, no send on load, external requests
  during the run: none. grep: no contacts API anywhere. QR: drawn in-browser from the link (src/lib/qr.ts, no outside call; unit test decodes the link). Before-50 version and 50+ version both shot.
  No tab bar (page has no bottom nav). Friends screen present. PASS.
5 /go/<code>: 307 to /go, Set-Cookie voices_invite=<code>; Max-Age=2592000 (30 days); first wins (a valid kept code is not replaced; no Set-Cookie); bad code: redirect, no cookie;
  cookie holds only the code; Secure only behind x-forwarded-proto https; upper case lower-cased. End to end in Chrome: /go/ada4k2x, sign in as another person, open Posted: claim fired,
  cookie cleared, inviter sees the new friend and word. PASS.
6 Regression: full api suite includes bundles B and F tests (all pass); web tests pass. Non-mood Posted: see finding 3.
7 Legal: privacy.md lines and the six CLAIMS rows match the code (see 6 for wording nits).
8 Pictures: builder's 12 are in /tmp/voices-shots/lch-c; the board-*.png there are unstyled renders of the .dc.html sources (system font, no tokens), so they
  only prove text and order. My own: /tmp/voices-shots/vc-lch-c/ (YoureLive-390 light/dark, YoureLive-first-390 light/dark, Friends-390 light/dark, PostedNonMood-390-light). I looked
  at them: order is the board's (header, word, where you sit, Send it to 3 people, WhatsApp, SMS/Copy/More, message, note, card, friends row, QR), dark is clean.
9 Checks (EXIT lines), my worktrees, stand-in bases (grep of built bundle for wawuafrica.com / usevoices.com: only Next's own googleapis font constants, the display fallback
  string and legal pages; no service hosts):
  api eslint EXIT 0; tsc EXIT 0; npm test (fresh db vc_suite) 70 suites, 870 passed, 1 skipped, EXIT 0; npm run build EXIT 0.
  web lint EXIT 0; typecheck EXIT 0; npm test EXIT 0; npm run build EXIT 0; sync:shared --check EXIT 0 ("all copies up to date").

## Round 2 (backend 5b41dc8, web 662f983). Verdict: MERGE
Re-run of HIGH: friend posts {mood:"ANGRY", anonymous:true}, claims: inviter's /me/friends count 0, no items (was word ANGRY). FIXED.
Re-run of MEDIUM: per-person limit 10 a minute: 10x204 then 429 with Retry-After: 60 and details.retryAfterSeconds; a second person on the same IP is unaffected (204). Same results in the 20-parallel run (10 pass, rest 429, one row). Per-IP guard now 300 a minute. FIXED. Web retries after Retry-After (3 tries) and on the next load; code kept.
Other angles on the anonymous leak (probe spec, real app, DB edits where no route exists; there is no route that edits an answer to anonymous):
- only anonymous answer: not counted, not listed, no friendship row (claim ignored). PASS
- named older, anonymous newer: word from the named answer (PROUD), count 1. PASS. Anonymous older, named newer: TIRED, count 1. PASS
- named answer later flipped to anonymous, then REMOVED, then deleted: each drops the friend from list AND count at once (count and list use the same countable()). PASS
- export uses the same friends() path, so it hides them too. PASS
- Note (LOW, not blocking): a claim made while the only answer is anonymous is dropped for good, and the web forgets the code on the 204. A later named answer does not bring them in. The web has no anonymous switch, so this only affects direct API use.
Per-person limit is a process-memory Map (cleaned of expired entries when it passes 5000). After an API restart the counters reset, so a person gets at most 10 more tries in that minute; the throttler's per-IP counter is also in memory. On one droplet that is harmless (restarts are rare, the limit is an abuse brake, not a security boundary, and codes are 7.8e10). It would multiply by the number of instances if the API were ever scaled out; then it needs Redis.
Tab bar: browser run (Chrome, 390, stand-ins): ordinary Posted screen shows the bottom bar (Home/Discover/Speak/Profile); the mood Posted screen has none. PASS (R2-Posted-plain/mood-390.png in /tmp/voices-shots/vc-lch-c/). A friend with a word-sharing switch on and no word shows no chip; off shows "Word kept private" (code read, web test).
Regression B and F: full api suite includes their specs, all pass.
Checks, EXIT lines: api eslint 0; tsc 0; npm test (fresh vc2_suite) 70 suites, 875 passed, 1 skipped, EXIT 0; build 0. Web lint 0; typecheck 0; test 0; build 0 (stand-in bases 15060/15061); sync:shared --check 0.
