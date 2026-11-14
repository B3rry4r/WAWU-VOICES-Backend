VERDICT: FIX

# Verify V-FIX-C round 6, server side (verifier, API)

Code under test: `origin/v/fix-c` at 5ecb4b6 (round 5). `git merge origin/v/fix-c` into `verify/v-fix-c` was clean (merge commit ee41eb6), so the merged tree was tested; its `api/` is 5ecb4b6's. My scripts and specs are in `/tmp/v6` and are not in the commit. No `.env` or key file opened. A fake key was exported; the real `@google/genai` SDK was pointed at a local stand-in (`GOOGLE_GEMINI_BASE_URL`); the stand-in saw 40 calls, all `Host: 127.0.0.1`, body keys `contents,generationConfig` only. Own PostgreSQL 16 (55555) and two Redis (56555, 56556) were started by me and are stopped.

## Why FIX

Every round-5 finding is closed and the model path does what ruling A says: the mark is visible, the note is there exactly when a mark is (one small exception, L1), a mark-only draft falls back to the data draft, and **0 of 373** ordinary sentences got a mark in the model path (0 changed in the posts path). But the posts-path criterion fails: phone numbers of the ruled shapes still go out whole, and so does an email, in four shapes that each take one line to write:

1. **A separator of six or more characters hides a phone.** `call 0803      123      4567 now` (6 spaces) goes out whole in both paths. Same for `   -   `, `------`, `......`, six tabs, six line breaks.
2. **A number list of 19 or 20 numbers in front of a phone splits it.** `7 8 9 1 2 3 4 5 6 7 8 9 1 0803 123 4567` goes out whole in both paths.
3. **Two fully spoken numbers in one run: the second goes whole** (N1 again, in words): `zero eight zero three one two three four five six seven, oh seven zero one two three four five six seven eight` -> `, oh seven zero ... eight`.
4. **An email whose domain has a non-ASCII letter goes whole.** `jane@müller.de`, `jane@пример.рф`, `jane@例え.jp`, and the lookalike `jane@ех.com` (Cyrillic е and х) all come out unchanged.

And one thing in the model path fails the lead's "never silent" line: text in angle brackets is cut with no mark (M1).

## Round 5 findings and their state

| # | Round 5 said | Now | The run |
|---|---|---|---|
| N1 | the second phone in a run stays | **closed for digits; one shape left (new F3)** | All 21 exact strings (comma, slash, dash, `;`, `|`, `&`, newline, plain space, three numbers, `+234`, foreign, `(202) 555-0143 / (202) 555-0199`, unbroken): digits all gone, in both paths. Left: two fully spoken numbers (F3), a list in front (F2). |
| N2 | price per unit deleted as a link | **closed** | 24 of 24 exact strings whole in both paths (`N617.50/litre`, `N1.5m/month`, `Dr.Ade/Dr.Bola`, `Mr.Bello/Mrs.Bello`, `v1.2/final`, the 9 that were whole). Real path links still go (`twitter.com/janedoe`, `bit.ly/3abcde`, `evil.zz/path` ...) but see F5. |
| N3 | lists starting with 0 deleted | **closed** | 23 of 23 strings: 22 whole; `Section 123.456.7890` is removed (ruled: `ddd.ddd.dddd`). Times, scores, dates, decimals, `070, 080, 081, 090, 091`, `234, 235, 236, 237`, `Votes 123 456 7890` stay whole. |
| N4 | `handle 10k`, `ig 24x7` etc. deleted | **closed** | 17 of 17 whole in both paths. |
| N5 | `00234 803 123 4567` leaves `4567` | **closed** | `00234 803 123 4567`, `00234-803-123-4567`, `002348031234567`, `+234 803 123 4567`: all removed. |
| LOW | list | **as ruled** | 21 phone forms, 5 spoken, 29 marks, handles, lower-case starters, `dot com`, IPv4-shaped: same as round 5 (see "Left by ruling"). Two changed for the better: `ig: x`/`ig @x` (one-letter handle) now stay whole, `(202) 555-0143` now goes (rule e). |

## New findings

### BLOCKER
None.

### HIGH

