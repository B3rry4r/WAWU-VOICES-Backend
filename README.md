# WAWU VOICES

The voice-first conversation web app by WAWU, on its own DigitalOcean droplet, signing in with WAWU ID.
Two repositories since 8 Nov 2026: this one (the API in api/, the contract, infra, rulings, tasks and the legal texts'
master copies) and [B3rry4r/WAWU-VOICES-Web](https://github.com/B3rry4r/WAWU-VOICES-Web) (the phone-first web app).
The joint history from before the split is on the `archive/monorepo` branch. The web repo keeps copies of
`docs/legal/{terms,privacy,refunds}.md`, `docs/contract/openapi.yaml` and `api/src/audio-ref/{normalise,limits}.ts`:
after changing one here, run `npm run sync:shared` in the web repo (its README says how).

Read docs/WORKFLOW.md and DECISIONS.md before any work.
