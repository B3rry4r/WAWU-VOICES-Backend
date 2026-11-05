# Extra voice time (token sheet) (ExtraVoice)

## 1. Boards
- Board files (2): project/talk/ExtraVoice-1440.dc.html, ExtraVoice-390.dc.html (folder B)
- Pictures (3): shots/B/ExtraVoice-1440.png, ExtraVoice-390-v3.png, ExtraVoice-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- Sheet over /speak when the 10 second limit is reached.
## 3. Regions
- Preview recorder behind (recorded 10 s). Sheet "Need more time?": two radio options (30 seconds ₦150, 1 minute ₦200), summary lines, "Pay with" segmented tabs Card | Transfer | USSD, Pay button with lock icon, No thanks button, footnote.
- At 1440:
  - Dialog sheet over the Record page with right rail showing prices.
## 4. Strings (verbatim)
- Need more time?
- You reached the 10 seconds of a free post.
- Choose extra time (aria)
- Extra voice, 30 seconds
- Up to 30 seconds for this one message
- ₦ 150
- Extra voice, 1 minute
- Up to 1 minute for this one message
- ₦ 200
- Time for this voice: 10 seconds free, plus 20 more with this token.
- Your 10-second recording is kept. Your free posts stay as they are.
- Pay with
- Card | Transfer | USSD
- Pay ₦150 for 30 seconds
- No thanks, keep my 10 seconds
- One payment for one message. Not a subscription, nothing renews. You get a receipt in your history.
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- 30 seconds selected (drawn), card tab. Pay pending, payment failed, token already owned not drawn.
## 6. Numbers, lists, actions -> contract
- Options and prices -> GET /units/tiers -> extraVoice[] (kind SECONDS_30/SECONDS_60, maxSeconds, priceKobo, label)
- Pay -> POST /payments -> kind EXTRA_VOICE, tokenKind, returnPath; PaymentInit.checkoutUrl; then POST /payments/{paymentId}/verify
- Pay with Card / Transfer / USSD -> GAP: InitPaymentRequest has no method field; the method is chosen on the Flutterwave checkout
- Receipt -> GET /payments/{paymentId}/receipt
- Token for this message -> GET /extra-voice-tokens; CreateVoiceClipRequest.extraVoiceTokenId
## 7. Where each tap goes
- Pay -> Flutterwave checkout, then back to Record-preview with token; No thanks -> Record-preview (10 s kept).