**F1. A separator of 6 or more characters between the groups of a phone: the phone goes out whole, in both paths.** `scrub.ts:105` (`PHONE_CHAIN`: `[^\p{L}\d]{1,5}` between groups); whitespace is collapsed only at the end (`:247`), after the phone step.
- `call 0803      123      4567 now` (6 spaces) -> posts `call 0803 123 4567 now`; model `call 0803 123 4567 now`. 8 spaces, 6 tabs, 6 line breaks, 7 NBSP: same.
- `call 0803   -   123   -   4567 now` -> `call 0803 - 123 - 4567 now` (both paths).
- `call 0803------123------4567 now`, `call 0803......123......4567 now`, `call 0803_ _ _ _123_ _ _ _4567 now`: whole.
- `call +234      803 123 4567 now`, `call 0803      1234567 now`, `call 0803      one two three four five six seven now`: whole.
- 5 characters (`     `, ` – – `) are removed; 6 are not. Shape B phones, so the posts-path merge test fails.
- Should: take whitespace and repeated marks out of the working text before the phone step (collapse `\s+` to one space and any run of the same mark to one), or raise the cap and collapse. Round 5 asked for 2 to 5; the lead asked "every separator".

**F2. A run of 19 or 20 numbers in front of a phone cuts the phone in two.** `scrub.ts:105` (`{1,20}`: a chain holds at most 21 tokens; the next chain starts after it). If a phone straddles token 21 of a chain, neither half is a phone.
- `1 2 3 4 5 6 7 8 9 1 2 3 4 5 6 7 8 9 1 0803 123 4567` (19 single numbers, then the phone) -> posts: the same string, unchanged; model: unchanged, no mark. With 20 numbers in front (`... 9 1 2 0803 123 4567`): same. With 18 in front: phone removed (`... 8 9` / `... 8 9 [removed]`); with 21 in front: removed. So it is a position: the phone straddles token 21 of a chain.
- Natural cause: any long numbered list or table directly before a number. Deliberate cause: anyone padding a post.
- Should: do not cap the chain in the regex; walk all digit groups in the text (the token walk in `phoneChain` already exists) or restart the next chain on the last 10 tokens of the cut one.

**F3. Two fully spoken (or `0 8 0 3 ...` single-digit) numbers in one run: the second stays whole.** Same cap: two spoken numbers are 22 tokens.
- `zero eight zero three one two three four five six seven, oh seven zero one two three four five six seven eight` -> posts `, oh seven zero one two three four five six seven eight`; model `[removed], oh seven zero ...`. With ` `, ` / `, newline between: same. With `and` between: both removed (a word breaks the chain).
- `0 8 0 3 1 2 3 4 5 6 7, 0 7 0 1 2 3 4 5 6 7 8` -> `, 0 7 0 1 2 3 4 5 6 7 8`.
- Digits mixed with words (`0803 one two three ... seven, 0701 two three ...`) are removed (fewer tokens).

**F4. An email with a non-ASCII domain goes out whole.** `scrub.ts:15-16` (`LABEL = [a-z0-9-]`, `LOCAL = [a-z0-9._%+'-]`: ASCII only, no `u` flag). The ruling: no email with an at sign gets through whole.
- `mail jane@müller.de now`, `mail jane@пример.рф now`, `mail jane@例え.jp now`, `mail jane@ех.com now` (Cyrillic е, х) -> unchanged, both paths.
- `mail jane@café.com now` -> posts `mail janeé.com now`, model `mail jane [removed] é.com now` (the email is not whole, but part of its domain stays).
- `mail ジェーン@example.com now` -> `mail ジェーン@ now`.
- A homoglyph domain is a one-keystroke bypass of the whole email rule. Should: `\p{L}\p{N}` with the `u` flag in LABEL and LOCAL (and `[\w.]` in HANDLE_AT).

### MEDIUM

**M1. The model path still removes text with no mark: anything between `<` and `>`.** `summary-draft.ts:130-131` (`.replace(/<\/?[a-z!][^<>]{0,200}>/gi, " ")`, runs before `scrub`). Not a contact detail, so not in ruling A's letter, but it is the failure the lead named: words vanish and the sentence reads whole. The editor gets no mark and no note.
- `People said <very angry> about it.` -> `People said about it.` (route item 31: AI draft, no note).
- `He wrote <sad> in the chat.` -> `He wrote in the chat.`; `We want <everyone> to vote.` -> `We want to vote.`; `Press <Enter> to continue.` -> `Press to continue.`; `The sign said <Closed> today.` -> `The sign said today.`; `If x <y and z> w then stop.` -> `If x w then stop.`.
- `<5%`, `<18`, `1 < 2` lose only the sign (no words). `<b>bold</b>` -> `bold` is the intent.
- Should: replace a removed tag with the mark unless it is a known harmless tag name (`b i u em strong p br span ul ol li`), or mark all of them.
- Also silent: the model's answer is cut at 600 characters (`summary-draft.ts:138`) with no mark: 840 characters of `Rice is dear. ` came back as exactly 600, ending mid-sentence. The prompt asks for short views, so it is rare; a mark or a note would close it.

