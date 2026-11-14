VERDICT: FIX

# Verify V-FIX-C round 5, server side (verifier, API)

Code under test: `origin/v/fix-c` at d4d6c8b (round 4). `git merge origin/v/fix-c` into `verify/v-fix-c` was clean (no conflict, merge commit 8c28d7f), so I tested the merged tree, whose `api/` is d4d6c8b's. My scripts and specs stay out of the commit (they are in `/tmp/v5s`). No `.env` or key file opened. A fake key was exported; the real `@google/genai` SDK was pointed at a local stand-in (`GOOGLE_GEMINI_BASE_URL`); the stand-in saw 50 calls, all to `127.0.0.1:<port>`, request body keys `contents,generationConfig` only, every prompt fenced. Own PostgreSQL 16 (55555) and two Redis (56555, 56556) were started by me and are stopped.

## Why FIX

Round 4's own findings are all closed (table below). The new check finds two things that fail the rulings:

1. **A second phone number in the same run goes out whole.** `0803 123 4567, 0701 234 5678` -> `, 0701 234 5678`. Two numbers given in one line (comma, slash, dash, `&`, `;`, newline, a plain space between them) is the usual way people post two numbers. `scrub.ts:125-145` finds the first phone inside the chain and returns; the rest of the chain is never looked at again.
2. **A price per unit is deleted.** `Petrol now sells at N617.50/litre.` -> `Petrol now sells at`; `Salary is N1.5m/month.` -> `Salary is`. The ruling says prices stay whole. `PATH_LINK` (`scrub.ts:38`, label.label/path) reads `N617.50/litre` as a link.

On the merge test: no phone number from my lists may get through whole (the second number does), and under 1 in 100 of my ordinary sentences may change (it does: 1 of 356 in the first set, 0.28 %; but the shapes in N2 to N4 below are ordinary Nigerian news and speech, and one of my sets written to hit the new rules changes 27 to 50 %).

## Round 4 findings and their state

| # | Round 4 said | Now | The run |
|---|---|---|---|
| M1 | platform word + word + full stop deletes both words | **closed** | 15 named and 200 platform x template sentences, each with a full stop: 215 of 215 whole. Through the route: whole. |
| M2 | a phone with an unusual separator goes whole | **closed** | `call 0803<sep>123<sep>4567 now`, 104 separators (the 90 of round 4 and 14 more, 2 to 5 characters included): 104 give `call now`. `+234 (0) 803 – 123 – 4567` removed; `08o3 one two three 4567` removed. |
| M3 | prices, ranges, lists of years deleted | **closed for the 18 strings; reopened in a narrower shape (N3)** | The 18 strings (ranges, years, 1000-5000, `2 3 4 ... 11`, counting lists): 18 of 18 whole. Lists that start with 0 are still deleted (N3). |
| M4 | sentence starting with Africa, Online, Shop ... loses two words | **closed** | 17 starters x 2 sentences + the 4 named: 38 of 38 whole. Also all 52 ending words as a sentence start (`Prices rose again. <Word> owners complained.`): all whole. |
| M5 | spaced link/email goes whole | **closed (and `<at>`/`<dot>` fixed)** | 10 strings removed, including `jane<at>example<dot>com` on the model route (it is now an empty draft, the data draft is used). Lower-case-only rule held: `evil . COM` and `evil . Com` stay (ruling). |
| LOW | list | as ruled | 37 strings: 13 unlisted endings stay (`.de .in .au .ws .work .gq .ml .sh .by .so .am .fm .is`), bare names stay, `bit.ly/ 3abc` -> `3abc`. `192.168.0.1/admin`, `go.to`, `suffer.Africa`, `evil.co.za`, `evil.tk` etc. are now removed. |
| PUT | zero-width and direction characters differ between PUT and model path | **closed** | Item 3: PUT strips every `\p{Cf}` and the text equals `cleanModelText`. |

## New findings

### BLOCKER
None.

### HIGH

