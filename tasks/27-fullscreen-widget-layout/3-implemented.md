# Task 27: Fullscreen Widget Layout Implementation

## Result

Implemented the viewport-filling, minimal home widget dashboard on `27-fullscreen-widget-layout`. Desktop now uses a finite 12×12 canvas; normal home chrome consists of Settings, with editing, save/cancel, fullscreen, layout details, status, retry, and empty-layout guidance inside its dialog. This record was created before implementation changes and finalized after verification.

## Changes

- `public/home-layout.js`: added desktop row bounds, a six-widget default that fits the canvas, deterministic nearest-slot blocker relocation, and explicit no-space results for impossible edits/additions. Existing valid geometry is preserved; legacy overflow is fitted in saved spatial order with minimum-size compaction when necessary. Mobile keeps its existing independent four-column/downward-placement behavior.
- The shared normalizer makes legacy fitting idempotent on client/server. Reading existing SQLite configuration does not write fitted geometry or advance its revision; the next explicit revision-checked save persists the fitted result. Widget identities, mobile layout, and shared settings remain intact.
- `public/home-widgets.js`: previews now update grid styles without moving DOM nodes while pointer capture is active. Capture is released before commit/reordering; cancellation restores the pre-gesture model. Pointer movement uses measured column/row tracks and gaps instead of fixed 80px row steps. Keyboard gestures and numeric edits use the same bounded geometry rules.
- `public/home-shell.js`: added a small injectable owner for Settings opening/edit/save/cancel/retry and browser fullscreen. Settings remains openable without loaded configuration; fullscreen state follows browser events and denial/unavailability is reported in the dialog. Fullscreen exit, recent fullscreen transitions, and repeated Escape events are guarded against accidental draft cancellation.
- `public/index.html` and `public/app.js`: removed visible Home/photo navigation/page status/layout labels and external edit/save/cancel controls. Kept a screen-reader-only announcement region, consolidated Settings-owned actions, guarded loading/error states, and restored focus to Settings after removal/edit/save. ResizeObserver, viewport changes, fullscreen transitions, and page suspension cancel active gestures without saving geometry.
- `public/styles.css`: added a full-width, safe-area-aware desktop viewport shell with explicit 12-row fractional tracks, adaptive gaps/padding, a reserved Settings strip, and bounded internal scrolling. Widget and nested collection/bookmark/device surfaces are transparent. Dialogs retain readable backgrounds and bounded scrolling; mobile retains normal page scrolling.
- Updated home static assertions for the requested minimal shell and preserved direct photo dashboard routes/assets. Updated README workflow/compatibility guidance and bumped `package.json` from `0.16.0` to `0.16.1`.

## Movement Regression Evidence

The previous preview path reordered capture-owning widget nodes during pointer movement. The improved injected test DOM simulates capture loss when such nodes are moved. A multi-widget upward drag now retains capture and original DOM order during preview, commits the same target as keyboard movement, and reorders only after pointer release. Tests also cover a same-row neighbor with disjoint columns, real collision displacement, lost-capture cancellation, non-80px row steps, full-grid resize rejection, and cancellation without committing. This establishes the event-path regression under the injected test surface, not a claimed live-browser reproduction of the user's report.

## Verification

Passed:

```text
node --test test/home-layout.test.js test/home-widgets.test.js test/home-shell.test.js test/home-settings.test.js test/home-settings-api.test.js test/linkwarden-server.test.js test/dashboard.test.js
42 tests passed, 0 failed

npm test
154 tests passed, 0 failed

npm run check
node --check src/*.js && node --check public/*.js

git diff --check
```

- Layout tests cover bounded defaults, impossible operations preserving inputs, legacy fitting/idempotence/order, retained widget identities, and unchanged mobile/preferences.
- API tests verify legacy fitting does not rewrite the SQLite record on GET, while explicit save advances the revision and stale saves still return 409.
- Shell tests exercise Settings/retry without initial state, edit-to-canvas transitions, Settings-owned save/cancel, fullscreen denial/unsupported states, label changes, and draft preservation on fullscreen Escape.
- Existing integration, calendar/weather lifecycle, persistence/conflict, and photo dashboard tests pass.
- Browser verification was unavailable: no Chromium, chromium-browser, Google Chrome, or Firefox executable was found, and neither Playwright nor Puppeteer resolves in this environment. Real viewport screenshots/scroll-dimension assertions, real touch input, native fullscreen transitions, and live integration checks were not performed. Chromium plus Playwright is needed to complete the planned browser matrix at desktop/short-window and 320px/390px mobile sizes; no packages were installed.

## Plan Notes

- The version-1 settings envelope and server revision protocol are retained, as planned. Desktop geometry changes are logical grid dimensions rather than browser-specific pixels.
- The new home-shell module provides the planned injectable seam for fullscreen and unloaded/error Settings behavior.
- The only verification limitation is the unavailable browser runtime; automated checks are complete.
