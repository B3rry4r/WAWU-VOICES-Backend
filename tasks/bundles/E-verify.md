# Verifier for bundle E (media): LCH-13, LCH-07. Tier T1 with the privacy attacks. Lead brief, 9 Nov 2026

You are the verifier: you built nothing, fix nothing; check, attack, report, verdict MERGE or FIX. No commits, no pushes.
Read `docs/agents/RULES.md`, the builder brief `tasks/bundles/E-media.md`, the task files LCH-13 and LCH-07,
LAUNCH-SPEC §9 and §10, DECISIONS V-31, V-34, V-35, and the boards WeeklyInsta-Cover, WeeklyInsta-Story, VoiceVideo-916,
VoiceVideo-11. Render each board with `node scripts/design/render-boards.cjs <dir> <Board>` (port from your range) and
compare picture against picture.
Code: `v/lch-e` (backend b96ac9e, web 4d83773; main with bundle A merged in). Worktrees /home/user/wt/ve-backend and
/home/user/wt/ve-web; resources: ports 15060-15079, Redis db 10, Postgres databases `ve_*`. Another verifier works on
15040-15059 and db 11; an analysis agent on 16000-16019.

The lead already sees three gaps; confirm each and say how you would close it (they go into the fix round with yours):
the contract (`docs/contract/openapi.yaml` hand-edited, not regenerated from `docs/contract/src`); the data export does not
list a person's videos; nobody is told a video is ready unless the share screen is open.

## Check (command, result, PASS or FAIL)
1. Instagram: sizes 1080x1350 and 1080x1920; every word comes from the approved report or a board line (try a report whose
   text changes after approval, a draft, a held report: 409); numbers as the report shows them; only editor and admin can
   download (every other role and a guest refused); nothing posts anywhere by itself. Pictures beside the boards.
2. Video privacy: only the answer's author can ask for, see or download a video (another person, a guest, an admin
   without the author, a guessed or old file id, a direct storage key); an anonymous answer; a removed, deleted or
   blocked answer's video is 404 at once and its file is gone after the purge; the account deletion purge removes every
   video; nothing is ever public; legal lines (privacy.md, CLAIMS) match what the code does.
3. Video build: both sizes as the boards draw them (one frame of each beside its board), at most 15 s, captions only from
   the stored transcript, the word chip on mood questions, the name line only with the card switch; the queue under 50
   requests (2 at a time, nothing lost, the server stays responsive: time a normal request while it runs); 5 a day per
   person including the edges (Lagos midnight, a failed build, a double tap).
4. Share screen: none, making, ready at 390 light and dark; until ready the share uses the audio link; a failure state.
5. Existing tests changed: list each; only values a ruling changed. Changed shared code (ObjectStore.putVideo, schema,
   migration 20261110080000_voice_video): additive; the migration applies on a database with data from main.
6. Regression: bundles A, B, C, F hold on this branch.
7. Checks to EXIT lines on both branches, the full api suite on a fresh database (if test/feed/ranking.spec.ts fails on
   latency while another agent's tests run, rerun it alone and give both numbers).
Report: /tmp/voices-reports/v-lch-e.md, written as you go. Hand back in 8 lines. Clean up worktrees, `ve_*`, Redis db 10.
