# Poll results (Results)

## 1. Boards
- Board files (3): project/talk/Results-1440.dc.html, Results-390-2.dc.html, Results-390.dc.html (folder B)
- Pictures (4): shots/B/Results-1440.png, Results-390-2-v3.png, Results-390-v3.png, Results-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id]/results (also /polls/[id]/results).
## 3. Regions
- App bar: Back, "Results so far", "Week 4 poll", Share the result. StageBar (Vote).
- Poll in results state (selected a, bars with percent); section "Explain my vote" with By voice and In words buttons; Back to the discussion; Share ghost; banner ad (Zobo Fresh); BottomNav.
- 390 and 390-2 differ only in scroll position.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Back to the conversation, Share the result, StageBar with counts; "Thanks for voting. The bars move as votes come in until the poll closes."; Explain my vote buttons; Share the result; right rail TrendingList.
## 4. Strings (verbatim)
- Results so far
- Week 4 poll
- What should every employer do before the year ends?
- Pay salaries on time, every time (4,260) | Pay a real year-end bonus (2,930) | Publish clear pay scales (1,370) | End unpaid overtime (1,120)
- closes in 2 days
- Explain my vote
- Say why you picked “Pay salaries on time, every time”. It joins the discussion under the question.
- By voice
- In words
- Back to the discussion
- Share
- Zobo Fresh | Free delivery on your first order | Open
- Thanks for voting. The bars move as votes come in until the poll closes.
- Share the result (1440)
- Share the result (aria)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- After voting, poll open. Closed poll final, not voted yet, results-hidden not drawn.
## 6. Numbers, lists, actions -> contract
- Bars, percent, total -> GET /polls/{pollId}/results -> PollResults.options[].votes, percent, totalVotes, leadingOptionId, asOf
- Live moving bars -> GET /polls/{pollId}/results/stream (server-sent events)
- My pick (selected a) -> PollResults.myVote
- Explain my vote -> POST /polls/{pollId}/explanation -> kind, body or clipId
- Banner ad -> GET /ads/placement; POST /ads/{adId}/events
- Share the result -> POST /share/links -> objectType POLL_RESULT
- Messages link -> GAP: V-10 (Messages is week 2); link points at the Messages board
## 7. Where each tap goes
- By voice -> Record-ready; In words -> Write; Back to the discussion -> Question; Share -> ShareSheet; ad -> advertiser link.
