VERDICT: FIX

# Verify V-FIX-C round 7, server side (verifier, API)

Code under test: `origin/v/fix-c` at 90e659a (round 6). `git merge origin/v/fix-c` into `verify/v-fix-c` was clean (merge 70c0534), so the merged tree was tested. My scripts are in `/tmp/v7` (not in the commit); my attack spec was moved out of `api/test` before the suites ran. No `.env` or key file opened. A fake key was exported; no provider was called (the scrub paths were driven directly, and the route checks use no AI branch). Own PostgreSQL 16 on 55777 and Redis on 56777, stopped at the end.

## Why FIX

Items 3, 5 and 6 hold. Item 4 holds for the exact mark. Items 1 and 2 each have a hole:

1. **F4 is not closed: an email whose name or domain has a combining mark (Devanagari, Bengali, Tamil, Thai, Arabic with vowel marks) goes out whole or half-whole, in both paths.** ULABEL and ULOCAL use `\p{L}\p{N}` only; the vowel signs of these scripts are `\p{M}`. HIGH.
2. **M1: full-width angle marks come back as working markup.** The model path removes tags first and NFKC-folds afterwards (inside `scrub`), so `＜script＞alert(1)＜/script＞` reaches the editor as `<script>alert(1)</script>`. MEDIUM (the lead's line: no working markup reaches the editor's page).

## 1. F4: email in any script

The sixth check's 6 exact strings and 40 of mine, both paths (`/tmp/v7/s/t1.mts`, `t1b.mts`).

Removed whole, both paths (posts: nothing left; model: one `[removed]`), 38 of my 40 and all 6 of the sixth check's: `jane@müller.de`, `jane@пример.рф`, `jane@例え.jp`, `jane@ех.com` (Cyrillic е, х), `jane@café.com`, `ジェーン@example.com`, `josé@exemplo.com.br`, `иван@почта.рф`, `Иван.Петров@mail.ru`, Greek (`ιωάννης@παράδειγμα.gr`, `ΑΒΓ@ΔΕΖ.gr`, Greek TLD), Arabic (`بريد@مثال.com`, Arabic TLD), Chinese (`用户@例子.中国`, `张三@example.cn`), Japanese (`山田@例え.日本`, `たろう@example.jp`), Korean (`홍길동@예시.한국`, `jane@도메인.kr`), Hebrew, `xn--` punycode (`jane@xn--mnchen-3ya.de`, `jane@xn--e1afmkfd.xn--p1ai`), look-alike letters in an ASCII-looking domain (`jane@exаmple.com`, `jаne@example.com`), mixed scripts, full-width `jane＠example.com`, `jane@ｅｘａｍｐｌｅ．ｃｏｍ`, `<jane@пример.рф>`, `(jane@пример.рф)`, trailing dot and comma.

**Not removed (HIGH):** letters of Indic and Thai scripts carry combining signs (`\p{M}`), which ULABEL/ULOCAL (`scrub.ts:16-17`) do not allow, so the match stops at the first vowel sign:

| input | posts | model |
|---|---|---|
| `mail jane@उदाहरण.परीक्षा ok` | `mail janeाहरण.परीक्षा ok` | `mail jane [removed] ाहरण.परीक्षा ok` |
| `mail jane@नमूना.com ok` | `mail janeूना.com ok` | `mail jane [removed] ूना.com ok` |
| `mail jane@मुंबई.com ok` | **`mail jane@मुंबई.com ok`** (whole) | **whole** (no mark) |
| `mail สมชาย@ตัวอย่าง.ไทย ok` | **whole** | **whole** |
| `mail jane@مِثال.com ok` (Arabic with kasra) | **whole** | **whole** |
| `mail राम@उदाहरण.भारत ok` | `mail रामाहरण.भारत ok` | `mail राम [removed] ाहरण.भारत ok` |
| `mail রাম@উদাহরণ.বাংলা ok` | `mail রামাহরণ.বাংলা ok` | partly |
| `mail ராமன்@உதாரணம்.இந்தியா ok` | `mail ராமன்ாரணம்.இந்தியா ok` | partly |
| `mail कृष्ण@example.com ok` | `mail कृष् ok` | `mail कृष् [removed] ok` |
| `mail रामा@xn--p1b6ci4b4b3a.xn--11b5bs3a9aj6g ok` | `रामा--p1b6ci4b4b3a.xn--11b5bs3a9aj6g` | partly |

So 3 of the 5 mixed or Indic tries leave an at sign in the output, and an Indic or Thai name or domain leaves part of the address. What should happen: `[\p{L}\p{M}\p{N}-]` in ULABEL and ULOCAL (and in HANDLE_AT). The same fix applies to `EMAIL_SPACED`.

