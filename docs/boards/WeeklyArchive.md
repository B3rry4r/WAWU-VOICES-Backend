# WeeklyArchive (Past reports)

## 1. Boards
- more/WeeklyArchive-390.dc.html | shots/C/WeeklyArchive-390-v3.png
- more/WeeklyArchive-1440.dc.html | shots/C/WeeklyArchive-1440.png

## 2. Route
`/weekly/archive` (proposed).

## 3. Regions
390: header (Back, "Weekly report") / H1 + intro / next-publish notice (clock icon) / Latest card (green, PDF button) / month headers "December 2026", "November 2026" each with report rows (week, linked title, mood line, counts, PDF icon) / BottomNav (Discover active).
1440: same list in one column with SideNav and top row; no month headers; mood lines start "The mood: ..."; next-publish notice has no trailing sentence.

## 4. Strings (verbatim)
Weekly report | Past reports | One report a week, from the week's poll and voices. Each is AI-assisted and checked by a WAWU editor before it goes out.
390 notice: Week 7 publishes Sunday 3 Jan, 6pm, after the poll closes. | 1440 notice: Week 7 publishes Sunday 3 Jan, 6pm
Latest · Week 6 · 21 to 27 Dec 2026 (1440: Latest · Week 6 · 21 to 27 Dec) | Christmas, Family and the Pressure to Perform | The mood: tired of showing off, still showing up. | 14,208 voices · 10,955 votes | PDF
December 2026 | November 2026 (390 only)
Week 5 · 14 to 20 Dec | The Road Home: Travel, Fares and Flights | Fares doubled. The road did not get better. (1440: The mood: fares doubled, the road did not get better.) | 12,930 voices · 9,880 votes
Week 4 · 7 to 13 Dec | Salary, Bonuses and Year-End Money | Waiting for a bonus that may not come. | 13,402 voices · 10,214 votes
Week 3 · 30 Nov to 6 Dec | Campaign Season: Promises, Politicians and the People | Heard it all before, still listening. | 10,655 voices · 8,731 votes
Week 2 · 23 to 29 Nov | Prices, Black Friday and the Empty Wallet | Angry about prices, still counting every naira. | 11,872 voices · 9,406 votes
Week 1 · 16 to 22 Nov | Are You Really Fine? You Dey Okay? | Not fine, but still talking. | 9,318 voices · 7,602 votes
Icon labels: Download the Week N PDF (N = 1 to 5)
Shell strings (SideNav, search, country, bell) as in README-2. Design bugs: none. Note: the dates (Dec, Jan) are sample data after launch week; week 1 shows 16 to 22 Nov, but V-14 starts week 1 on Thu 12 Nov.

## 5. States drawn
Signed-in, 6 published reports, light. Empty archive, loading and error not drawn.

## 6. Numbers, lists, actions
- List rows (week, title, mood, counts, range): GET /weekly-reports (WeeklyArchive.items: weekNumber, title, range, mood, basedOnVoices, basedOnVotes, publishedAt). Paging: nextCursor.
- Latest card: WeeklyArchive.latest.
- "Week 7 publishes ...": WeeklyArchive.nextPublishAt (the "after the poll closes" wording is client text).
- Month headers: derived from publishedAt (client).
- Counts format "14,208 voices": basedOnVoices, basedOnVotes.
- PDF buttons: GAP (no PDF route; V-10).
- Intro line: static copy.

## 7. Where each tap goes
Back: /weekly. Title link (Week 6, Week 2 drawn linked; others "#"): /weekly/[reportId]. PDF buttons: none at launch. BottomNav: Home, Discover, Speak, Profile.
