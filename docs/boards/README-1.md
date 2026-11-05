# Boards 1: folders A2 and B (V-BOARDS-1)

Skipped (V-10, week 2): Messages, Conversation, Prompts, Survey, SurveyDone, BrandPage, index and Main boards.

Screens: 34. Boards covered: 74.

| Folder | Screen | Boards |
|---|---|---|
| A2 | [Landing](Landing.md) | 3 |
| A2 | [Onboarding](Onboarding.md) | 2 |
| A2 | [Country](Country.md) | 2 |
| A2 | [SignIn](SignIn.md) | 2 |
| A2 | [Verify](Verify.md) | 2 |
| A2 | [Topics](Topics.md) | 2 |
| A2 | [ProfileSetup](ProfileSetup.md) | 2 |
| A2 | [HomeGuest](HomeGuest.md) | 2 |
| A2 | [Home](Home.md) | 4 |
| A2 | [Notifications](Notifications.md) | 2 |
| A2 | [Search](Search.md) | 2 |
| A2 | [SharePage](SharePage.md) | 3 |
| A2 | [ShareSheet](ShareSheet.md) | 2 |
| A2 | [ShareCardPoll](ShareCardPoll.md) | 1 |
| A2 | [ShareCardQuestion](ShareCardQuestion.md) | 1 |
| A2 | [ShareCardVoice](ShareCardVoice.md) | 1 |
| A2 | [ShareCardWeekly](ShareCardWeekly.md) | 1 |
| B | [Question](Question.md) | 4 |
| B | [Reactions](Reactions.md) | 2 |
| B | [Write](Write.md) | 2 |
| B | [Record-ready](Record-ready.md) | 2 |
| B | [Record-live](Record-live.md) | 3 |
| B | [Record-preview](Record-preview.md) | 2 |
| B | [ExtraVoice](ExtraVoice.md) | 2 |
| B | [Posted](Posted.md) | 2 |
| B | [OutOfPosts](OutOfPosts.md) | 2 |
| B | [Thread](Thread.md) | 2 |
| B | [Vote](Vote.md) | 2 |
| B | [Results](Results.md) | 3 |
| B | [LiveResults](LiveResults.md) | 3 |
| B | [PostResult](PostResult.md) | 2 |
| B | [Propose](Propose.md) | 2 |
| B | [WhatNext](WhatNext.md) | 3 |
| B | [Report](Report.md) | 2 |

## GAP table (35)

| Screen | Item | Why |
|---|---|---|
| Landing | Free posts "10" | guest-readable free-post count |
| Landing | Country button (Change country) | no operation lists countries; only Nigeria at launch |
| Landing | Weekly report link (1440 nav) | V-10 (weekly report is week 2); /weekly-reports/latest exists but is not launch scope |
| Onboarding | Slide 3 FreePosts 10 and "0.5 unit (₦6.90)" | guest-readable cost; allowance needs sign-in |
| SignIn | Send code (SMS code, +234 number) | sign-in and the SMS code are WAWU ID (id.wawuafrica.com), not a VOICES operation |
| SignIn | Saved voice kept until sign-in | client-held draft; POST /voice-clips needs a signed-in user (guest upload not in contract |
| Verify | Code check and resend 0:42 | WAWU ID, not a VOICES operation |
| Topics | Minimum 3 | contract states no minimum for setCategories; enforced in the client unless the API adds it |
| HomeGuest | Topic of the week card | no question count on Topic |
| HomeGuest | Messages icon | V-10 (Messages is week 2 |
| Home | Messages icon | V-10 |
| Notifications | Tabs Replies, Reactions, Polls | listNotifications has no type filter (only unreadOnly); filter in client or add param |
| Search | Tabs with counts 21/2/17/2 | SearchResults has no totals |
| SharePage | Add your voice (guest recording in browser) | record-before-sign-in storage is client side |
| SharePage | Open in app | VOICES is a web app (V-1); button has no target in the contract |
| ShareCardWeekly | Weekly report content | V-10 (weekly report is week 2); data would come from GET /weekly-reports/latest |
| Question | Avatar stack of three people | no recent-voices avatars field; derive from first listAnswers items (author.avatarUrl |
| Question | Save this question (bookmark) | no save or bookmark operation in the contract |
| Question | Messages link | V-10 (Messages is week 2); link points at the Messages board |
| Write | Draft | no draft save operation; client-held |
| Write | Prompts button | V-10 (AI prompts are week 2; board Prompts skipped |
| Record-ready | Try a prompt | V-10 (AI prompts are week 2 |
| ExtraVoice | Pay with Card / Transfer / USSD | InitPaymentRequest has no method field; the method is chosen on the Flutterwave checkout |
| OutOfPosts | Draft saved | no draft operation; client-held |
| Thread | Chip counts | no experienceCount field |
| Thread | Messages link | V-10 (Messages is week 2); link points at the Messages board |
| Vote | Messages link | V-10 (Messages is week 2); link points at the Messages board |
| Results | Messages link | V-10 (Messages is week 2); link points at the Messages board |
| LiveResults | "N new results" live feed | no stream for result posts (stream exists only for polls); poll the list |
| LiveResults | Share this thread | ShareObjectType has no result thread |
| LiveResults | Messages link | V-10 (Messages is week 2); link points at the Messages board |
| Propose | Similar proposal warning before posting | ProposalReceipt.similar returns only after the post; no pre-check call |
| WhatNext | Share this summary | ShareObjectType has no What Next? summary |
| WhatNext | Messages link | V-10 (Messages is week 2); link points at the Messages board |
| Report | Mobile confirmation screen | 390 board shows only the form; confirmation drawn at 1440 only |
