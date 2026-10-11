# Task 29: Reliable Separate Mobile Widget Layout Implementation

## Result

Implemented explicit responsive mode ownership and mode-isolated edit routing for the existing independent desktop/mobile layout model. Mobile now defaults to an explicit four-column canvas, while the bounded 12-column/12-row viewport rules require both the desktop media query and desktop mode markers. This record was created before application code changes and completed after verification.

## Diagnosis

- The persisted version-1 settings envelope already stored independent `layouts.desktop` and `layouts.mobile` arrays, and existing model/API tests confirmed that they round-trip separately.
- The browser composition path selected mode independently with `window.innerWidth`, while CSS used media queries. It had no active-mode marker and no composition test proving that deliberately different arrays switch at the 767/768 boundary.
- The original reported visual symptom could not be reproduced because no browser runtime is installed. The implementation therefore removes the browser/CSS mode-source ambiguity and adds regressions rather than claiming a visually confirmed root cause.

## Changes

- Added `public/home-responsive.js` with one exported `(max-width: 767px)` query owner. It selects the initial mode synchronously, emits only actual breakpoint transitions, and removes its listener on disposal.
- Reworked `public/app.js` to initialize page/grid `data-layout-mode` markers before settings can reveal the grid, switch saved/draft arrays from media-query changes, cancel gestures before transitions, and stop deriving mode from `window.innerWidth`.
- Routed editor changes/removals, catalog additions, and numeric geometry forms with an explicit captured mode. An asynchronous operation can no longer write to a different array because the viewport crossed the breakpoint while it was pending.
- Retained resize/ResizeObserver gesture cancellation without using resize events to choose a layout, and added teardown for the resize and media-query listeners.
- Updated `public/home-widgets.js` so pointer, keyboard, and remove callbacks report the mode that the editor actually rendered.
- Made the base/mobile CSS four columns with ordinary 64px rows. Desktop viewport locking, 12 columns, 12 finite rows, compact padding, and overflow hiding now require the 768px desktop media query plus matching page/grid desktop markers.
- Preserved the existing version-1 settings envelope, atomic revision-checked save, independent defaults, normalization, and server API. No data migration or regenerated layout was needed.
- Added responsive owner/composition tests, distinct-layout normalization coverage, explicit editor-mode callback coverage, mobile-only failed/save/cancel persistence coverage, and served-source/CSS assertions. Existing API restart/conflict tests continue to cover both arrays.
- Clarified the separate mobile scrolling canvas in `README.md` and bumped `package.json` from `0.16.2` to `0.16.3`.

## Verification

Passed:

```text
node --test test/home-responsive.test.js test/home-layout.test.js test/home-widgets.test.js test/home-settings.test.js test/home-settings-api.test.js test/dashboard.test.js
43 tests passed, 0 failed

npm test
161 tests passed, 0 failed

npm run check
node --check src/*.js && node --check public/*.js

git diff --check
```

- Responsive tests prove initial mobile selection, duplicate-event suppression, both breakpoint directions, listener disposal, and selection of deliberately incompatible arrays without geometry mutation.
- Editor tests prove desktop previews cancel before mobile rendering and that keyboard/remove callbacks report `mobile`; model/controller tests prove mobile changes preserve desktop geometry through failure, save, and cancel.
- Served-asset tests prove the new module is available, mobile defaults to four tracks, finite desktop CSS requires matching desktop markers, mode no longer uses `window.innerWidth`, and `/dashboard` assertions remain unchanged.
- No Chromium, chromium-browser, Google Chrome, or Firefox executable is installed, and neither Playwright nor Puppeteer is installed. The reported visual symptom, 320px/390px layout, native media-query transitions, touch scrolling, and rendered overflow/focus were not browser-verified. Live integrations were not exercised.

## Plan Notes

- `public/home-layout.js` and the API schema required no implementation change because inspection and tests confirmed their existing dual-layout behavior.
- Existing API tests already cover distinct layout persistence, revision conflict, and restart survival, so no duplicate API case was added; focused controller and composition regressions cover the newly exposed browser path.
