VERDICT: FIX

# Verify V-FIX-C round 4, server side (verifier, API)

Code under test: `origin/v/fix-c` at 8667584 (round 3). `verify/v-fix-c` merged it cleanly (no conflict). I tested the whole tree. My specs and scripts stay out of the commit (copies in `/tmp/vfc4/s`). No `.env` opened, no live provider called: a fake key was exported, the real `@google/genai` SDK was pointed at a local stand-in (`GOOGLE_GEMINI_BASE_URL`), and the only host that stand-in ever saw was `127.0.0.1:<port>`. Scratch PostgreSQL 16 (55444) and Redis (56444) were started by me and are stopped.

Why FIX. Roles, the approve rule, the delete route, `q=@`, the mood floor, the fence, speed, the contract and every suite are fine, and L1 to L4 are closed. But the filter still fails the lead's rulings on both sides, and I found it with plain shapes:
1. **Leaks**: a plain phone number written with an en dash, em dash, bullet, tilde, asterisk, `+`, `;` or a four-character separator goes to the provider whole (`0803–123–4567`); a link or email with spaces around its dot (`evil . com`, `jane @ example . com`) goes whole.
2. **Damage**: a sentence that ends in "platform word + word + full stop" loses both words (`I use whatsapp daily.` becomes `I use`; the final full stop is counted as the "." that marks a handle). Any sentence that follows a full stop with Africa, Online, Tech, Shop, Site, Club, Info, Link, Store, Dev, Net, Org, Biz, UK, NG, XYZ or Com loses that word and the word before it (`Our people suffer. Africa should unite.` becomes `Our people should unite.`, which reads as a whole sentence and means something else). Price ranges and lists of years or prices are deleted (`100,000 - 150,000 naira` becomes `naira`).

Against the merge test: no plain phone number from my lists may get through (it does), and ordinary sentences must be damaged in under 1 in 100 (my 451 general sentences: 21 changed = 4.7 %, 10 of them = 2.2 % even after dropping every list I wrote on purpose to hit a known rule; the targeted sets below are far higher).

## Round 3 findings and their state