## 2. M1: markup in the model path

The sixth check's strings and 61 of mine (`/tmp/v7/s/t2.mts`, `t2b.mts`).

Words kept (angle marks removed, words stay): `People said <very angry> about it.` → `People said very angry about it.`; `He wrote <sad> in the chat.`; `We want <everyone> to vote.`; `Press <Enter> to continue.`; `The sign said <Closed> today.`; `If x <y and z> w then stop.` → `If x y and z w then stop.`; `<my cousin> said hello`; `x < y and y > z` → `x y and y z`; `I <3 this` → `I 3 this`; `<<POSTS` / `<<POSTS>>` → `POSTS`; `<5%`, `<18`, `1 < 2`; an unclosed `an unclosed <b and words` → `an unclosed b and words`; `<!-- unclosed comment words` → `!-- unclosed comment words`; `<details open ontoggle=alert(1)>`, `<svg/onload=alert(1)>`, `<marquee onstart=alert(1)>`, `<xss onfocus=alert(1) ...>`, `<base href=//evil.zz>`, `<input autofocus onfocus=alert(1)>`, `<img/src=x onerror=alert(1)>` (not in the tag list, or slash instead of space) → the same text with no angle marks: inert text, no tag.

Real markup dropped, nothing readable lost: `<b>bold</b>` → `bold`; `<p>one</p><p>two</p>` → `one two`; `a <b\nclass="x">split</b> tag` → `a split tag`; `<a href="http://evil.zz/x">text</a>` → `text`; `<a href='javascript:alert(1)'>click</a>` → `click`; `<script>alert(1)</script>` → `alert(1)` (tags gone, the script's text stays as plain text); `<img src=x onerror=alert(1)>` → `` (empty); `<svg onload=alert(1)>`, `<iframe ...></iframe>`, `<body onload=...>`, `<object data=x>`, `<video><source onerror=...></video>` → empty; `<!-- hidden words here -->visible` → `visible` (a closed comment's words go: ruled as markup); `<!DOCTYPE html>x` → `x`; `<script\n>alert(1)</script>` → `alert(1)`; `<a\nhref=x>t</a>` → `t`.

Odd shapes that stay inert (no `<` or `>` left): `<scr<script>ipt>alert(1)</scr</script>ipt>` → `scr ipt alert(1) /scr ipt`; `<<b>script>alert(1)<</b>/script>` → `script alert(1) /script`; `<a href=x title="a > b" onclick=alert(1)>t</a>` → `a href=x title="a b" onclick=alert(1) t`; entities (`&lt;script&gt;`, `&#60;`) stay as typed text.

**Not as wanted (MEDIUM): full-width and small angle marks.** `cleanModelText` (`summary-draft.ts:131-137`) removes tags before `scrub` folds with NFKC (`scrub.ts:224`), so the fold creates the tag after the strip:
- `＜script＞alert(1)＜/script＞` → **`<script>alert(1)</script>`**
- `＜b＞x＜/b＞` → `<b>x</b>`
- `﹤img src=x onerror=alert(1)﹥` → **`<img src=x onerror=alert(1)>`**
- `＜a href=javascript:alert(1)＞x＜/a＞` → `<a href= [removed] >x</a>`
The draft carries these strings to the editor's page as the model wrote them. Whether the web page shows them as text or as markup is not checked here (no web in this repo); with any raw-HTML rendering the script runs. Should: fold with NFKC (or remove `[<>＜＞﹤﹥]` after `scrub`) so the strip runs on the folded text. (`≮script≯` stays as typed, no `<`.)

**Known tag names used as words go with no mark (LOW):** `The <main> issue is fuel.` → `The issue is fuel.`; `A <big> problem and a <small> one.` → `A problem and a one.`; `Read the <title> carefully`, `Use the <form> here`, `The <label> says no`, `I <i> you`, `He sent <code> by text`, `Pick an <option> now`, `see <link> below`, `a <source> of income`, `a <table> was set`, `<video> call`. This is what the rule says (a known tag name, opening or closing), but a person can read these words. A bare `<name>` with no attribute and no closing tag could keep its word.

## 3. M2: short hosts with a path (both paths)

Whole, nothing like `/janedoe` left (30 inputs): `t.me/janedoe`, `x.com/jane`, `g.co/abc`, `t.co/abc`, `wa.me/2348031234567` (posts: empty; model: `[removed] [removed]`), `m.me/jane`, `a.co/d/abcdef`, `x.co/abc`, `T.ME/JaneDoe`, `x.com/jane/status/123`, `fb.me/jane`, `ig.me/jane`, `wa.me/2348031234567?text=hi`, `t.me/joinchat/ABC`, `t.me/+AbCdEf`, `bit.ly/3abcde`, `youtu.be/abc123`, `(t.me/janedoe)`, `t.me/janedoe.`, `m.me/jane.doe`, `wa.me/+2348031234567`, `x.com/@jane`. Left (ruled, spaced hosts): `t.me / janedoe` → `/ janedoe`; `t . me/janedoe` → whole in posts, `t. me/janedoe` in model.

