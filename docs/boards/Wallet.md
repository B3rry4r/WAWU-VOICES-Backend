# Wallet (Voice Units)

## 1. Boards
- more/Wallet-390.dc.html (top) | shots/C/Wallet-390-v3.png
- more/Wallet-390-2.dc.html (scrolled to Extra voice, AI Credits, History) | shots/C/Wallet-390-2-v3.png
- more/Wallet-390-dark.dc.html (dark theme, same content as Wallet-390) | shots/C/Wallet-390-dark-v3.png
- more/Wallet-1440.dc.html | shots/C/Wallet-1440.png

## 2. Route
`/wallet`. Buy flow: `/wallet/buy` (BuyUnits.md), `/wallet/paid` (PaymentDone.md).

## 3. Regions
390: header (Back to profile, H1 "Wallet") / balance card (coin, "Your balance", 12.5, "Voice Units", "Get Voice Units", price note) / "Free posts" (dots, note) / "What things cost" (5 rows) / "Extra voice" (2 token cards, note) / "AI Credits: 0" row with "Get" / "History" (5 rows, receipt links) / banner ad / BottomNav (Profile active).
1440: SideNav (Profile active) + top row; main column: balance card (button inline), free posts, Extra voice (2 cards), "History" with "Download statement" and a table (What, When, Units); right aside "Costs": "What things cost", AI Credits block, ad.

## 4. Strings (verbatim)
Back to profile | Wallet | Your balance | 12.5 | Voice Units | Get Voice Units | From ₦138 for 10 units. Units cannot be cashed out or sent to others.
Free posts | 7 free posts left (dots of 10) | 390: Text and voice both count. Deleting a post does not give one back. After these, each post shows its unit cost first. | 1440: Text and voice both count. Deleting a post does not give one back.
What things cost | Text answer or reply: 0.5 unit (₦6.90) | Voice, up to 10 seconds: 1 unit (₦13.80) | Reaction after 20 free a day: 0.1 unit | Vote after 3 free a day: 0.2 unit | Read, listen, like, share: Always free
Extra voice | Talk past 10 seconds. One token covers one message and does not renew. | 390: Up to 30 sec ₦150 One message | Up to 1 min ₦200 One message | 1440: Extra voice, 30 seconds ₦150 One message, up to 30 seconds | Extra voice, 1 minute ₦200 One message, up to 1 minute | Buy token | You can also buy one right when you reach the limit while recording. Your recording waits.
AI Credits: 0 | 390: Optional prompts that help you find your words. Never needed to speak. | Get | 1440: Optional prompts that help you find your words. Bought separately from units, and never needed to speak. | Get AI Credits
History | 1440: Download statement | What | When | Units
Vote, after 3 free | Today, 9:14am | −0.2
Reaction, after 20 free | Today, 8:52am | −0.1
Text answer (390: Yesterday · free post, 7 left; 1440: Text answer (free post, 7 left), Yesterday, 6:40pm) | Free
Extra voice, 1 minute | 28 Nov · used on one message · Receipt (1440: ₦200 by card, 28 Nov, 7:05pm, units "-") | ₦200
Chat pack, ₦345 by card | 27 Nov · Receipt (1440: 27 Nov, 1:12pm) | +26
Ad: Zobo Fresh | Free delivery on your first order | Open | Ad
Shell strings: see README-2. Design bugs: none (no em-dash; "−" is a minus sign). Notes: "AI Credits" and its Get button are V-10; "Chat pack" is the Chat tier (26 units); the ad copy says "Free delivery".

## 5. States drawn
Signed-in, 7 free posts left, 12.5 units, light and dark (dark only on 390). Zero units, low units, all free posts used, empty history, loading, error not drawn.

## 6. Numbers, lists, actions
- Balance 12.5: GET /wallet (balanceMilli 12500; units are thousandths). Free posts 7 of 10: freePostsRemaining, freePostsUsed.
- "From ₦138 for 10 units": GET /units/tiers (minPackKobo 13800; TiersResponse.tiers).
- What things cost rows: GET /wallet or /units/tiers (ActionCosts: textPostMilli 500, voicePostMilli 1000, reactionAfterFreeMilli 100, voteAfterFreeMilli 200, freeVoiceSeconds 10). "(₦6.90)" and "(₦13.80)": GAP (naira per unit derived client-side; no field). "20 free a day" and "3 free a day": Allowances.freeReactionsLeftToday and freeVotesLeftToday give what is left; the daily limits 20 and 3: GAP.
- Extra voice cards (₦150 and ₦200, 30 s and 1 min): TiersResponse.extraVoice (kind, maxSeconds, priceKobo, label) or ActionCosts.extraVoice30Kobo.
- Buy token: POST /payments (kind EXTRA_VOICE, tokenKind); my unused tokens: GET /extra-voice-tokens.
- AI Credits count and Get: GAP (V-10).
- History rows (title, time, delta, free flag, receipt): GET /wallet/history (LedgerItem: title, deltaMilli, free, hasReceipt, paymentId, createdAt). Naira amount on extra voice row (₦200): GAP (LedgerItem has no amount). "free post, 7 left": GAP (no remaining-after field).
- Receipt link: GET /payments/{paymentId}/receipt.
- Download statement: GAP (no statement route).
- Banner ad: GET /ads/placement (WALLET_OFFER or BANNER).

## 7. Where each tap goes
Back: /profile. Get Voice Units: /wallet/buy. Buy token: payment for that token (POST /payments then checkout). Get / Get AI Credits: none at launch. Receipt: receipt view. Download statement: none (GAP). Ad: ad link. BottomNav: Home, Discover, Speak, Profile.
