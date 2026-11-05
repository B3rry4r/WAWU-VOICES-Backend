# Category (Money, a category page)

## 1. Boards
- more/Category-390.dc.html | shots/C/Category-390-v3.png
- more/Category-1440.dc.html | shots/C/Category-1440.png

## 2. Route
`/c/[slug]` (proposed; drawn category "Money", slug money).

## 3. Regions
390: header (Back to Discover, "Discover", share icon) / hero (coins icon, "Alerts on" chip, H1, blurb, counts) / Tabs (Open 6, Closed 32, Polls 4) / 5 question rows (first has "Today's question" badge) / "Top voice in Money this week" (AnswerCard, voice) / BottomNav (Discover active).
1440: SideNav (Discover active) + top row; back link "Discover"; hero with chip and solid share button; same tabs; 4 TopicTile cards (forest first, sun others); "Top voices in Money this week" with 2 AnswerCards (voice, text); right aside "This week": TopicOfWeek rail, "Trending in Money", ad.

## 4. Strings (verbatim)
Back to Discover | Discover | Share the Money category | Alerts on | Money | Salary, prices, banks, the naira and the hustle in between. | 38 questions · 12.4K voices this week
Tabs (label "Questions in Money"): Open 6 | Closed 32 | Polls 4
Today's question | When salary arrives, how many hours pass before it disappears? | 12.5K voices · Closes in 9h
Should failed transfers be refunded within one hour by law? | 8,200 voices · Poll open · Closes in 2 days
Who is getting rich from this inflation while you count coins? | 6,100 voices · Closes in 3 days
You were debited, the transfer failed and nobody can tell you where your money is. What do you do? | 3,400 voices · Closes in 4 days
How many hustles are you running just to cover what one salary used to cover? | 2,100 voices · Closes in 5 days (390 only)
Top voice in Money this week (1440: Top voices in Money this week)
Answer 1: @tunde.a Tunde Adewale | 2h | Ibadan | 9 s voice, transcript "Two hours. I counted. Rent contribution, my mother, then the generator man is already at the gate." | 1,284 likes | 86 replies | reactions 💯 😢 🔥 total 2,310 | label Most Relatable
Answer 2 (1440): @funmi.o Funmi Ogunleye | 3h | Lagos | "Salary lands at 9am. By 11am rent contribution, my mother's upkeep and generator fuel have taken their share. What is left is for transport and prayer." | 642 likes | 41 replies | reactions ❤️ 😂 total 905 | label Most Debated
1440 tiles: Today's question | Poll open | Closes in 3 days | Closes in 4 days (with the question text above and 12,480 / 8,200 / 6,100 / 3,400 voices)
1440 aside: This week | Are You Really Fine? You Dey Okay? | Week 1 · 10 questions · Poll open | Trending in Money | (3 items: failed transfers 8,200; getting rich 6,100; "The naira falls and suddenly everything you own is worth less. How did you find out?" 2,900) | Zobo Fresh | Cold zobo, delivered in 30 minutes | Lagos Island and Lekki only. | Order now | Ad badge
Shell strings: see README-2. Design bugs: none.

## 5. States drawn
Signed-in, category followed with alerts on, Open tab, light. Closed and Polls tab bodies, not-following, empty and loading not drawn.

## 6. Numbers, lists, actions
- Name, blurb, "38 questions", "12.4K voices this week": GET /categories/{slug} (CategoryDetail.category: name, blurb, questionCount, voicesThisWeek).
- Today's question row: CategoryDetail.todaysQuestion (Question: text, voiceCount, endsAt). Other rows: CategoryDetail.questions (hasOpenPoll for "Poll open", endsAt for "Closes in"). Paging: nextCursor.
- Tab counts (Open 6, Closed 32, Polls 4): GAP (CategoryDetail has questionCount only; tab filters via GET /questions?category= status, but open/closed/polls counts are not returned).
- Top voice(s): CategoryDetail.topVoice (one Answer; labels, likeCount, replyCount, reactionBreakdown, clip). Two top voices on 1440: GAP (contract has one).
- "Alerts on" chip: PUT /me/categories (CategoryFollow.alertsOn); current state from GET /me/settings is not enough: GAP for reading which categories are followed.
- Share icon: POST /share/links (objectType: GAP, ShareObjectType has no CATEGORY).
- Aside TopicOfWeek: GET /topics/current. "Trending in Money": GET /feed/trending (category filter: GAP). Ad: GET /ads/placement (FEED_CARD).
- Counts of voices on tiles: Question.voiceCount.

## 7. Where each tap goes
Back: /discover. Share: share sheet. Alerts chip: toggles alerts. Tab: filters list. Question row or tile: the conversation /q/[id]. Answer card: /q/[id] answer. Aside topic: /q topic page. Trending item: /q/[id]. Ad button: ad link. BottomNav: Home, Discover, Speak, Profile.
