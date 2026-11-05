# Discover

## 1. Boards
- more/Discover-390.dc.html (top) | shots/C/Discover-390-v3.png
- more/Discover-390-2.dc.html (scrolled to flash poll and trending) | shots/C/Discover-390-2-v3.png
- more/Discover-1440.dc.html | shots/C/Discover-1440.png

## 2. Route
`/discover`. Related: `/c/[slug]`, `/news`.

## 3. Regions
390: header (H1 "Discover", Messages icon, bell) / SearchField / "Categories" (see all link, 8 tiles) / "Newsroom" (blurb, Open link, 3 tag chips with counts) / TopicOfWeek / "Flash poll" (Live badge, Poll with Vote button) / Trending list / BottomNav (Discover active). The -2 board shows the lower half only.
1440: SideNav + top row (SearchField, country, Messages, bell) / H1 + lead / TopicOfWeek / "Flash polls" (2 polls side by side) / "Newsroom" (blurb, chips, "Open the Newsroom") / "Categories" (8 tiles, no "See all") / right aside "This week": Trending list, ad.

## 4. Strings (verbatim)
Discover | Messages | Notifications | Search questions, voices and handles | Search VOICES
Categories | See all (390) | Money 12.4K voices | Power and light 6,100 voices | Work and pay 4,900 voices | Love 3,200 voices | Roads and travel 2,700 voices | Faith 2,800 voices | Family 1,800 voices | Elections 21.4K voices
Newsroom | News posts, sorted by their tag. (1440: News posts, sorted by their tag. Follow the ones you trust.) | Open (1440: Open the Newsroom) | Verified News 24 | Unverified News 61 | Gossip 133
TopicOfWeek: Topic of the week | Are You Really Fine? You Dey Okay? | Week 1 · 10 questions · Poll open
Flash poll (1440: Flash polls) | Open poll | Live | How many hours of light did you get today? | None at all 1,840 | 1 to 6 hours 2,310 | 7 to 12 hours 960 | More than 12 hours 410 | Closes in 2h | Vote | One vote per account. Voting is free today: 3 of 3 votes left.
1440 second poll: Is your bank app working right now? | Yes, it is fine 620 | Slow, but working 1,130 | Not at all 1,475 | Closes in 45 min
1440 lead: Every conversation on VOICES, by topic, by tag and by what is moving now.
Trending (title "Trending"): Should failed transfers be refunded within one hour by law? 8.2K voices · Money | Is a tithe a rule or a choice? 6.1K voices · Faith | Should the minimum wage rise automatically with inflation? 4.9K voices · Work and pay | 1440 adds: The fare to your village doubled for the same bumpy road. Who approved that? 2.7K voices · Roads and travel
1440 ad: Zobo Fresh | Cold zobo, delivered in 30 minutes | Lagos Island and Lekki only. | Order now | Ad
Shell strings: see README-2. Design bugs: none.

## 5. States drawn
Signed-in, polls in the unvoted (vote) state, light. Voted, closed, empty (no flash poll), loading, error, guest not drawn. Poll on 390 shows one flash poll; 1440 shows two.

## 6. Numbers, lists, actions
- Category tiles (name, voices): GET /categories (Category: name, slug, voicesThisWeek). Icons are client-side per slug. Eight tiles drawn; "See all" target: GAP (list route returns all; no page defined).
- Newsroom tag counts (24, 61, 133): GAP (TagInfo has tag, label, meaning, followed; no post count). Tags: GET /news/tags.
- TopicOfWeek (title, "Week 1 · 10 questions"): GET /home (topicOfWeek: weekNumber, title, voiceCount) or GET /topics/current. "10 questions" count: GAP (Topic has no question count). "Poll open": Question.hasOpenPoll or Poll.status.
- Flash poll (options, votes, closes in): GET /polls/current (Poll: title, options, endsAt, totalVotes, myVote). Two flash polls at once (1440): GAP (/polls/current returns one).
- Vote: POST /polls/{pollId}/votes (optionIds, VoteReceipt.charge). "3 of 3 votes left": Allowances.freeVotesLeftToday, cost: ActionCosts.voteAfterFreeMilli. Live results: GET /polls/{pollId}/results/stream.
- Trending list: GET /feed/trending returns Answers; the board lists questions with category and voices: GAP (no trending-questions route; use /home trending or /questions).
- Search: GET /search (questions, answers, people). Messages icon: GAP (V-10). Bell: GET /notifications/unread-count.
- Ad: GET /ads/placement (FEED_CARD); POST /ads/{adId}/events.
- Units chip, country: as README-2.

## 7. Where each tap goes
Category tile: /c/[slug] (only Money linked in the board). See all: all categories. Open / Open the Newsroom: /news. Tag chip: /news filtered by tag. TopicOfWeek: topic conversation. Poll option then Vote: confirm vote in place. Trending row: /q/[id]. Search: /search. Messages: none at launch. Bell: notifications. BottomNav: Home, Discover, Speak, Profile.
