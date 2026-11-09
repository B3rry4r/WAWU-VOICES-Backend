# Verifier report: VOICES bundle B (mood), v/lch-b, backend 94c2df7 / web 0d9bea2. VERDICT: FIX

## Checks (EXIT lines)
Backend: prisma generate 0, tsc 0, eslint 0 (0 errors, 34 warnings), npm test 0 (66 suites, 743 passed, 1 skipped, fresh DB), build 0.
Web: lint 0, typecheck 0, sync:shared --check 0, vitest 0, build 0 (built with stand-in bases :15040/:15041).
Bundle grep: one `voices.wawuafrica.com` in static chunk 3996 and in legal pages (legal text, not an API base). I did NOT run a browser against it, so I took no pictures of my own. I judged the builder's 13 pictures against the boards instead (MoodPick, Posted, 1080 card compared: match closely).

## Findings
1. MEDIUM, api/src/vote/poll.service.ts:463 (explain my vote): creates a PUBLISHED Answer under a poll's question with no word. Confirmed on a mood question: 201, mood null. Claim "refused on every route that creates an answer" is false. Breaks LCH-02 ("required on a mood question"). Fix: apply the same word rule (or refuse explain on a mood question).
2. MEDIUM (privacy), api/src/mood/mood.controller.ts cardName: PATCH does not invalidate the stored 1200x630 card. Confirmed: name ON then OFF, with no new POST /share/links, /share/{code}/card still serves the old bytes (the named one). Story and square are drawn fresh and follow the switch at once. The web re-POSTs on toggle, but a direct call or an unfocused tab leaves a named card public. Fix: on PATCH, redraw/reset the link's card (or key serving to the current spec hash).
3. LOW, api/src/reach/share.service.ts moodCardGone: a SUSPENDED person's card is still served (200 all three sizes) although their answer is excluded from counts. Decide with owner.
4. LOW: card address is voices.wawuafrica.com/s/{code}; board shows usevoices.com/go/... (V-35, LCH-08 owns it; it is PUBLIC_WEB_BASE config).
5. LOW, mood-stats.service.ts count(): filters PUBLISHED before DISTINCT ON, so if a person's latest answer is removed their earlier published one counts. Spec says one per person, not removed; debatable.
6. LOW (default): Posted screen still shows the bottom tab bar (builder picture); MoodPick board draws a "Share my word" switch, omitted (it belongs to LCH-06). Old share buttons kept on Posted (board shows LCH-06's "Send it to 3 people"): acceptable, no ruling broken.

## Claims confirmed
- Migration additive; UP, DOWN (answers kept, enum gone), UP again on a copy with rows; prisma migrate diff shows no mood drift. Rollback warns that words are lost.
- Word refused without a word (text and voice) on the talk route; served on answer, thread, list, profile, /s; ?mood= filter and 422 on a bad word; counts per word.
- Where you sit: 49/50 per group tested by builder; switch shows once world reaches 50 (Nigeria 50 implies world 50); valid-answer SQL excludes removed, deleted, banned, deleted, suspended. Staleness: Redis counts refreshed every 15 s (MOOD_REFRESH_MS) for questions read within 30 min, key TTL 1 h; confirmed a deleted account still counts until refresh (total 1, then 0 after refresh). Own answer added when newer than counts.
- Seed: idempotent, replaced question kept in the spare bank unchanged; re-running seed:questions after seed:launch leaves exactly one question on 15 Nov (confirmed).
- Cards: square route works, 404 for non-mood answers; anonymous+name equals no-name card; deleted-pending and removed answers 404 on card, story, square and page even after caching.
- Privacy: where-you-sit only for the author's own answer; counts only public-answer words; percentages only at 50+.
- test/reach/helpers.ts: now passes `size` to the real renderer (it was dropped before); strengthens, does not weaken.
- Copy: curly apostrophes, no em-dash, no "wallet"/"Rant". Card line lowercase matches boards.

## Cleanup
Worktrees removed, vb_* databases dropped, Redis db 11 flushed, temp attack spec deleted, no commits or pushes, no PIDs left.

# Round 2 (backend 19f79d7, web 5643b40). VERDICT: MERGE

Attacks re-run:
- MEDIUM 1 (explain-my-vote without a word): fixed. No word 422, bad word 422, valid word 201 with mood stored; ordinary question with a word 422 ("no words to pick from"), ordinary question without a word 201, mood null. The web results page gets moodOptions from the question and shows a word picker.
- MEDIUM 2 (stale named card): fixed. After PATCH on, GET card is 202 at once, then the redrawn card equals a fresh reference render with the name; after PATCH off, 202 then a card byte-identical to the first nameless one. Cache-Control on a mood card is no-cache.
- Ruling 3: forced a draw to hang in the renderer, flipped the name mid-draw: the first picture was not stored, redrawn, served card matched the final setting. 12 rounds of 2 to 5 racing flips with parallel PATCH, card GETs and POST /share/links: 0 mismatches between the final setting, the served card and the stored file.
Regression: full backend suite and web suite green (share pages, other cards, answers, ranking, payments covered by the existing specs; builder's new tests included).

Remaining LOW (not blocking):
- PATCH commits the setting and then resets the cards in a second transaction (mood.controller.ts dropStoredCards), so a request in that gap can still get the old named card, and a failure of the reset would leave it. Wrap both in one transaction later.
- After 3 stale redraws the card stays PENDING (self-heals on the next request). Findings 3 to 6 of round 1 stand as LOW/default.

EXIT lines. Backend: tsc 0, eslint 0, npm test 0 (751 tests, 750 passed, 1 skipped), build 0. Web: lint 0, typecheck 0, sync:shared --check 0, vitest 0 (601 passed), build 0.
Cleanup: worktrees removed, vb_* dropped, Redis db 11 flushed, temp specs deleted, no commits or pushes.
