---
id: LCH-08
title: The /go campaign page and the usevoices.com address
area: LAUNCH
priority: launch
tier: T1
repo: web + infra
status: todo (address decided: usevoices.com, V-35)
depends_on: [LCH-02]
decisions: [V-30]
boards: [Landing / Question]
---
# LCH-08 · /go and the address

Source: LAUNCH-SPEC.md §3.

## Build
- /go opens straight onto the launch question with "Add your voice" (guests can listen; answering asks for sign-in and
  comes back to the question). /go/{code} also records the invite code (LCH-06).
- If the owner moves VOICES to usevoices.com (OPEN Q2): PUBLIC_WEB_BASE, share links, nginx server_name and TLS, the
  WAWU ID allowed-origins paste, the Spaces CORS rule, the DNS records, the legal pages’ address. If voices.wawuafrica.com
  stays the app, usevoices.com redirects to it with the path kept.

## Done when
- Pictures; a guest from /go reaches the question in one screen; an invite code survives sign-up.
