# PaymentDone (payment result: success and failure)

## 1. Boards
- more/PaymentDone-390.dc.html (success) | shots/C/PaymentDone-390-v3.png
- more/PaymentDone-390-2.dc.html (failure) | shots/C/PaymentDone-390-2-v3.png
- more/PaymentDone-1440.dc.html (success and failure, two frames) | shots/C/PaymentDone-1440.png

## 2. Route
`/wallet/paid?payment=[paymentId]` (proposed; the return path set in POST /payments). Full-screen task on phone (no bottom bar).

## 3. Regions
390 success: Close X / check icon / H1 / balance line / Banner "Your answer is posted" / detail list (Pack, Paid, Method, Reference, Time) / "Back to the conversation" / "Download receipt".
390 failure: Close X / cross icon / H1 / reason / Banner "Your draft is still saved" / Banner "Seeing a debit?" / list (Pack, Method) / "Contact support" link / "Try again" / "Pay by transfer or USSD".
1440: SideNav (Profile active; units 67.5 on success, 12.5 on failure) with the same two states as centred cards; buttons side by side ("Receipt" instead of "Download receipt"); "Contact support" link below the buttons.

## 4. Strings (verbatim)
Close
Success: 55 units added | Payment received. Your balance is now 67.5 Voice Units. | Your answer is posted | We kept your draft and sent it the moment your units arrived. | Pack: Buzz, 55 units (5 bonus) | Paid: ₦690 | Method: Card ending 4412 | Reference: VU-261202-48213 | Time: 2 Dec 2026, 6:14pm | Back to the conversation | Download receipt (1440: Receipt)
Failure: Payment did not go through | Your bank declined the card. No units were added. | Your draft is still saved | It posts as soon as your units arrive. | Seeing a debit? | If your bank shows one for this payment, it comes back to you. Support can trace it with reference VU-261202-48219. | Pack: Buzz, ₦690 | Method: Card ending 4412 | Contact support | Try again | Pay by transfer or USSD
Shell strings (1440): see README-2. Design bugs: none. Note: reference format VU-YYMMDD-NNNNN; the date (2 Dec 2026) is sample data after launch week.

## 5. States drawn
Success with a held draft posted; failure (card declined) with a held draft. Pending or confirming (before verify), expired payment, success with no draft ("Back to the conversation" target), extra-voice token purchase success, transfer or USSD pending, dark, loading not drawn.

## 6. Numbers, lists, actions
- Result and every line: GET /payments/{paymentId} (Payment: status SUCCEEDED or FAILED, title, amountKobo, unitsMilli, bonusMilli, method, cardLast4, txRef, receiptNo, failureReason, balanceMilli, verifiedAt, createdAt).
- Confirm on return: POST /payments/{paymentId}/verify (providerTxId); never trust the browser (V-11).
- "55 units added": unitsMilli 55000. "Your balance is now 67.5": balanceMilli. "(5 bonus)": bonusMilli.
- Reference VU-...: GAP (contract has txRef and receiptNo; which one shows is not stated).
- "Your bank declined the card": failureReason.
- "Your answer is posted ... draft kept": GAP (no route stores or posts a held draft; contract has INSUFFICIENT_UNITS and FREE_POSTS_EXHAUSTED errors only).
- Download receipt / Receipt: GET /payments/{paymentId}/receipt (Receipt: receiptNo, amountKobo, paidAt).
- Try again: POST /payments (same tier). Pay by transfer or USSD: GAP (no method field).
- Contact support: GAP (no route; static page "Help and contact").
- Extra voice purchase on this screen: Payment.token.

## 7. Where each tap goes
Close: back to where the payment started (/wallet or the recording). Back to the conversation: /q/[id] with the draft posted. Download receipt / Receipt: receipt file. Try again: a new checkout. Pay by transfer or USSD: checkout in that method. Contact support: help page.