**N1. Two phone numbers in one run: the second stays whole.** `api/src/reach/scrub.ts:125-145` (`phoneChain`: returns on the first phone found, `m.slice(toks[j-1].end)` is kept untouched), reached from `PHONE_CHAIN` (`:83`).
- Input -> output (`scrub`, and the same through the route as the model's answer, item 3 row 3):
  - `0803 123 4567, 0701 234 5678` -> `, 0701 234 5678`
  - `0803 123 4567 / 0701 234 5678` -> `/ 0701 234 5678`
  - `0803 123 4567 - 0701 234 5678`, `; `, `| `, `& ` -> the second stays after the mark
  - `0803-123-4567, 0701-234-5678` -> `, 0701-234-5678`; `0803.123.4567, 0701.234.5678` -> `, 0701.234.5678`
  - `0803 123 4567, 0701 234 5678, 0812 345 6789` -> `, 0701 234 5678, 0812 345 6789` (two numbers whole)
  - `+234 803 123 4567, +234 701 234 5678` -> `, +234 701 234 5678`; `+234 803 123 4567 / +234 701 234 5678` -> `/ +234 701 234 5678`
  - `0803 123 4567 0701 234 5678` -> `0701 234 5678`; `0803 123 4567\n0701 234 5678` -> `0701 234 5678`; `0803 123 4567,0701 234 5678` -> `,0701 234 5678`; `0803 123 4567 (0701 234 5678)` -> `(0701 234 5678)`
  - `0803 1234567, 0701 2345678` -> `, 0701 2345678`; `1, 0803 123 4567, 2, 0701 234 5678` -> `1, , 0701 234 5678`
  - `+1 202 555 0143, +44 7911 123456` -> `7911 123456`; `202-555-0143, 202-555-0199` -> `, 202-555-0199`; `(202) 555-0143 / (202) 555-0199` -> `(202) 555-`
  - Of 26 strings with two or three numbers in one run, 22 leave digits behind. Removed, so not affected: unbroken numbers (`08031234567, 07012345678` -> `,`, because `PHONE_SINGLE` runs after), and two numbers with a word between (`... or ...`, `... and ...`).
- Should: after a phone is found, scan the rest of the chain again (loop on the remainder), so that every number in the run is removed.

### MEDIUM

**N2. A price per unit with a decimal is deleted as a link.** `scrub.ts:38-39` (`PATH_LINK`: a letter, then `.label`, then `/`). The ruling: "Prices ... stay whole".
- `Petrol now sells at N617.50/litre.` -> `Petrol now sells at`; `Petrol is N617.5/litre now.` -> `Petrol is now.`; `Rice is N5.5k/kg.` -> `Rice is`; `Diesel at N1200.00/litre hurts.` -> `Diesel at hurts.`; `Pay NGN617.50/litre at the pump.` -> `Pay at the pump.`; `It costs USD1.50/kg.` -> `It costs`; `Salary is N1.5m/month.` -> `Salary is`; `Fare is N1.5k/trip.` -> `Fare is`; `I pay N2.5k/day.` -> `I pay`; `He gets N30.5k/week.` -> `He gets`; `Rent is N2.5m/yr.` -> `Rent is`; `N2.5bn/year was voted for roads.` -> `was voted for roads.`
- Also: `Dr.Ade/Dr.Bola attended.` -> `attended.`; `Mr.Bello/Mrs.Bello came.` -> `came.`; `Use v1.2/final please.` -> `Use please.`
- Whole (so the damage needs a letter before the digits): `N617.50 per litre`, `₦617.50/litre`, `#617.50/litre`, `$1.5/kg`, `N150k/month`, `N1,200.50/litre`, `22.4%/year`, `4.5k/day`, `60km/h`.
- The sentence is cut at the price, so the figure the post was about is gone; it does not read whole. In a news or price post this is common (fuel and salary posts).
- Should: PATH_LINK must not start on a letter that is a currency tag glued to a number (or require the label to contain a letter run of 2+ after the dot, or at least that the last label is not digits+unit).

**N3. Lists and ranges that start with 0 are phones by rule b/c, so times, scores, dates and decimals are deleted.** `scrub.ts:100-108`. This is the ruling's letter ("first digit is 0 ... 10 to 14 digits", up to 5 non-letter characters between groups), so I rank it by effect, not as a code error; the lead may want a guard (a list of 2 to 4 digit groups separated by `:` `-` `/` `, ` is not a phone).
- `Buses leave at 08:30, 09:30, 10:30.` -> `Buses leave at .`
- `Results: 0-0, 1-1, 2-0, 3-1, 0-2.` -> `Results: .`
- `The shifts are 08:00-16:00, 16:00-00:00.` -> `The shifts are :00.`
- `Dates: 01/02/2024 - 05/02/2024.` -> `Dates: /2024.`; `From 01/03/2024 - 05/03/2024 we are closed.` -> `From /2024 we are closed.`
- `Inflation: 0.5, 1.2, 0.8, 2.1, 3.0.` -> `Inflation: .`; `Grades 0, 1, 2, 3, 4, 5, 6, 7, 8, 9.` -> `Grades .`; `Page 0 1 2 3 4 5 6 7 8 9` -> `Page`
- `Numbers starting 070, 080, 081, 090, 091 are mobile.` -> `Numbers starting , 091 are mobile.`
- Rule d (3-3-4 with one space/dot/dash) and rule b (first group 234): `Bags: 120 340 1000` -> `Bags:`; `Votes 123 456 7890` -> `Votes`; `Section 123.456.7890` -> `Section`; `Votes were 400 500 6000.` -> `Votes were .`; `234, 235, 236, 237.` -> `.`; `Cars: 234 235 236 237` -> `Cars:`
- Whole (good): single times, `0-5, 6-10, 11-15`, `0.5-1.5 percent`, `2023-2024-2025`, `01/02/2024` alone, `08:30:15`, scores with fewer than 10 digits, years lists, 1000-5000 lists, `100,000 - 150,000`, `N10,000-N15,000`, `100 000 000`.

**N4. A `handle` (or snap, x, ig ...) followed by a number with a unit or a currency tag is a handle.** `scrub.ts:74-77`. The ruling says "holds a digit", so this is by the ruling's letter; but `handle` is a common English verb, and the post loses its figure.
- `I can handle 10k users.` -> `I can users.`; `It can handle 5G.` -> `It can .`; `She will handle 2nd round.` -> `She will round.`; `We handle N5,000 each.` -> `We ,000 each.`; `Dem go handle N50,000.` -> `Dem go ,000.`; `Snap 2nd group is full.` -> `group is full.`; `I used ig 24x7 last year.` -> `I used last year.`; `On twitter 2day I saw it.` -> `On I saw it.`
- Whole: `handle 2023 requests`, `x 2023`, `ig 2 times`, `whatsapp 2.0`, `instagram 2.0`, `x 24/7`, `x.y`, `x.5`, `I met x. Then he left.`
- Should: for `handle` (and `x`, `snap`) require `:` or `is`/`na` or `@` before the token, not a bare digit-with-letters token.

**N5. `00234 803 123 4567` leaves its last group.** `scrub.ts:100-108` (rule b caps at 14 digits; `00234` + 10 = 15 digits). `00234 803 123 4567` -> `4567`; `00234-803-123-4567` -> `-4567`; through the route `4567`. The unbroken `002348031234567` is removed. The ruling's 14 limit does not cover the 00234 form; the last four digits of a real number go out.

### LOW (residue; by ruling or rare)

- **Phone forms outside the four rules stay whole** (the rule list is exclusive): `(202) 555-0143`, `(415)555-0143`, `1 (202) 555-0143`, `98765 43210`, `98765-43210`, `44 7911 123456`, `44 20 7946 0958`, `33 6 12 34 56 78`, `7911 123456`, `151 23456789`, `612 34 56 78`, `803 1234 567`, `803-123-45-67`, `803 12 34 567`, `2340803 123 4567`, `415 5550143`, `415-555-01-43`. With a plus, a leading 0, or 3-3-4 (single space, dash, dot) they go (`+1 (202) 555-0143`, `+44 7911 123456`, `202-555-0143`, `415.555.0143`). A US number in brackets is the one most likely to be typed; I suggest adding it.
- **Spoken numbers outside the rule:** `eight zero three one two three four five six seven`, `two three four eight zero three ...`, `nought eight zero three ...`, `o eight o three ...`, `zero eight zero three one two three for five six seven` ("for" for four), `... won too ...` stay (the run must start with zero, oh, 0 or +).
- **A mark between a platform word and a handle** (the ruling's "next token" is the mark): `ig = jane_doe`, `ig -> jane_doe` (arrow), `ig — jane_doe`, `ig => jane_doe`, `ig ~ jane_doe`, `ig | jane_doe`, `ig / jane_doe`, `ig #jane_doe`, `ig ➡ jane_doe`, `ig ( jane_doe )`, `ig [jane_doe]`, `ig "jane_doe"`, `ig ‘jane_doe’`, `ig, jane_doe`, `ig; jane_doe`, `ig. jane_doe`, `my ig, jane_doe`, `on x, jane_doe`, `IG (jane_doe)`: all stay (16 of my 150 handle shapes). Removed: `ig: x`, `ig - x`, `ig @x`, `ig  x`, `ig\nx`, `ig is x`, `ig na x`, `ig:x`, `ig-x`, `x @ jane.doe`.
- `tiktok @ jane`, `find me @ jane`, `@ jane_doe`, `ig : @ jane_doe` stay (an at sign and a space; round 4 had `@ jane`). `sc: jane_doe` (snap abbreviation not in the list). `handles jane_doe` (plural). `whatsapp me on jane.doe` (ruling: bare name, though it has a dot).
- `twitter . com / jane`, `x . com / jane`, `facebook . com / jane` -> `/ jane` (the name after a spaced link stays).
- `jane_at_example_dot_com` stays. `jane . doe @ example . com` -> `jane .` (the first name stays).
- Lower-case-typed posts: after a full stop a lower-case `net`, `info`, `org`, `com`, `biz`, `io`, `ng`, `xyz` is read as an ending (the ruling): `we dey suffer. info no reach us.` -> `we dey no reach us.`; `rice is dear. net profit no dey.` -> `rice is profit no dey.`; `go market. com plaints plenty.` -> `go plaints plenty.`; `i voted. io no know.` -> `i no know.`; `we paid. biz dey slow.` -> `we dey slow.`. Capitalised starters are whole (`Prices went up. Info on the website is old.`).
- An at sign with spaces then a place then a full stop and an ending word: `Dinner @ home. Net later.` -> `later.`; `The meeting is @ Ikeja. Info follows.` -> `The meeting follows.` (reads whole, loses two phrases). Rare: it needs ` @ ` with spaces.
- `The dot com bubble was before my time.` -> `bubble was before my time.` (round 4: same; `dot com` is a written link).
- IPv4-shaped numbers: `Section 2.1.3.4 says so.` -> `Section says so.`; `Version 1.2.3.4 is out.` -> `Version is out.`.
- `evil . COM`, `evil . Com` stay (ruling: lower-case only).

## Proved by runs

### 1. Round 4's exact strings: input, output, state
(`scrub` only; M1 has 215 rows summarised as its 15 named strings; every other row is exact. The 90 separators of M2 are run with 14 more.)

#### M1 (15 named + 200 platform x template)

| input | output | state |
|---|---|---|
| `I use whatsapp daily.` | `I use whatsapp daily.` | whole |
| `Twitter is dead.` | `Twitter is dead.` | whole |
| `Let the police handle that.` | `Let the police handle that.` | whole |
| `Mark the x here.` | `Mark the x here.` | whole |
| `Dem talk am for wa group.` | `Dem talk am for wa group.` | whole |
| `The school has a whatsapp group.` | `The school has a whatsapp group.` | whole |
| `He lost his job after a facebook post.` | `He lost his job after a facebook post.` | whole |
| `They shared it on instagram widely.` | `They shared it on instagram widely.` | whole |
| `I read the news on twitter first.` | `I read the news on twitter first.` | whole |
| `Instagram is slow.` | `Instagram is slow.` | whole |
| `It was just a snap judgement.` | `It was just a snap judgement.` | whole |
| `The council did not handle complaints.` | `The council did not handle complaints.` | whole |
| `That is the x factor.` | `That is the x factor.` | whole |
| `Rumours spread on telegram fast.` | `Rumours spread on telegram fast.` | whole |
| `Check the poll on facebook later.` | `Check the poll on facebook later.` | whole |

All 15 named and all 200 platform x template sentences (20 platform words x 10 templates, each ending with a full stop): 215 of 215 whole.
#### M2, 104 separators (the 90 of round 4 and 14 more): `call 0803<sep>123<sep>4567 now`

Separators (U+ codes for non-printing): `U+0020` `U+0009` `U+000A` `U+00A0` `U+2009` `,` `.` `-` `/` `_` `:` `|` `(` `)` `,U+0020` `U+0020/U+0020` `U+2013` `U+2014` `U+2212` `U+2010` `U+2011` `U+2022` `U+00B7` `U+2027` `U+2043` `U+2219` `U+3001` `U+3002` `U+2016` `U+00A6` `U+00AC` `U+00B0` `!` `"` `$` `%` `&` `'` `*` `+` `;` `<` `=` `>` `?` `[` `\` `]` `^` ``` `{` `}` `~` `#` `U+0020--U+0020` `U+0020..U+0020` `U+0020...U+0020` `U+0020-U+0020` `U+0020U+2013U+0020` `U+0020U+2014U+0020` `--` `---` `...` `..` `U+0020U+0020` `/U+0020` `U+0020/` `~~` `**` `U+2012` `U+2015` `U+00AB` `U+00BB` `U+201C` `U+201D` `U+2020` `U+00A7` `U+00B6` `U+00A1` `U+00BF` `U+2030` `U+2032` `U+2044` `U+2215` `U+203B` `U+22C5` `U+25CF` `U+25A0` `U+2605` `U+2192` `U+21D2` `U+00B1` `U+00D7` `U+00F7` `U+00A4` `U+00A3` `U+20AC` `@` `-----` `.....` `U+2022U+2022U+2022` `U+2013U+2013U+2013` `U+000DU+000A` `U+000AU+000A`

Output for every one of the 104: `call now`. State: removed (0 stay).
#### M2 other

| input | output | state |
|---|---|---|
| `+234 (0) 803 – 123 – 4567` | `` | removed |
| `08o3 one two three 4567` | `` | removed |

M2 other: 2 strings, 0 stay

#### M3 ranges and lists

| input | output | state |
|---|---|---|
| `100,000 - 150,000 naira per year.` | `100,000 - 150,000 naira per year.` | whole |
| `Between 100,000-150,000 naira.` | `Between 100,000-150,000 naira.` | whole |
| `I earn 100,000 - 150,000.` | `I earn 100,000 - 150,000.` | whole |
| `Between 10,000 - 15,000 naira per week.` | `Between 10,000 - 15,000 naira per week.` | whole |
| `Between 2015, 2016, 2017 and 2018 nothing changed.` | `Between 2015, 2016, 2017 and 2018 nothing changed.` | whole |
| `In 1999, 2003, 2007, 2011, 2015, 2019 and 2023 we voted.` | `In 1999, 2003, 2007, 2011, 2015, 2019 and 2023 we voted.` | whole |
| `From 2019 2020 2021 2022 2023 2024 prices doubled every year.` | `From 2019 2020 2021 2022 2023 2024 prices doubled every year.` | whole |
| `Payments of 10,000, 20,000, 30,000 and 40,000 were delayed.` | `Payments of 10,000, 20,000, 30,000 and 40,000 were delayed.` | whole |
| `The levy list was 1000, 2000, 3000, 4000, 5000.` | `The levy list was 1000, 2000, 3000, 4000, 5000.` | whole |
| `N10,000-N15,000` | `N10,000-N15,000` | whole |
| `₦100,000 - ₦150,000` | `₦100,000 - ₦150,000` | whole |
| `2 3 4 5 6 7 8 9 10 11 teachers were sacked.` | `2 3 4 5 6 7 8 9 10 11 teachers were sacked.` | whole |
| `Counting: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and we start again.` | `Counting: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and we start again.` | whole |
| `Page 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 are blank.` | `Page 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 are blank.` | whole |
| `Bags 12 13 ... 21 were delivered.` | `Bags 12 13 ... 21 were delivered.` | whole |
| `Sections 1,2,...,10 apply.` | `Sections 1,2,...,10 apply.` | whole |
| `Three. Four. Five. Six. Seven. Eight. Nine. Ten.` | `Three. Four. Five. Six. Seven. Eight. Nine. Ten.` | whole |
| `Count: one. Two. ... Nine.` | `Count: one. Two. ... Nine.` | whole |

M3 ranges and lists: 18 strings, 0 changed

#### M4 sentence starts on an ending word (34 + 4 named)

| input | output | state |
|---|---|---|
| `Our people suffer. Africa should unite.` | `Our people suffer. Africa should unite.` | whole |
| `Nigeria is blessed. Africa watches us.` | `Nigeria is blessed. Africa watches us.` | whole |
| `Our people suffer. Online should unite.` | `Our people suffer. Online should unite.` | whole |
| `Nigeria is blessed. Online watches us.` | `Nigeria is blessed. Online watches us.` | whole |
| `Our people suffer. Tech should unite.` | `Our people suffer. Tech should unite.` | whole |
| `Nigeria is blessed. Tech watches us.` | `Nigeria is blessed. Tech watches us.` | whole |
| `Our people suffer. Shop should unite.` | `Our people suffer. Shop should unite.` | whole |
| `Nigeria is blessed. Shop watches us.` | `Nigeria is blessed. Shop watches us.` | whole |
| `Our people suffer. Site should unite.` | `Our people suffer. Site should unite.` | whole |
| `Nigeria is blessed. Site watches us.` | `Nigeria is blessed. Site watches us.` | whole |
| `Our people suffer. Club should unite.` | `Our people suffer. Club should unite.` | whole |
| `Nigeria is blessed. Club watches us.` | `Nigeria is blessed. Club watches us.` | whole |
| `Our people suffer. Info should unite.` | `Our people suffer. Info should unite.` | whole |
| `Nigeria is blessed. Info watches us.` | `Nigeria is blessed. Info watches us.` | whole |
| `Our people suffer. Link should unite.` | `Our people suffer. Link should unite.` | whole |
| `Nigeria is blessed. Link watches us.` | `Nigeria is blessed. Link watches us.` | whole |
| `Our people suffer. Store should unite.` | `Our people suffer. Store should unite.` | whole |
| `Nigeria is blessed. Store watches us.` | `Nigeria is blessed. Store watches us.` | whole |
| `Our people suffer. Dev should unite.` | `Our people suffer. Dev should unite.` | whole |
| `Nigeria is blessed. Dev watches us.` | `Nigeria is blessed. Dev watches us.` | whole |
| `Our people suffer. Net should unite.` | `Our people suffer. Net should unite.` | whole |
| `Nigeria is blessed. Net watches us.` | `Nigeria is blessed. Net watches us.` | whole |
| `Our people suffer. Org should unite.` | `Our people suffer. Org should unite.` | whole |
| `Nigeria is blessed. Org watches us.` | `Nigeria is blessed. Org watches us.` | whole |
| `Our people suffer. Biz should unite.` | `Our people suffer. Biz should unite.` | whole |
| `Nigeria is blessed. Biz watches us.` | `Nigeria is blessed. Biz watches us.` | whole |
| `Our people suffer. UK should unite.` | `Our people suffer. UK should unite.` | whole |
| `Nigeria is blessed. UK watches us.` | `Nigeria is blessed. UK watches us.` | whole |
| `Our people suffer. NG should unite.` | `Our people suffer. NG should unite.` | whole |
| `Nigeria is blessed. NG watches us.` | `Nigeria is blessed. NG watches us.` | whole |
| `Our people suffer. XYZ should unite.` | `Our people suffer. XYZ should unite.` | whole |
| `Nigeria is blessed. XYZ watches us.` | `Nigeria is blessed. XYZ watches us.` | whole |
| `Our people suffer. Com should unite.` | `Our people suffer. Com should unite.` | whole |
| `Nigeria is blessed. Com watches us.` | `Nigeria is blessed. Com watches us.` | whole |
| `I could not go to school. Online classes did not work either.` | `I could not go to school. Online classes did not work either.` | whole |
| `Rice is 85,000 naira. Shop owners are crying.` | `Rice is 85,000 naira. Shop owners are crying.` | whole |
| `It cost me 5,000. Biz is slow these days.` | `It cost me 5,000. Biz is slow these days.` | whole |
| `Hunger is real. Shop prices doubled.` | `Hunger is real. Shop prices doubled.` | whole |

M4 sentence starts on an ending word (34 + 4 named): 38 strings, 0 changed

#### M5 spaced links and emails

| input | output | state |
|---|---|---|
| `evil . com` | `` | removed |
| `evil .com` | `` | removed |
| `evil .\n com` | `` | removed |
| `w w w . evil . com` | `` | removed |
| `h t t p s : / / evil . com` | `` | removed |
| `jane @ example . com` | `` | removed |
| `evil。com` | `` | removed |
| `evil dot com` | `` | removed |
| `evil. com` | `` | removed |
| `jane<at>example<dot>com` | `` | removed |

M5 spaced links and emails: 10 strings, 0 stay

#### LOW list

| input | output | state |
|---|---|---|
| `evil.tk` | `` | removed |
| `evil.ru` | `` | removed |
| `evil.de` | `evil.de` | STAYS |
| `evil.in` | `evil.in` | STAYS |
| `evil.au` | `evil.au` | STAYS |
| `evil.cn` | `` | removed |
| `evil.za` | `` | removed |
| `evil.gh` | `` | removed |
| `evil.fr` | `` | removed |
| `evil.ws` | `evil.ws` | STAYS |
| `evil.cloud` | `` | removed |
| `evil.click` | `` | removed |
| `evil.work` | `evil.work` | STAYS |
| `evil.gq` | `evil.gq` | STAYS |
| `evil.ml` | `evil.ml` | STAYS |
| `evil.vip` | `` | removed |
| `evil.icu` | `` | removed |
| `evil.sh` | `evil.sh` | STAYS |
| `evil.by` | `evil.by` | STAYS |
| `evil.so` | `evil.so` | STAYS |
| `evil.am` | `evil.am` | STAYS |
| `evil.fm` | `evil.fm` | STAYS |
| `evil.is` | `evil.is` | STAYS |
| `evil.xxx` | `` | removed |
| `evil.co.za` | `` | removed |
| `192.168.0.1/admin` | `` | removed |
| `127.0.0.1:8080` | `` | removed |
| `dm me on janedoe99` | `dm me on janedoe99` | STAYS |
| `via janedoe99` | `via janedoe99` | STAYS |
| `add me on discord janedoe` | `add me on discord janedoe` | STAYS |
| `jane at gmail` | `jane at gmail` | STAYS |
| `@ jane` | `@ jane` | STAYS |
| `discord: jane#1234` | `` | removed |
| `bit.ly/ 3abc` | `3abc` | STAYS |
| `go.to` | `` | removed |
| `suffer.Africa` | `` | removed |
| `whatsapp me on janedoe` | `whatsapp me on janedoe` | STAYS |

LOW list: 37 strings, 20 stay

#### Round 4 'Leaks' table (37 strings)

| input | output | state |
|---|---|---|
| `example.info` | `` | removed |
| `example.biz/x` | `` | removed |
| `site.xyz` | `` | removed |
| `my.site.online` | `` | removed |
| `shop.store/a` | `` | removed |
| `bio.link/jane` | `` | removed |
| `jane.ee` | `` | removed |
| `example.ca` | `` | removed |
| `jane.dev` | `` | removed |
| `linktr.ee/jane` | `` | removed |
| `evil dot com` | `` | removed |
| `example dot ng` | `` | removed |
| `example [dot] com` | `` | removed |
| `evil[.]com` | `` | removed |
| `hxxp://evil[.]com` | `` | removed |
| `javascript:alert(1)` | `` | removed |
| `example. com` | `` | removed |
| `0803/123/4567` | `` | removed |
| `0803_123_4567` | `` | removed |
| `0803,123,4567` | `` | removed |
| `0803:123:4567` | `` | removed |
| `0803 \| 123 \| 4567` | `` | removed |
| `0803/1234567` | `` | removed |
| `0803 one two three four five six` | `` | removed |
| `zero eight zero three 123 4567` | `` | removed |
| `０８０３１２３４５６７８` | `` | removed |
| `٠٨٠٣١٢٣٤٥٦٧٨` | `` | removed |
| `O8O31234567` | `` | removed |
| `＠jane_doe` | `` | removed |
| `@ja` | `` | removed |
| `whatsapp me on janedoe` | `whatsapp me on janedoe` | stays (ruling) |
| `FB: jane.doe` | `` | removed |
| `tg: jane` | `` | removed |
| `jane#1234` | `` | removed |
| `jane(at)example.com` | `` | removed |
| `jane.doe (at) example.com.ng` | `` | removed |
| `jane at x . com` | `` | removed |

### 2. My own sets

**Ordinary sentences, set A: 356 distinct** (227 written by hand, 80 = 20 platform words x 4 templates, 52 = every ending word as a sentence start). All end with a full stop, question mark or exclamation mark (a few headings like `Dot your i's and cross your t's.` too). Platform words at the start, middle and end (`Whatsapp is where my family talk.`, `Twitter is dead`-type, `Fb is too slow on my phone.`, `Wa group for the street is too noisy.`); `x` as a letter, `2 x 3`, `4 x 5`, `x-ray`, `X is where the debate started.`; `handle` as noun and verb; `snap` as a verb and a noun; prices and ranges (`₦500 - ₦1,000`, `between ₦75,000 and ₦90,000`, `N2.5bn`, `850m`, `30k`, `5,000 naira`, `2,500 naira`, `1,200,000 votes`, `0.5 percent`, `12.5 percent`); times, dates, scores, `No. 10`, `2024/2025 session`, `08:30`, `3-2`, `0-0`; phone-like counts (`774 local governments`, `3 phones and 2 SIM cards`); lists of years; `dot`, `at` as ordinary words; Pidgin.
- **1 of 356 changed (0.28 %)**: `The dot com bubble was before my time.` -> `bubble was before my time.` (the words "dot com" are a written link; meaning of the rest is cut, it does not read whole).
- Everything else whole: all 52 `Prices rose again. <Ending> owners complained.`, `Our people suffer. Africa should unite.`, `Rice is 85,000 naira. Shop owners are crying.`, `Go. To the market, please.`, `I will go. Me, I no fit.`, `Instagram is slow.`, `Twitter is dead.`, `I read it on x this morning.`.

**Ordinary sentences, set B: 138 written after reading the code, aimed at the rules round 4 changed** (numeric lists, prices per unit, handle + number, lower-case starters, abbreviations). Changed: B1 numbers, times, dates, scores, lists: 17 of 52; B2 (versions, handle + number, lower-case starters, `@`, abbreviations): 27 of 59 (most are listed in N2 to N4 and LOW; `A.I.`, `The U.K. and U.S.A.`, `W.H.O.`, `Ph.D.`, `p.m. and a.m.` stay whole); B3 prices per unit: 12 of 27 (N2). These are not a sample of real posts: they are shapes I picked. Added to set A they would be 57 of 494 (11.5 %); the real rate is between.
- Meaning: the changed sentences lose the figure or the phrase named in them. Those that read whole and say something else: `Dinner @ home. Net later.` -> `later.`, `The meeting is @ Ikeja. Info follows.` -> `The meeting follows.`, `I paid rent. net income dropped.` -> `I paid income dropped.` (does not read whole).

**Leak shapes: 228 strings** (150 asked; Nigerian numbers 070, 080, 081, 090, 091 with `+234`, `234`, `00234`, `0`; 16 separators, spoken, full-width; foreign +1, +44, +233, +254, +27, +91, +971, +49, +33, +86; emails and links with spaces, brackets, words, full-width and ideographic dots; handles after 14 platform words with 20 marks).
- 197 removed. 31 leave something: **N1** (1 here; in a separate set of 26 strings with two or three numbers in one run, 22 leave digits of the second number, in the examples above whole), **N5** (2: last four digits), `(202) 555-0143` (US brackets, by the rule list), `evil . COM`, `evil . Com` (ruling), `whatsapp me on jane.doe` (ruling), 16 marks between a platform word and a handle, `tiktok @ jane`, `@ jane_doe`, `sc: jane_doe`, three `twitter . com / jane` (name after link), `jane_at_example_dot_com`, `jane . doe @ example . com`. Whole emails: none. Whole links: none. Whole phones: the second number of N1 and `(202) 555-0143`. Whole marked handles (a platform word and a mark): the 16 marks above.
- Not leaked: every `+234`, `234`, `0803`, `0701`, `0812`, `0906`, `0913` number in one run with a space, dash, dot, slash, en dash, em dash, underscore, comma, middle dot, bullet, tilde, tab, NBSP; Nigerian numbers in 3-4-4, 4-3-4, 3-3-4, 4-7, 4-3-2-2, 2-2-2-2-2-2 groups with a leading 0; `+234 (0) 803 ...`; `(+234) 803 ...` (digits gone, brackets stay); full-width digits; letter O for zero; `tel:`, `sms:`; `wa.me/...`; `whatsapp://`; spoken runs starting with zero or oh, hyphenated, with commas; `jane (at) example (dot) com`, `[at]`, `{at}`, `<at>`, full-width `＠` and `．`; `evil dot com`, `evil (dot) com`, `evil [dot] ng`, `evil。com`, `evil｡com`, `h t t p s : / / evil . com`, `w w w . evil . com`, `hxxps://evil[.]com`, `t.me/x`, `youtu.be/x`, `bit.ly/3abc`.

### 3. The model's answer through the real draft route (compiled app, real SDK, local stand-in)
`POST /admin/topics/:id/summary/draft {ai:true}` as an editor, 40 strings as the model's `mainView` (`opposingView` fixed and clean). All 200. The stand-in: 50 calls, only `127.0.0.1`, body keys `contents,generationConfig`, every prompt held the fence. "empty" means the cleaned text was under 3 characters, so the route said "The AI draft was not usable" and gave the data draft.

| # | model's answer (mainView) | editor sees | route state |
|---|---|---|---|
| 1 | `Call 0803 123 4567 now` | `Call now` | 200 AI |
| 2 | `call 0803\u2013123\u20134567 now` | `call now` | 200 AI |
| 3 | `0803 123 4567, 0701 234 5678` | `, 0701 234 5678` | 200 AI |
| 4 | `+234 803 123 4567` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 5 | `(202) 555-0143` | `(202) 555-0143` | 200 AI |
| 6 | `98765 43210` | `98765 43210` | 200 AI |
| 7 | `00234 803 123 4567` | `4567` | 200 AI |
| 8 | `jane@example.com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 9 | `jane<at>example<dot>com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 10 | `jane @ example . com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 11 | `evil . com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 12 | `evil\u3002com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 13 | `h t t p s : / / evil . com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 14 | `w w w . evil . com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 15 | `https://evil.com/x` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 16 | `ig: jane_doe` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 17 | `ig = jane_doe` | `ig = jane_doe` | 200 AI |
| 18 | `tiktok @jane` | `tiktok` | 200 AI |
| 19 | `x.com/jane` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 20 | `discord: jane#1234` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 21 | `whatsapp me on janedoe` | `whatsapp me on janedoe` | 200 AI |
| 22 | `0803\u200B 123 4567` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 23 | `0803\u202E 123 4567` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 24 | `ev\u200Bil . com` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 25 | `I use whatsapp daily.` | `I use whatsapp daily.` | 200 AI |
| 26 | `Instagram is slow.` | `Instagram is slow.` | 200 AI |
| 27 | `Twitter is dead.` | `Twitter is dead.` | 200 AI |
| 28 | `Let the police handle that.` | `Let the police handle that.` | 200 AI |
| 29 | `Mark the x here.` | `Mark the x here.` | 200 AI |
| 30 | `Our people suffer. Africa should unite.` | `Our people suffer. Africa should unite.` | 200 AI |
| 31 | `Rice is 85,000 naira. Shop owners are crying.` | `Rice is 85,000 naira. Shop owners are crying.` | 200 AI |
| 32 | `100,000 - 150,000 naira per year.` | `100,000 - 150,000 naira per year.` | 200 AI |
| 33 | `Buses leave at 08:30, 09:30, 10:30.` | `Buses leave at .` | 200 AI |
| 34 | `Dates: 01/02/2024 - 05/02/2024.` | `Dates: /2024.` | 200 AI |
| 35 | `The dot com bubble was before my time.` | `bubble was before my time.` | 200 AI |
| 36 | `Paying people on the day promised matters most.` | `Paying people on the day promised matters most.` | 200 AI |
| 37 | `Prices rose again. Online classes did not work.` | `Prices rose again. Online classes did not work.` | 200 AI |
| 38 | `zero eight zero three one two three four five six seven` | `(empty: data draft, "AI draft was not usable")` | 200 DATA |
| 39 | `Send to jane.doe (at) example.com.ng please` | `Send to please` | 200 AI |
| 40 | `Follow me on insta jane_doe now` | `Follow me on now` | 200 AI |

**Editor's PUT with zero-width and direction characters** (`PUT /admin/topics/:id/summary`, an editor, 7 values; `opposingView` always `sav\u200Fing first`):

| mainView sent | stored and returned | status |
|---|---|---|
| `pay\u200Bing\u202E on\u2066 time\u2069` | `paying on time` | 200 |
| `0803\u200B 123\u200E 4567` | `0803 123 4567` | 200 |
| `jane\u200B@example\u202E.com` | `jane@example.com` | 200 |
| `ig:\u2060jane_doe` | `ig:jane_doe` | 200 |
| `ev\u200Bil . com` | `evil . com` | 200 |
| `\u202Eevil.com\u202C` | `evil.com` | 200 |
| `plain text here` | `plain text here` | 200 |

All seven have `opposingView` = `saving first`. The editor's PUT strips every `\p{Cf}` exactly as `cleanModelText` does (the new `fixc.spec.ts` case also asserts equality). The PUT does not scrub contact details: that is the editor's own text and it does not go to the provider (round 4 same).

### 4. Speed
- 64 shapes of 200 000 characters (single tokens, every pattern's trigger repeated: `a.`, `a@`, `http://`, `www.`, `ig `, `0803 `, `1-`, `1,`, number words, `dot`, ` at `, brackets, zero-width, `<at>`, 70-character labels, 40-digit groups): `scrub` (default cut to 5 000) worst **16.7 ms**; `scrub(text, 200000)` (cut lifted; nothing calls it so) worst **407.5 ms** (`a-a-a-...`); `cleanModelText` worst **5.9 ms**; `cleanPost` worst **3.6 ms**. (The machine was running the test suites at the same time.)
- 3 000 random token soups of 200 000 characters (49 tokens: phones, platform words, `@`, `.`, number words, `http://`, `₦`, zero-width): worst `scrub` **9.1 ms**; lifted cut **78.2 ms**; `cleanModelText` **7.2 ms**; `cleanPost` **5.1 ms**.
- Route with a 1 MB model answer (10 shapes: `a` x 1 000 000, `a.`, `a@`, `http://`, `one two three `, `1-`, `ig `, `0803 123 4567, `, `<`, `a-`), a GET summary sent 5 ms after each: draft **44 to 79 ms**, second request **7 to 39 ms** (the `http://` shape), all 200; the `http://` and `<` shapes gave the data draft, the others an AI draft.

### 5. The one assertion round 4 changed
`git diff 8667584 d4d6c8b -- api/test`: the only removed line is `["double five six seven eight nine zero one two", /seven|eight|nine/]` in `test/reach/scrub.spec.ts`. It is replaced by a new test `Round 4 ruling (was: removed)` that asserts `scrub("double five six seven eight nine zero one two")` is returned whole. That is the ruling ("a spoken run counts only if it starts with zero, oh, 0 or +, and reaches 10 digits": the run here starts at `five`, and is 8 digits). Nothing else changed: no other test line is removed anywhere in `api/test` (all other changes are additions: `scrub-round4.spec.ts` new, +24 lines in `fixc.spec.ts`, +7 -1 in `scrub.spec.ts`). `api/src/admin/dto.ts` and `summary-draft.ts` changes (Cf stripping on PUT, `<at>`/`<dot>` before the tag strip) are what the PUT test and the route run above show.

### 6. Gates and suites
- `npx tsc --noEmit`: exit 0.
- `eslint "{src,test}/**/*.ts"`: 0 errors, 41 warnings.
- `jest test/admin test/reach test/vote test/shared`: **44 suites passed, 44 total; 1 125 passed, 1 skipped, 1 126 total** (153.7 s).
- Whole API suite, once, fresh database, fake key exported: **107 suites passed, 107 total; 1 892 passed, 1 skipped, 1 893 total** (412 s).
- `npm run test:audio`: **13 tests, 13 pass, 0 fail**.
- Contract: `python3 docs/contract/src/build.py <temp>` exit 0; `cmp` with `docs/contract/openapi.yaml`: identical. `git diff 8667584 d4d6c8b -- docs` is empty.

## Read only
- `scrub.ts` (183 lines) and the whole round 4 diff, read in full. The route harness is the compiled tree (`tsc --outDir`) run under Node with the test harness, because the SDK cannot send a request under Jest.
- I did not open `.env` or any key file.

## Not proved
- Real posts: my rates are for sentences I wrote (356, and 138 aimed at the rules). How often real posts hold a price per litre with a decimal, two phone numbers, or a zero-led list is not measured; I think a fuel or salary price per unit is common enough to matter.
- A real model's behaviour (no live call, by design).
- The web: how the editor view renders an empty `mainView` was not checked (no web in this repo).
