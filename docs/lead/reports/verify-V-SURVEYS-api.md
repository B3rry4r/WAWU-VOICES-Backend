VERDICT: FIX

# Verify V-SURVEYS (server side): sponsored surveys, results for the brand, brand pages

Code under test: `origin/v/surveys` at `d84fc13`, plus `origin/main` `755aa15` merged in a local copy (never pushed). Verifier branch `verify/v-surveys`. Own PostgreSQL 16 (port 15432) and Redis (15379, 15380), stopped and deleted at the end. Nothing real was called: the mail relay was a local stand-in, no Flutterwave, WAWU ID, Gemini or Spaces. My attack specs and scripts are uncommitted and are not in this commit.

## The merge

`git merge origin/main` into `v/surveys`: **one conflict**, `api/src/mail/mail.service.ts`.
- Both sides added a block at the same place after `NoticeJob`: this branch added `interface BrandMailJob`; main added `type PostResult = "ok" | "capped" | "failed"`. Resolution: keep both blocks, drop the markers. Everything else auto-merged (`schema.prisma`, `mail-templates.ts`, `openapi.yaml`, `schema.prisma` in docs, `schemas.py`, `CATALOGUE.md`).
- The builder's report says its own merge of main (`f336fc6`) had no conflict. It did not include main's later work (`PostResult`). **The conflict is textual, but it hides a semantic break: see BLOCKER 1.** `tsc` does not see it.
- Migration order on the merged tree: `...20261114120000_subscriptions`, `20261114170000_subscription_terms` (new from main), `20261114190000_sponsored_surveys`. Sorts last. Good.

## Findings

### BLOCKER

