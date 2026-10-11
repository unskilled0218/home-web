# Task 27: Fullscreen Widget Layout and Minimal Home Controls

## Objective

Make the home widget dashboard fill the available screen, prevent desktop widgets from extending the page into a scrollable canvas, fix upward movement around other widgets, make widget backgrounds transparent, and leave only widgets and the Settings button on the home page.

## Request and Scope

- Source: `~/workdir/command.md`: use fullscreen, prevent widgets making the desktop layout scroll, investigate inability to move a widget upward when another widget occupies the same row, use transparent widget backgrounds, move Edit widgets into Settings, and remove the Home title, desktop/mobile label, settings-load status, and Photo dashboard link from the page.
- Interpret fullscreen as a viewport-filling home canvas by default, with an explicit Enter/Exit fullscreen action inside Settings for browser fullscreen. Browser fullscreen requires a user gesture; do not request it automatically on page load or synchronize fullscreen state between devices.
- Interpret the desktop scrolling requirement as preventing document/canvas scrolling caused by widget geometry. Long widget contents and Settings dialogs must remain internally scrollable so bookmarks, events, devices, and controls remain reachable. Preserve ordinary vertical mobile-page scrolling.
- Apply the minimal page controls in both desktop and mobile modes. Widget content and widget-local actions remain available; move/resize/remove handles may appear while editing. Put page-level edit/save/cancel/fullscreen/status/retry/empty-state controls inside Settings.
- Preserve Task 26's server-shared preferences, independent desktop/mobile layouts, revision conflicts, selected Home Assistant identities, integration workflows, and automatic calendar lifecycle.
- Keep the `/dashboard` and `/dashboard/` photo routes working; remove their navigation link from the home page as requested.

## Inspected Context

- The current project is version `0.16.0`, on branch `26-customizable-home-widgets`, with clean working tree at `0246462` before this planning change. Task 26 is implemented; this request is a new task, numbered 27 after inspecting `tasks/`.
- `public/index.html` renders `.home-toolbar` with Home, the photo link, Settings, Edit widgets, Save layouts, and Cancel. It also renders `#home-layout-label`, `#home-status`, `#home-retry`, and `#home-empty` outside the settings dialog.
- `public/app.js` assumes all those elements exist in render/event/focus paths. Settings is currently disabled until settings load successfully, and its open handler assumes `current.settings` exists. Removing the external retry/error controls therefore requires a usable Settings dialog even after initial load failure.
- `public/styles.css` limits `.shell` to 1100px with large padding and makes `.home-grid` grow through fixed 64px implicit rows and 16px gaps. Widget backgrounds are `#102a43`; collection trees and nested bookmark/device cards have additional opaque backgrounds. `.widget-content` already scrolls internally.
- `public/home-layout.js` permits rows through 144 and heights through 24, with downward-only collision displacement. The default desktop arrangement extends beyond a single viewport. `changeWidget()` already prioritizes the edited widget, and `overlaps()` checks both axes: another widget sharing a row is not inherently a collision.
- `public/home-widgets.js` assumes a fixed 80px vertical gesture step. Its `paint()` reorders widget DOM on every pointer preview using `insertBefore()`, while `lostpointercapture` cancels the gesture. Reparenting the capture-owning widget during an upward preview is a plausible cause of the reported movement failure, not yet a browser-confirmed diagnosis.
- The existing editor test element does not simulate capture loss caused by DOM moves, so the current tests can miss this failure. Existing tests cover movement of a single widget and controller ownership but need multi-widget upward movement and viewport-boundary cases.
- The layout module is shared with server normalization through `src/home-settings.js`, and SQLite loading/saving in `src/db.js` uses it. Desktop bounds and legacy fitting must be consistent on both sides; CSS-only clipping is insufficient.

## Behavioral Decisions

### Minimal home page and Settings

