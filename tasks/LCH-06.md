---
id: LCH-06
title: Personal invite links and friends who answered
area: LAUNCH
priority: launch
tier: T2 (privacy)
repo: api + web
status: done (merged 9 Nov, backend a128b2d, web ba591a9; T2 verified in 2 rounds)
depends_on: [LCH-02, LCH-14]
decisions: [V-31]
boards: [new: FriendsAnswered]
---
# LCH-06 · Personal invite links and friends who answered

Source: LAUNCH-SPEC.md §7.

## Build
- Each signed-in person gets one personal invite link (a short code, e.g. usevoices.com/go/ab12cd).
- A new person who arrives by that link and then answers is counted as that sender’s friend (first link wins, kept
  in a cookie for 30 days, never anything about the device beyond that code).
- The sender sees "2 of your friends have answered" and can tap to see each friend’s handle and word.
- A friend’s word is shown only if the friend leaves "Share my word" on. On by default, a switch on the posting
  screen and in Settings. Off: the friend is counted but the word is not shown.
- Privacy: only to the person who invited them; never in a public response; in the person’s data download; removed
  by the deletion purge. Privacy text and CLAIMS rows updated (owner approves).

## Done when
- T2 verifier: nobody but the inviter sees a friend’s word; "Share my word" off hides it at once; rotating codes
  cannot claim friends; deletion removes the links.
