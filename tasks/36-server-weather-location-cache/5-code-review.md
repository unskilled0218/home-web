# Brooks-Lint Review

**Mode:** PR Review
**Scope:** All changes on `36-server-weather-location-cache` relative to `main`, merge base `8c2a8ee`, through implementation commit `950d254`. One implementation commit changes 20 files with 1,022 additions and 125 deletions. Review depth is sampled around browser mutation ownership, server request lifecycle, persistence invariants, API boundaries, and corresponding tests; the complete changed-file inventory and related UI/documentation changes were examined. `package-lock.json` was skipped as generated content.
**Health Score:** 90/100
**Trend:** 85 → 90 (+5) from the previous PR Review. The previous score reviewed the task plan, so this is not a like-for-like code quality trend.

The feature has broad verification and coherent cache ownership, but two reproduced failure-path issues remain.

## Findings

### Warning

**R6 — Domain Model Distortion: an earlier save can release a later mutation's pending state**

Symptom: `public/dashboard-weather.js:81–95` uses one shared `mutationPending` boolean for every `saveLocation` invocation. Line 89 clears that boolean before awaiting the post-save snapshot refresh, permitting another selection while the earlier invocation is still running. The earlier invocation's unconditional `finally` then clears the flag again and arms polling, even if the newer selection's PUT is still pending. Read-generation checks protect snapshot results but do not protect mutation cleanup ownership.

Source: *Domain-Driven Design* — Aggregate Roots and invariant ownership; *Code Complete* — explicit state and error-path discipline.

Consequence: The controller can accept competing location saves and resume polling during an active PUT, contrary to its single-mutation contract. A subsequent configure or snapshot emission exposes `mutationPending: false`, allowing `public/dashboard.js:53` to re-enable result buttons while the newer save is still in flight. Server revision checks limit persistence damage, but users can receive avoidable conflicts and misleading pending state.

Remedy: In `createWeatherController.saveLocation`, either retain mutation ownership until the entire save operation finishes or give each mutation an operation token and let only the current owner clear its pending state, release its controller, and restart polling. Keep post-save refresh cancellation distinct from ownership of the following PUT. Add a controller regression that delays the first save's follow-up GET, starts a second save after the first PUT commits, then settles the older GET while the second PUT remains blocked; the second mutation must remain pending and reject a third save.

Evidence: A read-only inline reproduction using the real controller and deferred fetch responses logged `second PUT pending: true`, then `after first save finally, second PUT still pending: false` after settling the first save's obsolete follow-up GET and re-emitting state through `configure`. The second PUT had not completed.

**R2 — Change Propagation: early provider rejection leaves response cleanup without an owner**

Symptom: `src/weather.js:15–18` throws for an unsuccessful status or excessive declared Content-Length before acquiring a reader or canceling the response body. `retrieve` at lines 34–42 cancels the deadline and removes its abort listener on every settlement, but does not abort the request when that early rejection occurs. Cleanup exists only inside the later reader loop's error path.

Source: *A Philosophy of Software Design* — Information Hiding and Leakage; *Code Complete* — resource management and error-handling discipline.

Consequence: The service reports a completed failed attempt while an unread upstream body can still own network resources. Its ten-second deadline no longer bounds that body's lifetime; cleanup depends on upstream completion or garbage collection. Repeated provider failures across retained timezones can therefore retain connections or buffering even though the refresh queue appears idle.

Remedy: Make the provider request boundary own cleanup for every exit path. In `providerJson`, cancel or abort rejected responses before throwing, including non-OK statuses and excessive declared lengths; ensure `retrieve` aborts unfinished transport work when it exits exceptionally. Preserve the existing independent cache-failure behavior. Add tests with an open streaming response for a non-OK status and an oversized Content-Length, asserting body cancellation or signal abortion when the failed attempt completes.

Evidence: A read-only inline reproduction used the real weather service with an in-memory SQLite store and streaming responses declaring `Content-Length: 1048577`. It logged `responses rejected: true true`, `unread response bodies canceled: 0`, and `request signals aborted: [ false, false ]`. The existing oversized-response test reads until the streamed byte limit and does not cover this header-rejection path.

## Quick Test Check

Corresponding Node and browser checks exist for the new behavior. Temporary SQLite stores exercise real persistence and API boundaries; injected clocks and providers isolate network timing. Assertions cover rendered output, cached values, timestamps, failures, revision conflicts, and cancellation rather than only mock wiring. Multiple assertions in these tests support coherent behavior claims, so no separate test-obscurity finding is warranted.

The last implementation verification passed `npm run check`, all 170 Node test entries, and all 24 Chromium cases on the reviewed implementation. Those suites were not repeated during this documentation-only stage. Both findings were independently reproduced against the reviewed code without adding tests or changing implementation files.

## Summary

Fix mutation cleanup ownership first, then close the early provider-response cleanup gap. No critical findings were identified; the two warnings account for the 90/100 score under the default balanced deductions.

This is a large cohesive weather feature spanning persistence, service scheduling, API delivery, browser presentation, and verification, rather than unrelated change propagation. The shared normalization module, revision-checked transactions, registration tokens, canonical units, and server-owned queue provide clear boundaries; no additional findings were identified for duplicated policy, speculative infrastructure, or dependency direction. This review records findings only and applies no implementation fixes.