- Render only the widget canvas and a consistently reachable Settings button in normal mode. Reserve a small safe-area-aware control strip for Settings so it never covers widget controls; use the rest of the viewport for the desktop canvas.
- Remove the visible Home heading and photo navigation from home markup. Keep an accessible main-region label or visually hidden heading if needed, without visible page-title space.
- Move Edit widgets, the active desktop/mobile layout indication, settings load/save/conflict messages, retry, and empty-layout guidance into Settings. Consolidate the existing duplicate page/dialog Save and Cancel controls into one Settings-owned pair.
- Edit widgets begins the layout draft and closes Settings so the canvas can be manipulated. The Settings button remains visible while editing and can indicate unsaved changes accessibly. Reopening Settings offers Save shared changes and Cancel / reload; closing Settings alone keeps the draft.
- Removing a focused widget transfers focus to Settings, not to the removed page-level Save button. Successful save returns focus to Settings after closing the dialog. Escape outside a dialog cancels the draft as before; Escape that closes browser fullscreen must not also discard a draft.
- Keep one visually hidden live region outside the modal for move/resize announcements and concise load/save/error updates. Put visible details only in Settings; do not announce unchanged successful synchronization text every 30 seconds.
- Settings must open before initial load completes and after load failure. Display loading/error/retry inside it, disable only actions that require a loaded configuration, and guard preference/catalog/geometry/selection rendering against missing state. An empty layout leaves Settings as the sole visible page control.

### Desktop viewport and finite grid

- Use a home-specific full-width shell, `100dvh` with a `100vh` fallback, border-box sizing, and safe-area padding. Remove the home shell's 1100px cap and desktop document scrolling. Keep dialogs in the browser top layer with bounded height and internal scrolling.
- Define the desktop canvas as 12 columns by 12 logical rows. Derive rendered row height from the available canvas height and row gaps; reduce gaps/padding for short viewports so track sizes stay nonnegative. Do not simply hide overflow on the current unbounded grid and strand widgets below the viewport.
- Enforce desktop `0 <= x`, `x + w <= 12`, `0 <= y`, and `y + h <= 12`. Preserve per-type minimum spans, with minimum height three logical rows. Use the same geometry rules for pointer, keyboard, numeric Settings edits, additions, and server normalization.
- Provide a six-widget desktop default that fits: time at `(0,0,4,3)`, weather at `(4,0,8,6)`, calendar at `(0,3,4,6)`, bookmarks at `(4,6,4,6)`, Home Assistant at `(8,6,4,6)`, and Wake-on-LAN at `(0,9,4,3)`, expressed as `(x,y,w,h)`.
- Preserve existing desktop layouts unchanged when they already satisfy the finite bounds. For legacy overflow, deterministically clamp sizes/positions and attempt bounded row-major placement in saved spatial order; if the preserved sizes cannot fit, compact the affected desktop layout using per-type minimum sizes and stable order. Never drop a widget or alter shared widget settings/mobile membership to fit desktop.
- Keep the version-1 settings envelope and existing revision protocol. Make legacy fitting idempotent through the shared normalizer, without a background database write or revision change on GET. The next explicit save persists the canonical fitted layout. Document the desktop fitting behavior for existing Task 26 users.
- During normal editing, preserve the user's chosen sizes. Pin the edited widget to its clamped target, keep noncolliding widgets in place where possible, and relocate blockers to free in-bounds cells using deterministic nearest-slot ordering. If a requested move/resize/add cannot be placed with current sizes, retain the previous valid layout and explain the limitation through the live region/Settings; do not silently shrink unrelated widgets during a gesture.
- Mobile retains its independent four-column, vertically scrollable layout and existing logical row-height behavior. Desktop fitting, fullscreen changes, and resizing must never rewrite mobile geometry or save viewport-specific pixel dimensions to the server.
- Widgets keep bounded, scrollable content bodies. On short windows/zoomed displays, ensure headers/edit handles cannot expand the grid tracks; compact widget chrome or include oversized content in the internal scroll container. Keep Settings, modal close/save/retry, and keyboard focus reachable.

