# Newsroom

## 1. Boards
- more/Newsroom-390.dc.html | shots/C/Newsroom-390-v3.png
- more/Newsroom-1440.dc.html | shots/C/Newsroom-1440.png

## 2. Route
`/news` (proposed). Entered from Discover "Newsroom".

## 3. Regions
390: header (Back to Discover, H1 "Newsroom", info icon "What the tags mean") / lead line / tag chips (All, Verified News, Unverified News, Gossip) / follow strip ("You follow Verified News", Change) / 3 posts, each with a category label above an AnswerCard / BottomNav (Discover active).
1440: SideNav + top row; back link; H1 and lead; chips with counts (All 218, Verified News 24 with 2 new, Unverified News 61, Gossip 133); 4 posts (the voice post has its transcript open); right aside: "What the tags mean" (3 NewsTag with notes, flag hint) and "Follow by tag" (3 switches, note). No follow strip and no info icon.

## 4. Strings (verbatim)
Back to Discover | Discover (1440 link) | Newsroom | What the tags mean | Every news post shows one tag, so you know what is confirmed and what is talk. Only WAWU editors can mark a post Verified News.
Chips: All | Verified News | Unverified News | Gossip (1440 counts 218, 24 (+2 new), 61, 133)
390 follow strip: You follow Verified News | Change
Post 1: Roads and travel | @voices.desk VOICES Desk | 40 min | tag Verified News | "One lane of Third Mainland Bridge closes this weekend for repairs, from Friday 11pm to Monday 5am. Plan another route if you can." | 2,140 likes | 312 replies | reactions 👏 💯 total 1,260 | link: Source: Lagos State Ministry of Works statement
Post 2: Money | @musa.d Musa Danjuma | 1h · Kano | Unverified News | 24 s voice, transcript "They said fuel would come down after the new refinery. My transport money is still double what it was in January." | 230 likes | 19 replies
Post 3: Sport | @sola.m Sola Martins | 2h · Port Harcourt | Gossip | "They are saying the Super Eagles coach will go after Saturday. Na gist o, I no fit confirm am." | 518 likes | 144 replies | reactions 😂 💀 🤔 total 2,004
Post 4 (1440): Money | @chidi.e Chidi Eze | 3h · Lagos | Unverified News | "Fuel queues are back on Ikorodu Road this morning. Two stations closed, the one selling has a line to the bus stop." | 412 likes | 58 replies
1440 aside: What the tags mean | Verified News: Confirmed by WAWU's editors against a named source. The source is linked. | Unverified News: A news claim WAWU has not confirmed. Treat it with care. | Gossip: Talk, rumour or opinion. Not presented as fact. | Think a tag is wrong? Open the post and flag it as misleading. An editor checks every flag. | Follow by tag | Verified News (on, read-only) | Unverified News | Gossip | We tell you when a post with that tag goes up. Never on the lock screen.
Card actions: see README-2 (AnswerCard). Design bugs: none.

## 5. States drawn
Signed-in, All chip, light; following Verified News only. Empty tag, loading, error, guest not drawn. Transcript closed (390) and open (1440). 1440 "Verified News" switch is drawn on and read-only.

## 6. Numbers, lists, actions
- Post list: GET /news (NewsPostPage: Answer items; tag filter query). Each card: Answer (author, createdAt, kind, body, clip, news, likeCount, replyCount, reactionBreakdown).
- Tag label and source: Answer.news (NewsLabel: tag, sourceName, sourceUrl, chosenBy, chosenAt). Category label above each post (Roads and travel, Money, Sport): GAP (Answer has questionText, no category).
- Chip counts 218, 24, 2 new, 61, 133: GAP (no count per tag or new-since-visit).
- Tag meanings: GET /news/tags (TagInfo.label, meaning, followed).
- Follow by tag switches and "Change": PUT /me/tag-follows (tags). The Verified News switch is fixed on and read-only: GAP (contract allows removing it).
- "You follow Verified News": TagInfo.followed.
- Flag a tag: POST /news/{answerId}/flag (note).
- Like / react / reply / share / more: PUT|DELETE /answers/{id}/like, PUT /answers/{id}/reaction, POST /answers/{id}/replies, POST /share/links, POST /reports.
- Voice play and transcript: GET /voice-clips/{clipId}/play, VoiceClip.transcript.

## 7. Where each tap goes
Back: /discover. Info icon: tag meanings sheet. Chip: filters list. Change: tag-follow choice. Source link: external URL. Card: /news/[answerId]. Switches: save follows. BottomNav: Home, Discover, Speak, Profile.
