# Bundle L (the Yoruba headline and the theme song). Tier T1. Lead brief, 12 Nov 2026

Builder: one Sonnet agent. Branch `v/landing-song` in wawu-voices-web from origin/main (and in this repo only if a seed,
spec or doc names the old headline). Read `docs/agents/RULES.md`, DECISIONS.md V-30, V-35, V-41 and V-43, the landing
(`src/features/entry/landing-words.ts` and where it is used), the settings screen, and how WHO MADE THIS plays its theme
(wawu-wmt-mobile `src/features/music/` and `src/lib/sound.ts` in wawuafrica, R-99): learn the pattern, never copy WMT's
brand. The track: the owner's file at /root/.claude/uploads/f6abda14-ea52-5aeb-b102-78d31cb7857d/7433f79c-AUD-20261112-WA0017.mp3
(3 min 28 s, 187 kbps). Resources: ports 15040-15059, Redis db 12, Postgres databases `vl_*`.

| # | What | Done when |
|---|---|---|
| L1 | The headline is "Ẹ jẹ́ ká sọ̀rọ̀!" (line 1) and "Let’s talk." (line 2), exactly, with the tone marks and the dot under the e drawn by the headline font itself (check every glyph renders in the landing font at 390 and 1440, light and dark; if the font lacks one, use a font that has it for that line and say so). Every place that showed "Finally, a place to say it. And be heard." shows the new words (grep both repos). | a guest sees the two lines on the landing, every mark in place |
| L2 | The theme song: the track is served from the web app (`/voices-theme.mp3`, or a smaller encode of the same track if it is over 4 MB, said in the hand-back), a round sound button on the landing and in the app's shell where the design leaves a slot (or the place WMT uses), and a Music row in Settings, start and stop it. It keeps playing across page changes, never starts before a tap, remembers on/off for the session, and a failed load says so in plain words. `web/src/app/layout.tsx` is fenced: if the player must live there, change only that and name it in the hand-back. | a person taps the button, the song plays while they move around, taps again and it stops |

## Checks
Every existing check EXIT 0 (web lint, typecheck, vitest, build, `sync:shared --check`). Pictures of the landing and
Settings, 390 and 1440, light and dark, beside their boards. Hand back in 6 lines with the head and the pictures folder.
