VERDICT: FIX
INTERIM

# Check of V-SURVEYS round 4 (interim, one HIGH found, check still running)

Branch checked: `origin/v/surveys` at f7377d3. Checker branch `verify/surveys-4`.

## HIGH

### H1. Staff routes give the exact number of people who answered, for any group size
- Routes: `GET /admin/surveys`, `GET /admin/surveys/{id}` (fields `responses`, `completes`, `starts`, `skips`, `views`), and `GET /admin/surveys/{id}/report` (field `answeredSoFar`, at every stage: RUNNING, REVIEW, before release). Roles: AD_MANAGER and ADMIN.
- Code: `api/src/surveys/surveys-admin.service.ts:186-243` (`view`), `api/src/surveys/surveys-results.service.ts:255-280` (`report`, `answeredSoFar`).
- Steps: seed a survey with 1, 2 or 4 answers (floor 5) and call the detail route as an ad manager. Seen: `responses: 1`, `2`, `4` (my run: survey with 4 answers gave `responses 4`, `completes` as stored, while the released brand report for the same survey said `belowMinimum: true` and nothing else). With 68 answers in groups 50/6/5/4/2/1 the detail gave `responses: 68`. Polling the same route before and after one person answers gives a difference of exactly one, with no floor.
- The first check named this L-K and the builder left it ("staff see counts while a survey runs"). Under this brief (an ad manager or an admin must not learn a group under the floor or its exact size) it is a break: a survey that reaches only 1 to 4 people has its size handed to staff, and `starts - completes` gives the small group that began and did not finish.
- If the lead rules that staff may see operational counts, this drops to LOW. Otherwise the fix is to apply the same floor (null under the floor) to every count on these three routes.

(The rest of the check follows in the final report.)
