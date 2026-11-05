# Report a voice (Report)

## 1. Boards
- Board files (2): project/talk/Report-1440.dc.html, Report-390.dc.html (folder B)
- Pictures (3): shots/B/Report-1440.png, Report-390-v3.png, Report-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /report/[type]/[id] (propose; sheet over the reported item at 1440).
## 3. Regions
- App bar: Close (to Question), "Report this voice", "From @musa.d".
- Guidance line; six radio reasons ("Shares personal details" selected); note field (max 280); checked option "Also block @musa.d"; Send report button; footnote.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Question page behind (Back to Home, StageBar, question, voices, Poll, TrendingList, ad) with confirmation dialog "Thanks. We got your report." offering Undo block and Back to the conversation.
## 4. Strings (verbatim)
- Report this voice
- From @musa.d
- Strong opinions are welcome. We act on harassment, threats, scams and private details.
- Why are you reporting this voice? (aria)
- Hate or harassment | Threat or violence | Scam or spam | Shares personal details | Misleading news tag | Something else
- Add a note (optional)
- What should our team look at?
- Also block @musa.d
- You will not see their voices or replies.
- Send report
- The person is not told who reported them.
- 1440 dialog: Thanks. We got your report. | Report sent at 4:12pm | Our moderators will look at this voice from @musa.d and act if it breaks the community rules. @musa.d is not told who reported it. | You blocked @musa.d | Undo | Back to the conversation
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Form with one reason selected and Also block on (390). Confirmation (1440 dialog). No reason chosen, sending, error not drawn.
## 6. Numbers, lists, actions -> contract
- Send report -> POST /reports -> targetType ANSWER, targetId, reason, note, alsoBlock; ReportReceipt.blocked
- Reasons -> ReportReason HATE_OR_HARASSMENT, THREAT_OR_VIOLENCE, SCAM_OR_SPAM, PERSONAL_DETAILS, MISLEADING_NEWS_TAG, OTHER (ABOUT_ME exists in the contract but is not drawn)
- Also block -> PUT /me/blocks/{userId}
- Undo block -> DELETE /me/blocks/{userId}
- Report sent at 4:12pm -> ReportReceipt has no time; client clock
- Mobile confirmation screen -> GAP: 390 board shows only the form; confirmation drawn at 1440 only
## 7. Where each tap goes
- Close -> Question; Send report -> confirmation then Question; Undo -> unblocks; Back to the conversation -> Question.