**M2. One-letter hosts with a path now leave the path.** `scrub.ts:40` (PATH_LINK: the first label must be 2 or more letters; the N2 fix). Round 5 removed these; now: `t.me/janedoe` -> `/janedoe`, `x.com/janedoe` -> `/janedoe`, `g.co/janedoe`, `m.me/janedoe`, `t.co/abc123`, `x.co/abc`, `a.co/d/abcdef` -> `/d/abcdef`; `v.gd/abc` whole (ending not in the list). The host goes and the account name stays, so a Telegram or X contact still goes out as `/janedoe`. Through the route: `x.com/jane` -> `[removed] /jane` (item 19). Should: keep the `Dr.`-style title guard and the digit guard, but allow one letter when the last label is in ENDINGS.

### LOW

- **L1.** The note can be there with no mark in the draft: `opposingView` that is only a mark is dropped to empty, and the note is still added (route items 36 and 39: `Pay people on time.` / `jane@example.com` -> opposing `""`, note "Something that looked like a contact detail was taken out. Check the marked places." and no mark shown). It tells the editor something real (the view is blank), but "exactly when a mark is" is not literally true.
- Email leftovers (local part stays when the domain is removed, not an email): `zqx_doe+tag at mail dot example dot co dot uk` -> `zqx_doe+`; `zqx dot doe at yahoo dot com` -> `zqx dot`; `jane,@example.com` -> `jane,@`; `jane@@example.com` -> `jane@@`; `"jane doe"@example.com` -> `"jane doe"@`; `jane      @      example.com` -> `jane @`; `jane@[192.168.0.1]` -> `jane@[]`.
- Spoken email with an unlisted ending: `jane at example dot zz` whole (ruled: endings outside the list).
- `https:\\evil.zz`, `https:/evil.zz`, `http//evil.zz`, `https%3A%2F%2Fevil.zz`, `evil.zz?x=1`, `a.bc/d`, `café.com`, `пример.рф`, `例え.jp` stay whole (no scheme with `://`, no www, ending outside the list).
- `@ zqxjane` (at sign, space, name), `u/zqxjane`, `reddit u/zqxjane` stay.
- `0803 one two three four five six now` (10 digits) stays: ruling B asks for 11. The `(415)555-0143` form (no space after the bracket) stays; `(202) 555-0143` goes.
- In the model path, `\s+([.,;:!?)])` -> `$1` removes the space before any such mark: `ok :)` -> `ok:)`, `Prices ( see below ) rose.` -> `Prices ( see below) rose.`. Cosmetic.
- `(.)` is read as a dot with its spaces: `He said (.) and left.` -> `He said.and left.` (words joined, not lost).
- NFKC changes: `½` -> `1⁄2`, `m²` -> `m2`, `№ 5` -> `No 5`, `…` -> `...`. Cosmetic.
- Handle token eats the next word after `platform word + colon`: `She is on WhatsApp: it is free.` -> posts `She is on is free.` / model `She is on [removed] is free.`; `Instagram: the new market.` -> `[removed] new market.` (noise, marked).

## Left by ruling (D), checked, not against the verdict

Landlines and foreign numbers in spaced groups with no `+` stay whole (`98765 43210`, `44 7911 123456`, `33 6 12 34 56 78`, `803 1234 567` ...: 17 of 17 as before); bare names (`dm me on janedoe99`, `via janedoe99`, `whatsapp me on jane.doe`); `go.to` and `suffer.Africa` removed; endings outside the list (`evil.de .in .au .ws .work .gq .ml .sh .by .so .am .fm .is`) stay; `twitter . com / jane` -> `/ jane`; `jane . doe @ example . com` -> `jane .`; IPv4-shaped versions (`Version 1.2.3.4 is out.` -> `Version is out.`); `The dot com bubble ...` -> `bubble ...`; spoken runs not starting with zero or oh (`eight zero three ...`, `nought ...`, `o eight o three ...`, `... for ...`); marks between a platform word and a handle (now `ig = jane_doe`, `ig -> jane_doe`, `ig | jane_doe`, `ig ~ ...` are removed, but `ig ( jane_doe )`, `ig [jane_doe]` leave the closing bracket or quote).

