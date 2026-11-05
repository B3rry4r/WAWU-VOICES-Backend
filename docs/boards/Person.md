# Person (another person's profile)

## 1. Boards
- more/Person-390.dc.html | shots/C/Person-390-v3.png
- more/Person-1440.dc.html | shots/C/Person-1440.png

## 2. Route
`/p/[handle]` (proposed; contract path is by userId: GET /people/{userId}).

## 3. Regions
390: header (Back, share icon, More icon "report or block") / ProfileHeader (avatar, handle, place, joined, Voice Card, 3 stats; no units, referral or Edit profile) / Tabs (Voices 112, Replies 640) / 2 post cards each with "On:" question link / BottomNav (Home active).
1440: SideNav (Home active) + top row; back link "Back"; "Share profile" button; header, tabs and posts; right aside "This week": TopicOfWeek rail, Trending, ad. No More icon drawn on 1440.

## 4. Strings (verbatim)
Back | Share @tunde.a's profile | More: report or block @tunde.a | Share profile (1440 button)
Tunde Adewale | @tunde.a | Ibadan · Joined Nov 2026 | Play Voice Card | Voice bio · 0:07 | Stats: 112 Voices | 18.4K Reactions | 640 Replies
Tabs (label "@tunde.a's posts"): Voices 112 | Replies 640
On: When salary arrives, how many hours pass before it disappears? | 2h · Ibadan | 9 s voice, transcript "Two hours. I counted. Rent contribution, my mother, then the generator man is already at the gate." | 1,284 likes | 86 replies | reactions 💯 😢 🔥 total 2,310 | label Most Relatable
On: How many hours of light did you get this week? Not what they promised, what you actually got. | 3d · Ibadan | "Eleven hours, all of it between 1am and 5am. NEPA is running a night shift for owls." | 2,210 likes | 140 replies | reactions 😂 💀 total 3,120 | label Most Thought-Provoking
1440 aside: Topic of the week | Are You Really Fine? You Dey Okay? | Week 1 · 10 questions · Poll open | Join the conversation | Trending | (Failed transfers 8.2K · Money; Tithe 6.1K · Faith; Minimum wage 4.9K · Work and pay) | Zobo Fresh | Cold zobo, delivered in 30 minutes | Lagos Island and Lekki only. | Order now
Shell strings and AnswerCard actions: see README-2. Design bugs: none.

## 5. States drawn
Another person, signed-in, light, Voices tab. Blocked person, no posts, no Voice Card, Replies tab body, loading, error, guest, removed account not drawn. The More menu is not drawn open.

## 6. Numbers, lists, actions
- Handle, name, place, joined, voice count, Voice Card: GET /people/{userId} (PublicProfile.profile: handle, displayName, city or state, joinedAt, voiceCount, voiceCard).
- Voices list with "On:" link: PublicProfile.recentAnswers (Answer.questionText); paging nextCursor.
- Stats Reactions 18.4K and Replies 640: GAP (Profile has voiceCount only).
- Replies tab and list: GAP (no route lists a person's replies).
- Share profile: POST /share/links: GAP (ShareObjectType has no PROFILE).
- Report: POST /reports (targetType USER, reason, alsoBlock). Block: PUT /me/blocks/{userId}; unblock DELETE. State: PublicProfile.isBlockedByMe.
- Aside: GET /topics/current, GET /feed/trending (questions with category: GAP as in Discover.md), GET /ads/placement.
- Search handle to reach a profile: GET /search (people).

## 7. Where each tap goes
Back: previous screen. Share: share sheet. More: report or block menu. Play Voice Card: plays. "On:" link: /q/[id]. Tab: switches list. Aside topic: topic conversation. BottomNav: Home, Discover, Speak, Profile.
