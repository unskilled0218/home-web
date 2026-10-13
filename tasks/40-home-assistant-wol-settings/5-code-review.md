# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Current branch `40-home-assistant-wol-settings` against base `main`, `302c093...fa0444c`: 23 changed files, 736 insertions and 28 deletions. Review depth was risk-prioritized for this larger branch, focusing on request ownership, form/session lifecycle, token handling, polling, and test-server teardown; supporting markup, styles, documentation, version, and regression changes were also checked. Generated `package-lock.json` was excluded from design diagnosis.
**Health Score:** 95/100
**Trend:** 89 → 95 (+6) from the previous PR Review record; that record reviewed the task plan, so this is not a like-for-like implementation trend.

The integration screens and IPC test teardown work, but persisted-page suspension bypasses submitted-secret cleanup and leaves stale action progress.

## Findings

### Warning

**R2 Change Propagation — Persisted-page session invalidation also suppresses required action cleanup**

Symptom: `public/dashboard-integration-settings.js:54-62` allows success callbacks and action messages only while the captured session matches. `suspend()` at line 122 increments that session but, unlike `close()` at line 120, neither clears the Home Assistant token nor clears action messages. Token clearing after a successful connection is inside the session-guarded success callback at line 105. `public/dashboard.js:337-338` calls `suspend()` on persisted `pagehide` and restores visibility on persisted `pageshow`, without opening a new dialog session or reconciling those action fields. The controller can therefore confirm a save while its required form cleanup is permanently skipped.

Source: The Pragmatic Programmer — Orthogonality; A Philosophy of Software Design — Information Hiding and Leakage; Code Complete — Defensive Programming and Error Handling.

Consequence: After restoration, a successfully submitted long-lived token remains in the password input and the message remains “Saving server settings…” even though the connection is saved and inputs are enabled. This violates the goal's successful-secret cleanup requirement and misrepresents a completed action as pending. Wake-on-LAN actions crossing the same boundary can likewise retain stale progress. This is extended secret retention in the browser form, not evidence of token disclosure through APIs or storage.

Remedy: Separate session-specific draft/focus effects from lifecycle cleanup. Clear Home Assistant token input when suspending a persisted page, or clear only the still-owned submitted value on successful completion without touching any newer draft. Clear or reconcile obsolete progress messages on suspension/restoration from actual controller pending state. Keep confirmed state updates and stale-result protections intact. Add a delayed Home Assistant save regression that crosses persisted `pagehide`/`pageshow` and asserts saved connection, empty token, non-pending message, preserved unrelated drafts, and no focus theft; cover the equivalent Wake-on-LAN progress case.

Evidence: A read-only Chromium probe used the actual dashboard, an in-memory real server/store, and a blocked injected Home Assistant client. It submitted a token, dispatched persisted `pagehide`, released the successful connection, waited for input re-enablement, and dispatched persisted `pageshow`. Observed output was `{"configured":true,"tokenCleared":false,"message":"Saving server settings…"}`. No repository implementation or test file was modified for the probe.

## Quick Test Check

The branch adds corresponding controller, scheduler, and real-server browser tests, with observable UI and persistence assertions rather than mock wiring alone. Injected providers and timers are appropriate seams for asynchronous behavior, and the current tests cover validation, failure, duplicate mutation, stale reads, confirmation, draft preservation, independent polling, and restart persistence. `e2e/integration-settings.spec.js:94-102` covers a pending connection across close/reopen, while lines 150-165 cover persisted-page suspension after a connection has already completed. Their missing intersection explains the finding; it is not counted again as a separate coverage issue. Test names and assertions provide readable failure stories, so no additional test-quality finding is warranted.

## Verification

- `npm run check` passed.
- `npm test` passed: 232 tests, zero failures and zero skipped tests.
- `PLAYWRIGHT_PORT=3212 npm run test:browser` passed: all 69 tests in 38.7 seconds, including all nine integration Settings cases and the existing actual Firefox/Chromium exchange test. Firefox is now installed, resolving the earlier environmental blocker recorded in `4-implemented.md`. No browser installation was performed during this review.
- The independent persisted-page pending-save probe reproduced the warning despite the existing suite passing.
- No `.brooks-lint.yaml` exists; balanced defaults apply. No fixes were implemented in this stage.

## Summary

Address the persisted-page action cleanup before treating the branch as ready to merge; one warning yields 95/100. The branch exceeds 500 added lines, which is a Change Propagation review-cost signal, but most edits stay within the same settings feature and its tests; IPC teardown is a justified response to the observed container shutdown failure, not evidence of unrelated architectural coupling. No additional R1/R3/R4/R5/R6 findings were substantiated: focused controller boundaries hide request complexity, the two-consumer transport is justified, browser URL checks remain server-authoritative and tested, imports are acyclic, and the simple configuration domain does not require a richer model.
