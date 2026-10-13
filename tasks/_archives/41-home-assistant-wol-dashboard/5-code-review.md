# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Branch `41-home-assistant-wol-dashboard` versus `main`, merge base `d584f24` through `b274e52`: 31 changed files, 810 additions and 108 deletions. Sampled risk-focused review of transport, configuration/selection identity, schema compatibility, draft ownership, shared polling/lifecycle, Wake dispatch, DOM/layout, tests, and documentation. Generated `package-lock.json` was excluded from design analysis.
**Health Score:** 95/100
**Trend:** 89 → 95 (+6) from the previous PR Review; the previous entry assessed this task's plan, so scores are not directly comparable.

The state and API boundaries are sound, but a short-desktop error state can hide all Wake buttons and clip dispatch feedback.

## Findings

### Warning

**R2 Change Propagation — Growing status text collapses the Wake list viewport**

Symptom: `public/dashboard.css:58-63` gives the device column a fixed viewport-derived height, splits it into equal rows, and assigns each section three automatically sized metadata rows followed by `minmax(0, 1fr)` for the device list. Sections use `overflow: hidden`. `public/dashboard-device-view.js:43-44` displays both retained-list error feedback and the latest wake result outside that list. These valid messages can consume more than the section's allocated height. The short-screen geometry case in `e2e/dashboard-devices.spec.js:108-124` tests long device lists but does not combine them with expanded error/action feedback.

Source: The Pragmatic Programmer — Orthogonality; Code Complete — Defensive Programming and Error Handling.

Consequence: A background list-refresh failure can make an otherwise retained, usable Wake action visually inaccessible. In a Chromium reproduction at 1200×420, using the actual stylesheet, the normal retained-list network-error message, and a successful wake message containing a valid 80-character device name, the Wake section remained 152px high but its contents required 214px. The list had a 0px viewport despite containing a saved row; the action message extended below the section and was clipped. Scrolling the page or list cannot restore a list viewport with zero height. This violates the planned short-window accessibility and clear-feedback behavior.

Remedy: Reserve a usable device-list viewport and make excess metadata scrollable, or use normal-flow sizing when the available height cannot accommodate metadata and actions. Preserve equal halves where feasible without clipping essential feedback or reducing the list to zero height. Add a browser regression combining a short desktop viewport, a maximum-length device name, a retained-list refresh error, and success/uncertain Wake feedback; assert the button remains visually reachable and the complete status can be read.

## Summary

Fix the metadata/list height interaction before treating short-desktop error handling as complete. The 918-line diff is a change-propagation review signal, but the edits remain related to this feature and do not justify a separate Shotgun Surgery finding. No implementation fixes were made during this review.

## Verification

- `npm test -- --test-reporter=dot`: all 249 unit/API tests passed during review.
- `npm run check`: passed during review.
- `PLAYWRIGHT_PORT=43217 npx playwright test e2e/dashboard-devices.spec.js --browser=chromium`: all 12 device browser cases passed during review. The full 81-case browser suite result is recorded in `4-implemented.md`; it was not rerun in this review.
- A separate read-only Chromium layout reproduction loaded existing HTML/CSS, without application scripts or network mutations, and populated existing status/list elements with legitimate values. It confirmed the 152px section, 214px content extent, and 0px list viewport described above. No reproduction or test files were added to implementation.

## Retained Decisions And Test Check

- Display-only device reads avoid server control-token issuance, while default API clients retain their control contract. Configuration identity guards prevent stale source responses from minting tokens or replacing current readings.
- Shared stored/cache decoding preserves previous fields and revisions without read-time writes. Selection arrays are canonical, bounded, instance-scoped, and saved through existing revision conflicts.
- Settings has no private controller lifecycle. Shared controllers, generation guards, subscriptions, and per-device pending requests preserve dashboard polling and dirty drafts without automatic wake retries.
- Production changes have corresponding unit/API/browser coverage, including failure, persistence, and concurrency paths. Fakes isolate nondeterministic network and UDP delivery boundaries; assertions verify displayed state, storage, token validity, and action outcomes rather than only mock wiring. No separate Quick Test Check findings were added.
- R1, R3, R4, R5, and R6 scans found no additional evidence-backed findings. The named modules hide necessary asynchronous ownership, composition-root imports are intentional, and display records are valid boundary DTOs. No `.brooks-lint.yaml` exists; balanced defaults apply.