The round 5 table again (32 strings): 31 whole in both paths (`N617.50/litre`, `USD1.50/kg`, `N1.5m/month`, `Dr.Ade/Dr.Bola`, `Mr.Bello/Mrs.Bello`, `v1.2/final`, `Prof.Ade/Prof.Bola`, `N2.5m/year`, `N1.2k/paint`, `Android 14.1/iOS 17.2`, `St.Mary/St.John`, `Rev.`, `Chief.Ade/Hon.Bola`, `08:30/09:30`, `a.m/p.m`, `and/or`, `w/o`, `5.5/6.5`, `v2.0/v3.0`, `e.g. a/b`, `s.a/b`, `U.S/UK`, `Mr.A/B`, `dr.ade/dr.bola` ...). One of my extras changes: `Mon.1/2 done` → `done` (posts) / `[removed] done` (model): a word with a dot and a fraction, marked in the model path; unrelated to the round (the first label has a digit after the dot); LOW.

## 4. Approve with the mark

Run through the real routes (compiled test harness, editor account, admin write limit lifted in my own database; `/tmp/v7/zz-v7attack.spec.ts`).
- `PUT summary approve:true` with `[removed]` in `mainView`, `opposingView`, `pollLine` or `nextStepsLine`, any one of them: **422**, `details.fields = [{path, message: "Take out or rewrite the marked places before approving."}]`, one entry per marked field; with all four marked: 4 entries. Not public.
- Mark inside a word: `the [removed]s were`, `xx[removed]yy`: 422. Two marks `[removed][removed]`, mark with line breaks around: 422. Zero-width characters inside the mark (`[removed​]`, `[re​moved]`): 422 (the DTO strips them first).
- Draft with the mark, `approve:false`: **200**, `reviewedByEditor: false`, not public (`reviewedById` null); GET shows `mail [removed]`.
- Already approved summary, then a PUT with the mark and `approve:true`: 422 and the old approved text stays public; a PUT with the mark and `approve:false`: 200 and the summary becomes **not public** (approval is withdrawn).
- Rewrite and `approve:true`: **200**, public (`reviewedById` set).
- Variants that are **not** refused (200, public), all by design an exact-string check on `[removed]`: `[Removed]`, `[REMOVED]`, `[ removed ]`, `[removed ]`, `[ removed]`, `[rem0ved]`, full-width `［removed］`, Cyrillic `е` in `[removеd]`, `unremoved`, `[removed` (no close), `removed]`, `[remove]`, `【removed】`. The model path itself writes only the exact `[removed]`, so these are text an editor or the model typed. LOW: if the model writes `[REMOVED]` itself, it is shown and can be approved.
- Routes that set a summary approved: **one** — `PUT /admin/topics/:topicId/summary` (`TopicsAdminService.saveSummary`, `topics.service.ts:1213`, `reviewedById: dto.approve ? actorId : null`). `grep reviewedById` in `src`, `prisma`, `scripts`: no other writer; the draft route saves nothing; `weekly.service` `approvedAt` is the weekly poll, not the summary. Readers (`vote/proposal.service.ts:267`, `reach/share-subject.ts:164`) show the summary only with `reviewedById`.
- A non-string `mainView` (number, array) with `approve:true`: 422.

## 5. The speed change (email guard)

- Guard is `/@|\bat\b/i` for the symbol and spaced patterns and `/\sat\s/i` for the spoken one. Differential run: the shipped `scrub` against a copy with both guards forced on, **400 000 random strings from 50 pieces** (`at`, `AT`, `@`, `＠`, `﹫`, `(at)`, `[at]`, `{at}`, `<at>`, `dot`, `[dot]`, `(.)`, `。`, `．`, tab, NBSP, line break, U+2028, U+3000, zero-width, `ａｔ`, `_at_`, names, endings), each in posts and model mode = 800 000 comparisons: **0 differences**.
- 28 handwritten shapes (`jane at example dot com`, `AT`/`DOT` upper case, `jane  at  example . com`, line breaks, tabs, NBSP, ideographic space, `(at)`, `[at]`, `{at}`, `<at>`, `<dot>`, `＠`, `﹫`, `ａｔ`, `@@`): all removed, as the unguarded copy. Left, same in both (ruled or not an email): `jane a t example dot com`, `jane [ at ] example . com`, `jane_at_example_dot_com`, `janeat example dot com`, `jane  \n at \n example dot com` (leaves `jane at`, the dot-com part removed).
- Timing, 49 shapes of 200 000 characters: `scrub(text)` (cut to 5 000) worst **8.3 ms** (`1-`); `scrub(text, 200000, mark)` worst **322.8 ms** (`1-`; next `1.5/` 152.9, `1,` 138.0); `cleanModelText` worst **5.1 ms**. None over 400 ms. The sixth check's worst was 391.9 ms, 13.1 ms, 5.7 ms.

