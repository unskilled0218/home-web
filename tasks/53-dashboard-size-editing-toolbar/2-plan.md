# Plan

## Table of Contents

- [Scope](#scope)
- [Current Boundaries](#current-boundaries)
- [Design Decisions](#design-decisions)
- [Implementation Plan](#implementation-plan)
- [Acceptance Criteria](#acceptance-criteria)
- [Risks and Limits](#risks-and-limits)

## Scope

Keep dashboard widgets at their normal fitted size during direct editing. Replace the expanded editing header with compact top-right Save, Toolbar, and Cancel controls plus an initially closed overlay panel. Add Up and Down controls for each widget without changing current move/resize gestures. Follow the revised `1-goal.md`; the Toolbar button is the route to detailed controls. This planning stage changes only this document and commits it; no implementation, version, dependency, or historical task changes occur here.

## Current Boundaries

- `public/dashboard-layout-view.js:measureLayoutSurface()` includes `#layout-toolbar` in its destination top-edge reservation, and its ResizeObserver watches that node. This is the direct cause of edit-mode shrinking. Accepted references and `fitLayoutCanvas()` are already independent of toolbar size and must remain so.
- `.dashboard-layout-editing .page-tools` currently uses `visibility: hidden`, retaining its normal layout footprint. Preserve that distinction: switching to `display: none`, changing the normal tools' wrapping, or adding controls to their flow can also shift the destination even after removing toolbar measurement.
- `public/dashboard-layout-editor.js` owns one session, local projection, raw numeric fields, capture ownership, inert restoration, and explicit save/disposal. It currently shows all controls on entry and focuses `#layout-widget`. Its button-disable loop treats every frame button as a geometry handle, so added layer buttons need separate eligibility rules.
- `public/dashboard-layout-session.js:layer(action)` currently targets `selected`. `public/dashboard-layout.js:changeWidgetLayer()` already supports forward/backward/front/back operations, returns the same profile at boundaries, and preserves geometry. Canonical array order supplies live/frame z-index; no persisted z-index field is needed.
- `public/dashboard.js` composes activation, reference/view, editor, and the sole settings synchronizer. Its edit-time Wake guard and Settings exclusivity already work. Neither panel visibility nor a layer action should configure providers, replace live widget nodes, reinitialize drafts, or introduce another writer.
- `e2e/dashboard-layout.spec.js` contains 34 scenarios and helpers that equate a visible `#layout-toolbar` with editing. Those assertions and entry focus expectations need explicit separation between active editing and an open details panel. Task 52 recorded 429 passing Node tests, 136 browser tests, and 10 focused Firefox cases; these are inherited counts, not verification performed during planning.

## Design Decisions

### Stable dashboard geometry, overlay-only chrome

- Continue calculating destination space from normal page tools, status, safe areas, viewport, and caption. Remove edit chrome from both measurement and view observation ownership. Do not freeze the destination at entry: actual resize, viewport offsets, captions/status, and fullscreen must still refit normally. Keep the existing reference lock, scale cap, bottom-left anchoring, and shared `view.frame()` projection.
- Keep ordinary tools' measured footprint unchanged while editing, even though their actions remain hidden/disabled. Position all new editing chrome independently outside normal flow, live widget roots, and the transformed stage. Opening/closing the panel must not change body/document scrollbars or page-tools dimensions.
- For an unchanged active Custom profile, entry and exit should preserve actual canvas, widget, and content measurements at the same viewport/reference. Automatic entry retains its existing deterministic template exception. Selecting another profile, changing canonical geometry, or accepting a queued reference on exit can legitimately change rendering; tests must distinguish those transitions from chrome-induced scaling.

### Compact controls and a nonmodal details panel

- Use one existing layout form/session, not two editors. A fixed top-right editing root contains Save, Toolbar, and Cancel, with Toolbar immediately next to Save. Keep the controls in safe areas and above all widget layers. A bounded scrolling details section opens below/adjacent to that root as an overlay; it never reserves canvas space.
- Reuse stable IDs where practical: `#layout-toolbar` can remain the editing root, with a new toggle and a separately identified hidden details section. Keep Save as the only layout submit action and make Toggle, Close, Up, and Down buttons explicitly `type="button"`. Preserve Enter-to-save from numeric fields and separate Settings form ownership.
- The details panel starts closed on every new edit session. Toggle and a named Close control show/hide it; Escape cancels an active gesture first, otherwise closes an open panel without ending editing. Do not add an outside-click dismissal handler that competes with direct manipulation. Keep the panel nonmodal so exposed frames remain usable, while real widgets remain inert.
- Focus the Toolbar button on edit entry, including long-press entry, rather than an invisible selector. Use `aria-expanded` and `aria-controls` on the toggle, an accessible panel name, and an intentional focus target on opening. Closing returns focus to Toolbar when focus was inside the panel; a pure visibility toggle must not steal an active handle's capture or rewrite raw fields. There is no focus trap over inert dashboard content.
- Show a compact editing/status indication independently of the closed panel. Saving, failure/conflict, offline/reload requirements, unavailable area, and inactive-profile state remain discoverable without reopening details. Status is overlay chrome too and cannot reserve canvas space. Detailed status can reuse the same message owner without duplicating live announcements.
- Hiding the panel is neither a commit nor Cancel. Keep its DOM, selection, scroll state where practical, and valid/invalid raw fields. Explicit Save or a real selection/mutation uses existing validation; invalid Save opens the panel before focusing/reporting the invalid field. Closing must not run a blur/change path that resets input, refocuses a now-hidden invalid field, or prevents dismissal. True pending writes keep existing mutation/exit protection, including disabling panel toggle/close until settled.

### Per-widget layer controls without gesture changes

- Add compact Up/Down pairs to each editing frame where there is sufficient screen space, as siblings of the existing move/resize buttons, never nested buttons or controls inside inert content. Keep the labeled move target and selected upper-right resize handle recognizable and available with the panel closed. Do not replace them with a new drag mechanism.
- Also provide six labeled widget rows with Up/Down pairs in the details panel. These are the reliable route for fully covered, hidden, or tiny widgets. Retain the current widget selector and selected-widget forward/backward/front/back controls to preserve existing capabilities; route all layer commands through one handler and the same session/model primitive.
- Extend the session operation narrowly to accept an explicit target ID, defaulting to the selected widget for existing callers. Up maps to `forward`, Down to `backward`. Validate any old selection's raw numeric changes before switching selection to the targeted widget; invalid values expose the panel and prevent the layer operation. Do not accidentally apply old raw values to a new target.
- Compute boundary states per associated widget, not globally from the current selection. Disable Up at index 5 and Down at index 0. Disable layer mutation during an active gesture or pending shared write. Give controls names such as `Move Time up one layer`, without changing the visible Up/Down labels. Disabled or no-op commands do not materialize an Automatic profile, issue a PUT, or change geometry.
- Scope pointer gesture entry to the original move/resize affordances. Layer buttons must not capture a pointer, initiate a drag, or fall through to underlying actions. Leave fixed-start conversion, pointer cancellation, Escape, activation-release protection, and canonical field edits intact. Pure panel visibility changes retain an active gesture and its fit; actual profile/widget changes cancel it through existing ownership.
- Keep frame/row identities stable while changing CSS z-index and rank labels. Do not rebuild/reparent actionable content or reorder focused panel rows merely to mirror stacking. Fit Up/Down controls inside available frame geometry without enlarging cards, extending hit targets over global controls, or covering the resize affordance. Hide inline pairs when they cannot fit; all six panel rows remain reachable without requiring an inline hit.

## Implementation Plan

### 1. Establish task ownership and geometry regressions

- During implementation, create a new branch named exactly `53-dashboard-size-editing-toolbar` from task-bearing HEAD; do not reuse a branch. Create `4-implemented.md` with a table of contents and preserve unrelated work.
- Extend `test/dashboard-layout-view.test.js` so a visible, resized, or hidden editing root/panel cannot affect `measureLayoutSurface()`, the frame fit, or view observation ownership. Retain assertions that normal tools, status, caption, safe insets, actual viewport changes, and zero surfaces still work.
- Add a browser regression that records an unchanged Custom canvas transform/reference/border box, all visible widget border boxes, and representative text/child measurements before entry, after entry, with details open, with details closed, and after Cancel. Assert matching values within existing CSS subpixel tolerances and zero PUTs. Cover desktop/mobile, fullscreen, caption, and wrapped normal page-tools cases rather than only controlled synthetic surfaces.
- Use that regression to demonstrate the current toolbar-induced shrink before removing the reservation; record actual failure evidence in the implementation report. Avoid unrelated measurement/refitting rewrites.

### 2. Split compact editing controls from details

- Restructure `public/index.html` around the single layout form. Move detailed profile/arrangement/widget/geometry/layer/reset/reload/fullscreen controls into the initially hidden panel. Keep top-right Save/Toolbar/Cancel and essential editing/status information outside that hidden section. Keep all eight Settings tabs and native preference form associations unchanged.
- Replace the full-width reserved toolbar styles in `public/dashboard.css` with safe-area-aware fixed top-right chrome and a bounded overlay panel. Keep compact actions reachable at 320 × 240 and 160 × 150 as well as ordinary sizes; allow panel-internal scrolling and text wrapping without moving the canvas or making Save/Cancel depend on panel scroll position. Account for visual viewport/keyboard bounds without feeding chrome dimensions back into fitting.
- Remove `layout-toolbar` from `measureLayoutSurface()` and the view's ResizeObserver list. Continue reserving only existing non-edit dashboard elements, retaining the normal page-tools footprint during editing. Do not change reference computation, normalized geometry, font/padding rules, or custom weather wrapping.
- Add explicit panel-open state and focused open/close helpers to the existing editor. Those helpers update visibility/ARIA/focus only; they must not call `session.load()`, `project()`, `cancelGesture()`, raw reset, or a preference write solely because chrome changed. Ensure measurement callbacks and `observe()` cannot reopen/close the panel or rewrite raw values.
- Adapt entry, submit validation, pending controls, status, exit, suspension, and disposal to the split chrome. A new session starts closed; success/Cancel/disposal hide both root and panel, restore inert/lock/focus ownership once, and clear only session-owned UI state. Failed saves retain the same draft/base and visible feedback. Persisted suspension retains panel state and completed drafts while existing interruption rules cancel a held gesture.

### 3. Add one per-widget layer command path

- Extend `public/dashboard-layout-session.js` with explicit-target layer support and add unit tests for targeting a nonselected widget, boundary identity, unchanged geometry/other profile, and Automatic no-op versus real reorder. Keep payload/revision/baseline ownership unchanged.
- Create frame Up/Down pairs and six details-panel rows from `DASHBOARD_WIDGETS`, with stable widget IDs and shared layer metadata. Avoid a generic registry or second layer model. Keep existing selected-widget layer actions and route all command variants through the same validated action function.
- Separate geometry-handle disabled/tiny-surface checks from layer-button checks. Render each pair's own rank/boundary/pending/gesture state. An unavailable/tiny canvas disables or hides unusable inline controls but does not remove access to canonical layer editing in the panel.
- Resolve the command's associated widget before rendering or changing selection. Validate the previous raw selection first; then apply one canonical reorder, select the target, update live/frame z-index and panel rank labels, and announce its result. Keep focus on a connected useful control when a boundary button becomes disabled, without moving or rebuilding live widget nodes.
- Retain pointerdown/move/up listeners and field-specific conversion on the existing move/resize buttons. Ensure Up/Down controls are excluded from manipulation entry and that one click/key/touch action causes one layer step, not a drag or double mutation.

### 4. Migrate and extend behavioral coverage

- Update `e2e/dashboard-layout.spec.js` helpers to distinguish entering edit mode from opening details. Do not auto-open the panel for tests intended to prove direct manipulation works while it is closed. Update old visible-toolbar and entry-focus assertions explicitly; preserve all 34 scenarios' behavioral claims and the real Firefox/Chromium exchange.
- Keep the 600ms/8px activation tests, composed-path exclusions, touch/native scrolling, release/click-through suppression, and normal dashboard action protections. Update the consumed-release Save fixture to target the new compact controls rather than obsolete nested header assumptions. Do not add a new activation gesture.
- Test toggle/Close/Escape with mouse, Tab/Enter/Space, and touch. Preserve valid, empty/invalid, and partially typed fields across close/reopen, successful/failed/unchanged polls, and conflict observations. Verify invalid Save reveals its field; mere panel toggles cause no validation mutation, baseline/revision change, or request.
- Test a held move/resize while toggling details through keyboard/programmatic UI activation: capture and fixed fit remain valid, deltas remain scale-correct, and completion/cancel invariants match existing behavior. Keep tests that actual resize/fullscreen/profile changes cancel stale capture. Verify the open panel only intercepts its own covered area and leaves exposed direct handles usable.
- For all six widgets and both profiles, test Up/Down in panel rows and usable inline pairs, one-step order, per-widget boundaries, nonselected target handling, keyboard/touch operation, and full canonical geometry equality before/after. Verify live and frame hit-tested order, hidden/covered access, inactive-profile isolation, Automatic no-op/custom transition, persistence after Save/restart, and Cancel restoring the latest confirmed order.
- Exercise partially/fully covered widgets, tiny inline targets, all-hidden content, true zero destination, safe insets, 600px crossings, native short/narrow windows, fullscreen/background-only tools, and overlay placement. Measure canvas and representative text, not only frame style declarations; assert top-right action coordinates and reachable panel/exit controls.
- Retain real-server SQLite fixtures, complete payload/captured-revision assertions, no-op/no-autosave counters, pending-write exit refusal, failure/conflict/explicit Reload, cached offline authority, late completion/disposal, reference lock/inert restoration, and unrelated Settings layout preservation. Keep the pending stubbed Wake completion, detached stale row dispatch guard, provider/timer identity counters, and bookmark navigation resumption with both panel states.
- Update static tests in `test/dashboard.test.js` for unique IDs, one layout form, explicit non-submit controls, toggle/panel ARIA linkage, and continued absence of a Settings layout editor. Add focused editor DOM tests for panel focus/raw-state ownership and dynamic layer handlers; use real-browser events where fake DOM cannot establish layout/focus/capture safety.

### 5. Document, verify, and commit implementation

- Update `docs/dashboard-layout.md`, `docs/dashboard.md`, and `docs/testing.md` for unchanged-size editing, compact top-right actions, the initially closed overlay, unchanged move/resize gestures, per-widget Up/Down semantics, covered/hidden/tiny alternatives, focus/dismissal, and existing save/recovery behavior. Remove instructions implying reserved toolbar space or an always-open details form; keep historical task reports unchanged.
- Run focused activation/session/model/reference/view tests and direct-editor DOM/browser cases. Run the complete `npm test -- --test-timeout=10000` and Chromium browser suite, then focused Firefox geometry/toggle/focus/layer/short-window cases. Retain actual cross-engine sharing coverage. Report missing browser/system prerequisites as blockers, not silent skips or privileged installation attempts.
- Run `npm run check`, individual syntax checks for every changed/new JavaScript file, manifest consistency checks, and `git diff --check`. Record before-fix shrink evidence, actual final test counts, equality tolerances, no-write/action counters, pending owner preservation, and browser/hardware limits in `4-implemented.md`.
- During implementation, bump the then-current patch version in both manifests, currently `0.17.21`, without changing dependencies. Commit only task-scoped implementation/tests/docs/version/results on the new branch. This planning commit contains only `2-plan.md`; no push, merge, release, image publication, or live-service operation is authorized.

## Acceptance Criteria

- Unchanged Custom canvas, widget, and content measurements match normal display across entry, open/closed details, and Cancel at a stable viewport/reference; no edit chrome contributes reserved space or unintended writes.
- Save, Toolbar, and Cancel remain top-right, above widget layers, accessible in fullscreen and short/narrow windows. Details start closed, overlay rather than resize the dashboard, and preserve focused/raw draft state through dismissal and reopening.
- Current primary-pointer move/upper-right resize behavior works with details closed. Only real geometry/context changes invalidate a gesture; toggling chrome alone neither changes fit nor cancels capture.
- Each widget has independent Up/Down access, including a panel route for covered/hidden/tiny widgets. Commands move exactly one layer, honor per-widget boundaries, preserve every canonical rectangle and the other profile, and persist only through successful explicit Save.
- Existing Automatic no-op semantics, selected/inactive profiles, reference locking, action blocking, pending completions, Settings exclusivity, complete revision saves, conflicts/offline recovery, and exact cleanup remain covered and unchanged.
- Focused/full Node and browser verification, individual syntax checks, manifest consistency, and diff checks pass with results recorded honestly. No historical scenario is removed merely because its old toolbar selectors no longer match.

## Risks and Limits

- Overlay chrome deliberately covers some content instead of shrinking it. Keep it bounded/dismissible, maintain the selector and all-widget layer rows, and preserve access to exposed handles. Do not move canonical widgets or enlarge their rectangles to make room for controls.
- Removing only the toolbar reservation is insufficient if the edit CSS changes normal page-tools flow or document scrollbars. Test actual before/after destination, canvas, and text measurements, including narrow wrapping and fullscreen variants.
- A hidden panel's focused numeric input can emit a native change/blur. Closing must preserve raw values and avoid invisible validation focus; Save/selection changes remain explicit validation boundaries. Stable panel/frame DOM also prevents focus loss during reorder.
- Inline layer buttons compete for limited space with move/resize affordances. Prioritize existing direct gestures and use the panel when safe normal-size controls cannot fit. One-pixel containment is not a promise of readable content or usable pointer targets.
- Fullscreen exit can legitimately apply queued references, and Automatic entry intentionally shows a template. Equality tests must hold reference/profile/layout context constant rather than masking those supported transitions with a frozen destination.
- Keep the existing synchronizer/provider boundaries and activation safety; this is a focused editing-chrome/layer-access change, not an interaction framework, persistence migration, or general synchronization refactor. No real Wake packet, live provider account, NFS mount, user data/configuration edit, dependency addition, `todo.md` change, or retained legacy-layout deletion is authorized. Desktop touch emulation does not establish physical pen/mobile Safari behavior.
