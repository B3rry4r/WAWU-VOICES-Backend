# Propose a next step (Propose)

## 1. Boards
- Board files (2): project/talk/Propose-1440.dc.html, Propose-390.dc.html (folder B)
- Pictures (3): shots/B/Propose-1440.png, Propose-390-v3.png, Propose-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /q/[id]/propose.
## 3. Regions
- App bar: Close without posting (to WhatNext), "Propose a next step", eyebrow "What Next?".
- The What Next? question; guidance text; Composer (placeholder "Who should do what, and by when?", voice button); "This looks like a proposal already here" with a ProposalCard (Bola Kareem 3h) and note.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Back to What Next?; StageBar (What Next?); section "Week 4 · Salary, Bonuses and Year-End Money"; right rail "How proposals work" with Proposed badge text.
## 4. Strings (verbatim)
- Propose a next step
- What Next?
- What is one practical change that would make pay fairer in your workplace?
- Make it practical: who should do what, and by when. It shows as Proposed, and others can support, challenge or improve it.
- Your proposal (label)
- Who should do what, and by when? (placeholder)
- This looks like a proposal already here
- Support it instead, or post yours. A moderator decides if they belong in one group.
- Bola Kareem 3h proposal card (supports, challenges, grouped)
- How proposals work
- Every proposal is labelled Proposed and shows how many people support or challenge it. Anyone can improve one. Similar proposals are grouped once a moderator confirms. Nothing here is a decision.
- Back to What Next? (1440)
- Week 4 · Salary, Bonuses and Year-End Money (1440)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Draft with a similar-proposal warning (this board). Empty, over-limit, posting, posted not drawn.
## 6. Numbers, lists, actions -> contract
- Post proposal -> POST /questions/{questionId}/proposals -> kind, body or clipId, improvesId
- Similar proposal warning before posting -> GAP: ProposalReceipt.similar returns only after the post; no pre-check call
- Improve an existing one -> CreateProposalRequest.improvesId
- Cost / free post use -> ProposalReceipt.charge
- Support instead -> PUT /proposals/{proposalId}/stance -> SUPPORT
## 7. Where each tap goes
- Close -> WhatNext; post -> WhatNext with the new proposal; Support it instead -> stance then WhatNext.
