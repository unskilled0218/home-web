# Task 31: Pixel-Precise Widget Geometry

## Objective

Allow widget resizing at one-CSS-pixel granularity and keep the entire canvas, including its top edge, reachable while the edit-mode Save and Cancel buttons are visible.

## Request and Scope

- Source: `~/workdir/command.md`: make widget size changes pixel-level, and fix the inability to move a widget upward when the Save button is present.
- Apply this work only to the customizable home widget page at `/`; do not change the independent photo dashboard at `/dashboard`.
- Interpret "pixel level" as free pointer resizing without snapping to the current 12-column/12-row or four-column/64px-row tracks. A one-pixel pointer delta must produce a one-pixel preview delta at the current canvas size, subject to minimum size, canvas bounds, and collision rules.
- Preserve separate desktop and mobile layouts, shared server persistence, draft Save/Cancel behavior, collision prevention, accessible keyboard controls, fullscreen, and integration lifecycle behavior.
- Treat the Save-button symptom as a canvas geometry defect: showing edit actions must not reduce or offset the layout's usable rectangle, and a widget must be movable to the canvas top boundary while Save/Cancel are visible.

## Inspected Context

- Task 31 is the next number after inspecting `<project>/tasks/`; this is a new plan and does not reuse Tasks 26-29.
- The worktree already contains uncommitted bookmark implementation changes in `public/app-helpers.js`, `public/home-integrations.js`, `public/index.html`, `public/styles.css`, `test/app-helpers.test.js`, and `test/home-widgets.test.js`. This planning task must not alter or include those changes in its commit.
- `public/home-layout.js` stores each widget as integer `x`, `y`, `w`, and `h` grid cells. Desktop is bounded to 12 columns by 12 rows; mobile uses four columns and fixed 64px rows. `changeWidget()` clamps and relocates rectangles in those logical cells.
- `public/home-widgets.js` measures one whole grid track plus its gap, rounds pointer displacement to that step, and writes CSS `grid-column`/`grid-row`. Resizing therefore jumps by roughly a column or row rather than following individual pointer pixels. Arrow keys also change one whole cell.
- `public/app.js` exposes the same cell-based values in Settings as Column, Row, Width, and Height. `normalizeHomeSettings()` accepts only safe integers, and client/server/API tests depend on that envelope.
- `public/styles.css` keeps `.home-toolbar` in normal flex layout above `.home-grid`. On desktop the shell is exactly one viewport high and the grid receives only the remaining flex height, so toolbar wrapping or edit-only controls can alter the measured row height and shift/shrink the available canvas while editing.
- `public/home-shell.js` correctly shares toolbar/dialog Save and Cancel operations and returns focus to Settings. The obstruction should be fixed in layout/CSS and editor measurement rather than by duplicating or moving persistence logic.
- `test/home-layout.test.js` covers bounded non-overlap, relocation, independent modes, legacy fitting, and impossible edits. `test/home-widgets.test.js` drives actual pointer/keyboard handlers with injected geometry but assumes grid-sized steps. `test/home-shell.test.js` covers Save/Cancel behavior but not canvas dimensions while those buttons appear.
- The current package version is `0.17.0`. README still documents grid-snapped edits and numeric grid-cell geometry, so implementation must update those statements if the storage and controls change.

## Geometry Design

