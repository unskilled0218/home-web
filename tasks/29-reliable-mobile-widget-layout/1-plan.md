# Task 29: Reliable Separate Mobile Widget Layout

## Objective

Ensure the home widget page always selects, edits, and reloads a dedicated mobile layout below the responsive breakpoint instead of presenting desktop geometry as a scrollable page, while preserving desktop and mobile arrangements independently.

## Request and Scope

- Source: `~/workdir/command.md`: provide a separate mobile layout because the current behavior appears to scroll the desktop layout, and save mobile and desktop layouts separately.
- Apply this work to the customizable home widget page at `/`. Do not change the separate photo dashboard at `/dashboard`.
- Treat Desktop and Mobile as two persistent logical layouts with independent widget membership, order, position, width, and height. Shared display preferences, integration credentials, and selected Home Assistant readings remain shared.
- Mobile may scroll vertically because its widgets are arranged in a four-column stacked canvas, but that scroll must contain mobile geometry, not an overflowing or scaled desktop 12-column canvas.
- Preserve the current 768px boundary unless browser verification demonstrates that the product requirement needs a different breakpoint. Widths below 768px select Mobile; widths at or above 768px select Desktop.
- Do not create a second settings record, duplicate integration configuration, or migrate to separate databases. The existing version-1 envelope already has `layouts.desktop` and `layouts.mobile`; fix and prove the browser selection/editing path rather than replacing the valid persistence model.

## Inspected Context

- The project is version `0.16.2` on `main` at `07e179b` before this planning change. The worktree is clean, and Task 29 is the next number after inspecting `tasks/`.
- `public/home-layout.js` already defines `layoutMode(width)`, 12 desktop columns, four mobile columns, independent defaults, and normalization of both `layouts.desktop` and `layouts.mobile`. Mobile defaults are generated as full-width stacked widgets rather than transformed desktop coordinates.
- `public/app.js` chooses the active layout from `window.innerWidth`, renders `state.settings.layouts[mode]`, and writes edits back to `next.layouts[mode]`. A resize listener mutates the module-level `mode`, cancels gestures, and rerenders, but this browser composition path is embedded in the entry module and has no focused automated coverage.
- `public/styles.css` applies the finite viewport-filling 12-row canvas only at `min-width: 768px`; the base grid uses fixed 64px implicit rows and ordinary page scrolling for mobile. The editor supplies `--columns`, but markup does not expose the active logical mode for assertions or mode-scoped styling.
- `public/home-settings.js` keeps one canonical settings envelope and one draft. A save writes both layout arrays atomically through the revision-checked API, which preserves unchanged geometry but means correctness depends on every edit targeting only the active array.
- `test/home-layout.test.js` proves pure-model independence and breakpoint values. `test/home-settings.test.js` and `test/home-settings-api.test.js` prove both arrays round-trip and that changing one can preserve the other. They do not prove that the browser displays the mobile array below 768px or that resize/edit callbacks continue to target the correct array.
- `test/home-widgets.test.js` proves an editor mode change cancels pointer capture, but its fixture normally edits desktop and does not exercise application-level viewport routing. There is no home entry-point or responsive coordinator test.
- `README.md` already promises independent layouts, a 768px breakpoint, mobile four-column geometry, and separate behavior. The reported behavior conflicts with those promises, so implementation verification must prioritize a reproducible browser/composition test rather than assuming the pure model is sufficient.

## Behavioral Decisions

### Active Layout Selection

- Define the responsive query in one exported location and use `matchMedia('(max-width: 767px)')` or an equivalent injectable media-query owner as the authoritative browser mode source. Keep its boundary exactly aligned with CSS.
- Initialize the active mode before the first visible grid render so a mobile viewport never briefly paints desktop geometry.
- On a real breakpoint transition, cancel any active move/resize gesture, switch to the corresponding saved/draft layout, update layout labels/catalog/geometry controls, and render without persisting or deriving geometry.
- Ignore resize events that do not cross the breakpoint. Pixel-size changes within one mode may cancel an active gesture when required for safe metrics, but must not rewrite either layout or restart data owners solely because dimensions changed.
- Expose the active mode on the home shell/grid through a stable `data-layout-mode="desktop|mobile"` attribute. Use it for test assertions and mode-specific CSS where needed; do not infer logical mode independently in multiple modules.