### Reliable movement and fullscreen lifecycle

- Add a regression reproducing an upward move past another widget, including two widgets with the same starting/target row but disjoint column ranges. Verify placement with pointer and keyboard input before choosing the final fix.
- Keep DOM order stable throughout an active pointer gesture: previews change only grid styles, not node parent/order. On pointerup, release capture, commit the valid model, then reconcile DOM reading order and focus. Pointercancel/lost capture/Escape restores the exact pre-gesture layout, including displaced widgets.
- Replace the hardcoded vertical `/ 80` step and horizontal `+ 16` assumptions with measured grid track/gap dimensions captured at gesture start. Use the actual desktop row height and mobile row height. Ensure preview geometry and the final saved geometry use the same metrics.
- Cancel an active gesture before viewport/container resizing, breakpoint changes, fullscreen entry/exit, page suspension, or teardown. Recompute pixel metrics for future gestures; geometry-only viewport changes must not reset controller owners or issue settings writes.
- Add Enter fullscreen / Exit fullscreen in Settings, backed by `document.documentElement.requestFullscreen()` and `document.exitFullscreen()`. Update labels from `fullscreenchange`, show an unavailable state where unsupported, and keep permission/rejection messages in Settings.
- Use the browser's actual fullscreen state rather than a saved preference. If fullscreen exit uses Escape, protect unsaved layout drafts; use explicit Cancel / reload to discard them when fullscreen exits.

### Transparent widget appearance

- Set home widget surfaces to transparent and remove opaque nested collection-tree/bookmark/device-card fills within the widget canvas so solid inner panels do not defeat the requested appearance.
- Retain readable text, subtle grouping boundaries where useful, visible keyboard focus, selected/control states, and edit outlines. Keep dialog/input/button surfaces readable; transparency applies to widget surfaces, not every UI element.
- Scope these rules to the home canvas. Do not modify the separate photo dashboard's layout, forecast width choices, background slideshow, or fullscreen control behavior.

## Implementation Steps

1. Create `tasks/27-fullscreen-widget-layout/3-implemented.md` before implementation edits, then maintain it with actual results and departures.
2. Update `public/home-layout.js` with desktop row bounds, compact defaults, idempotent legacy fitting, and bounded edit collision behavior. Keep mobile behavior separate; expose a consistent failure result for impossible operations rather than manufacturing out-of-bounds geometry.
3. Update `public/home-widgets.js` to use measured tracks/gaps, defer DOM reordering until gestures finish, preserve focus/capture correctly, and integrate placement-failure announcements. Maintain stable data owners.
4. Update `public/index.html` and `public/app.js` to remove the visible toolbar/title/link/status content, relocate editing/fullscreen/retry/status into Settings, consolidate Save/Cancel, handle unloaded/error states, and update every removed-ID/focus/event reference.
5. Update `public/styles.css` for the full-width desktop viewport canvas, explicit finite tracks, short-viewport constraints, transparent widget surfaces, reachable Settings, and bounded dialogs. Preserve mobile page scrolling.
6. Wire viewport/fullscreen/container changes into gesture cancellation and metric recomputation. Keep fullscreen local to the browser and keep resize/fullscreen changes out of settings persistence.
7. Update `README.md` for Settings-owned editing, fullscreen, desktop no-page-scroll behavior, internally scrollable content, desktop legacy fitting, transparent widgets, and the separate mobile layout. Bump `package.json` from `0.16.0` to `0.16.1` for the focused layout/usability correction.
8. Complete verification, record browser availability and observed movement reproduction accurately, and commit the Task 27 implementation on its task branch.

## Verification Plan