- Replace cell-only persisted geometry with a version-2 canvas-space representation that can preserve free-form rectangles across reloads and different viewport sizes. Store each mode's reference canvas dimensions together with integer CSS-pixel widget rectangles; do not persist transient DOM coordinates, transforms, floating-point drift, or browser-specific device pixels.
- Render a saved rectangle by scaling it from its reference canvas to the current canvas, then clamp/fit it without writing settings merely because the viewport changed. When the user edits, materialize the current rendered rectangle in the current canvas coordinate space so pointer movement and resizing remain exactly one CSS pixel per pointer pixel.
- Keep all rectangle values finite bounded safe integers, define explicit minimum pixel width/height per widget and mode, and cap reference dimensions and coordinates to prevent malformed settings from causing oversized CSS or expensive placement work.
- Version the settings envelope rather than silently changing the meaning of version-1 `x`, `y`, `w`, and `h`. Normalize version 1 by deterministically projecting desktop 12x12 and mobile four-column/64px-row geometry into documented canonical reference canvases, preserving membership, spatial order, and non-overlap. Normalization must be idempotent and reads must not rewrite SQLite or increment the revision; the next successful explicit save persists version 2.
- Use one rectangle model for painting, overlap checks, dragging, resizing, numeric Settings edits, defaults, migration, and server validation. Avoid retaining a second CSS-grid placement algorithm that could disagree with pixel geometry.
- Replace exhaustive cell scanning with a bounded deterministic rectangle-placement strategy. Candidate blocker positions should come from canvas edges and neighboring rectangle edges, be ordered by distance and stable spatial order, and reject an operation without mutating the prior layout when no legal placement exists.
- Preserve mobile vertical scrolling. Mobile uses a bounded horizontal canvas and a persisted reference width, while its vertical pixel coordinates/heights remain in document-space pixels; collision relocation may extend the mobile canvas downward within an explicit maximum. Desktop remains bounded in both dimensions to the visible canvas.
- Pointer resize previews use raw `clientX/clientY` deltas from the gesture start and enforce minimum dimensions, bounds, and collisions through the same model. Keyboard arrows change the focused move/resize edge by one CSS pixel; optionally support an explicit larger modifier step only if documented and tested.

## Toolbar and Canvas Design

- Remove `.home-toolbar` from desktop canvas sizing flow by positioning it as an overlay anchored to the shell safe-area corner. The grid's measured content box must remain identical before editing, during editing with Save/Cancel visible, while saving, and after editing.
- Keep Settings, Save, and Cancel visible, focusable, and above widget content. Restrict pointer interception to the actual controls rather than a full-width invisible overlay.
- Permit geometry to reach `x = 0` and `y = 0` even when the toolbar is present. If a top-right widget can visually pass beneath the controls, retain keyboard access and provide a predictable way to finish/cancel editing; do not reserve hidden grid rows that recreate the reported obstruction.
- On narrow mobile widths, keep the toolbar compact and wrapping within the viewport without horizontal overflow. Its overlay must not change the mobile layout's stored origin or scroll height.
- Continue canceling active gestures on actual canvas resizes/fullscreen transitions. Toggling Save/Cancel visibility alone must no longer trigger ResizeObserver cancellation because it must not resize the canvas.

## Implementation Steps

1. Create `tasks/31-pixel-widget-geometry/3-implemented.md` before implementation edits and record the reproduced behavior, migration details, actual changes, tests, and browser limitations.
2. Refactor `public/home-layout.js` around bounded pixel rectangles and mode-specific canvas metadata. Add deterministic scaling, clamping, overlap, blocker relocation, add/change operations, minimum sizes, mobile vertical bounds, version-1 migration, and version-2 normalization while preserving independent desktop/mobile arrays.
3. Update `public/home-widgets.js` to measure the canvas rectangle, paint widgets with absolute pixel geometry, preview raw pointer deltas without track rounding, commit through the shared rectangle model, and make keyboard move/resize use one-pixel increments. Preserve pointer capture, cancellation, stable DOM order during previews, focus restoration, and owner lifecycles.
4. Update `public/styles.css` to replace home-grid track placement with a positioned canvas suitable for pixel rectangles, retain desktop viewport bounds and mobile vertical flow, and overlay the home toolbar without changing the canvas content box when Save/Cancel appear.
5. Update `public/app.js` Settings geometry controls and labels to edit pixel Left, Top, Width, and Height values against the active canvas. Ensure each operation captures the intended desktop/mobile mode and current reference canvas, and preserve no-space announcements and drafts.
6. Keep `public/home-shell.js` Save/Cancel persistence and focus behavior unless a small integration seam is required to expose toolbar visibility for geometry tests. Do not create a second save path or persist during preview.
7. Update server-shared normalization/API handling through the existing `src/home-settings.js` export boundary and database flow. Ensure GET can present migrated version-1 data without an implicit write and PUT still enforces revision conflicts and request limits.
8. Update README for pixel-precise pointer/keyboard/numeric geometry, responsive scaling/reference-canvas behavior, version-1 migration, mobile vertical scrolling, collision handling, and the non-resizing edit toolbar. Bump `package.json` from `0.17.0` to `0.17.1` for this focused layout change.
9. Run focused, full, and browser verification, update the implementation record factually, and commit only intended Task 31 implementation files on the task branch.