### Independent Editing and Saving

- Every add, remove, pointer move, keyboard move, resize, and numeric geometry submission must capture or receive the intended layout mode and mutate only that mode's array. Avoid asynchronous callbacks reading a later mutable global mode after a breakpoint transition.
- Entering edit mode on mobile edits the mobile draft; entering on desktop edits the desktop draft. Crossing the breakpoint while a draft exists switches the visible editor to the other draft array without copying positions or membership between arrays.
- Keep one revision-checked settings envelope and atomic PUT because shared preferences and both arrays form one server configuration. "Saved separately" means each mode retains independent values and an edit to one leaves the other byte-for-byte equivalent after normalization, not that the application needs two endpoints or independent conflict domains.
- Save commits the current draft envelope, including the unchanged other layout. Cancel restores both layouts to the last acknowledged envelope. A failed/conflicting save retains the draft and must not regenerate mobile from desktop.
- Continue allowing different widget membership, including an empty layout, in each mode. Removing a widget from mobile must not hide it on desktop or disconnect its integration.

### Mobile Presentation

- Render mobile from the four-column mobile geometry with ordinary vertical document scrolling and no desktop finite-row constraint. Ensure saved `x`, `y`, `w`, and `h` map to mobile tracks and do not retain a 12-column width or desktop-only offscreen placement.
- Keep touch scrolling enabled outside dedicated move/resize handles, internal scrolling for long widget content, safe-area padding, and the edit-only toolbar actions introduced in Task 28.
- Scope desktop viewport locking and 12-row rules to the explicit desktop mode as well as the media boundary so stale classes or JavaScript/CSS disagreement cannot make a mobile layout behave like the desktop canvas.
- Keep Settings reachable at 320px, keep Save/Cancel wrapping without horizontal overflow, and preserve labeled move/remove/resize controls and visible edit outlines.

## Implementation Steps

1. Create `tasks/29-reliable-mobile-widget-layout/3-implemented.md` before implementation edits and maintain it with the reproduced cause, actual changes, verification, and departures.
2. Extract the viewport-to-layout decision and breakpoint subscription from `public/app.js` into a small injectable function or module that owns the single media query, reports `desktop`/`mobile`, and cleans up its listener on disposal.
3. Refactor `public/app.js` so initial rendering, breakpoint changes, catalog/geometry rendering, and every layout mutation use an explicit active-mode value. Capture mode for asynchronous operations and cancel gestures before changing the editor's mode.
4. Add the active mode as a data attribute/class on the shell or grid and update `public/styles.css` so four-column mobile scrolling and finite 12-column desktop viewport behavior are explicitly separated while retaining the 768px CSS fallback.
5. Keep `public/home-layout.js` and the version-1 settings envelope unless implementation reveals a concrete normalization defect. If one is found, make the smallest idempotent repair that preserves existing desktop and mobile arrays independently; do not reset valid saved mobile data.
6. Add composition-level tests with intentionally incompatible layouts, such as a desktop-only widget and a mobile-only widget at distinct geometry. Prove initial mobile selection, initial desktop selection, both breakpoint directions, gesture cancellation, correct catalog/geometry mode, and no writes during responsive switching.
7. Add edit/save regressions proving mobile add/remove/move/resize leaves desktop unchanged, desktop edits leave mobile unchanged, save/reload returns each layout at its matching viewport, cancel restores both, and a failed/conflicting save retains both drafts without cross-copying.
8. Update static/CSS coverage to assert the mode marker, four mobile columns, vertical mobile flow, desktop-only viewport lock, no horizontal overflow at narrow widths, and unchanged `/dashboard` assets/styles.
9. Update `README.md` only where needed to clarify that mobile's vertical scroll contains its separately saved four-column layout and that crossing 768px selects the other saved arrangement. Bump `package.json` from `0.16.2` to `0.16.3` for the focused responsive-layout correction.
10. Run focused and full verification, document browser availability and observed behavior accurately, and commit the Task 29 implementation on its exact task branch.

