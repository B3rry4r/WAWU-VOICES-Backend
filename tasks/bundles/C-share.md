# Bundle C (share): LCH-06 + LCH-05. Tier T2 (privacy). Lead brief, 9 Nov 2026

Builder: one Sonnet agent. Branches `v/lch-c` in BOTH repos, from origin/main (bundle B merged: mood words, where you
sit, mood card). Read `docs/agents/RULES.md`, the task files LCH-06 and LCH-05, `docs/launch/LAUNCH-SPEC.md` §6 to §8,
DECISIONS V-31 and V-35, and the boards `docs/design/launch/YoureLive-390`, `YoureLive-390-first`, `Friends-390`,
`MoodPick-390` (its “Share my word” switch).
Resources: ports 15000-15019, Redis db 12, Postgres databases `lchc_*`. Bundle F (money) may merge to main while you
work: merge origin/main into your branch before you hand back (git merge, never rebase; regenerate the contract and
web types, never hand-merge generated files).

## Build
- LCH-06 (api + web): one personal invite code per signed-in person (short, unguessable, stable). The link is
  `<PUBLIC_WEB_BASE>/go/<code>` (the address itself moves to usevoices.com in LCH-08; read it from config).
  A visitor arriving by a link keeps the code for 30 days (first link wins; only the code is kept). When that visitor
  signs up and answers, they count as the sender’s friend.
  The sender sees “N of your friends have answered” and the list: handle and word for a friend whose “Share my word” is
  on (on by default), “Word kept private” otherwise. The switch: on MoodPick (as drawn) and in Settings.
  Privacy: a friend’s word is shown only to the person who invited them; never in a public response; the person’s data
  export includes their invite code and who they invited; the deletion purge removes the links both ways; privacy.md
  and CLAIMS.md lines (list them for the owner).
- LCH-05 (web): the “You’re live” screen as YoureLive-390 draws it (and -first before 50 answers): Share on WhatsApp is
  the main button, then SMS, Copy link, More (the browser’s share sheet); the pre-filled message exactly:
  “I just shared how I feel about Nigeria on VOICES.\n\nI feel {WORD} about Nigeria. What about you?\n\nAdd your voice in
  10 seconds: {PERSONAL LINK}”; SMS by an `sms:` link with the body (Android and iPhone forms) opening the person’s own
  app; never read or upload contacts; nothing sent without the person’s tap; “Send it to 3 people.”; the friends row;
  “Ask the person next to you, then compare” with a QR code of the invite link drawn in the browser (a library is fine,
  no outside service); no tab bar on this screen (the board has none).

## Tests (new; existing ones change only where a ruling changes a value, list each)
- Invite: first link wins; 30-day expiry; self-invite does not count; one friend counted once; a friend who turns
  “Share my word” off disappears from the inviter’s list words at once (count stays); nobody but the inviter can read a
  friend’s word (every route); export and purge.
- Share screen: the message text exactly; the sms: body encoded; WhatsApp link; nothing sent without a tap; QR encodes
  the personal link.
Pictures: every screen touched at 390 light and dark and 1440 beside the boards, in `/tmp/voices-shots/lch-c/`.
Hand back per `docs/agents/RULES.md`.
