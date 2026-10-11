# Task 31: Pixel-Precise Widget Geometry Implementation

## Result

Implemented version-2 pixel geometry for the customizable home widget page. Pointer and keyboard edits now operate in individual CSS pixels, layouts scale from persisted reference canvases, legacy version-1 grid settings migrate on read without an implicit database write, and the fixed edit toolbar no longer changes the canvas bounds or blocks top-edge placement.

## Changes

- `public/home-layout.js` now stores each desktop/mobile mode as `{ canvas, items }` with bounded integer CSS-pixel rectangles. It provides deterministic canvas projection, per-widget minimum sizes, arbitrary rectangle collision checks, edge-based blocker relocation, mobile downward growth, bounded normalization, and one-pixel `changeWidget()` operations.
- Version-1 settings remain accepted by the shared browser/server normalizer. Existing 12-column desktop and four-column mobile tracks project into canonical pixel canvases after the prior desktop fitting behavior, including minimum-size compaction for oversized legacy layouts. Migration preserves revision, membership, separate modes, preferences, and Home Assistant selections; normalization returns version 2 idempotently.
- `public/home-widgets.js` paints absolute pixel rectangles, previews raw pointer deltas, uses one-pixel arrow-key steps, materializes the active layout against the measured canvas only when editing, and preserves pointer capture, cancellation, focus, and stable preview DOM order. Mobile height updates owned by the editor no longer cause its ResizeObserver to cancel active downward drags.
- `public/app.js` consumes mode-specific pixel layouts, rebases current-mode edits to the rendered canvas, preserves explicit desktop/mobile routing, and exposes Left, Top, Width, and Height pixel controls in Settings. Geometry-only changes still do not restart widget data owners.
- `public/styles.css` replaces home CSS-grid tracks with a relative canvas and absolutely positioned widgets. The home toolbar is fixed above the canvas with pointer interception limited to its actual buttons, so showing Save/Cancel does not consume canvas height.
- Added Playwright Chromium coverage in `e2e/home-layout.spec.js` and `playwright.config.js`. It checks unchanged canvas bounds when edit actions appear, exact one-pixel resizing, top-edge movement while Save is visible, save/reload persistence, 320px/390px mobile overflow behavior, and mobile downward canvas growth.
- Updated model, editor, controller, API migration, responsive composition, and served-CSS tests for version-2 geometry. Updated README behavior/migration documentation, added `npm run test:browser`, ignored Playwright output, and bumped `package.json`/`package-lock.json` from `0.17.0` to `0.17.1`.

## Migration and Compatibility

- New databases start with version-2 reference-canvas settings.
- Stored version-1 JSON is normalized to version 2 during GET but remains byte-for-byte unchanged in SQLite with the same revision. The first successful revision-checked PUT persists version 2 and increments the revision once.
- Desktop migration retains the former repair contract for overflowing version-1 layouts, including six-widget minimum-size compaction rather than making settings unavailable after upgrade.
- Rendering at another viewport scales rectangle edges without writing settings. An actual edit materializes all rectangles in that mode against the current canvas so subsequent pixel deltas are exact and do not accumulate projection drift.
- The SQLite schema, 64 KiB request limit, revision conflict protocol, shared preferences, integration credentials, and separate photo dashboard remain unchanged.

## Verification

- Focused Node suites passed for layout, widgets, shell, settings controller/API, responsive composition, and served dashboard assets.
- `npm test` passed: 171 tests, 0 failures.
- `npm run check` passed.
- `npm run test:browser` passed all three Chromium tests at desktop, 320px mobile, and 390px mobile sizes.
- `git diff --check` passed.
- Chromium `153.0.8010.12` was available through the installed Playwright runtime. Firefox and WebKit were not installed, so native cross-browser verification was not performed.

## Scope Notes

- The pre-existing uncommitted bookmark changes present before Task 31 were preserved. They are not part of the Task 31 implementation scope.
- The toolbar may visually cover content in the top-right canvas corner by design, but its container is pointer-transparent and its controls remain visible and keyboard accessible. No hidden row or offset is reserved, so every canvas edge remains valid geometry.
