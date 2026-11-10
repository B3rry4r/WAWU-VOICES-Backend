# Bundle J (the web app asks to be installed on launch). Tier T1. Lead brief, 10 Nov 2026

Builder: one Sonnet agent. Branch `v/install` in wawu-voices-web, from origin/main (846940b or later).
Read `docs/agents/RULES.md`, DECISIONS.md V-41 (in this repo), and the web app's `src/app/layout.tsx`, `public/`
and `src/app/icon.png`, `apple-icon.png`. Resources: ports 15000-15019, Redis db 10, Postgres databases `vj_*`.

| # | What | Done when |
|---|---|---|
| J1 | Installable: a web manifest (Next 14 `app/manifest.ts` or `public/manifest.webmanifest`) with the app's name, short name, icons at 192 and 512 (any and maskable, from the brand assets), theme and background colours from the design tokens, `display: standalone`, `start_url` and `scope` `/`; the Apple tags (`apple-touch-icon`, `apple-mobile-web-app-capable`, title, status bar style) through Next's metadata. Served with the right content type under the site's headers (nginx and any CSP). | Chromium reports the app installable on a production build (`next build` + `next start`); the manifest and icons load with no console error. |
| J2 | The install screen (V-41), before anything else in a browser tab: Install through `beforeinstallprompt` where offered; iPhone and iPad Safari steps with pictures; the in-app browsers told to open in Safari or Chrome with a copy-link button; "Continue in the browser" at the foot; never in standalone (`display-mode: standalone`, `navigator.standalone`); the address opened (an invite, a share link, a payment return) kept and opened after. Curly quotes, no em-dashes, never "wallet" for tokens. | Vitest for each detection (standalone, iOS Safari, each in-app browser user agent, beforeinstallprompt) and the kept address; Playwright pictures of each state at 390 light and dark and at 1440 on a production build, each looked at. |

## Checks
Every existing check EXIT 0 on the branch (web lint, typecheck, vitest, build, `sync:shared --check`) and the lead's
`scripts/lead/fullcheck.sh`. Hand back in 6 lines with the head, the proof per browser and the pictures folder.
