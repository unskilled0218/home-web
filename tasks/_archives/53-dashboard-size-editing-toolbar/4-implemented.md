# Implementation

## Table of Contents

- [Outcome](#outcome)
- [Changes](#changes)
- [Regression Evidence](#regression-evidence)
- [Ownership and Safety](#ownership-and-safety)
- [Verification](#verification)
- [Limits and Scope](#limits-and-scope)

## Outcome

Implemented unchanged-size dashboard editing, compact top-right Save/Toolbar/Cancel, an initially closed overlay panel, and per-widget Up/Down layer controls on branch `53-dashboard-size-editing-toolbar`, created from reviewed task-bearing commit `6643f46`. The application version is `0.17.22` in both manifests with no dependency changes. Existing labeled-frame move and selected upper-right resize gestures remain unchanged and work with the panel closed. No additional activation gesture or Settings editor was introduced.

## Changes

- `public/dashboard-layout-view.js` no longer measures or observes editing chrome. Normal page tools, page status, safe insets, viewport, and caption retain destination ownership; the existing reference lock, uniform fit, bottom-left coordinates, projection, and live node identity remain unchanged. Hidden normal tools retain their measured footprint during editing rather than being removed from flow.
- `public/index.html` retains one native layout form and unique existing controls, with Save, an ARIA-linked Toolbar toggle, and Cancel outside the hidden details section. Compact status remains available with details closed. Profile/arrangement/widget selection, numeric fields, all existing layer actions, reset, Reload, and fullscreen remain in the nonmodal panel, alongside six labeled Up/Down rows. Settings form ownership and all eight tabs are unchanged.
- `public/dashboard.css` positions the compact controls independently at the safe-area-aware visual viewport's top right. The bounded overlay panel scrolls internally, while exit controls remain separate and may wrap inside narrow windows. Root/panel/status sizes never feed canvas measurement. Existing safe-inset variables are reused for chrome as well as the view. Pointer-transparent empty chrome does not block exposed frames; actual controls/panel own their hit areas.
- `public/dashboard-layout-editor.js` owns panel visibility, ARIA/focus, and visual-viewport placement without reloading drafts, projecting geometry, acquiring another reference lock, or saving solely because visibility changes. Entry focuses Toolbar; opening focuses the named panel; dismissal restores Toggle focus when appropriate. Escape cancels a gesture first, otherwise closes details without ending editing. Pending writes disable toggle/close as well as existing mutation/exit controls.
- Numeric dismissal retains the same raw values, selection, and panel scroll. Toggle/Close prevent the native pointer focus change that would commit a focused numeric field before their click. Deferred field changes reject obsolete panel epochs/hidden sessions, and invalid field-change validation no longer traps focus. Explicit Save/selection/mutation still validates; invalid Save reveals and focuses the field. Measurement/status observations do not rebase drafts or reset raw values. Identical status text is not repeatedly rewritten for live announcements.
- `public/dashboard-layout-session.js` adds an optional explicit widget target to its existing layer operation. Up maps to forward and Down to backward in the existing canonical array, with unchanged record geometry and no new persisted field. Both frame pairs and stable panel rows delegate to one validated handler, also used by the existing selected-widget layer actions. Each pair computes its own boundary/pending/gesture state; focus falls back to the paired enabled action when a focused boundary button disables.
- Frame pairs are siblings of the existing move/resize buttons, not nested actionable content. Inline pairs appear only at fitted sizes of at least 150 × 80 screen pixels; smaller/covered/hidden widgets retain panel access. Geometry-handle eligibility remains separate from layer eligibility. Layer clicks neither capture a pointer nor initiate a gesture. Stable row/frame identities avoid focus/node churn during reorder.
- Tests migrate all 34 inherited layout scenarios without deleting or skipping their behavior. Six new browser cases cover unchanged-size geometry, raw dismissal, capture-preserving toggles, all-target layers, touch layer/toolbar input, and hidden/covered/zero-canvas access. Unit/static tests cover chrome-independent measurement/observation, explicit layer targeting and Automatic boundaries, unique form/ARIA controls, and retained Settings ownership. Active layout/testing documentation describes the new UI and unchanged transaction contracts.

## Regression Evidence

- Before the fix, `npx playwright test e2e/dashboard-layout.spec.js --browser=chromium -g 'unchanged Custom editing'` failed on edit entry: the default fixture canvas changed from 1248 × 600 to approximately 834.08 × 401 screen pixels. The clock changed from 404 × 294 to approximately 270.01 × 196.49, and its text height changed from 93 to approximately 62.16. This demonstrated actual live-content shrinking, not merely a frame-style discrepancy.
- After removing the chrome reservation, the expanded regression compares exact actual canvas transforms/reference dimensions, all six widget boxes, and clock text boxes across normal display, edit entry, details open, details closed, and Cancel. It covers desktop, mobile, narrow/wrapped tools, caption reservations, settled real fullscreen, and controlled safe insets. Equality uses exact values for these unchanged-context samples; existing projection tests retain their 0.1px tolerance. Real viewport/profile/reference transitions remain allowed to refit.
- The first dismissal regression exposed native change occurring before the Close click: `00181` became committed/reformatted as `181`. Deferring change alone was insufficient. Preventing Toggle/Close's pointer focus change, combined with panel-epoch guards, preserves valid/empty/invalid raw entries and the previous live width across dismissal and polling. Chromium and Firefox both verify this behavior.
- Firefox fullscreen can expose an actual visual viewport wider than Playwright's configured page viewport. The top-right assertion now checks actual visual viewport bounds instead of assuming the configured width remains fullscreen geometry. Native 320 × 240 and 160 × 150 cases assert all three compact buttons stay within bounds independently of panel scrolling.

## Ownership and Safety

- Panel toggles produce no projection calls in the isolated real-DOM owner fixture. Reference acquisition/release, prior inert restoration, captured complete payload/revision, idempotent disposal, cleared dynamic layer rows, rejected late saves, and inert-action protection remain covered. Disposed toggle events cannot reopen details.
- Pure layer tests target a nonselected widget while retaining session selection, complete canonical rectangles, the other profile, and revision. Boundary steps return Automatic unchanged; real steps materialize only the selected profile. Browser row tests exercise every widget in both profiles, inverse keyboard steps, inline controls with the panel closed, unchanged per-ID geometry, and explicit Save/restart persistence.
- Trusted touch taps exercise inline Up, panel Down, Toolbar/Close, reset, and a final no-op Save with zero PUTs and unchanged revision. Covered/hidden/zero-destination tests retain canonical layer access through the panel without enabling hidden content or changing confirmed preferences. Closed-panel direct move and canceled resize retain the original field-specific geometry semantics.
- A held move retains capture and scale while Toolbar is activated by keyboard and closed through UI dispatch; later pointer motion and completion preserve intended fields. Real resize/fullscreen/profile interruption tests remain intact. Ordinary activation thresholds, touch scrolling, composed-path exclusions, and consumed-release click protection were not redesigned.
- Existing real-server tests retain complete baseline/revision payloads, stale conflicts, offline explicit Reload, no-op/no-autosave counters, uncertain pending writes, polling-safe focused inputs/gestures, unrelated Settings saves, reference locking, tiny surfaces, and weather wrapping. The original stubbed Wake completes with details closed while its button/sensor nodes and read owners remain intact; stale connected/detached events cannot dispatch another action. Bookmark and explicit action behavior resume on exit.

## Verification

- Focused activation/session/model/reference/view tests: 71 passed, zero skipped/failed.
- `npm test -- --test-timeout=10000`: 432 passed, zero failed/skipped/canceled.
- `npx playwright test --browser=chromium`: 142 passed, zero skipped, including all 40 layout scenarios and the retained actual Firefox/Chromium exchange.
- Focused Firefox run with `PLAYWRIGHT_PORT=3213`, `--browser=firefox`, and the unchanged-size/dismissal/capture/layer/hidden-zero/short-window/activation/polling/reference/keyboard cases: 10 passed, zero skipped. Both real fullscreen geometry and controlled safe insets passed.
- `npm run check`: passed. All seven changed JavaScript files passed separate `node --check` invocations. Both manifests agree on `0.17.22`; no dependency entries changed. `git diff --check`: passed before final commit.

## Limits and Scope

Desktop Chromium trusted mouse, keyboard, and browser touch emulation plus focused actual Firefox runs establish the verified platform scope. Physical pen/touch hardware, mobile Safari/OS callouts, guaranteed BFCache admission, and physical device safe-area/keyboard behavior were not verified. Safe-inset tests use the existing CSS variables and actual browser layout; persisted-page tests deliberately exercise the lifecycle branch through dispatched events rather than claiming guaranteed navigation recovery.

The overlay deliberately covers some dashboard area instead of shrinking content. Close it to reach covered handles or use panel selectors/numeric/layer alternatives. Tiny frames preserve geometry rather than promising inline controls at every size. No persistence/schema, provider/synchronizer, activation, or legacy home-layout rewrite was performed. Tests use owned temporary SQLite/real servers, loopback popups, and stubbed providers/actions; no real Wake packet, provider account, NFS mount, user data/configuration edit, privileged installation, push, merge, release, image publication, or live-service operation occurred. `todo.md` and historical task records remain untouched.
