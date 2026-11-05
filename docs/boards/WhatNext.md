# What Next? (summary and proposals) (WhatNext)

## 1. Boards
- Board files (3): project/talk/WhatNext-1440.dc.html, WhatNext-390-2.dc.html, WhatNext-390.dc.html (folder B)
- Pictures (4): shots/B/WhatNext-1440.png, WhatNext-390-2-v3.png, WhatNext-390-v3.png, WhatNext-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id]/next.
## 3. Regions
- App bar: Back to the conversation, "What Next?", "Week 4 · Salary, Bonuses and Year-End Money", Share this summary. StageBar (What Next?).
- The question; "Editorial summary" card (Reviewed by an editor; main arguments; opposing view; poll so far; proposed next steps; footnote); "Proposals" with sort tabs and grouping note; four ProposalCards; Propose a next step button; BottomNav.
- 390, 390-2 show the same page at two scroll positions.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Back to the conversation, Share this summary, StageBar with counts; summary and proposals in the centre; Propose a next step; right rail Poll (results state) and TrendingList.
## 4. Strings (verbatim)
- What Next?
- Week 4 · Salary, Bonuses and Year-End Money
- What is one practical change that would make pay fairer in your workplace?
- Editorial summary
- Reviewed by an editor
- Where the conversation stands so far
- Main arguments
- Most voices so far lean towards: salary is gone within a day, to rent, family and transport.
- 5,400 voices
- The main opposing view: it lasts when you move savings out before the bills.
- 2,100 voices
- The poll so far
- “Pay salaries on time, every time” leads with 44% of 9,680 votes. The poll is still open.
- Proposed next steps
- 214 proposals in 38 groups. Most supported so far: put the salary date and a late-payment penalty in every offer letter.
- Based on 12,480 voices and 9,680 votes. Updated 2 hours ago. These are proposals, not decisions.
- Proposals
- Most supported | Newest | Most challenged
- Similar proposals are grouped. Groups are suggested automatically and a moderator confirms each one.
- Cards: Bola Kareem 3h | Ifeoma Nnaji 2h | Chidi Okeke 1h | Kemi Bello 20m (supports, challenges, grouped)
- Propose a next step
- Share this summary (aria)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Populated with the editor-reviewed summary. Summary not yet reviewed, no proposals, group detail not drawn.
## 6. Numbers, lists, actions -> contract
- Summary text and counts -> GET /questions/{questionId}/what-next -> summary (EditorialSummary: mainView, mainViewVoices, opposingView, opposingViewVoices, pollLine, nextStepsLine, basedOnVoices, basedOnVotes, updatedAt, reviewedByEditor)
- "214 proposals in 38 groups" -> WhatNext.proposalTotal, groupTotal
- Proposal list and sort -> GET /questions/{questionId}/proposals?sort= (supported, new, challenged not named in the contract)
- Support and challenge counts, grouped -> Proposal.supportCount, challengeCount, improveCount, groupId; ProposalGroup
- Support / challenge buttons -> PUT /proposals/{proposalId}/stance -> SUPPORT or CHALLENGE; DELETE to remove
- Share this summary -> GAP: ShareObjectType has no What Next? summary
- Messages link -> GAP: V-10 (Messages is week 2); link points at the Messages board
## 7. Where each tap goes
- Propose a next step -> Propose; Back -> Question; cards open that proposal (same page); StageBar tabs as Question.