| # | Round 3 said | Now | The run |
|---|---|---|---|
| M1 | contact details go in plain forms | **closed for the listed forms, open for the shapes in M2 and M5 below** | All 37 round 3 "still goes" strings: 36 removed; only `whatsapp me on janedoe` stays (the lead's ruling). Table below. |
| M2 | platform words delete ordinary words | **open (MEDIUM, reopened in the sentence-final shape)** | All 30 named damaged sentences are whole now; the same sentences with a full stop at the end are not (M1 below). |
| L1 | a post can rebuild the fence | **closed** | 41 attempts through the real route, request body captured; none rebuilt or closed it (item 5). |
| L2 | `change` wrong when a mood was folded | **closed** | `null` when the mood was not its own bar last week; the contract says `type: [number, 'null']` (`docs/contract/openapi.yaml:8903`). Item 6. |
| L3 | shares do not add to 100 | **closed** | 20 000 shown weeks (82 271 generated), every sum 100. Item 6. |
| L4 | PUT summary with NUL gave 500 | **closed** | 422 for NUL, BEL, ESC, DEL and U+0085 in each of the four fields; line breaks, CR LF and tab stay 200. |

## New findings

### BLOCKER
None.

### HIGH
None.

### MEDIUM

**M1. A platform word, the next word and the sentence's full stop: both words are deleted.** `api/src/reach/scrub.ts:59-62` (`HANDLE_TOKEN`).
- Did: ran `scrub` on 50 ordinary sentences that mention x, handle, snap or a platform name, and the same sentences through the real draft route as a model answer.
- Happened: the lookahead `(?=[\w.]{0,29}[\d_.])` accepts the closing full stop as the "." that marks a handle, and the token `[\w.]{3,30}` takes it. 18 of 50 changed. Exact: `I use whatsapp daily.` -> `I use`; `The school has a whatsapp group.` -> `The school has a`; `He lost his job after a facebook post.` -> `He lost his job after a`; `They shared it on instagram widely.` -> `They shared it on`; `I read the news on twitter first.` -> `I read the news on`; `Instagram is slow.` -> (empty); `Twitter is dead.` -> (empty); `It was just a snap judgement.` -> `It was just a`; `The council did not handle complaints.` -> `The council did not`; `Let the police handle that.` -> `Let the police`; `Mark the x here.` -> `Mark the`; `That is the x factor.` -> `That is the`; `Dem talk am for wa group.` -> `Dem talk am for`; `Rumours spread on telegram fast.` -> `Rumours spread on`; `Check the poll on facebook later.` -> `Check the poll on`. Without the final full stop the builder's sentences stay whole (his spec has none with one, `test/reach/scrub-round3.spec.ts:76-96`).
- Through the model route: `Instagram is slow.` and `Twitter is dead.` as the model's answer give an empty draft, so the route falls back to the data draft and says so; `Let the police handle that.` reaches the editor as `Let the police`.
- Should: a dot counts only between word characters (`jane.doe`), never at the end.

**M2. A phone number with a separator outside `[\s\-./_,:|()]{0,3}` goes whole.** `scrub.ts:66-72` (`SEP`, `PHONE_DIGITS`, and `PHONE_MIXED` at `:74-77`). The ruling is "any separators that are not letters".
- Did: `call 0803<sep>123<sep>4567 now` for 90 separators.
- Happened (leaks, whole number stays): en dash `–`, em dash `—`, minus `−`, U+2010 and U+2011, bullet `•`, middle dot `·`, `‧`, `⁃`, `∙`, `、`, `。`, `‖`, `¦`, `¬`, `°`, and ASCII `! " $ % & ' * + ; < = > ? [ \ ] ^ \x60 { } ~`, also ` -- `, ` .. `, ` ... ` (4 or 5 characters). `0803#123#4567` leaves `#4567`. The en dash is what a phone keyboard turns `-` into. Removed: space, tab, line break, NBSP, thin space, `, . - / _ : | ( )`, `, ` and ` / `.
- Also stays: `+234 (0) 803 – 123 – 4567`; `08o3 one two three 4567` (a letter o inside a digit group). Through the model route the same.
- Should: treat any run of non-letters between digit groups as a separator (a class of `[^\p{L}\d]` with a cap on its length), after NFKC.

**M3. Prices, ranges and lists of years or prices are deleted as phone numbers.** `scrub.ts:95-99` (`phoneDigits`).
- Happened: `100,000 - 150,000 naira per year.` -> `naira per year.`; `Between 100,000-150,000 naira.` -> `Between naira.`; `I earn 100,000 - 150,000.` -> `I earn .`; `Between 10,000 - 15,000 naira per week.` -> `Between naira per week.`; `Between 2015, 2016, 2017 and 2018 nothing changed.` -> `Between and 2018 nothing changed.`; `In 1999, 2003, 2007, 2011, 2015, 2019 and 2023 we voted.` -> `In and 2023 we voted.`; `From 2019 2020 2021 2022 2023 2024 prices doubled every year.` -> `From prices doubled every year.`; `Payments of 10,000, 20,000, 30,000 and 40,000 were delayed.` -> `Payments of and 40,000 were delayed.`; `The levy list was 1000, 2000, 3000, 4000, 5000.` -> `The levy list was .` Each loses the figures. `N10,000-N15,000` and `₦100,000 - ₦150,000` stay (a letter or symbol breaks the run).
- This is what the ruling says ("10 or more digits with any separators"), so it is a design clash with "prices, years and dates stay". A cheap guard: a run is a phone only if its first group starts with 0, +, or 234 or the groups are 3 to 4 digits, or the run is not a list of 4-digit years or thousands groups (`\d{1,3}(,\d{3})+` items).
- Builder's "10 or more digits split by spaces" case: 7 of my 451 sentences (`2 3 4 5 6 7 8 9 10 11 teachers were sacked.` -> `teachers were sacked.`, `Counting: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 and we start again.` -> `Counting: and we start again.`, `Page 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 are blank.`, `Bags 12 13 ... 21 were delivered.`, `Sections 1,2,...,10 apply.`, `Three. Four. Five. Six. Seven. Eight. Nine. Ten.`, `Count: one. Two. ... Nine.`). All are lists I wrote to hit it; in running text they are rare.

**M4. A sentence that starts with Africa, Online, Tech, Shop, Site, Club, Info, Link, Store, Dev, Net, Org, Biz, UK, NG, XYZ or Com loses that word and the word before the full stop.** `scrub.ts:45` (third alternative of `ENDING_LINK`, `\b${LABEL}\.\s{1,2}(?:${COMMON_ENDINGS})\b`, case-insensitive). This is the builder's "`example. com` only for 16 endings" case.
- Happened (30 of 34 targeted sentences; I picked the starters): `Our people suffer. Africa should unite.` -> `Our people should unite.` (reads whole, says something else, would be published unnoticed); `Nigeria is blessed. Africa watches us.` -> `Nigeria is watches us.`; `I could not go to school. Online classes did not work either.` -> `I could not go to classes did not work either.`; `Rice is 85,000 naira. Shop owners are crying.` -> `Rice is 85,000 owners are crying.`; `It cost me 5,000. Biz is slow these days.` -> `It cost me 5, is slow these days.`; `Hunger is real. Shop prices doubled.` -> `Hunger is prices doubled.`
- How often: 0 of my 451 general sentences (none began with one of the 17 words), 30 of 34 when they do. So the rate is the share of sentences that start with one of them; `Africa` and `Online` are the likely ones in these posts. Case is ignored, so `Net`, `Org`, `Link`, `Site` and `Club` bite too.
- Should: require no space (`example.com`, which another branch of the pattern already covers) or a lower-case ending: `\b${LABEL}\.\s{1,2}(?:endings)\b` with the ending case-sensitive lower, and not at the start of a sentence word.

**M5. A link or an email with spaces around its dot or at sign goes whole.** `scrub.ts:23-24` (`DOT`, `AT_SYM`), `:27-30`, `:44-47`.
- Happened (leaks): `evil . com`, `evil .com`, `evil .\n com`, `w w w . evil . com`, `h t t p s : / / evil . com`, `jane @ example . com`, `evil。com` (U+3002). The ruling lists "written-out and broken forms only when the last word is a listed ending": `com` is. `evil. com` (one space after) and `evil dot com` are removed, so the pattern is half there.
- Model route only: `jane<at>example<dot>com` comes out as `jane example com`: `cleanModelText` (`api/src/admin/summary-draft.ts:116-130`) strips tag-like `<at>` and `<dot>` before `scrub` sees them, so the written-out email is split but its words stay. The editor path gives an empty string for the same input.
- Should: allow `\s{0,3}` around every dot and at sign when the last label is a listed ending; run `scrub` before the tag strip (or treat `<at>`/`<dot>` as brackets first).

### LOW (residue, by the rulings or rare)
- Endings outside the list still go bare (the ruling allows this): `evil.tk`, `.ru`, `.de`, `.in`, `.au`, `.cn`, `.za`, `.gh`, `.fr`, `.ws`, `.cloud`, `.click`, `.work`, `.gq`, `.ml`, `.vip`, `.icu`, `.sh`, `.by`, `.so`, `.am`, `.fm`, `.is`, `.xxx`. `.in` and `.co.za` are the ones to add. With a path or `http://` they go.
- `192.168.0.1/admin` stays (the path pattern needs a letter first; `127.0.0.1:8080` goes, as a 10-digit run).
- Bare handles with no mark, by the ruling: `dm me on janedoe99`, `via janedoe99`, `add me on discord janedoe`, `jane at gmail`, `@ jane` (an at sign and a space). `discord: jane#1234` removes `jane` and leaves `#1234`.
- `bit.ly/ 3abc` (a space after the slash) leaves `3abc`.
- NFKC changes visible text: `…` becomes `...`, `½` becomes `1⁄2`, `№` becomes `No`. No meaning lost.
- The model route accepts a PUT with U+200B or U+202E (RLO) typed by an editor (only `\p{Cc}` is refused); the model path strips them. The editor and the model path therefore differ on those two characters only (2 of 828 strings differed in the whole run, the other one being `<evil.com>`: model route gives empty, the editor path `<>`).
- The "linear, 200 000 characters under 50 ms" ruling holds because `scrub` cuts to 5 000 first (default). With the cap lifted to 200 000, `scrub(text, 200000)` on `a-a-a-...` takes 289 ms and `1-1-1-...` 387 ms (linear, constant factor high); nothing calls it that way.

## Proved by runs

### 1. Leaks
The round 3 "still goes" list (37 strings, exact), `scrub` output, state:

| # | string | after `scrub` | state |
|---|---|---|---|
| 1 | `example.info` | (empty) | removed |
| 2 | `example.biz/x` | (empty) | removed |
| 3 | `site.xyz` | (empty) | removed |
| 4 | `my.site.online` | (empty) | removed |
| 5 | `shop.store/a` | (empty) | removed |
| 6 | `bio.link/jane` | (empty) | removed |
| 7 | `jane.ee` | (empty) | removed |
| 8 | `example.ca` | (empty) | removed |
| 9 | `jane.dev` | (empty) | removed |
| 10 | `linktr.ee/jane` | (empty) | removed |
| 11 | `evil dot com` | (empty) | removed |
| 12 | `example dot ng` | (empty) | removed |
| 13 | `example [dot] com` | (empty) | removed |
| 14 | `evil[.]com` | (empty) | removed |
| 15 | `hxxp://evil[.]com` | (empty) | removed |
| 16 | `javascript:alert(1)` | (empty) | removed |
| 17 | `example. com` | (empty) | removed |
| 18 | `0803/123/4567` | (empty) | removed |
| 19 | `0803_123_4567` | (empty) | removed |
| 20 | `0803,123,4567` | (empty) | removed |
| 21 | `0803:123:4567` | (empty) | removed |
| 22 | `0803 \| 123 \| 4567` | (empty) | removed |
| 23 | `0803/1234567` | (empty) | removed |
| 24 | `0803 one two three four five six` | (empty) | removed |
| 25 | `zero eight zero three 123 4567` | (empty) | removed |
| 26 | `０８０３１２３４５６７８` | (empty) | removed |
| 27 | `٠٨٠٣١٢٣٤٥٦٧٨` | (empty) | removed |
| 28 | `O8O31234567` | (empty) | removed |
| 29 | `＠jane_doe` | (empty) | removed |
| 30 | `@ja` | (empty) | removed |
| 31 | `whatsapp me on janedoe` | `whatsapp me on janedoe` | **still goes** (left by ruling: bare name, no mark) |
| 32 | `FB: jane.doe` | (empty) | removed |
| 33 | `tg: jane` | (empty) | removed |
| 34 | `jane#1234` | (empty) | removed |
| 35 | `jane(at)example.com` | (empty) | removed |
| 36 | `jane.doe (at) example.com.ng` | (empty) | removed |
| 37 | `jane at x . com` | (empty) | removed |

Own shapes: 247 strings aimed at each rule (spacing, case, Unicode look-alikes, zero-width characters inside, line breaks inside, mixed scripts, Nigerian phones with +234, 234, 00234, 0 and 0-prefixed with every separator, accounts, BVN, NIN, card numbers, short links, emails with plus signs and subdomains, handles after "on", "via", "dm me", Discord tags, number words, Arabic-Indic, Persian, full-width and mathematical digits). 40 left something: the ones named in M2, M5 and LOW above (24 are the unlisted endings). 207 removed. A further grid of 90 phone separators: 42 leak (M2).

### 2. Damage
The round 3 damaged sentences (30 exact, with the untouched ones the report named):

| # | sentence | after `scrub` | state |
|---|---|---|---|
| 1 | `the x factor` | `the x factor` | whole |
| 2 | `handle with care` | `handle with care` | whole |
| 3 | `insta-worthy` | `insta-worthy` | whole |
| 4 | `handle the situation` | `handle the situation` | whole |
| 5 | `my handle was stolen` | `my handle was stolen` | whole |
| 6 | `x marks the spot` | `x marks the spot` | whole |
| 7 | `x is fine` | `x is fine` | whole |
| 8 | `the x ray` | `the x ray` | whole |
| 9 | `twitter is dead` | `twitter is dead` | whole |
| 10 | `tiktok is loud` | `tiktok is loud` | whole |
| 11 | `instagram is slow` | `instagram is slow` | whole |
| 12 | `telegram is down` | `telegram is down` | whole |
| 13 | `insta pay` | `insta pay` | whole |
| 14 | `I use whatsapp every day` | `I use whatsapp every day` | whole |
| 15 | `snap out of it` | `snap out of it` | whole |
| 16 | `the ig nobel` | `the ig nobel` | whole |
| 17 | `ig is short for igbo` | `ig is short for igbo` | whole |
| 18 | `on x handle` | `on x handle` | whole |
| 19 | `we have been at it dot by dot` | `we have been at it dot by dot` | whole |
| 20 | `I will be at home dot dot dot` | `I will be at home dot dot dot` | whole |
| 21 | `1 2 3 4 5 6 7 8` | `1 2 3 4 5 6 7 8` | whole |
| 22 | `pay so people can handle payments on time` | `pay so people can handle payments on time` | whole |
| 23 | `meet at the bank at noon` | `meet at the bank at noon` | whole |
| 24 | `page 3 of 5 dot points` | `page 3 of 5 dot points` | whole |
| 25 | `one two three four five six` | `one two three four five six` | whole |
| 26 | `call me at noon` | `call me at noon` | whole |
| 27 | `prices are 5,000 naira` | `prices are 5,000 naira` | whole |
| 28 | `born in 1990` | `born in 1990` | whole |
| 29 | `08 September` | `08 September` | whole |
| 30 | `I have one two three four five six reasons` | `I have one two three four five six reasons` | whole |

The round 3 "65 ordinary posts": that file lived in the third check's `/tmp` and is not on any branch; I could not run it. I ran the 30 sentences the report names, and my own sets instead. If you have the 65, run them against M1.
My sets (`scrub`): 451 general sentences (Nigerian English and Pidgin, with "x", "handle", "snap", "at", "dot", "to", "me", "co", "go.to", "It. Me", years, naira with commas, `2,000,000,000 naira`, dates, times, scores, `No. 1`, `e.g.`, `i.e.`, `a.m.`, `Dr.Ade`, `St.Mary`, `U.S.A`, `Mr.Bello`, joined words) 21 changed; 63 sentences (50 with x, handle, snap or a platform name, 13 with a missing space before an ending word) 31 changed (18 and 13); 34 sentences with a sentence starting on an ending word 30 changed. The 21: 4 `go.to` (`Go.To the market and buy yams.` -> `the market and buy yams.`, `I will go.To be honest, I am tired.` -> `I will be honest, I am tired.`), 7 number or number-word lists (M3), 3 year lists, 4 price lists or ranges, 2 `dot com` (`The dot com bubble was before my time.` -> `bubble was before my time.`), 1 `snap judgement.` (M1). Unchanged and checked: all the `Dr.Ade`, `St.Mary`, `U.S.A`, `Mr.Bello`, `e.g.`, `i.e.`, `a.m.`, `No. 1`, scores `3-2`, times, dates, `2,000,000,000 naira`, `It. Me`, `Me, I no go vote again.`
The builder's four things left on purpose, measured: (a) `go.to` as a link: 4 of 451 (all sentences I wrote to contain it; the natural form is a missing space before "To" or "Me" after a full stop: 13 of the 13 sentences I wrote with Me, Us, To, Top, Live, Pro, Page, Site, Online or Co after the full stop; 0 of the 10 with an ordinary starter such as Then, But, So); (b) 10 or more digits split by spaces: 7 of 451, all lists I built; (c) `example. com`: M4; (d) the bare name after `whatsapp me on`: left, as ruled.
Meaning lost: every changed sentence loses words; those where the rest still reads whole and says something different are M4's (`Our people suffer. Africa should unite.`).

### 3. The model's answer path (real draft route, real SDK, local stand-in)
828 model answers (the 30, the 37, the 247 and the 514 sentences of the first two sets; the 34 of M4 were run through `scrub` only). Request body the stand-in saw: keys `contents`, `generationConfig` only; prompt text only; no author, id or email; the abort signal is not sent. The route answered 200 each time. Damaged phrases: the 30 round 3 sentences all came through whole; of my 514 ordinary ones, 53 changed or fell back (the same ones as in item 2 plus `Twitter is dead.` and `Instagram is slow.`, which became empty, so the route said "The AI draft was not usable", and `It is a 2-1 decision, not unanimous.`, refused by the existing "unanimous" guard). Leak shapes: 74 of the 247 produced an AI draft with something left; 173 left under 3 characters and fell back to the data draft; the leaks in the draft are the 41 above (40 plus `jane<at>example<dot>com`). Of 37 round 3 leak strings 36 fell back to data and `whatsapp me on janedoe` came through (ruled).

### 4. Speed
`scrub`, `scrub(...,200000)`, `cleanModelText`, `cleanPost`, each on 47 shapes of 200 000 characters (single tokens, every pattern's trigger repeated, 70-character labels, markers, zero-width, line breaks): worst `scrub` 8.4 ms, `cleanModelText` 4.5 ms, `cleanPost` 5.4 ms; `scrub` with the cap lifted 289 ms. 3 000 random token soups of 200 000 characters: worst `scrub` 6.7 ms, `cleanModelText` 1.8 ms, `cleanPost` 11.4 ms, lifted-cap `scrub` 49.6 ms. Route with a 1 MB model answer (one token, dots and `@`, `http://`, number words, `<`, `ig `, `a-`, `1,`) while a second request (GET summary) was sent 5 ms later: draft 21 to 30 ms, second request 4 to 8 ms, all 200.

### 5. L1, fence
41 attempts (nesting, doubled markers, `<<<<`, spaces, tab, NBSP and line breaks inside, zero-width inside, word-joiner, invisible separator, full-width `＜＜＜ＰＯＳＴＳ`, mathematical small capitals, `<<<POSTS>>>` x 200, 5 000 `<`, `«`, `‹`, `≫`, markers split across two posts, a second post carrying `9. injected`), each as published answers on a live question, request body captured. Every prompt held exactly the instruction's own pair plus the one real pair; the fence body had exactly as many lines as posts, numbered 1.. in order, the last line `POSTS>>>`. Posts come out as `1. POSTS POSTS` or `1.  POSTS`; no post line begins or ends a marker. `‹‹‹POSTS`, `POSTS»»»` and `POSTS≫` pass through, are not the marker, and are LOW at most.

### 6. L2, L3, L4
`weekEmotions` over a stub database (floor 20), 82 271 random weeks until 20 000 were shown (1 to 4 moods, single moods 14 274, ties 14 948, with and without a last week): every sum 100; every `change` null exactly when last week had under the floor or the mood was not its own bar last week, else this share minus last week's share; no bar or "Other" under 5 people. Single mood 30 vs 25: Tired 100, change 0. Single mood of 4, floor 3: nothing. `7/7/7` is `34/33/33`; `13/13/13/1` is `33/33/32/2`. Round 3's own case (last week Angry 4, Tired 16; now Tired 15 of 35): `Tired 43 change null`. PUT: 422 for NUL, BEL, ESC, DEL, U+0085 in each of the four fields; 200 for `\n`, `\r\n`, `\t`, a blank line; U+200B and U+202E also 200 (LOW). Model path and editor path agree on control characters; they differ on zero-width and RLO (LOW above).

### 7. Nothing else moved
Roles (guest / member / MODERATOR / EDITOR / AD_MANAGER / ADMIN), every route this branch adds or changes: GET summary, POST summary/draft, PUT summary 401 / 403 / 403 / 200 / 403 / 200; GET proposal-questions, GET proposals, POST proposal-groups (201), DELETE proposal-groups 401 / 403 / 200 / 403 / 403 / 200; GET users?q 401 / 403 / 403 / 403 / 403 / 200 (ADMIN only); GET weekly-reports 401 / 403 / 403 / 200 / 403 / 200. Approve rule on a topic of 40 voices: 0+10, 10+0, 0+0, -1+10, 1.5+10, 21+20, 40+1 with approve: 422; 1+1, 20+20, 39+1: 200; without approve 10+0, 0+0, 1000+1000: 200. Mood floor: item 6 and the suite. Delete route: guest, member, EDITOR, AD_MANAGER refused, MODERATOR and ADMIN 200 (the suite also checks the audit row, `released` and the second 404). `q=@`, ` @ `, `@@`, `%`, `_`: 200, 0 rows; `@r4r.user1`: 1 row; `@@r4r.user1`: 0; empty: 422.

### 8. Against what goes live first
`git merge --no-commit origin/v/batch-api-1114c2` (4ee61be) onto `origin/v/fix-c` in a scratch worktree: **no conflict**. Auto-merged: `api/src/reach/share-subject.ts`, `api/src/reach/weekly-draft.ts` (it adds `questionReadableWhere` at the answer query, `:379`), `api/src/vote/proposal.service.ts`, `docs/contract/openapi.yaml`, `docs/contract/src/build.py`, `docs/contract/src/schemas.py`. On that merged tree `tsc --noEmit` exit 0, and `build.py` output and `docs/contract/openapi.yaml` are identical (`cmp`). The scratch worktree is removed.

### 9. Contract, gates, suites
- Contract: `python3 docs/contract/src/build.py <temp>` exit 0, `cmp` with `docs/contract/openapi.yaml`: identical (also after the merge in item 8). No contract change in this round (`git diff 088ddb4 8667584 -- docs` is empty).
- `npx tsc --noEmit`: exit 0. `eslint "{src,test}/**/*.ts"`: 0 errors, 41 warnings (same as round 3).
- `test/admin test/reach test/vote test/shared`: **43 suites passed; 651 passed, 1 skipped, 652 total**.
- Whole API suite once (fresh database, fake key exported): **106 suites passed, 106 total; 1 418 passed, 1 skipped, 1 419 total** (498 s). `npm run test:audio`: **13 tests, 13 pass, 0 fail**.
- Assertions changed in `088ddb4..8667584` (every removed test line): `{ name: "Other", share: 50, change: 50 }` became `change: null` in `fixc.spec.ts` (the ruling: null when it was not its own bar last week; the new test `a mood that was not its own bar last week has change null` adds the case). Five lines removed from `scrub.spec.ts`: `ig - janedoe`, `tiktok na janedoe`, `snapchat janedoe`, `telegram janedoe`, `whatsapp janedoe`, each now asserted to stay whole in `Round 3 ruling (was: removed)`: that is the ruling (a platform word followed by a bare word, no `:`, `@`, digit, `_` or `.`). `whatsapp me on janedoe` is added to the same list. Nothing else was weakened; `scrub-round3.spec.ts` is new. The new "stay whole" lists have no sentence-final full stop, which is why M1 passed them.

## Read only
- `@google/genai` reads `GOOGLE_GEMINI_BASE_URL` at construction (used for the stand-in). Under Jest the SDK cannot make a request ("Undici globalDispatcher is not available"), so the route runs were done with the compiled app in plain Node (the same app module, harness and database).
- The web is not in this repo: how it renders `Emotion.change` null is not checked.

## Not proved
- The round 3 "65 ordinary posts" (not available, see item 2) and a real Gemini model's behaviour with any of this (no live call, by design).
- How often real posts start a sentence with Africa, Online and the like, or end one with a platform word: my rates are for sentences I chose to hit those rules (63 and 34), and 21 of 451 for the general set; real posts are in between.
- Two editors racing an approve against a falling `answerCount` (not touched by this round).
