# Bundle K (a question pool in the dashboard). Tier T1. Lead brief, 11 Nov 2026

Builder: one Sonnet agent. Branch `v/question-pool` in wawu-voices-backend (api) and in wawu-voices-web, each from its
origin/main. Read `docs/agents/RULES.md`, DECISIONS.md V-14, V-27, V-29 and V-42 (this repo), the admin API
(`api/src/admin/admin-content.controller.ts`, `topics.service.ts`, `dto.ts`: `POST /admin/questions` already creates a
question with no topic and no day), and the web dashboard (`src/features/admin/CalendarPage.tsx`, `AdminFrame.tsx`,
`src/lib/api/admin.ts`, `ui.tsx`). Resources: ports 15020-15039, Redis db 11, Postgres databases `vk_*`.

| # | What | Done when |
|---|---|---|
| K1 | API: `GET /admin/questions?pool=1` lists pool questions (no topic, no day, not closed), newest first, cursor pages; additive, editor and admin only, in the contract | an editor sees exactly the pool, a viewer is refused |
| K2 | API: adding many at once. Either `POST /admin/questions/bulk` (up to 50, each the same rules as one) or the web calls the existing route per line; the builder picks and records why. A bad line is reported by its line number and the good ones are kept | 30 pasted lines become 30 pool questions; a 2-character line is named and refused |
| K3 | API: put a pool question on a day: it joins the week whose dates hold that day (no week there: refused in plain words), a free day at once, a taken day only after the editor confirms, and then the two swap as `move` does. One lock, as the calendar uses | the calendar shows it on that day; the old question goes to the pool |
| K4 | Web: a "Question pool" page in the dashboard nav: a box for many questions (one per line), Daily or Flash, category; the list with edit, remove, "Put on a day" (date picker, the taken-day confirm), and "Start now" for a Flash one (the existing flash poll call) | an editor adds 10 questions and schedules 2, all through the page |
| K5 | Web: "Add a question" inside a week of the calendar (the missing button): adds a spare to that week | the week shows one more spare |

## Checks
Every existing check EXIT 0 on both branches (api lint, typecheck, tests; web lint, typecheck, vitest, build,
`sync:shared --check`) and the lead's `scripts/lead/fullcheck.sh`. Pictures of the pool page and the week's new button,
1440 and 390, light and dark, beside the dashboard's look. Hand back in 6 lines with both heads and the pictures folder.

## State
Cut 11 Nov 2026. Builder next.
