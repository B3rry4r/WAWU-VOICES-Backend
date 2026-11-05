# AdminCalendar (Admin: Topic calendar)

## 1. Boards
- admin/AdminCalendar-1440.dc.html | shots/C/AdminCalendar-1440.png

## 2. Route
`/admin/calendar` (week detail opens in the right panel; proposed `/admin/calendar/[topicId]`).

## 3. Regions
Admin nav (README-2) / totals line / H1 "Topic calendar", search field, "Add a week" / status chips with counts / week table (Week, Topic of the week, Status; 9 rows) / selected-week panel: date range, title, "Edit week", status, sensitive note, 7 daily questions (live one and a pinned one badged), spare line, poll (closes, question, 4 options), What Next? prompt.

## 4. Strings (verbatim)
Admin shell: see README-2. 103 weeks · 1,030 questions · 103 polls | Topic calendar | Find a week or question | Search the calendar | Add a week
Chips: All 103 | Live 1 | Scheduled 3 | In review 2 | Draft 95 | Sensitive 14
Table: Week | Topic of the week | Status
1 · 16 Nov Are You Really Fine? You Dey Okay? Closed | 2 · 23 Nov Prices, Black Friday and the Empty Wallet Closed | 3 · 30 Nov Campaign Season: Promises, Politicians and the People Live | 4 · 7 Dec Salary, Bonuses and Year-End Money Scheduled | 5 · 14 Dec The Road Home: Travel, Fares and Flights Scheduled | 6 · 21 Dec Christmas, Family and the Pressure to Perform Scheduled | 7 · 28 Dec The Year in Review: Wahala Awards 2026 In review | 8 · 4 Jan New Year, Old Problems In review | 9 · 11 Jan Election Week: Your Vote, Your Voice Draft
Panel: Week 3 · 30 Nov to 6 Dec 2026 | Campaign Season: Promises, Politicians and the People | Edit week | Live | Sensitive: politics. No ads beside it.
Mon 30 Which campaign promise have you heard so many times that you can recite it from memory? (Live)
Tue 1 They can afford billboards, helicopters and rallies. Why can they not afford a working clinic in your area?
Wed 2 Have you ever collected rice, money or a branded T-shirt for your vote? And did your life change afterwards?
Thu 3 If a candidate knocked on your door right now, what is the first question you would ask? (Pinned)
Fri 4 Which politician has insulted your intelligence the most with a speech?
Sat 5 What do you think happens to your street, your road and your light after the votes are counted?
Sun 6 Should every candidate sign a written promise that voters can use against them if they break it?
Spare: 3 more questions held for follow-ups and flash polls
Poll, closes Sun 6 Dec 11:59pm | What should every candidate be forced to do? | Publish their assets and plans · Debate in public · Sign binding promises · Account for all campaign spending
What Next? prompt: What is one promise that voters should hold every candidate to in writing?
Design bugs: none. Note: week 1 is drawn as 16 Nov; V-14 starts week 1 on Thu 12 Nov.

## 5. States drawn
Week 3 selected (live, sensitive). Selected week in Draft, Scheduled or In review, empty search result, add-week form, edit mode, loading, error not drawn. Chip "All" selected.

## 6. Numbers, lists, actions
- Table and chips: GET /admin/topics (CalendarPage items: weekNumber, title, startsOn, status). Chip counts and totals ("103 weeks", "1,030 questions", "103 polls"): GAP (list returns items only; counts are not returned). Filter by status and Sensitive: query params not declared (GAP); Topic.sensitive exists.
- Search "Find a week or question": GAP (no search param on /admin/topics).
- Add a week: POST /admin/topics (UpsertTopicRequest: weekNumber, title, blurb, startsOn, sensitive, whatNextPrompt, status).
- Panel: GET /admin/topics/{topicId} (AdminTopic: topic, questions with slotIndex, day, text, status, pinned, spare, poll). Edit week: PATCH /admin/topics/{topicId}; edit a question: PATCH /admin/questions/{questionId} (text, scheduledFor, pinned, status); add: POST /admin/questions.
- Poll block (closes, question, options): AdminTopic.poll (Poll: title, endsAt, options); edit: PATCH /admin/polls/{pollId}; create: POST /admin/polls.
- "Sensitive: politics. No ads beside it.": Topic.sensitive.
- What Next? prompt: Topic.whatNextPrompt.
- Spare count (3): AdminTopic.spare length.
- Move a week's date: PATCH /admin/topics/{topicId} (startsOn). Drag or move control not drawn.

## 7. Where each tap goes
Chip: filters table. Table row: loads that week in the panel. Add a week: new-week form. Edit week: edit form. Question row: question editor. Nav: other admin pages.
