# Search (Search)

## 1. Boards
- Board files (2): project/entry/Search-1440.dc.html, Search-390.dc.html (folder A2)
- Pictures (1): shots/A2/Search-390-v3.png
- Read from the board source (text, attributes, links). Copy inside design-system components (AnswerCard, Poll, Recorder and so on) comes from the design-system bundle.
## 2. Route
- /search?q=fare.
## 3. Regions
- App bar: Back to Discover, SearchField (value "fare").
- Tabs All 21, Questions 2, Voices 17, People 2.
- Questions: two result links; Voices: two AnswerCards (one text, one voice unfolded); People: two rows; BottomNav (Discover active).
- At 1440:
  - Left SideNav (units 12.5, free-left count), top bar with SearchField, Country button "Nigeria", Messages link, bell (Discover active); heading Results for "fare"; Right rail aside "This week": TopicOfWeek (rail) and TrendingList.
## 4. Strings (verbatim)
- Search questions, voices and handles
- fare (value)
- All 21 | Questions 2 | Voices 17 | People 2
- Questions
- The fare to your village doubled for the same bumpy road. Who approved that?
- Roads and travel · 3,100 voices · Open
- What is one rule that would stop fare hikes in peak season?
- What Next? · 840 voices · 22 proposals
- Voices · text and transcripts
- @... 2d Enugu text: Lagos to Enugu was ₦18,000 in September. Today the same bus fare is ₦35,000 and the AC still does not work. (418 likes, 52 replies)
- 3d Owerri voice (203 likes, 17 replies)
- People
- @farida.k Kaduna · 32 voices
- @fareed.l Ilorin · 8 voices
- Results for "fare" (1440)
- Back to Discover (aria)
- Design bugs: none found (no em-dash and no banned word in the board text).
## 5. States drawn
- Results (this board). No-results, empty query and loading not drawn.
## 6. Numbers, lists, actions -> contract
- Results lists -> GET /search?q=fare -> SearchResults.questions, answers, people
- Tabs with counts 21/2/17/2 -> GET /search?type= filters; counts GAP: SearchResults has no totals
- Question meta (category, voices, Open, proposals) -> Question.category, voiceCount, status, proposalCount
- People line "Kaduna · 32 voices" -> Profile.state, voiceCount
- Transcript matches -> GET /search matches answer text and transcripts (summary text)
## 7. Where each tap goes
- Back -> Discover; question row -> Question; voice card -> Question/Thread; person -> Person (folder C); tabs filter the list.
