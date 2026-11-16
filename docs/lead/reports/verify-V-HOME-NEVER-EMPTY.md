VERDICT: FIX
INTERIM

# Check of V-HOME-NEVER-EMPTY (interim)

Checked commit: 0181cdc (`origin/v/home-never-empty`). No newer commit had arrived at the time of this note.

## Findings so far

### 1. MEDIUM (gate broken): the contract file no longer parses
`docs/contract/openapi.yaml:9525` was edited by hand. The new `description` for `Home.trending` is an unquoted line that holds `voices: today's`, and YAML reads that colon as a new key. The file is no longer valid YAML.

Steps: `python3 -c "import yaml;yaml.safe_load(open('docs/contract/openapi.yaml'))"` gives `mapping values are not allowed here ... line 9525, column 141`.

Effect: `api/test/shared/shared2.spec.ts` fails on this branch ("SHARED-2: API gaps, round 1, item 8 table: every signed-in write route in the contract refuses a non-active status") with `YAMLException: bad indentation of a mapping entry (9525:141)`. It passes on `origin/main` (to be confirmed in the full list).

Fix: run `python3 docs/contract/src/build.py docs/contract/openapi.yaml` from `schemas.py` (which is right). The build quotes the text; its output differs from the committed file at exactly that line (verified by regenerating to a scratch file).

### 2. Rule H itself: no fault found so far
- My own fuzz test, which uses a plain-JS oracle written from the rules, ran 60 random worlds (window 0, 3, 7, 30 days; 9 question states; HELD, REMOVED, DELETED_BY_AUTHOR and `deletedAt` answers; anonymous posts; banned, deletion-pending, deleted, suspended and ex admins; blocks in both directions; guest and signed-in viewers). Every world matched, order included, no duplicate.
- Hand cases that held: today 0 / 1 / 5 voices; cap 3 newest first (the 4th admin post may take a ranked place, as on `/feed/trending`); blocked author hidden in the ranked places; blocked admin still shown; stopped-being-admin and BANNED / DELETION_PENDING / DELETED admins not lifted; a SUSPENDED admin is lifted (same as `/feed/trending`); closed 6 days ago shown, closed 8 days ago not (window 7), shown at window 30; window 0 shows only open questions; draft and not-yet-open questions show nothing; `isMine` true on one's own post, false for others, `iLiked` true after a like.
- Note (not a fault, same as `/feed/trending`): an anonymous admin post is not lifted but can take a ranked place; a block does not hide an anonymous post.

### Still to do
Compare every other route with `origin/main`, query counts and timing with 50,000 answers, EXPLAIN, three runs of the new spec and its leftovers, the whole suite on both branches.
