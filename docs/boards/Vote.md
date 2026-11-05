# Vote on a poll (Vote)

## 1. Boards
- Board files (2): project/talk/Vote-1440.dc.html, Vote-390.dc.html (folder B)
- Pictures (3): shots/B/Vote-1440.png, Vote-390-v3.png, Vote-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id]/vote (also /polls/[id]).
## 3. Regions
- App bar: Back, "Vote", "Week 4 poll", Share this poll. StageBar (Vote).
- Poll in confirm state (selected a) with cost line; "More polls on this topic" with a second Poll (selected yes); BottomNav.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Back to the conversation, Share this poll, StageBar with counts; line "Salary, Bonuses and Year-End Money. Pick one, then confirm. You can explain your vote after."; right rail TrendingList and ad slot.
## 4. Strings (verbatim)
- Vote
- Week 4 poll
- What should every employer do before the year ends?
- Pay salaries on time, every time (4,260) | Pay a real year-end bonus (2,930) | Publish clear pay scales (1,370) | End unpaid overtime (1,120)
- closes in 2 days
- Confirm your vote
- One vote per account. You cannot change it after you confirm.
- Free: you have 3 free votes left today. After that a vote uses 0.2 unit.
- More polls on this topic
- Should employers who delay salary pay staff a penalty for every day it is late?
- Yes, for every day it is late (3,104) | Only after the first week (1,210) | No, just pay on time (586)
- closes in 9h
- One vote per account. Voting is free today: 3 of 3 votes left.
- Open poll: one vote per account. It shows what voters here think, not the whole country.
- Share this poll (aria)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Confirm state (this board). Vote state and results state are in Results. Already voted, poll closed, out of units not drawn here.
## 6. Numbers, lists, actions -> contract
- Poll and options -> GET /polls/{pollId} -> Poll (title, options, closes, choiceMode, label)
- Confirm vote -> POST /polls/{pollId}/votes -> optionIds; VoteReceipt.charge, results
- Cost line -> Poll.costToVoteMilli; Allowances.freeVotesLeftToday; ActionCosts.voteAfterFreeMilli (200)
- More polls on this topic -> GET /questions/{questionId}/polls
- Share this poll -> POST /share/links -> objectType POLL_RESULT
- Messages link -> GAP: V-10 (Messages is week 2); link points at the Messages board
## 7. Where each tap goes
- Confirm your vote -> Results; Back -> Question; Share -> ShareSheet; a poll option selects it.
