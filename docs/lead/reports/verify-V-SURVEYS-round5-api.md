VERDICT: FIX
INTERIM

# Check of V-SURVEYS round 5 (API), interim

Checked `origin/v/surveys` at d4d1bb9 on branch `verify/surveys-5`. No product code or test changed. One HIGH found so far; the full report follows in the next push.

## HIGH

**H1. The count of answers under the floor is shown to anyone, at the moment a response target is reached.**
- A survey may carry `responseTarget` from 1 (`api/src/surveys/dto.ts:117`, `@Min(1)`). Nothing ties it to the floor (`weekly.min_group_size`).
- `isLive()` (`api/src/surveys/surveys-admin.service.ts:72`) turns the survey off when `responses >= responseTarget`. The public brand page `GET /brands/:slug` (no sign-in, `brands.service.ts:249`) and the feed slot `GET /surveys/placement` (`surveys-public.service.ts:181`) both drop it at that moment.
- Steps and numbers: floor 20, survey target 3. Before any answer: brand page lists 1 survey, feed offers it. After answer 1 and answer 2: same. After answer 3: brand page lists 0, feed offers none. So a person with no account, polling the brand page, learns that exactly 3 people have answered (3 is under the floor of 20) and when the third one did.
- Fix: refuse a target below the floor when a survey is created, edited or approved (and when the floor is raised), or keep the survey on the public page and the feed until the results are released.