**B1. A brand mail the relay refuses or drops is logged as sent and never retried (merge-semantic break).**
`api/src/mail/mail.service.ts:353` (`sendBrand`): `const ok = await this.post(...); if (!ok) { delete MailLog; return "failed" }`. After the merge `post()` returns `"ok" | "capped" | "failed"`, all non-empty strings, so `!ok` is never true. Main's own `send()` was updated to `if (ok !== "ok")`; `sendBrand` was not, because it was written against the older boolean `post`.
- Did (run): relay stand-in answering 500, then 429 (`daily_cap`); submitted a survey (F01) each time; then re-ran `surveySubmitted` for the same survey with the relay healthy.
- Happened: 500: 3 relay calls (retries), then the `MailLog` row for `brand:<id>` **stays** (outcome "sent"); the retry with the relay back delivered **0** mails. 429: 1 relay call, row stays, retry delivered 0. The brand never gets F01 (and the same for F02, F03, F04: F04 is also marked `resultsMailedAt` first, see M5).
- Should: `if (ok !== "ok")` delete the log row, return `"capped"` for 429 as `send()` does. A 429 on a busy day (the relay's daily cap) is exactly when this bites.
- Source: run (`zz-verify` test 10). The builder's suite cannot catch it: its branch predates `PostResult`.

### HIGH

**H1. A survey voice clip can be made a public post through two existing routes (explicit source rule broken).** `api/src/vote/post-content.ts:35` (`checkContent`, used by `POST /polls/{id}/explanation` and `POST /questions/{id}/proposals`): finds the clip by owner, READY, not on an Answer/Reply/Proposal. It checks **no purpose**, and does not look at `SurveyAnswer`. Only `POST /questions/{id}/answers` and replies go through `ClipsService.forPublish`, which does check purpose.
- Did (run, copy of `test/vote/vote.spec.ts` with one added test): a READY `SURVEY_ANSWER` clip owned by the voter, posted as a poll explanation, and another as a proposal.
- Happened: both **201**. A guest then got `GET /voice-clips/{id}` **200** (the clip is now public). On `/questions/{id}/answers` the same clip is refused (422 "made for something else"), which I also ran.
- Why it matters for the promise: a person's own public post would carry the same audio and transcript as their survey answer in the brand report; the brand or an admin can match them and learn who answered and what. It needs the owner's action (or a modified client), but the task rule is that this can never happen. Also, a clip already used as a survey answer is not blocked from posting (read: `used` checks only Answer/Reply/Proposal).
- Should: `checkContent` requires the purpose that matches the route (as `forPublish` does) and refuses a clip that is on a `SurveyAnswer`.
- Source: run for 201 and the guest 200; "used survey clip" is read only.

**H2. The floor of 20 does not protect a group under 20: it can be worked out by subtraction.** `api/src/surveys/survey-report.ts:100-110`.
- Did (run): 21 people answer a two-choice question: 20 pick A, 1 picks B.
- Happened: report at n=19: `belowMinimum: true`, nothing else. n=20: A count 20, share 100, B `hidden`. n=21: A `count 20`, `share 95`, B `hidden: true, count null` but `questions[0].answered = 21`. So B = 21 − 20 = **1**, exactly (my spec computed `deducedB = 1`). The code comment says a group under the floor is "never shown, not even as a count". With two options (or any question where only one option is hidden) the hidden option is exact. At n=20 with one hidden option the same arithmetic applies.
- Should: complementary suppression (hide the next-smallest option too, or fold hidden options into one "Other" with a count that is itself ≥ floor), and do not show `answered` and shares that sum to it when only one cell is hidden.
- Source: run.

**H3. A live report can be differenced across time, so each later answer is exposed.** `GET /admin/surveys/{id}/report` works on any status, including APPROVED and running, and is recomputed from all answers each call.
- Did (run): fetched the report at 20 and at 21 answers. The one new free-text answer ("unique thing only one says") is the only text that appears in the second report and not the first; counts move by exactly the new person's choice.
- Happened: past the floor, every new answer is visible to whoever reads the report before and after it (the admin, for the brand). Free answers are sorted alphabetically (no time order), but that does not help once two snapshots are compared.
- Should: the brand report is only available once the survey has ended or reached its target (a frozen snapshot), or the report is cached and refreshed in steps of the floor.
- Source: run.

### MEDIUM

**M1. Free text and transcripts reach the brand with names, places and spelt-out numbers.** `api/src/surveys/survey-rules.ts:28` `scrubText` removes emails, `http(s)://`/`www.` links, `@handles` and runs of 7+ digits.
- Did (run, 21 answers, brand view at n=21): removed: `chidi@example.com`, `@chidi_o`, `08031234567`, `0803 123 4567` (kept "reach [removed]now": the space is eaten), `plus 234 803 123 4567`, `wa.me/...` digits (left `visit wa.me/[removed]`).
- Passed through unchanged: "Call me Chidi Okafor from Surulere, number zero eight zero three one two three four five six"; "I am Adaeze Nwosu of 12 Allen Avenue Ikeja"; "email me chidi at gmail dot com"; "my insta is kemi_ng"; **`t.me/chidi`**.
- Should: add bare-domain and `t.me`/`wa.me` links and "at ... dot ..."; the builder says staff read before sending (Choice 10) but nothing in the API forces it: the report route is live (H3). The sources say "never your name, handle or number", so the report needs a staff approval step, or text answers are shown only after a human marks them clean.
- Source: run.

**M2. Response and event rows can be joined in the database; the "respondentKey is useless for finding the person" claim holds only for the response table.** `api/src/surveys/surveys-public.service.ts:366-372` writes a `COMPLETE` `SurveyEvent` with `userId` in the same transaction as the response. Nothing reads `COMPLETE` for the frequency cap or the skip rule (those use `VIEW` and `SKIP`).
- Did (run): joined `SurveyEvent` (COMPLETE) to `SurveyResponse` on `surveyId` for an **anonymous** answer.
- Happened: the event holds the user id and its `createdAt` is 2 ms from the response's; ids are `uuid(7)` so they also sort by time. With a few answers in a survey the join is unique. Also `SurveyAnswer.clipId` joins to `VoiceClip.ownerId` for every voice answer (run). No API route returns any of this (report returns no ids, times or clip ids; clip GET/play is owner-only: guest/admin/ad manager/moderator/another member get 404; run). Danger is DB access, a leaked dump, or a future route.
- Should: do not write `userId` on `COMPLETE` (drop the event, or write it without the user); say in the privacy text that a voice answer is stored as a recording tied to the account until deleted.
- Source: run for the joins and the 404s; "no route returns them" is from reading every controller plus the run.

**M3. A brand page can show another advertiser's adverts.** `api/src/surveys/brands.service.ts:163`: `Ad.brand` (free text) equals `Brand.name`, case-insensitive.
- Did (run): brands "Dupe Brand" and "dupe brand" (slugs `dupe-brand`, `dupe-brand-2`), one approved advert whose `brand` text is "DUPE BRAND" from some other advertiser.
- Happened: **both** pages list "Other advertiser". Any admin who creates a brand named like an existing advertiser puts that advertiser's live adverts on the new brand's page, labelled with the new brand. Slug collisions are not rejected (the second gets `-2`).
- Should: match on a stored brand id, or refuse a second brand with the same name ignoring case, and only match adverts the brand claimed.
- Source: run.

**M4. `GET /brands/{slug}` with a NUL byte answers 500.** `surveys.controller.ts:74` passes the raw slug to Prisma; `/brands/%00..%2f%27` gave 500 ("invalid byte sequence 0x00").
- Should: validate the slug (`^[a-z0-9-]{1,60}$`), else 404.
- Source: run.

**M5. F04 can be lost, and busy-day count is unbounded for F01/F03.** `surveys-admin.service.ts:693`: `resultsMailedAt` is claimed first, then the mail is sent; with B1, or any failure after the claim, the mail is never re-sent. F01 and F03 have a per-event limit with a key from `submittedAt` / `updatedAt`, so each submit / ask-for-changes cycle sends again, with no per-day brand budget (the topic mails got one on main). A busy day: ≤ 3 mails per survey on the happy path (F01, F02, F04) plus 2 per change cycle; the shared relay's daily cap then answers 429, which B1 hides.
- Source: read for the claim order; run for B1. Count is arithmetic from the code, not a run.

**M6. State targeting uses the profile state with no consent check; age band is not a target.** Source 6.9: "by state or age band where users consented". Built: `states` targets `User.state` (`surveys-public.service.ts` `eligible`, and `openable`) for everyone; there is no age-band target. State/age band are only *reported* when the person ticks share. The builder says no consent switch exists (Choice 3). Needs a lead ruling.
- Source: read.

**M7. Report is not audited.** `GET /admin/surveys/{id}/report` writes no `AuditLog` row (run: audit rows for create, submit, 4 decisions have actor, time, reason where given; the report read has none). Create, update, submit, decide, brand create/update are audited.

### LOW

- **L1.** One person can store unlimited `START`/`VIEW` events (run: 30 START + 2 VIEW stored for one person; limit 120/min). They inflate `views`/`starts` in the brand report and deflate `completionRate`. Dedupe per person per day.
- **L2.** The owner can `DELETE /voice-clips/{id}` after answering (run: 204, clip REMOVED). The report then drops the transcript but keeps `answered: 1` (`voices: []`). Not a leak; the count and the content disagree. `ClipsService.remove` checks only Answer/Reply/Proposal.
- **L3.** `POST /voice-clips` now accepts purpose `SURVEY_ANSWER` for anyone: unlimited uploads with no survey. Same as other purposes; read.
- **L4.** Brand website accepts `https://ok.test/a b` (stored with a space); the source asks for http or https, built is https only (stricter; `javascript:`, `data:`, `ftp:`, `//x`, `http://` all 422: run). Brand `name` with `<b>` is stored raw; escaping is the web's job. A contact address `"a b"@b.test` is accepted; line breaks, `,` second address and `<a@b>` are refused (run), and the body goes to the relay as JSON, so header injection is not possible.
- **L5.** Account export has no survey line (run: `POST /me/export` 202; no code reads survey tables, read). `SurveyEvent.userId` is the person's data until deleted. The privacy text should say: survey answers are stored without your account; views, skips and the voice recording are tied to it until you delete it.
- **L6.** The cap is counted from `VIEW` events the app posts; a client that never posts VIEW is never capped. Same shape as adverts; read.
- **L7.** Sources not covered, as built: "alcohol and finance extra checks" (brief 6.9) have no survey check (`hasBannedWording` covers betting, loan apps, tobacco, health; no alcohol); "never in the first 3 items" is the web's job (the placement route has no position); per-day-live packages are not modelled. `skipped` on `SurveyAnswer` is never written.

## Required and missing / built and not asked for

Required by the sources and missing: the whole web half (admin screen, Survey and SurveyDone screens, report page and CSV, brand page; the builder says so); the results report reaches the brand only through admin and a `mailto:` link (no brand sign-in); "Report this ad", "Why am I seeing this?" and the brand voice note on the brand page; age-band targeting; alcohol/finance checks; the "Zobo Fresh sees totals only, never your name, handle or number" line (web copy; the API note says only "paid for by the brand ... free and optional").
Built that the sources do not ask for: the per-answer `anonymous`/`shareState`/`ageBand` consent controls (not on any board); `Brand` as an admin-managed table with contact email; the F01 to F04 mail from the catalogue (asked in the mail catalogue); `surveys.*` config keys (price null until the owner sets it; run: price from request, else config, else null, nothing invented, in the builder's spec which I ran).

## Proved by runs (mine unless marked)

- Merged tree compiles: `npx tsc --noEmit` exit 0; `npx eslint "{src,test}/**/*.ts"` (no `--fix`) exit 0, 0 errors, 41 warnings.
- Contract: `python3 docs/contract/src/build.py <temp>` on the merged tree is **byte-identical** to `docs/contract/openapi.yaml` (`cmp`).
- Full API suite on the merged tree (`npm test`: jest `--runInBand` + `test:audio`): **102 suites passed, 1175 tests passed, 1 skipped, 0 failed; audio 13 of 13 passed.** Nothing failed, so no comparison with origin/main alone was needed. The survey specs, `test/admin`, `test/mail`, `test/privacy`, `test/feed` all ran inside it. A separate run of `src/surveys`, `test/admin/surveys.spec.ts`, `test/mail`, `test/privacy`, `test/feed`: 19 suites, 149 tests, all passed. (Builder's 100 suites became 102 with main's new suites.)
- Roles, 14 routes: guest 401, member 403, MODERATOR 403, EDITOR 403 on all 10 admin routes; AD_MANAGER and ADMIN 200/201 on list, detail, report, brands, patch brand, create brand, patch survey. Public four: placement 200 for all (null for guest), `GET /surveys/{id}` and events 401 for a guest, brand page 200.
- Audit rows with actor, time and reason (PAUSE "checking", REJECT "bad tone").
- Floor at 19 (nothing about people), 20 (shown), 21 (B hidden but derivable): H2. Differencing: H3. Scrubbing: M1. State group of 1 (Kano) left out; Lagos 20 shown; no respondent id, handle, sub, clip id in the report JSON (checked for every test person).
- Voice: guest, admin, ad manager, moderator, another member: `GET /voice-clips/{id}` 404; owner 200. Report carries transcript and seconds only (floor lowered to 1 for this probe), no audio, address, clip id or owner. Ordinary clip as survey answer: 422. Survey clip on `/answers`: 422; via explanation and proposal: 201 (H1).
- Two answers at the same instant: one 201, one 409. Paused survey by id: 404. Same question twice: 422. Rejected with 422: other owner's clip, not READY, 31 s clip, REMOVED clip, unknown clip, text on a voice question, clip on a poll question, random option, 501 characters, blank text, 6 answers, empty list, bad age band. Same clip in a second survey: 201 then 422.
- Consent: same person, two surveys: first (share state, 25-34) stored `Lagos`, `25-34`; second (anonymous) stored nothing; `shareState` with no state on file stores nothing.
- A survey answer changes **no row in any of the 71 other tables** (count and md5 of every row, before and after two answers, including Wallet, Ledger, FreeAllowance, UsageCounter, Notification, Answer).
- Account deletion: after `purge`, both of the person's `SurveyEvent` rows have `userId` null; the response remains (it never had the person). Remains: `SurveyAnswer.clipId` pointing at a clip now `REMOVED` with the transcript blanked, so the voice answer leaves the report.
- Mail: contact address with line breaks, second address, `<>` all 422; mails go once (builder's spec, in the suite). Failure handling: B1.
- Migration `20261114190000_sponsored_surveys`: a database migrated with `origin/main`'s own `prisma/` (17 migrations incl. subscription_terms), holding 2 users and 7 voice clips (one per old purpose), then `prisma migrate deploy` from this branch: applied only the new one (`ALTER TYPE ... ADD VALUE` inside Prisma's transaction works), rows unchanged (2 / 7), second `migrate deploy` "No pending migrations", `migrate status` "up to date". Rollback (`rollback.down.sql`), five cases on that database: (A) only a `SURVEY_ANSWER` clip: refused, 7 tables still there; (B) survey + 2 questions + 2 options + response + 2 answers + event + clip: refused; (C) survey rows gone, clip left: refused; (D) all gone: ran clean, 7 tables dropped, 2 users and 7 clips intact, enum value `SURVEY_ANSWER` left (documented); (E) second rollback: errors on the missing table, changes nothing; (F) migration row deleted and `migrate deploy` again: applies, up to date.
- Existing behaviour: read every changed line in existing files. `ads.service.ts` is one `export`; `common.ts` widens a type; `media.controller.ts` adds one value to the allowed list; `storage-purge.service.ts` adds `Brand.logoFileId` to the reference list; `deletion.service.ts` adds one `updateMany`; `config-catalogue.ts`, `mail-templates.ts`, `mail-events.ts`, `mail.service.ts` are additions only (all diff lines are `+`); the one existing-code collision is the merge conflict. The 1,175 existing tests pass on the merged tree.

## Read only

- Exact line of every finding other than the runs above; the "no route returns responses, events, clips or keys" claim for the admin side (read all routes in `surveys-admin.controller.ts`, `surveys.controller.ts`, and grepped for `surveyResponse`, `surveyEvent`, `surveyAnswer`, `SURVEY_ANSWER` outside `surveys/`: only `deletion.service.ts` and `media.controller.ts`).
- Mail HTML escapes variables (`mail-render.ts:27`), so an admin's change reason cannot inject markup.
- `ads.service.ts:391` accepts any READY clip id for an advert's audio with no purpose or owner check (existing). A survey clip id is never shown to an admin, so it is not reachable, but it is one more reason for H1's purpose check.
- A used survey clip not being blocked from posts (H1); the F04 claim order (M5); no CSV route (builder's choice).

## Not proved

- Nothing in a browser: no web half exists.
- The ten-minute `sweepFinished` timer (off under test); only the method is exercised, by the builder's spec.
- A real mail relay or client; the stand-in only.
- Placement checks for rejected, sensitive, kept-away, outside-state, over-target and two-skip cases: not re-run by me by hand; they are in the builder's `surveys.spec.ts` which passed inside my full run, and I ran the paused-by-id, cap and concurrency cases myself.
- The frequency cap's clock: read (Lagos day, `lagosDay()`), not tested across midnight.
- Whether a person's WAWU-ID side deletion removes anything else.

## What to fix before merge

B1 (one line), H1 (purpose check and survey-answer check in `checkContent`), H2 (secondary suppression), H3 (freeze the report until the survey ends), M1 (a staff approval step before text reaches a brand, and wider scrubbing), M2 (drop `userId` from COMPLETE), M3 and M4. The rest can follow.
