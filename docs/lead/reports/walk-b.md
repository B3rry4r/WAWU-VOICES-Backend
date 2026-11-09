# Walk B (money and sharing), VOICES launch walk, 9 Nov 2026
Code: backend fc9e6a4, web e457dea (worktrees /home/user/wt/vwb-*). Production builds behind nginx on http://localhost:15026 (use `localhost`: nginx's
default server answers 127.0.0.1 with the www redirect). Stand-ins: WAWU ID, Spaces, Flutterwave, Gemini (mine, /tmp/vwb-run/standin2.mjs). Database vwb_main, Redis db 11.
Seed: seed:questions + seed:launch, then SQL to open the launch question and week 1 today (its real date is 15 Nov).

## Status log
- Stack up; bundle check: no wawuafrica.com / usevoices.com URL in the web build.
- Money API walk (all 7 packs, double taps, two tabs, replay, forged, webhook, cancelled, failed, pending, expired, down): see findings; ledger balanced.

## Verdict: PASS (no SERIOUS found; see MEDIUM/LOW)

## MEDIUM
- M1 Receipt row label says "Units" (ReceiptScreen.tsx:41; /units/receipt/<id> picture b04-receipt-m-light.png). V-36: tokens replace "Units" on every receipt. Also the reference prefix is "VU-" (Voice Units). Expected "Tokens".
- M2 The 10 per 10 minutes Fix my text limit and the payment limit count replays: 4 same-key replays (a double tap) + 1 fix use 5 of 10; a person doing a few retries gets "Too many tries" early. Payment init limit is not atomic (12 parallel inits all 201 with limit 10). Passable.

## LOW
- L1 Share card shows host only ("localhost:15026" / real host), board draws "usevoices.com/go/<code>" (all 3 sizes, card-name-*.png).
- L2 /s/<removed or unknown code> returns HTTP 200 with the "We could not find that" page (API gives 404).
- L3 Answers and share page of a person in the 14-day deletion grace stay public (cards, profile, invite line already hidden); by design V-16.
- L4 After deleting an answer the video is hidden at once (404) and its row and file are swept by the 15 minute storage job; export may list it until then.
- L5 Cancelled return logs a console 409 (known).

## Money attacks (API, production build, stand-in Flutterwave)
All 7 packs: init amount = pack price, tokens = pack, receipt, balance exact. 8 parallel inits one key: 1 payment. Same key other pack: 409. No key 400, guest 401.
Two tabs (two keys): 2 INITIATED rows (known low). 12 parallel verifies: credited once, 1 ledger tx. Replay x3: no change. Victim's transaction id on attacker's payment: refused 409; other person's payment 404.
Underpay, 182.99, USD: 422 nothing credited. Overpay 500 on 183: credited the pack once, 317 recorded for refund. Webhook (forged, replayed, any header): 404 (not served). Cancelled, failed, pending then paid, expired then paid late, Flutterwave down (503 plain words, row FAILED): all right. Same Flutterwave id on a 2nd payment: refused (409 belongs to another payment).
Ledger after about 75 payments: every transaction sums to 0, wallet = sum of entries = last balanceAfter, purchases = succeeded payments, no duplicate providerTxId, global sum 0.
Posts: 10 free posts then 402 FREE_POSTS_EXHAUSTED; text 3/150/300/500/1000/3000/5000 chars = 0.10/5/10/16.67/33.33/100/166.67; 5001 refused; emoji counted once; 501 chars on a free post pays in full; voice 8 s free, 28 s 78, 45/59 s 100, 61 s refused; 6 parallel posts one key: 1 post 1 charge; 20 a day: exactly 3 of 6 parallel at 17 used got through, 429 with Lagos midnight resetsAt (23:00Z).
Fix my text: 5 tokens, once per key (4 parallel replays 1 charge), nothing to fix 0, meaning guard and AI failure 502 0 charge, validation, guest 401, results gone after 10 minutes (cleanup works).
Invites: first link wins, own code ignored, anonymous-only friend not counted or listed, Share my word off hides the word at once and on shows it, deleted answer or block drops the friend. Claim limit 10 a minute works.
Cards: 1200x630, 1080x1920, 1080x1080 drawn; name switch on/off redraws; matches boards. Video: 9x16 and 1x1 READY in 10 s, VIDEO_READY notice, file private/no-store, 6 parallel asks 1 video, 5 builds a day then 429, delete answer hides video.
Export: JSON downloads. Deletion after grace: user tombstoned, answers, clips, videos, invite, friends both ways, share links gone; payments kept anonymous.
Browser: buy screen 4 looks (cold and refresh), double tap Pay = 1 payment, success/cancelled/failed/pending/slow-pending + Check again, receipt, write (free and paid price on button), Fix my text result, out-of-posts, posted/You're live, double tap Post = 1 post. Pictures in /tmp/voices-shots/walk-b.