## 6. Nothing else moved

- **525 ordinary sentences** (the builder's `ownOrdinary`, round 3 ordinary, round 4 `stay`, `own` and `all`, round 5 `stay` and `all`, the starters and platform templates, from `api/test/reach/`) plus **103 of my own** (`/tmp/v7/s/own100.txt`: prices per unit, times, scores, versions, titles, Pidgin, lists, page and section numbers): posts path **0 changed** (0 of 628); model path **0 marked, 0 changed with no mark** (0 of 628).
- The round 3, 4, 5 and 6 spec files pass (inside the suites below).

## 7. Gates and suites
- `npx tsc --noEmit`: exit 0.
- `eslint "{src,test}/**/*.ts"`: 0 errors, 41 warnings.
- `jest test/admin test/reach test/vote test/shared` in band: **46 suites passed, 46 total; 1 317 passed, 1 skipped, 1 318 total**. (A first run in parallel on one shared database gave 37 suites failed with `deadlock detected`: the suites share a database; not a code fault.)
- Whole API suite, once, in band, fresh database, fake key: **108 suites passed, 1 failed, 109 total; 2 083 passed, 1 failed, 1 skipped, 2 085 total**. The failure is `test/load/shared-address.spec.ts` (300 people behind one address, 429) while my attack scripts and a second jest ran in the same machine; run alone it passes (**1 suite, 4 tests passed**). Treated as load, not as the code; not proved on a quiet machine in the one whole run.
- `npm run test:audio`: 13 tests, 13 pass, 0 fail.
- Contract: `build.py` exit 0 (admin 60, text-fix 1 listed); `cmp` with `docs/contract/openapi.yaml`: identical.
- Assertions changed in `5ecb4b6..90e659a`: `git diff` of `api/test` has **no removed line** other than the file headers: none changed; the builder's claim holds. Two files added or extended (`scrub-round6.spec.ts` new, `fixc.spec.ts` +55 lines).

## New findings

### BLOCKER
None.

### HIGH
**F4b. An email with combining-mark letters goes out whole or half-whole.** `scrub.ts:16-17` (`ULABEL`, `ULOCAL`: `\p{L}\p{N}` without `\p{M}`); `scrub.ts:~73` `HANDLE_AT` the same.
- `mail jane@मुंबई.com ok` → posts `mail jane@मुंबई.com ok`, model the same (no mark).
- `mail สมชาย@ตัวอย่าง.ไทย ok`, `mail jane@مِثال.com ok` → whole in both.
- `mail jane@नमूना.com ok` → posts `mail janeूना.com ok`; model `mail jane [removed] ूना.com ok`.
- Should: the whole address removed; add `\p{M}` to the classes.

### MEDIUM
**M3. Full-width angle marks become real markup after the strip.** `summary-draft.ts:131-137` strips tags, `scrub.ts:224` then folds with NFKC.
- `＜script＞alert(1)＜/script＞` → draft text `<script>alert(1)</script>`; `﹤img src=x onerror=alert(1)﹥` → `<img src=x onerror=alert(1)>`.
- Should: no `<` or `>` in the draft; fold first, or drop `<`/`>` after `scrub`.

### LOW
- A known tag name used as a word goes with no mark (`The <main> issue is fuel.` → `The issue is fuel.`; `<big>`, `<small>`, `<title>`, `<form>`, `<label>`, `<code>`, `<option>`, `<link>`, `<source>`, `<table>`, `<video>`).
- `[Removed]`, `[REMOVED]`, `[ removed ]`, `[removed ]`, full-width and look-alike marks are not refused on approve (exact `[removed]` only).
- `Mon.1/2 done` → `done` / `[removed] done`.
- `jane@münchen` (no dot in the domain) → `jane` (the at sign and name go, not an email shape; fine).

## Not proved
- How the web page shows `[removed]` or the text of M3 (no web here); whether a real model writes angle marks, full-width marks or `[REMOVED]` (no live call).
- Posts by real people: my 628 sentences are written, not collected.
- F1 to F3 of the sixth check and the older ruled forms were not re-run (ruled out of the verdict).