- Extend `test/home-layout.test.js` for desktop default bounds, legacy overflow fitting, idempotence, empty layouts, all six widget identities surviving fitting, desktop/mobile independence, same-row nonoverlap, upward collisions, bounds on displacement, and impossible edits leaving the prior layout intact.
- Extend `test/home-settings-api.test.js` for old Task 26 geometry loading into a valid desktop canvas without mutating the database/revision on GET, explicit-save round trips, unchanged mobile/preferences, and continued stale-revision conflicts.
- Extend `test/home-widgets.test.js` with multi-widget upward pointer/keyboard moves, capture retained during preview, DOM reordering only after release, real lost-capture cancellation, resizing under non-80px row metrics, no-fit rejection, and fullscreen/container-resize cancellation without persistence or owner restarts. Improve the injected event surface to expose capture-sensitive DOM reparenting rather than hiding it.
- Add focused home-shell/fullscreen interaction coverage using an injectable browser/document seam if needed. Verify Settings opens on initial load/error, Retry is reachable, Edit closes the modal, Save/Cancel work after reopening, and fullscreen denial/exit does not lose the draft.
- Update `test/linkwarden-server.test.js` and `test/dashboard.test.js` only where they currently require a visible Home heading or home-to-photo link. Assert the minimal home shell and relocated controls while preserving integration markup/accessibility, static assets, `/dashboard` aliases, and direct photo route availability.
- Run `node --test test/home-layout.test.js test/home-widgets.test.js test/home-settings.test.js test/home-settings-api.test.js test/linkwarden-server.test.js test/dashboard.test.js`, then `npm test`, `npm run check`, and `git diff --check`.
- Browser checks are important for this task because pointer capture, CSS sizing, and the Fullscreen API cannot be established by source assertions alone. If a browser is unavailable, record that limitation and the package/runtime needed rather than claiming visual checks passed.
- In a browser, verify desktop at 1920×1080, 1366×768, and a short desktop viewport, both windowed and fullscreen: document scroll width/height do not exceed the viewport, every widget stays within the canvas, Settings stays reachable, and long lists remain accessible inside widgets/dialogs.
- Reproduce upward movement with a neighbor sharing a row, move into occupied cells, release/cancel, save/reload, and verify consistent pointer/keyboard results. Exercise fullscreen entry/exit and viewport resize mid-drag, including Escape without accidental draft loss.
- Verify mobile at 320px and 390px widths remains scrollable, its saved layout does not change after desktop fitting/editing, and breakpoint transitions retain separate drafts. Check empty layout, slow/failed initial settings load, save failure/conflict, keyboard navigation, and visible focus after widget removal.
- Verify normal home display contains only widgets and Settings; load/status/layout labels/photo navigation/edit/save controls appear only inside Settings or as screen-reader announcements. Confirm transparency in actual rendered widgets, not just the outer CSS rule.

## Acceptance Criteria

- Home fills the viewport; desktop widget geometry never creates document/canvas scrolling or inaccessible offscreen widgets. Mobile remains independently scrollable, and long content is reachable through bounded widget/dialog scrolling.
- Upward moves work when another widget is on the same row, subject only to real rectangle collisions and finite capacity. Preview and commit agree, and DOM reordering does not break pointer capture.
- Widget surfaces are transparent and readable, with functional focus/selection/edit feedback.
- Normal home chrome consists solely of Settings. Edit widgets and browser-fullscreen actions live in Settings, with Save/Cancel, errors, retry, layout information, and empty-state guidance reachable there.
- Loading failure cannot lock the user out of Settings or retry. Fullscreen unsupported/denied/exit states preserve a usable page and unsaved drafts.
- Existing server-shared preferences, independent mobile layout, revision conflict handling, integration actions, and automatic information refresh remain functional.
- Documentation, version `0.16.1`, implementation record, automated results, and actual browser verification status match the delivered behavior.

## Planning Verification

- Read the shared project/task conventions and current request, inspected task numbering and clean Git state, and examined the home shell bindings, CSS grid sizing/surfaces, shared geometry model, and pointer editor before writing this new plan.
- The plan skill loader was unavailable, so this planning pass followed the user's supplied workflow directly alongside the readable shared conventions.
- This planning change adds only `tasks/27-fullscreen-widget-layout/1-plan.md`; implementation code is unchanged.
