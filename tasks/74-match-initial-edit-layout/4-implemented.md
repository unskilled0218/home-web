# Implementation

- [Implementation](#implementation)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limits](#limits)

## Changes

- Active Automatic editing now keeps widgets in their original DOM/CSS flow and uses exact measured rectangles for frames instead of immediately projecting the fixed grid. Existing Custom layouts still use their stored geometry. Inactive Automatic profiles retain the identified template preview.
- Added `public/dashboard-layout-automatic.js` for inverse fitted bottom-left coordinates, exact observations, bounded complete Custom candidates, and numeric intent/range helpers. Hidden/unmeasurable widgets use stable fallback records without being revealed. No persistence schema or API changed.
- Added explicit null overrides and active-only coalesced widget/content resize and document-scroll observation in the view. Custom projection or exit disconnects Automatic observers; stale callbacks cannot schedule work. Reset/Reload restore Automatic DOM before recapture, while clearing overrides restores the latest confirmed state.
- Session-local measured candidates remain separate from null Automatic drafts, captured source/revision tokens, and saved preferences. Real edits or explicit Custom selection materialize a candidate; no-op Save and canceled first gestures retain Automatic. Layout payloads still contain only `widgetLayout`.
- Addressed plan review W1: numeric controls show rounded, unclamped reference-pixel observations and expand native baseline bounds without relaxing Custom policy. Unchanged values are recognized before Custom validation, genuinely changed values use normal bounds, multiple raw fields process unchanged observations first, and focused/raw comparison provenance survives remeasurement.
- Added pure geometry tests, actual editor-handler tests through a small DOM seam, measured session tests, and view capture/cleanup tests. Added browser cases for desktop/intermediate/mobile entry geometry, typography, caption placement, long-press entry, partial/all-hidden widgets, short/negative/fractional numeric observations, scrolling/fullscreen, and first measured General Local/Global saves. Retained existing Custom and inactive-profile scenarios and updated the obsolete entry-template status assertion.
- Updated README, dashboard/layout documentation, release notes, and synchronized metadata to `0.17.43`.

## Verification

- Focused layout Node run across Automatic geometry, editor handlers, geometry/session/view/reference/activation tests: 82 passed, no failures, cancellations, or skips.
- `npm run check`: passed on version `0.17.43`.
- `npm test -- --test-concurrency=1`: passed all 666 tests, no failures, cancellations, or skips, in approximately 48 seconds. Syntax and full Node verification ran sequentially before browser attempts.
- All `e2e/*.js` files passed separate `node --check` syntax checks. Playwright also collected the complete suite successfully.
- Initial focused and complete browser attempts stopped at the first missing-Chromium launch failure with `--max-failures=1`. Those attempts exercised no application interactions. The user subsequently installed Chromium and Firefox; the prerequisite blocker is resolved. No browser/system packages were installed by the agent.
- After installation, `npm run test:browser -- e2e/dashboard-layout.spec.js e2e/settings-scope.spec.js` passed all 62 focused cases, including the Firefox/Chromium canonical-layout case and the new Automatic geometry, numeric-validation, scrolling/fullscreen, and Local/Global save scenarios.
- The first uncapped complete browser attempt reached 170 passing cases before the shell command's 240-second timeout interrupted execution. It was not treated as a complete pass; no application test failure was reported before interruption.
- Final `npm run test:browser`, rerun with a 600-second command allowance: all 191 cases passed in approximately 4.5 minutes, including both explicit Firefox/Chromium cross-browser scenarios. No code or test changes were needed after installing the browsers.
- `git diff --check`: passed. Release consistency and retained static-asset checks passed within the full Node suite.

## Limits

- Browser verification is now complete for the configured Chromium suite and its dedicated Firefox cross-browser scenarios. This does not claim that every scenario was run separately under Firefox.
- The live default arrangement is preserved while Automatic is pristine. Explicit Custom materialization still applies the existing minimum size and bounded canvas rules, so short/offscreen content may be constrained at that transition. Measured rectangles and comparison provenance are never persisted.
- Inactive Automatic profiles cannot be measured from the active DOM and retain their deterministic preview. Returning to active Automatic restores live-flow capture.
- Unrelated integration-draft discard and Calendar auto-close warnings remain unchanged. No merge, push, deployment, or release publication was performed.