## Verification Plan

- Extend `test/home-layout.test.js` with one-pixel resize/move cases, minimum/boundary clamps, arbitrary rectangle overlap, deterministic blocker relocation, no-space immutability, mobile downward growth, reference-canvas scaling, version-1 migration, version-2 validation, and normalization idempotence.
- Extend `test/home-widgets.test.js` so a 1px pointer delta changes preview and committed size by 1px, sub-cell deltas are not rounded away, keyboard arrows change one pixel, pointer cancellation restores exact prior geometry, and viewport/mode changes cancel without committing.
- Add regression coverage where the canvas returns exactly the same bounding rectangle with toolbar Save/Cancel hidden and visible, then move a widget upward to `y = 0` and commit while Save is present. Verify pointer capture remains active when crossing the toolbar region.
- Update `test/home-settings.test.js` and `test/home-settings-api.test.js` for version-2 round trips, independent mode preservation, revision conflicts, failed-save draft retention, legacy GET-without-write behavior, explicit migration save, and malformed/oversized pixel geometry rejection.
- Update `test/dashboard.test.js` static/CSS assertions for positioned pixel widgets and the out-of-flow toolbar while proving `/dashboard` markup, scripts, and styling remain unchanged.
- Run `node --test test/home-layout.test.js test/home-widgets.test.js test/home-shell.test.js test/home-settings.test.js test/home-settings-api.test.js test/dashboard.test.js`, then `npm test`, `npm run check`, and `git diff --check`.
- In an available browser, record canvas and widget `getBoundingClientRect()` values before editing, after Save/Cancel appear, during saving, and after cancel. The canvas origin/size must not change solely because toolbar controls become visible.
- Verify desktop pointer resizing with 1px, 2px, and diagonal deltas; keyboard resize/move by one pixel; collisions; minimum sizes; all four canvas edges; Save/reload; Cancel; failed save; conflict; fullscreen; and viewport scaling.
- Verify 320px and 390px mobile widths for free pixel sizing, vertical scrolling, no horizontal overflow, top-edge placement with edit actions visible, touch scrolling outside handles, and independent desktop geometry.
- If no browser executable is available, report that limitation and do not claim visual or native pointer reproduction from injected tests alone.

## Acceptance Criteria

- Dragging a resize handle by one CSS pixel changes the widget preview and committed size by one CSS pixel unless a documented minimum, canvas edge, or collision blocks it; resizing no longer snaps to whole grid tracks.
- Arrow keys on move and resize controls apply one-pixel geometry changes and retain visible focus and accurate accessible announcements.
- Pixel geometry persists through Save/reload, scales deterministically when the same layout is rendered on a different canvas size, and remains independent between desktop and mobile.
- Existing version-1 layouts migrate deterministically without losing widgets, overlapping rectangles, rewriting storage on read, or changing revision until an explicit successful save.
- Showing or hiding toolbar Save/Cancel does not change the canvas bounding rectangle, stored origin, widget dimensions, or active gesture. A widget can be moved to the top boundary while Save is visible.
- Toolbar controls remain visible, focusable, non-overflowing, and operational; Save/Cancel semantics, conflict handling, fullscreen, integrations, internal widget scrolling, and `/dashboard` remain intact.
- Automated results, browser-verification claims, documentation, version `0.17.1`, and the implementation record accurately describe the delivered behavior.

## Planning Verification

- Read the shared conventions and current command, inspected task numbering, Git status/history, prior widget-layout plans and implementation records, layout model, editor gesture math, app composition, shell actions, responsive/fullscreen CSS, settings/API persistence, README, and focused tests.
- Confirmed the current whole-cell rounding originates in `gridMetrics()` and `Math.round()` in `public/home-widgets.js`, while the Save-button obstruction risk originates in the toolbar participating in the finite viewport shell's flex layout.
- This planning change adds only `tasks/31-pixel-widget-geometry/1-plan.md`; it does not modify implementation code or include the pre-existing bookmark worktree changes.
