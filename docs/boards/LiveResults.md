# Live results thread (election) (LiveResults)

## 1. Boards
- Board files (3): project/talk/LiveResults-1440.dc.html, LiveResults-390-dark.dc.html, LiveResults-390.dc.html (folder B)
- Pictures (5): shots/B/LiveResults-1440.png, LiveResults-390-dark-v3.png, LiveResults-390-dark.png, LiveResults-390-v3.png, LiveResults-390.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /live/[threadId] (propose; threads list GET /result-threads).
## 3. Regions
- App bar: Back (Home), "Live results", "Election day · 16 January 2027", Share this thread.
- Heading block: title, subtitle, date and time line; LiveThread: filter All | Verified only, "N new results" pill, result posts (author, time, place, three figures, Verified or Not verified mark); button "Post the numbers you see"; BottomNav.
- At 1440:
  - Left SideNav (units 12.5, free-left), top bar: SearchField "Search questions, voices and handles", Country button "Nigeria", Messages link (aria "Messages, 3 unread"; V-10), bell "Notifications" with dot.
  - Right rail: "Were you at a polling unit?" panel, Post button; "What the labels mean" (Verified, Not verified); line "WAWU does not add these up or publish a count of its own."; TrendingList (election).
## 4. Strings (verbatim)
- Live results
- Election day · 16 January 2027
- Election Week: Your Vote, Your Voice
- Presidential and National Assembly elections
- Saturday 16 January 2027 · Polls closed at 2:30pm
- Polling unit results
- All | Verified only
- 1 new result / N new results
- Accredited | Votes cast | Rejected
- Verified | Not verified (marks)
- Nothing verified yet
- The WAWU team checks numbers as they come in. Switch to All to see every post.
- Post the numbers you see
- Share this thread (aria)
- 1440: Were you at a polling unit? | Copy them from the result sheet. The WAWU team checks every post. | What the labels mean | The WAWU team checked these numbers against the result sheet. | Not checked yet. Treat with care. | WAWU does not add these up or publish a count of its own.
- Trending: Will you vote on Saturday, or have you given up? Why? (18,400) | What do you fear most about Election Day: violence, long queues, vote buying or manipulation? (11,200) | If your vote does not count, why do politicians fight so hard for it? (7,600)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Dark theme (390-dark) and light (390, 1440). Populated with Verified and Not verified posts, 128 total and 41 verified. "Nothing verified yet" state is component copy, not a drawn board. Thread closed or scheduled not drawn.
## 6. Numbers, lists, actions -> contract
- Thread header -> GET /result-threads/{threadId} -> ResultThread (title, subtitle, heldOn, status)
- Posts, All vs Verified only -> GET /result-threads/{threadId}/posts?status= -> ResultPost (author, state, lga, ward, pollingUnit, accredited, votesCast, rejected, status, label, checkedLine)
- Counts 128 total / 41 verified -> ResultThread.postCount, verifiedCount
- "N new results" live feed -> GAP: no stream for result posts (stream exists only for polls); poll the list
- Share this thread -> GAP: ShareObjectType has no result thread
- Thread list -> GET /result-threads
- Messages link -> GAP: V-10 (Messages is week 2); link points at the Messages board
## 7. Where each tap goes
- Back -> Home; Post the numbers you see -> PostResult; "new results" pill scrolls to top and loads; filter switches list.
