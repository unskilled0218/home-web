# implemented

## Changes

- Implemented task 33 on the new branch `33-photo-dashboard-home`.
- Replaced `public/index.html` with the existing photo dashboard and removed its obsolete Home link and duplicate `public/dashboard.html` document.
- Added exact-path `308` redirects from `/dashboard`, `/dashboard/`, and `/dashboard.html` to `/`, with non-storing cache and `nosniff` headers. Dashboard asset and photo API routes retain their existing names.
- Removed the widget-only frontend modules, styles, hidden legacy controls, and their obsolete unit/browser tests. Kept `public/home-layout.js` because the database and retained home settings API import its normalization through `src/home-settings.js`.
- Preserved the existing dashboard controllers, `dashboard.preferences.v1` storage key, integration APIs, credential storage, and database schema.
- Split the former omnibus dashboard route/presentation test into focused tests for home documents, redirects, retained assets, retired assets/static containment, icons, markup, styles, and dashboard modules. Preserved backend and shared-controller regression tests.
- Added seven Chromium browser checks covering startup/default service states, saved preferences and legacy navigation, Settings at 1200px/320px/390px widths, mocked photo/weather/calendar rendering, and fullscreen. Browser fixtures use a fixed clock for forecasts and service interception without live NFS, weather, or Baikal dependencies.
- Updated README entry points, calendar/NFS instructions, browser test setup, and retained backend integration instructions. Updated the package description to match the photo dashboard.
- Bumped `package.json` and the root entries in `package-lock.json` from `0.17.2` to `0.17.3`, following recent patch-version increments for UI changes.

## Verification

- `npm test`: passed, 148 tests, zero failures or skips. Includes root documents, manual/followed legacy redirects, retired assets returning `404`, static containment, photo APIs, calendar controllers, persisted home settings, integration credentials, and backend security checks.
- `npm run check`: passed.
- `node --check e2e/dashboard-home.spec.js`: passed.
- `npx playwright test --list --browser=chromium`: passed; discovered seven tests in the replacement browser suite.
- `npm run test:browser`: blocked at browser launch for all seven tests. Playwright Chromium is not installed, so no browser assertions ran. The error was `browserType.launch: Executable doesn't exist at /home/dev/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.
- `git diff --check`: passed. Final source/documentation inspection found no surviving frontend imports of removed modules; the retained server/shared settings dependency remains intact.

## Remaining Verification

The user must install Chromium with `npx playwright install chromium`, then rerun `npm run test:browser`. Desktop/mobile interactions, rendered service fixtures, preference persistence, and fullscreen are covered by the new suite but are not claimed as browser-verified in this environment.