## Proved by runs

### 1. The exact strings of the round 5 N1 to N5 and LOW lists (232 strings, both paths)
Run through `scrub` (posts) and `cleanModelText` (model), saved in `/tmp/v6/run1.out`. State per group:
- N1 (21 strings): posts path leaves only the separators (`,`, `/`, `-`, `;`, `|`, `&`, `, ,`, `()`), no digit. Model path: every number is `[removed]` (`0803 123 4567, 0701 234 5678` -> `[removed], [removed]`; `1, 0803 123 4567, 2, 0701 234 5678` -> `1, [removed], 2, [removed]`; `0803 123 4567 0701 234 5678` posts `` and model `[removed] [removed]`).
- N2 (24): 24 whole. N3 (23): 22 whole, 1 removed by rule e. N4 (17): 17 whole. N5 (4): 4 removed (`[removed]` in the model path).
- LOW (about 164): as listed above and in the round 5 table; no regression except M2.

### 2. My own sets
- **Set A, 373 ordinary sentences** (Nigerian English and Pidgin, every one ends in `.`, `?` or `!`): fuel, food, rent and salary prices per unit (`N617.50/litre`, `N1.2k/paint`, `N2.5m/year`), times and timetables, scores, dates and ranges (`01/02/2024 - 05/02/2024`), election and budget figures, lists of years, 33 platform words x 4 positions (incl. `x`, `handle`, `snap`, `Handle`, `sc`), `Dr.`/`Mr.`/`Mrs.`/`Prof.` with and without a space, version numbers (`v2.3.1`, `Android 14.1`, `iOS 17.2`, `Node 20.11.1`), Pidgin. **Posts path: 0 of 373 changed. Model path: 0 of 373 got a mark, 0 changed in any way** (after the model path's own space-before-mark tightening and NFKC).
- **Set B, 128 sentences aimed at the rules** (10-digit unbroken numbers, `ddd-ddd-dddd`, short codes, `*901#`, lists starting with 0, lower-case starters after a full stop, `Platform: word`, `@` with spaces, file names, `.com` in prose, price per unit without a currency tag): posts changed 18, model marked 18, **silent changes 0**. The 18 are: unbroken numbers of 10 or more digits (`He stole 1500000000 naira`, `N10000000000 was approved!`: ruled, rule d), `Section 123-456-7890`, `We love Nigeria.Ng is home!`, `She is on WhatsApp: it is free.`, `Instagram: the new market.`, `Snap: it broke.`, `Handle: carefully.`, `X: it is gone.`, `Discord: too noisy.`, `Cement @ N9.5k per bag was normal.`, `Check www.example is not a link.`, `We use .com and .ng domains.`, `Go to the .gov.ng site?`, `The domain ends in dot com in speech.` Each is a visible mark. Set A and B together: 18 of 501 (3.6 %); A alone 0 of 373.
- **Model path silent changes (loss of words with no mark): none in A or B. Found by probing: M1** (angle brackets, 600-character cut).
- **Leak shapes, 387 strings + 45 + 9 + 14 more in both paths** (`/tmp/v6/leak*.mts`): 143 single Nigerian mobiles (13 prefixes x 11 groupings x separators incl. `+234`, `234`, `00234`, `2340`, `+234 (0)`, `(0803)`), 60 runs of two and three numbers (15 joiners: `, / - ; | & \n` plain space, `,` no space, `and`, `or`, `/`, en dash, space-comma, blank line; spaced, dashed, unbroken, `+234`), 9 emails x 10 forms (whole, ` @ `, `(at)`, ` [at] `, `at`/`dot`, `<at>`/`<dot>`, `[.]`, full-width `＠`, ideographic dot, upper case), 44 links, 50 handles (20 platform words x marks, `@`, `#1234`, `u/`). Results:
  - Phones: 0 whole in the 203 above (all removed or marked, no digit left). Whole in F1, F2, F3 only.
  - Emails (ASCII): 90 of 90 gone or partly gone, none whole; whole only in F4.
  - Links with `://` or `www`: 0 whole (incl. `https://user:pw@zqxevil.com`, `//`, upper case, `h t t p s`, `hxxp`, zero-width inside, full-width `ｈｔｔｐｓ：／／`). `https:\\evil.zz` and `https:/evil.zz` are whole (no `//`).
  - Handles: 40 of 40 platform-word handles gone; `@ zqxjane`, `u/zqxjane` stay (LOW).
  - Gone but a piece stays: M2 (`/janedoe`), email local parts (LOW).

### 3. The model's answer through the real draft route (compiled app, real SDK, local stand-in, 40 strings)
`POST /admin/topics/:id/summary/draft {ai:true}` as an editor, two written voices on the topic so the AI branch runs; `opposingView` fixed at `saving first` unless noted. All 200. The stand-in: 40 calls, only `127.0.0.1`, body keys `contents,generationConfig`.

| # | model's `mainView` | editor sees (`mainView`) | source | note |
|---|---|---|---|---|
| 1 | `Call 0803 123 4567 now` | `Call [removed] now` | AI | base + removed note |
| 2 | `call 0803–123–4567 now` | `call [removed] now` | AI | base + removed note |
| 3 | `0803 123 4567, 0701 234 5678` | (only marks: data draft) | DATA | "The AI draft was not usable" |
| 4, 5, 7 | `+234 803 123 4567`, `(202) 555-0143`, `00234 803 123 4567` | (only a mark: data draft) | DATA | not usable |
| 6 | `98765 43210` | `98765 43210` | AI | base only (ruled) |
| 8 to 18, 20, 22, 23 | email, `<at>`/`<dot>`, spaced, links, `ig:`, `ig =`, `tiktok @jane`, `discord:`, zero-width and direction versions | (only a mark: data draft) | DATA | not usable |
| 19 | `x.com/jane` | `[removed] /jane` | AI | base + removed note (M2) |
| 21 | `whatsapp me on janedoe` | same | AI | base only (ruled) |
| 24 to 29 | `I use whatsapp daily.`, `Instagram is slow.`, `Petrol now sells at N617.50/litre.`, `Buses leave at 08:30, 09:30, 10:30.`, `Dates: 01/02/2024 - 05/02/2024.`, `I can handle 10k users.` | same | AI | base only |
| 30 | `The dot com bubble was before my time.` | `[removed] bubble was before my time.` | AI | base + removed note |
| 31 | `People said <very angry> about it.` | `People said about it.` | AI | **base only, no mark (M1)** |
| 32 | `0803      123      4567` | `0803 123 4567` | AI | **base only, phone whole (F1)** |
| 33 | `Pay 5,000 then 1 2 3 ... 9 1 0803 123 4567` (19 numbers) | same, phone whole | AI | **base only (F2)** |
| 34 | `He wrote: pay on time, mail jane@example.com or call 0803 123 4567. Then wait.` | `He wrote: pay on time, mail [removed] or call [removed]. Then wait.` | AI | base + removed note |
| 35 | `jane@example.com` | (only a mark) | DATA | not usable |
| 36 | main `Pay people on time.`, opposing `jane@example.com` | opposing `""` | AI | base + removed note, no mark in the draft (L1) |
| 37 | `Pay people on time, call 0803 123 4567.` / opposing `mail jane@example.com now` | `Pay people on time, call [removed].` / `mail [removed] now` | AI | base + removed note |
| 38 | `[removed]` (the model writes the mark itself) | (only a mark) | DATA | not usable |
| 39 | main fine, opposing `[removed] [removed]` | opposing `""` | AI | base + removed note |
| 40 | main `ok`, opposing `jane@example.com` | | DATA | not usable (main under 3 characters) |

The base note is "The AI wrote the two views only. Count the voices behind each one yourself." and the removed note is appended to it as one string in `aiNote`: `... Something that looked like a contact detail was taken out. Check the marked places.` Present on rows 1, 2, 19, 30, 34, 36, 37, 39; absent on the rest of the AI rows.

**The editor's PUT of a text holding `[removed]`** (`PUT /admin/topics/:id/summary`, editor, 4 values, then `approve: true` with voices 1 and 1):

| mainView sent | PUT | approve | GET returns |
|---|---|---|---|
| `pay on time, mail [removed] or call [removed]` | 200 | 200 | the same text, `reviewedByEditor: true` |
| `[removed]` | 200 | 200 | `[removed]` |
| `[removed] [removed]` | 200 | 200 | `[removed] [removed]` |
| `ok [removed]` | 200 | 200 | `ok [removed]` |

It is saved as typed, and it can be approved and shown with the mark in it, even when the whole view is the mark. Nothing refuses it. **For the lead to rule:** whether PUT should refuse (422) a `mainView` or `opposingView` that holds `[removed]` (or is only the mark) when `approve` is true, so a mark cannot be published by mistake. (Without a rule, the editor's review is the only guard.)

### 4. Speed (`/tmp/v6/speed.mts`)
43 shapes of 200 000 characters (single tokens and the triggers of every pattern: `a.`, `a@`, `http://`, `www.`, `ig `, `0803 `, `1-`, `1,`, number words, `dot`, ` at `, brackets, `<at>`, `<`, zero-width, `0803      `, `0803 123 4567, `, `x: `, `handle `, `@a ` ...):
- `scrub(text)` (cut to 5 000): worst **13.1 ms** (`a`).
- `scrub(text, 200000)` and with the mark (cut lifted; nothing calls it so): worst **391.9 ms** (`1-`; `a-` 344, `1.` 357). Linear.
- `cleanModelText` (cut to 3 000): worst **5.7 ms** (`1.`).
No shape was over 400 ms. Not a finding. The route took 1 s for 40 requests including the stand-in.

### 5. Assertions changed in `d4d6c8b..5ecb4b6`
The diff removes these lines (all others are additions): 
1. `fixc.spec.ts`: `mainView` `"paying people on the day promised now"` -> `"... now [removed]"`, `opposingView` `"saving first, mail"` -> `"saving first, mail [removed]"`. **The ruling** (A: every removal is the mark). Nothing else changed in them; they sit in a test that also asserts the note's old text still holds (`Count the voices`). New test added for the note and the mark-only fallback.
2. `scrub-round3.spec.ts`: `"0803 one two three four five six"` removed from the must-go list (10 digits: ruling B asks for 11 for a spoken or mixed run; it now stays whole: checked). **The ruling.** `see x @jane ok` -> `see ok` (was `see x ok`): **not in rulings A to D** as given to me; it follows the handle-token rule the builder cites ("a platform word before `@` or `:` goes with the handle"). The test's own title still says "the platform word before it stays" (stale). The lead should confirm it.
3. `scrub-round4.spec.ts`: `"803 123 4567"` (no leading 0, no plus: not a phone by B), `"0803 one two three four five six"` (10 digits), `"oh eight oh three one two three four five six"` -> `... six seven` (11 digits now): **the ruling.** `cleanModelText("jane<at>example<dot>com")` `""` -> `"[removed]"` and `"mail jane<at>example<dot>com now"` `"mail now"` -> `"mail [removed] now"`: **the ruling** (A).
Each is the ruling and nothing else, except the `x @jane` line above. Checked: `scrub("call 803 123 4567 now")` and `scrub("call 0803 one two three four five six now")` return the input whole, as the changed assertions say.

### 6. Gates and suites
- `npx tsc --noEmit`: exit 0.
- `eslint "{src,test}/**/*.ts"`: 0 errors, 41 warnings.
- `jest test/admin test/reach test/vote test/shared`: **45 suites passed, 45 total; 1 281 passed, 1 skipped, 1 282 total** (137.7 s).
FULLSUITE_PLACEHOLDER

## Read only
- `scrub.ts` (250 lines), the whole round 5 diff in `src/` and the three changed test files, `summary-draft.ts:100-140` and `:355-395`. The route harness is the compiled tree (`tsc --outDir`) under Node with the test harness' `world()`, because the SDK cannot send a request under Jest.
- I did not open `.env` or any key file.

## Not proved
- Real posts: my rates are for sentences I wrote (373 ordinary, 128 aimed). How often a post holds a 6-space gap, a list of 19 or 20 numbers before a phone, two spoken numbers or a non-ASCII email domain is not measured; I think F1 (a gap of spaces from a copied table or a pasted card) and F4 are the likely ones.
- A real model's behaviour (no live call, by design): whether it writes `<...>` in a view, or goes past 600 characters.
- The web: how the editor view shows `[removed]` was not checked (no web in this repo).
