# BuyUnits (Get Voice Units)

## 1. Boards
- more/BuyUnits-390.dc.html | shots/C/BuyUnits-390-v3.png (Buzz pack selected)
- more/BuyUnits-390-2.dc.html (same content, scrolled to Extra voice) | shots/C/BuyUnits-390-2-v3.png
- more/BuyUnits-1440.dc.html | shots/C/BuyUnits-1440.png (Loud pack selected)

## 2. Route
`/wallet/buy` (proposed). Full-screen task on phone (no bottom bar). Also opens as a sheet from Speak when out of free posts (paywall variant, see 5).

## 3. Regions
390: header (Back to wallet, H1 "Get Voice Units", units chip) / BuyUnitsSheet inline: 6 pack cards, "Pay with" segmented control, Offer line, Pay button, fine print / "Extra voice" (lead, 2 token rows with price buttons, note).
1440: SideNav (Profile active) + top row; back link "Wallet"; BuyUnitsSheet as a dialog card with the balance subtitle; "Extra voice" section; right aside "What units pay for" with 4 cost rows and an info banner.

## 4. Strings (verbatim)
Back to wallet | Get Voice Units | 12.5 units (chip; 1440: subtitle "Balance: 12.5 units")
Pack cards (name, units, price, per unit, bonus): Spark 10 units ₦138 ₦13.80 a unit | Chat 26 units ₦345 ₦13.27 a unit +1 bonus | Buzz 55 units ₦690 ₦12.55 a unit +5 bonus | Loud 115 units ₦1,380 ₦12.00 a unit +15 bonus | Mega 310 units ₦3,450 ₦11.13 a unit +60 bonus | Boss 650 units ₦6,900 ₦10.62 a unit +150 bonus (units shown as the design system draws them)
Pay with | Card | Transfer | USSD | Payment method | Unit packs
Offer | Top up through our bank partner and get 5 extra units.
Pay ₦690 for 55 units (1440: Pay ₦1,380 for 115 units) | You see the full price before you pay. Units cannot be cashed out or sent to others. Reading, listening, liking and sharing stay free.
Extra voice | A one-off token for one longer message. The price is shown before you pay. | Extra voice, 30 seconds: One message, up to 30 seconds | ₦150 | Extra voice, 1 minute: One message, up to 1 minute | ₦200 | Tokens do not renew. Each purchase shows in your wallet history with a receipt.
1440 aside: What units pay for | Text answer or reply 0.5 unit (₦6.90) | Voice, up to 10 seconds 1 unit (₦13.80) | Reaction after 20 free a day 0.1 unit | Vote after 3 free a day 0.2 unit | Reading, listening, liking and sharing are always free.
Paywall banner (component variant, not on these boards): You have used your 10 free posts. Get Voice Units from ₦138. Your draft is saved and posts when your units arrive.
Design bugs: none. Note: the Offer line says "bank partner"; V-9 says no bank wallet.

## 5. States drawn
Signed-in, light, one pack selected, card method selected. Paywall (out of free posts) exists as a component option only. Zero-unit chip "Get Voice Units", paying/processing, payment error, pack sold out, loading not drawn.

## 6. Numbers, lists, actions
- Pack cards: GET /units/tiers (UnitTier: name, priceKobo, unitsMilli, bonusMilli, effectiveKoboPerUnit). "a unit" price: effectiveKoboPerUnit (the board divides price by units without bonus; GAP to confirm which).
- Selected pack and Pay button text: client from tiers. Pay: POST /payments (kind UNITS, tierId, returnPath) with Idempotency-Key; response checkoutUrl; amountKobo is the price shown.
- Pay with Card, Transfer, USSD: GAP (InitPaymentRequest has no method; Flutterwave checkout would choose).
- Offer line: TiersResponse.walletOffer (untyped).
- Extra voice buttons: TiersResponse.extraVoice (priceKobo 15000, 20000; label; maxSeconds); POST /payments (kind EXTRA_VOICE, tokenKind).
- Balance / chip: GET /wallet (balanceMilli). Cost rows: ActionCosts.
- After pay: GET /payments/{paymentId} and POST /payments/{paymentId}/verify on return (V-11).

## 7. Where each tap goes
Back / "Wallet" link: /wallet. Pack card: selects. Method tab: selects. Pay: Flutterwave checkout then /wallet/paid. Token button: Flutterwave checkout for that token then /wallet/paid. Units chip: /wallet.
