# implemented

## Changes

Implemented the five-tab Settings dialog on the new branch `34-tabbed-dashboard-settings`. This record was created before implementation edits and completed after the available verification.

- Reorganized `public/index.html` into General, Time, Weather, Calendar, and Images panels with a left-side tab rail, labeled tab/panel relationships, General initially selected, and a separate header/footer. General contains Information layout's position and overall scale controls.
- Grouped existing weather search, Baikal connection, and NFS status sections into their respective panels. Preserved existing control names, limits, IDs, credential attributes, and service handlers.
- Kept three independent forms. All display controls and the footer Save button explicitly belong to `#preferences`; inactive panels stay in the DOM with enabled controls. Search and calendar credentials retain their own form ownership.
- Added `public/dashboard-settings.js` for pointer activation, vertical arrow-key wrapping, Home/End, selected state, roving tabindex, and control-driven panel revelation. Navigation does not serialize preferences or affect service controllers.
- Added explicit first-invalid-control validation before preference serialization. Saving from any tab reveals the relevant panel and reports its invalid field before changing settings or writing storage.
- Reset the active tab to General on opening and focus its tab. Retained native dialog closing, Escape behavior, and focus return to Settings.
- Updated scoped dialog styling with dark surfaces, a selected-tab accent, consistent fields/actions, bounded scrolling, and compact left navigation at narrow widths. Header and footer remain outside the panel scroll area.
- Added two server/markup regression cases for the five-tab structure and complete preference form associations, and included the new module in static asset coverage.
- Adapted the existing browser cases and added seven focused cases for tab navigation, cross-tab drafts/saving, multi-panel validation, native form ownership, weather actions, calendar actions, and pending/error state across navigation. The 14-case suite includes 1200px/320px/390px widths at 800px and 360px heights with sidebar, overflow, and action reachability checks.
- Updated README instructions for the five tabs, General's shared layout controls, keyboard navigation, cross-tab saving, weather location behavior, and Calendar connection location.
- Bumped `package.json` and both root version entries in `package-lock.json` from `0.17.3` to `0.17.4`, following recent patch-version increments for UI changes.

## Verification

- `npm test`: passed, 150 tests, zero failures or skips. This includes the new markup/form-association checks and existing root routing, asset, service-controller, integration, persistence, and security regressions.
- `npm run check`: passed.
- Individual `node --check` calls for `public/dashboard.js`, `public/dashboard-settings.js`, `test/dashboard.test.js`, and `e2e/dashboard-home.spec.js`: passed.
- `npx playwright test --list --browser=chromium`: passed; discovered 14 browser cases.
- `npm run test:browser -- --max-failures=1`: blocked at the first browser launch, with 13 cases not run. Chromium exited with `error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file: No such file or directory`. No browser assertions ran.
- `ldd` confirmed missing Chromium runtime libraries, including GLib/GObject/GIO, NSS/NSPR, ATK/AT-SPI, D-Bus, XComposite/XDamage/XFixes/XRandR, GBM, xkbcommon, and ALSA.
- `git diff --check`: passed. Final inspection confirmed this task changes Settings frontend behavior, documentation, tests, and version metadata without changing backend routes, database schema, or preference storage format.

## Remaining Verification

The user must install Chromium's system dependencies in this environment, for example by running `npx playwright install-deps chromium` with administrative privileges, then rerun `npm run test:browser`. No system packages were installed during implementation. Native form validation/focus, keyboard navigation, desktop/mobile geometry, visual appearance, and service interactions are covered by the suite but remain browser-unverified because Chromium cannot launch. Starting the HTTP server does not substitute for those checks.
