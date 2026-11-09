---
id: LCH-05
title: Share is the next step ("You’re live")
area: LAUNCH
priority: launch
tier: T1
repo: web
status: building (bundle C, branch v/lch-c, 9 Nov)
depends_on: [LCH-03, LCH-06, LCH-14]
decisions: [V-31]
boards: [Posted (redrawn), ShareSheet]
---
# LCH-05 · Share is the next step

Source: LAUNCH-SPEC.md §6 and §8, source/spec-4-prefilled-message.jpg.

## Build
- On "You’re live", Share is the main button. Order: WhatsApp, SMS, Copy link, the phone’s share sheet.
- The pre-filled message, one tap, with the person’s own invite link:
  "I just shared how I feel about Nigeria on VOICES.\n\nI feel {WORD} about Nigeria. What about you?\n\nAdd your voice
  in 10 seconds: {PERSONAL LINK}"
- SMS uses an sms: link with the body, so it opens the person’s own messaging app. Never read or upload contacts.
  Never send anything without the person’s tap.
- The line "Send it to 3 people." and "Ask the person next to you, then compare".
- A QR code of the invite link, drawn in the browser (no outside service).

## Done when
- Tests: the message text exactly; the sms: link on Android and iPhone forms; nothing is sent without a tap.
- Phone list: SMS and WhatsApp open with the text filled in, on a real iPhone and Android.
