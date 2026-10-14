# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Current branch `44-background-display-options` against `main`, merge base `8454e75`, through `b84ee34`: 19 files, 373 additions and 57 deletions. Risk-focused review sampled the highest-risk preference migration, presentation/lifecycle, grid/fullscreen, and verification boundaries, with the complete branch diff inspected. Generated `package-lock.json` excluded from design analysis; package versions remain aligned at `0.17.14`. No `.brooks-lint.yaml` was found; balanced defaults apply.
**Health Score:** 94/100
**Trend:** 99 → 94 (−5) from the preceding task 44 plan review; plan and implementation scores are not like-for-like.

The feature preserves its data and presentation boundaries, with one test-coverage warning and one small lifecycle-coupling suggestion; no blocking production defect was found.

## Findings

### Warning

**T5 Coverage Illusion — caption test cannot detect bookmark folder requests**

Symptom: `e2e/background-display-options.spec.js:120` counts requests using `/api\/linkwarden\/.*bookmarks/`, but `public/dashboard-bookmarks.js:171,176` sends folder reads to `/api/bookmarks?collection=...`. Therefore the repeated `expect(folders).toBe(0)` assertions at line 125 cannot detect real folder requests. The fixture also has no configured Linkwarden connection or selected/loaded folder, so fixing the matcher alone would still leave the no-bookmark-work claim unexercised. Clock interval identity, manifest counts, revision preservation, and visible caption geometry remain meaningfully checked; this warning is specifically about the claimed bookmark-owner protection.

Source: *How Google Tests Software* — Change Coverage; *The Art of Unit Testing* — Test Completeness. A negative side-effect assertion needs a live eligible dependency and an observer of its actual external behavior.

Consequence: A future caption callback could accidentally invoke the composed bookmark presentation path and start eligible folder work while this regression test stays green. The present production caption path is DOM-only and does not demonstrate that defect, but the test and documentation overstate protection against its return.

Remedy: Match the actual `/api/bookmarks` pathname, initialize a stubbed configured connection with selected/loaded content, and prove the counter observes at least one baseline folder request before capturing it. Use controlled freshness/timers to distinguish scheduled refreshes from caption-triggered work; then change/clear captions repeatedly and assert no additional folder requests. Also observe the relevant integration request paths if retaining the broader “request owners” claim. Do not contact a real provider or change the existing scheduling policy to accommodate the test.

### Suggestion

**R2 Change Propagation — device-only visibility changes invoke bookmark scheduling**

Symptom: `public/dashboard.js:197` places all four Home Assistant/Wake-on-LAN profile visibility fields in the changed-key condition for `applyBookmarkPresentation()`. That function at lines 183–186 applies the shared DOM layout and then calls `bookmarks.setPresentation()`, even when bookmark mode, viewport, fullscreen state, and effective visibility are unchanged. The unchanged controller method at `public/dashboard-bookmarks.js:277` emits and invokes `queueRequired()`, which enqueues eligible selected/loaded folder work at lines 121–131.

Source: *The Pragmatic Programmer* — Orthogonality; *A Philosophy of Software Design* — Information Hiding. Updating device overlay geometry should not need the bookmark controller's request scheduling interface.

Consequence: Hiding/re-enabling a device section can start due bookmark reads earlier than the bookmark refresh owner would otherwise run, and unnecessarily renders bookmark/picker state. A disposable controlled-clock probe loaded one selected folder, advanced freshness by 300,001ms without firing its scheduled refresh, then called `setPresentation()` with unchanged arguments: it issued one additional `/api/bookmarks?collection=...` read while retaining one timer. This is bounded eligible work, not a duplicate owner, request loop, data loss, or proof of a caption-path defect; severity is therefore Suggestion.

Remedy: On device-only visibility changes, call the existing DOM-only `applyVisibilityLayout()` directly. Restrict bookmark controller presentation updates to relevant bookmark/profile/fullscreen changes, sharing the same derived visibility decision. Add an expired-cache test showing a device-only save updates wrapper rows/tracks without invoking bookmark scheduling, while the existing bookmark timer still refreshes due content normally.

## Assessment And Verification

- R1 Cognitive Overload: the new projection and DOM adapter are small, linear, and purpose-specific. Compact return/mapping expressions follow surrounding style; no additional style finding is warranted. The broad changed-key routing is covered by R2 rather than counted twice.
- R2/R3 Change Propagation and Knowledge Duplication: all changed files support one overlay-visibility objective. Controls move rather than duplicate; old profile fields remain canonical; new stored-default decoding does not loosen live writes. One shared effective-visibility decision owns wrapper and grid policy. Only the device-to-bookmark lifecycle coupling above is newly introduced.
- R4 Accidental Complexity: no new framework, storage table, endpoint, polling owner, browser launcher, or speculative extension point. The extracted DOM application absorbs the caption/lifecycle boundary called out in the plan review.
- R5 Dependency Disorder: `dashboard.js` remains the browser composition root; `dashboard-display.js` imports only profile helpers and exposes a DOM adapter separately from projection. No new cycle, database dependency in presentation policy, or test-only production method was found.
- R6 Domain Model Distortion: independent profiles, effective fullscreen hiding, optional filename presence, saved selections, connection state, and document visibility remain distinct. New booleans default true only when missing; invalid present fields and partial writes fail. All-hidden and caption-only pages retain controls. Hiding a pending Wake changes presentation, not submitted action ownership.
- Quick Test Check: corresponding unit/API/cache and browser tests exist. Real local SQLite/server fixtures verify persistence/conflicts and visible geometry; injected/intercepted providers keep tests deterministic. Existing moved-control, mobile ordering, selection, and calendar eligibility scenarios are retained rather than deleted. Mock setup does not replace the principal behavior assertions. The one coverage warning concerns a non-observing request counter, not absence of the overall suite.
- Review rerun: `node --test --test-timeout=10000 --test-reporter=spec test/dashboard-display.test.js test/dashboard-settings-api.test.js test/dashboard-settings-sync.test.js test/dashboard.test.js` passed all 55 tests, with zero skips/failures, in about 0.46 seconds.
- Review rerun: `PLAYWRIGHT_PORT=43251 npm run test:browser -- e2e/background-display-options.spec.js` passed all five tests in 13.2 seconds. Passing tests do not invalidate the ineffective counter finding.
- Reviewed the implementation's earlier full verification: 303 Node tests passed, two explicit OS-signal permission skips, and all 102 browser tests passed, including Firefox/Chromium exchange. Those full suites were not rerun in this review. The known `EACCES`/npm forwarding limitation and direct-launch fallback remain unchanged.
- Diagnostic probe: a disposable in-memory bookmark-controller fixture confirmed one eligible folder read from unchanged presentation after the five-minute freshness boundary, with exactly one retained refresh timer. It used no real connection, database, browser preference save, external provider, or packet dispatch and disposed its controller afterward.
- Score calculation: 100 − 5 for one Warning − 1 for one Suggestion = 94. Zero Critical findings. Archived task 42/task 43 findings and the user's unconfirmed live Settings-folder report remain outside this branch and are not claimed resolved.

## Summary

Repair the caption test's endpoint observer and fixture demand so its negative request assertion actually protects the intended boundary. Separately, route device-only visibility updates through DOM layout without bookmark scheduling. This stage records findings only: implementation, plan, dependencies, version, user data, and `todo.md` remain unchanged; only this report and the review history are committed.
