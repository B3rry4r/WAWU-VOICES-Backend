# V-SHARE-CARD (api): the question share card is the pick-one-word screen

Branch `v/share-card` from origin/main 5122c47. Code and tests commit: 15bc95a. This report is the next commit.

## Files (lines changed)
- api/src/reach/card-renderer.ts +199: `pickSvg()`, `CardSpec.pick`, tile colour helper
- api/src/reach/share.service.ts +83: spec, key mark, redraw rule, description, seconds
- api/src/reach/reach.module.ts +3: imports TalkSharedModule (for ConfigReader)
- api/test/reach/share-card-pick.spec.ts +363 (new, 13 tests)
- api/test/reach/share.spec.ts 1 line
- docs/lead/share-card/*.png (4 pictures)

## Seconds
`ShareCardService.freeSeconds()` reads `voice.free_seconds` with ConfigReader. That is the setting behind
`voiceFreeSeconds` and `costs.freeVoiceSeconds` in GET /config/public (default 60, in config-reader.ts).
Test: set 45, the drawing input carries 45.

## Old links
A QUESTION picture now has the key `card-q2<10 hex>.png`; the hash covers only the question, small line, words and seconds
(no counts, no date). `image()` already redrew a "coming up" card; it now also redraws a QUESTION picture whose key has no
q2 mark, through the same one-draw path (one redraw per card, others get the old picture meanwhile, then the stored file).
Test: 30 requests at once, 1 draw, 5 more requests, still 1 draw.

## Assertion changed (owner order)
test/reach/share.spec.ts:656, question page openGraph.description.
Old: "Most voices so far lean towards: gone within a day". New: "Say it in your voice." (that test question has no words).

## Commands
- `npx tsc --noEmit` (api): clean.
- `npx eslint src/reach test/reach/share-card-pick.spec.ts test/reach/share.spec.ts`: 0 problems.
- Own PostgreSQL 16 (port 54329) and Redis (63791), fresh database, no .env or keys.
- jest on test/reach and every spec mentioning share or card: 59 suites passed, 755 passed, 1 skipped.
- Whole jest suite: 122 suites passed, 1325 passed, 1 skipped, 982 s.
- Contract: `python3 docs/contract/src/build.py` to a temp file, `cmp` with docs/contract/openapi.yaml: identical (no new page field).
- Other kinds vs origin/main (worktree): voice, poll and old-style question cards give the same SVG and PNG sha1.
  The spec pins voice and poll hashes.

## Pictures (docs/lead/share-card/)
launch-four-words.png, no-words.png, long-question-four-words.png (175 chars, 3 lines), two-words.png.
All opened and checked: no overlap or overflow.

## Notes
- Tile colours: mood-card.ts has only light tints, so each tile is that tint deepened (same hue, lightness 0.3); the word uses the tint.
- A first full-set run died once because the scratch Postgres lost its directory; rerun on another path, all green.
- The Stories (1080x1920) card for a question is unchanged. The pick layout is the 1200x630 card only.
- Not done: no deploy; a question card whose words are edited after it was drawn is redrawn on the next share request, not on
  every image request.
