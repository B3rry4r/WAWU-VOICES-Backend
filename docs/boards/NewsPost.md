# NewsPost (one news post)

## 1. Boards
- more/NewsPost-390.dc.html | shots/C/NewsPost-390-v3.png
- more/NewsPost-1440.dc.html | shots/C/NewsPost-1440.png

## 2. Route
`/news/[answerId]` (proposed).

## 3. Regions
390: header (Back to the Newsroom, "Newsroom", share icon) / "Answering" question link / AnswerCard (the post) / who chose the tag line / NewsTag with note / "Is this tag wrong?" block with button / "58 replies" with 2 reply cards (text) / BottomNav (Discover active).
1440: SideNav + top row; back link "Newsroom"; the post; the line "Tag chosen by"; "58 replies" with 2 replies (second is a voice reply); right aside "About this post": "This post's tag" (larger NewsTag), flag block with longer text, "More in the Newsroom" (3 tag + headline links). No tag block in the main column.

## 4. Strings (verbatim)
Back to the Newsroom | Newsroom | Share this post
Answering | The fare to your village doubled for the same bumpy road. Who approved that?
Post: @chidi.e Chidi Eze | 3h · Lagos | Unverified News | "Fuel queues are back on Ikorodu Road this morning. Two stations closed, the one selling has a line to the bus stop." | 412 likes | 58 replies | reactions 😮 😢 total 188
Tag chosen by @chidi.e when posting, 8:15am
390 tag block: Unverified News | A news claim WAWU has not confirmed. Treat it with care.
390 flag: Is this tag wrong? | Flag it. An editor reviews every flag, and the poster is told if the tag changes. | Flag as misleading
1440 aside: This post's tag | Is this tag wrong? | If this is presented as news but is not, or the tag hides what it is, flag it. An editor reviews every flag. If the tag changes, the poster is told why. | Flag as misleading | More in the Newsroom | Verified News: One lane of Third Mainland Bridge closes this weekend for repairs | Unverified News: They said fuel would come down after the new refinery | Gossip: They are saying the Super Eagles coach will go after Saturday
58 replies
Reply 1: @kemi.b Kemi Bello | 2h · Ikeja | "Same at Ojodu Berger at 7am. I counted forty cars before I gave up and took okada." | 96 likes | 4 replies
Reply 2: @emeka.n Emeka Nwosu | 1h · Ketu | 390 text "I passed there at 9. Queue dey, but e dey move. Station by the bus stop is selling."; 1440 voice 11 s with that transcript | 41 likes | 2 replies
Card actions and shell strings: see README-2. Design bugs: none. Data note: the "Answering" question (fare to your village) does not match the post (fuel queues).

## 5. States drawn
Signed-in, Unverified News post, light. Verified and Gossip post pages, flagged-already, tag-changed, removed post, loading and error not drawn. "More in the Newsroom" links go to "#".

## 6. Numbers, lists, actions
- Post: GET /news/{answerId} (Answer with news: tag, sourceName, sourceUrl, chosenBy, chosenAt; likeCount, replyCount, reactionBreakdown, questionText).
- "Answering ...": Answer.questionText, questionId.
- "Tag chosen by @handle when posting, 8:15am": NewsLabel.chosenBy and chosenAt.
- Tag note text: GET /news/tags (TagInfo.meaning).
- Flag as misleading: POST /news/{answerId}/flag (note); report path POST /reports with MISLEADING_NEWS_TAG. "poster is told if the tag changes": NotificationType TAG_CHANGED.
- "58 replies" and reply list: GET /answers/{answerId}/replies (Reply: author, stance, kind, body, clip). Reply cards show likes and reply counts per reply: GAP (Reply has no likeCount or replyCount; replies are one level deep).
- "More in the Newsroom" list: GET /news.
- Share: POST /share/links (objectType ANSWER).
- Like, react, reply, report: as Newsroom.md.

## 7. Where each tap goes
Back: /news. Share: share sheet. "Answering" link: /q/[questionId]. Flag as misleading: flag note sheet. More-in-Newsroom link: /news/[answerId]. Reply card actions: like, react, reply. BottomNav: Home, Discover, Speak, Profile.
