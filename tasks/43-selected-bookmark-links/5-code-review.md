# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Current branch `43-selected-bookmark-links` against `main`, merge base `b706f0d`, through `a2b877e`: 25 changed files, 663 additions and 145 deletions. Risk-focused review sampled the highest-risk settings, catalog/cache, identity, persistence, rendering, and test boundaries, including the user's latest Settings display report. Generated `package-lock.json` skipped for design analysis; package versions remain aligned at `0.17.13`.
**Health Score:** 94/100
**Trend:** Stable at 94 versus the latest PR Review record, which reviewed this task's plan rather than its implementation.

The flat dashboard and ordinary nested picker cases work in focused tests, but a confirmed multi-location picker omission and obsolete disclosure machinery remain.

## Findings

### Warning

**R6 Domain Model Distortion — bookmark identity is also used as tree-row identity**

Symptom: `public/dashboard-bookmark-selection.js:31-44` collects multiple folder locations for one bookmark ID, but `public/dashboard-bookmark-selection.js:51-69` creates only one checkbox row per ID and places it under the saved-hint folder or the first available candidate. Each folder's notice at `public/dashboard-bookmark-selection.js:24` still reports its full cached bookmark count. A disposable real-browser probe with two open folders containing the same bookmark and a saved hint pointing at the second folder produced: first folder, “1 available links listed below.”, zero direct checkboxes; second folder, the same notice, one direct checkbox. This state can arise when a moved bookmark is discovered in its new folder while the previous folder's cached result has not yet refreshed; simultaneous permanent provider membership is not required.

Source: *Domain-Driven Design* — Entity identity and relationship modeling; *A Philosophy of Software Design* — Information Hiding. A persistent bookmark choice has one identity, while its currently displayed folder memberships are separate view relationships.

Consequence: Settings can show a folder with known returned links but no link choices underneath it. The current location can be hidden behind an older cached hint, even while the selected flat dashboard works. Duplicate persistent choices should be prevented, but globally deduplicating the visible tree rows prevents the picker from faithfully displaying each folder's available content. This is a concrete omission relevant to the user report, not a confirmed explanation of the user's exact live account/session.

Remedy: Separate the checkbox-row key from the persistent selection key. Render available locations by `(collectionSelectionId, bookmarkSelectionId)` while sharing one bookmark-keyed draft record and one selection-limit count across the mirrored controls. Checking, unchecking, and explicit folder repair must update the shared record and all visible representations without duplicating saved choices; unavailable choices should still appear only once outside the catalog. Keep folder notices consistent with actually displayed rows. Add a browser regression that retains the old-folder cache, discovers the same ID in a new folder without refreshing the old one, and verifies visible rows in both branches, one persistent selection, non-mutating discovery, and explicit repair/conflict handling.

### Suggestion

**R4 Accidental Complexity — removed dashboard disclosure still has an active controller model**

Symptom: The branch deletes `public/dashboard-bookmark-tree.js` and replaces it with a flat `public/dashboard-bookmark-list.js`, but `public/dashboard-bookmarks.js:25-36,271-272` still owns desktop/mobile profiles, dashboard `open` state, an overrides map, and `setFolderOpen()`. No production module calls `setFolderOpen()` or consumes the old folder-open/profile values; `test/dashboard-bookmarks.test.js:49-60` still asserts them. `public/dashboard.js:181` supplies mobile mode to this obsolete presentation model even though the user-directed refinement deliberately removed dashboard folder disclosure. The serialized legacy preference is intentionally retained, but retaining its old runtime behavior is a separate decision.

Source: *Refactoring* — Dead Code and unnecessary state; *The Pragmatic Programmer* — Orthogonality. Backward-compatible preference decoding does not require maintaining a second unused disclosure state machine.

Consequence: Maintainers must distinguish a real Settings `pickerOpen`/folder state from a working-looking but unused dashboard `open`/profile state. A future fix to folder opening can be wired to the wrong method and pass tests that verify behavior no visible view consumes. The duplicate runtime model also adds avoidable work and change coupling to snapshots and viewport updates.

Remedy: Preserve and round-trip `mobileBookmarksMode` at the preference compatibility boundary, but retire unused dashboard disclosure methods/state from the bookmark controller. Keep actual picker disclosure, selection demand, visibility, and fullscreen policy explicit. Update the controller tests to verify visible picker demand and flat-list behavior rather than obsolete profile overrides; do not weaken the legacy stored-preference compatibility assertions.

## User-Reported Settings Issue

The exact live-session report was not reproduced or dismissed. The current unique-location nested-folder browser case passed, while the controlled multi-location case above reproduced a real missing-row condition. Other documented states can also omit cached catalog content: child folders start closed, and evicted folders require explicit Reload folder. Those are stated policies rather than separately scored defects here. A deployment/browser-version mismatch or different provider payload was not established, and no real Linkwarden account or live service was inspected.

## Verification And Quick Test Check

- Ran `node --test --test-timeout=5000 test/dashboard-bookmarks.test.js test/dashboard-settings-api.test.js test/linkwarden-tree-api.test.js`: all 34 tests passed in about 0.69 seconds.
- Ran `PLAYWRIGHT_PORT=43249 npx playwright test e2e/selected-bookmark-links.spec.js --browser=chromium --grep 'Settings contains direct links|moved-link'`: both focused cases passed in 2.5 seconds.
- Ran `/tmp/opencode/task43-review-probe.mjs` against the real picker module in disposable Chromium with controlled DOM/state and a loopback static server. It confirmed the two-folder count/checkbox discrepancy. The probe's browser and server were closed; no implementation or repository test was modified to reproduce it.
- Existing implementation evidence records 297 passing Node tests with two signal-permission skips and 94 passing browser tests. The complete suites were not rerun during this review, and that earlier success does not cover the multi-location omission.
- Tests exist for schema/default transitions, revision conflicts, persisted identity, protected navigation, selected-first cache capacity, late-result fencing, source/access changes, draft independence, and visible tree/flat geometry. The key missing membership regression is included with the production finding rather than counted again as a separate coverage deduction.
- Mock/fake usage is appropriate for clocks and providers; browser tests use actual SQLite-backed servers, DOM, and loopback popup navigation. Most multi-assertion cases express one clear scenario; no separate Mock Abuse or Test Obscurity finding is warranted. The obsolete-state assertions are covered by the suggestion above.
- Shared identity/selection validation, source-scoped hashes, token authorization, canonical preference decoding, independent credential/preference actions, native protected anchors, and unchanged memory/request bounds were inspected. No required new dependency cycle, unrelated feature work, speculative framework, or duplicated persistence owner was found.
- No `.brooks-lint.yaml` was found; balanced defaults apply. Score is 100 minus one warning at five points and one suggestion at one point. The change exceeds 500 additions and spans several coupled feature boundaries, warranting risk-focused review, but its files share the bookmark-selection objective rather than unrelated responsibilities.

## Summary

Correct the Settings membership-to-row mapping without regressing the working flat dashboard or duplicating persisted choices. Retire the unused dashboard disclosure state separately while keeping preference compatibility. Only this review and the review-history record are committed; no fixes are implemented in this stage, and the user's live Settings issue remains unresolved pending remediation and exact-session verification.
