# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review: `tasks/36-server-weather-location-cache/2-plan.md`, checked against `1-goal.md`, the browser weather controller, and server lifecycle. Findings refer to the plan before this review's edits.
**Health Score:** 85/100
**Trend:** 100 → 85 (−15) from the previous PR Review; the previous scope was a branch review, so this is not a like-for-like implementation quality trend.

The plan covers the goal, but three state-transition gaps could cause excessive retries or leave weather permanently unavailable.

## Findings

### Warning

**R6 — Domain Model Distortion: missing data can bypass failed-attempt cadence [guided]**

Symptom: Step 3 allows retrieval when a variant is missing or its last attempt is at least one hour old, while also requiring hourly retries after failure. It does not distinguish an unregistered variant, a registered variant that has never been attempted, and a registered variant whose first attempt failed without producing data.

Source: *Domain-Driven Design* — Aggregate Roots and invariant ownership; *Code Complete* — defensive programming and explicit error paths.

Consequence: An empty cache after a failed first request can repeatedly satisfy the missing-data condition. Each browser reload or ensure-fresh request could retry the provider immediately instead of respecting the server's hourly retry invariant. Corrupt-cache replacement has the same ambiguity.

Remedy: In `2-plan.md` Steps 2–4, define `ensureFresh` in the planned `src/weather.js` around registration and per-part attempt state. Schedule immediately only for a newly registered or never-attempted part; record an attempt before dispatch; otherwise require the hourly deadline even when successful data is absent. Define terminal snapshot errors and an explicit idle refresh response so the browser does not infer pending work from HTTP 202 alone. Verify repeated requests following a failed first forecast and failed first AQI attempt produce no extra provider calls before the deadline.

**R2 — Change Propagation: cache eviction and browser recovery have incompatible contracts [guided]**

Symptom: Step 2 registers timezone variants only through refresh requests and evicts least-recently-used variants. Step 5 calls ensure-fresh on initialization, timezone changes, and visibility restoration, but normal polls only read snapshots. It neither defines what touches LRU activity nor schedules recovery when a visible browser's timezone disappears.

Source: *The Pragmatic Programmer* — Orthogonality; *A Philosophy of Software Design* — Information Hiding and Leakage.

Consequence: Another browser can evict an actively displayed timezone. Subsequent polls return no forecast, but the continuously visible client never registers it again. It can remain unavailable indefinitely or keep five-second polling with no server work. If only initial registration touches activity, even an actively used timezone can look old.

Remedy: In `2-plan.md` Steps 1–5, expose a small public `forecastRegistered` flag and an explicit refresh `scheduled`/`refreshing` result, while keeping registration tokens internal. Have the controller call ensure-fresh no more than once per sixty-second normal polling cycle after rendering a snapshot, touching registration activity and re-registering an evicted timezone. Drive fast polling from actual queued or active work, not absent data. Verify a visible client recovers after eviction and that provider calls remain coalesced and hourly for retained variants.

**R6 — Domain Model Distortion: label-only revisions strand valid weather work [guided]**

Symptom: Step 2 increments the location revision and retags cache entries for a label-only change. Step 3 rejects writes from old revisions but cancels and replaces work only on coordinate changes. Existing queued and active jobs still carry the old revision.

Source: *Domain-Driven Design* — Entity vs Value Object and Aggregate Roots; *The Mythical Man-Month* — Conceptual Integrity.

Consequence: A cosmetic rename invalidates otherwise useful active results. Pending snapshots may remain marked refreshing, or a first retrieval may be discarded without replacement until the next hourly cycle. Cache retagging alone does not repair job ownership.

Remedy: In `2-plan.md` Steps 2–3, route every non-idempotent location revision change through one service transition. For label-only changes, preserve retagged successful data and timestamps, cancel old-revision jobs, reset attempt markers only for canceled parts, and requeue canceled or never-attempted work under the new revision. Preserve due times for completed attempts. Verify renaming during a delayed first retrieval and during a successful-cache refresh cannot strand work or clear existing readings.

## Summary

All three findings are addressed in the revised `2-plan.md`, including concrete acceptance and verification cases. The 85/100 score records the reviewed input plan, not a projected implementation score. No implementation code changed; the Quick Test Check was skipped because this is a documentation-only review.

The remaining design choices are justified by the goal: canonical units avoid unit-specific cache multiplication, timezone variants preserve provider daily semantics, and revision checks protect shared configuration. No additional findings were identified for cognitive overload, duplicated knowledge, speculative abstractions, or dependency direction at plan level.

## Fix Summary

- Guided: Define per-part attempt eligibility and explicit scheduling state in Steps 1–4 and verify first-attempt failure throttling.
- Guided: Reconcile LRU activity, bounded registration recovery, and polling in Steps 2–5 and verify eviction recovery.
- Guided: Define label-only revision transitions in Steps 2–3 and verify pending retrieval replacement.