## Verification Plan

- Extend `test/home-layout.test.js` for boundary values and strongly distinct desktop/mobile fixtures, including different membership and geometry, normalization idempotence, and edits that leave the inactive layout deeply equal.
- Add a focused responsive coordinator/app-composition test using injected media-query, editor, and settings surfaces. Verify the initial mode is selected before first paint; transitions at 767/768 choose the corresponding array; repeated same-mode width changes do not rerender/persist unnecessarily; and disposal removes listeners.
- Extend `test/home-widgets.test.js` where needed to prove a mode transition cancels an active pointer preview and renders four-column mobile geometry without carrying desktop styles or committing the preview.
- Extend `test/home-settings.test.js` and `test/home-settings-api.test.js` only as needed for save/reload evidence with distinct arrays, unchanged inactive-layout geometry, empty membership in one mode, conflict retention, and restart persistence. Do not duplicate cases already proving atomic revision checks.
- Update `test/dashboard.test.js` served markup/style assertions for the active-mode marker and explicit mobile/desktop CSS separation while retaining all `/dashboard` route and forecast assertions.
- Run `node --test test/home-layout.test.js test/home-widgets.test.js test/home-settings.test.js test/home-settings-api.test.js test/dashboard.test.js` plus the new responsive composition test, then run `npm test`, `npm run check`, and `git diff --check`.
- If a browser runtime is available, reproduce the reported behavior before the fix and record the exact viewport/device conditions. If unavailable, state that limitation and do not claim the original symptom was visually reproduced.
- In a browser at 320px and 390px widths, verify the grid is four columns, only mobile membership/geometry appears, vertical scrolling reaches all mobile widgets, no 12-column canvas creates horizontal overflow, Settings remains reachable, and touch scrolling works outside handles.
- At 767px and 768px, verify the active mode marker, layout label, widget membership, geometry, and edit controls switch once and match CSS. Resize repeatedly across the boundary with and without a draft and during an active drag.
- Save a visibly different mobile arrangement, reload on mobile, and confirm it persists; load desktop and confirm its prior arrangement is unchanged. Repeat in the opposite direction, then exercise Cancel, failed save, conflict, empty mobile, and empty desktop cases.

## Acceptance Criteria

- Viewports below 768px render only `layouts.mobile` on a four-column vertically scrollable canvas; they never display desktop 12-column geometry merely made scrollable.
- Viewports at or above 768px render only `layouts.desktop` on the bounded desktop canvas.
- Mobile and desktop can have different membership, order, positions, widths, and heights. Saving edits in either mode preserves the other layout unchanged and both survive reload/server restart.
- Breakpoint transitions cancel active gestures, perform no settings write or geometry derivation, and switch all layout-aware UI to the corresponding saved/draft array.
- Mobile has no horizontal page overflow from desktop geometry, and Settings, Save/Cancel, content scrolling, touch scrolling, keyboard controls, focus, and integration behavior remain usable.
- The existing settings revision protocol, shared preferences, selected Home Assistant readings, integration credentials, fullscreen behavior, and `/dashboard` remain unchanged.
- Documentation, version `0.16.3`, implementation record, automated results, and browser-verification claims accurately describe the delivered behavior.

## Planning Verification

- Read the shared conventions and current request, inspected task numbering and Git state, and traced the layout model/defaults, browser mode routing, editor callbacks, responsive CSS, draft controller, API persistence tests, widget tests, prior dual-layout design, and current documentation.
- Confirmed the existing schema already stores separate layouts; this new plan does not reuse Task 26 and instead addresses the untested browser-level symptom reported after Tasks 27 and 28.
- This planning change adds only `tasks/29-reliable-mobile-widget-layout/1-plan.md`; implementation code is unchanged.
