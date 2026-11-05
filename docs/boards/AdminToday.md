# AdminToday (Admin: Today)

## 1. Boards
- admin/AdminToday-1440.dc.html (desktop only) | shots/C/AdminToday-1440.png

## 2. Route
`/admin` (home of the admin console, V-12). Desktop only; no phone board.

## 3. Regions
Left admin nav (shell, see README-2) / date line / H1 "Today" with status pill and "Override the day" button / 4 stat tiles / "Today's question" card and "Topic of the week" card / "Today's schedule" list / "Needs your attention" 6 linked rows with counts.

## 4. Strings (verbatim)
Admin shell: see README-2. Page: Monday 30 Nov 2026 · Week 3 | Today | Normal flow running | Override the day
Tiles: Voices today 3,482 (61% voice, 39% text) | Poll votes 5,910 (Week 3 poll, since Monday) | Shares 1,276 (WhatsApp leads) | Open reports 23 (Oldest waiting 3h)
Today's question | Live since 8:00am · closes 11:59pm | Which campaign promise have you heard so many times that you can recite it from memory? | 3,482 voices · Politics · Sensitive topic: ads are kept away
Topic of the week | Campaign Season: Promises, Politicians and the People | Poll: What should every candidate be forced to do? Closes Sunday 6 Dec, 11:59pm. The weekly report drafts itself after.
Today's schedule | 8:00am Today's question went live (done) | 12:00pm Flash poll: Is your bank app working right now? [Scheduled] | 6:00pm Week 2 report publishes, once approved [Needs you] | Tue 8am They can afford billboards, helicopters and rallies. Why can they not afford a working clinic in your area? (next question)
Needs your attention | News tags to review: 4 flagged as misleading, 2 asking for Verified News 6 | Posted results to check: Mark each Verified or Not verified 14 | Adverts and surveys to approve: 2 adverts, 1 sponsored survey 3 | Week 2 report draft: Ready to review, due out at 6pm 1 | Reached 500 people: Held until a moderator checks them 5 | Sensitive-topic queue: Politics this week, extra review 9
Design bugs: none. Notes: "sponsored survey" and "Reached 500 people" are V-10 items; the Week 2 report is "due out" on Monday 30 Nov while "Week 3" is running (week numbering is sample data).

## 5. States drawn
Normal flow running, one day, light. Override live (pill and banner), nothing waiting (empty attention list), loading, error, role without access not drawn.

## 6. Numbers, lists, actions
- Everything on the page: GET /admin/today (AdminToday: date, weekNumber, topic, flowState NORMAL|OVERRIDE_LIVE, todaysQuestion, stats, schedule, nextQuestion, needsAttention).
- Status "Normal flow running": flowState. Tiles: TodayStats (voicesToday, voicePercent, pollVotes, shares, openReports, oldestReportMinutes). Text "61% voice, 39% text": voicePercent (text share derived). "WhatsApp leads": GAP (no per-target share counts in stats; ShareTarget exists on events). "Week 3 poll, since Monday": client.
- Today's question: AdminToday.todaysQuestion (text, startsAt, endsAt, voiceCount, category, sensitive). "ads are kept away": Question.sensitive.
- Topic card and poll line: AdminToday.topic (title; poll title and close time: GAP not in Topic, fetch GET /admin/topics/{topicId} poll).
- Schedule rows: AdminToday.schedule (at, title, state DONE|SCHEDULED) and nextQuestion. Badge "Needs you" and the report line: GAP (state has two values only).
- Attention rows and counts: AdminToday.needsAttention (newsTags 6, resultPosts 14, ads 3, weeklyReports 1, moderation 5 and sensitive 9). Sub-lines ("4 flagged as misleading, 2 asking for Verified News", "2 adverts, 1 sponsored survey"): GAP (counts split not returned).
- Nav counts (News tags 6, Posted results 14, Adverts and surveys 3, Weekly report 1, Moderation 49): needsAttention; Moderation 49 vs 5 + 9 on this page: GAP (total not stated; 49 may be all queues).
- Signed-in admin and role: GET /me (roles).

## 7. Where each tap goes
Override the day (button, nav): /admin/override. Question card: question in admin calendar. Attention rows: News tags to review /admin/news; Posted results /admin/results; Adverts /admin/ads; Week 2 report /admin/weekly; Reached 500 and Sensitive queue /admin/moderation. Nav: each admin page.
