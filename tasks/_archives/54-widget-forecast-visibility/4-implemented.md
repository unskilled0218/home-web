# Implemented

- [Implemented](#implemented)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Remaining verification](#remaining-verification)

## Changes

- Created branch `54-widget-forecast-visibility` from `main` without reusing an existing branch.
- Added fullscreen hide settings for Time, Weather, Calendar, Home Assistant, and Wake-on-LAN. Retained the existing bookmark setting and moved its checkbox into General with the other fullscreen controls.
- Added independent hourly and daily forecast toggles in Weather. Both lists default to shown across desktop, mobile, and fullscreen. Current conditions, air quality, and update timestamps remain independent.
- Extended shared preference normalization and stored/cache decoding with backward-compatible defaults, strict boolean validation, unchanged read revisions, and existing revision-checked writes.
- Applied fullscreen hiding after desktop/mobile profile selection. Effective visibility controls widget nodes, collapsed groups, Custom layout visibility, and background-only tools without modifying saved geometry, layers, or service ownership.
- Re-rendered forecast visibility on confirmed local and remote preference changes and subsequent weather callbacks. Reused the existing hidden-attribute CSS rule without adding styles or dependencies.
- Added exhaustive fullscreen-mask projection tests and migration/cache/API regressions. Added eight browser scenarios for fullscreen controls, desktop/mobile boundaries, remote dirty drafts, forecast combinations and updates, and Custom layout preservation. Updated existing bookmark tests for the moved control and extended slideshow/timer regression coverage.
- Updated `docs/dashboard.md`. Bumped `package.json` and `package-lock.json` from `0.17.22` to `0.17.23`, following the existing patch-version convention.

## Verification

- `node --test test/dashboard-display.test.js test/dashboard-settings-api.test.js test/dashboard-settings-sync.test.js`: passed all 31 focused tests.
- `npm test`: passed all 436 tests, with zero failures or skips. Final run output is in `/tmp/opencode/54-node-tests.log`.
- `npm run check`: passed.
- Additional `node --check` validation of every top-level JavaScript file in `src/`, `public/`, `test/`, and `e2e/`: passed for 110 files.
- `git diff --check`: passed.
- Focused browser run selected ten new/affected scenarios, but all were blocked before application execution by missing Playwright Chromium.
- `npm run test:browser -- --max-failures=1`: discovered 151 tests, then stopped at the first browser launch failure; 150 did not run. The failure was `Executable doesn't exist at /home/container/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.

## Remaining verification

Browser behavior remains unverified in this environment. Install the matching browser with `npx playwright install chromium`, then run `npm run test:browser`. No browser downloads, system-package installations, release publishing, or changes to `todo.md` were performed.
