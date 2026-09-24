# Task 17 Implementation

## Result

Implemented a browser-native photo dashboard at `/dashboard` and `/dashboard/`, based on the sibling desktop reference. Released as version `0.12.0` on the fresh `17-dashboard-page` branch.

## Changes

- Added explicit static page aliases and navigation between the existing home page and the new dashboard. Added an independent HTML/CSS/module entry point without invoking the home-page integration clients.
- Added a dark photo canvas, lower-left/right information overlay, responsive settings dialog, browser fullscreen controls, keyboard focus restoration, and reduced-motion transition handling.
- Added versioned, schema-normalized localStorage preferences with bounded values, corrupt/blocked storage recovery, timezone validation, per-section visibility/scale, and session-only fallback on save failure.
- Added immediate timezone-aware clock/date rendering with locale date styles, 12/24-hour and seconds options, and owned timers paused when hidden.
- Added bounded local photo selection, object URL ownership, name/date/shuffle ordering, none/fade/slide transitions, opacity, solid/blur backgrounds, optional filenames, decode-failure skipping, selection-race protection, and resource cleanup after replacement or page disposal.
- Added fixed-endpoint Open-Meteo location search, current weather, future three-hourly samples, seven daily forecasts, and separately handled US AQI. Provider units, epoch timestamps, daily UTC offsets, location bounds, and output text bounds are handled explicitly.
- Added request timeouts and cancellation, generation-based obsolete-response protection, same-settings stale data, independently reported forecast/air-quality failures, and a single hourly refresh owner paused when hidden.
- Added Open-Meteo/CAMS attribution and browser-specific photo/storage explanations. Updated README and package version without adding dependencies.
- Added 11 meaningful tests covering routes/assets/containment, settings recovery, timezone date boundaries, photo bounds/order/lifecycle/races, forecast sampling and daily dates, provider queries, timeout/cancellation, partial failures, stale data, and refresh ownership.

## Verification

- `node --test test/dashboard.test.js`: passed, 11 tests.
- `npm test`: passed, 74 tests, no failures or skips.
- `npm run check`: passed. Also checked each `public/dashboard*.js` file individually with `node --check`, since the existing glob-based command does not reliably check every expanded argument.
- Live read-only HTTP checks against the documented geocoding, forecast, and air-quality endpoints succeeded using the implemented parameter sets. Forecast and air-quality documentation confirmed unit codes, current US AQI support, epoch timestamps, and daily offset handling.
- `git diff --check`: passed during final verification; staged changes also checked before committing.
- Interactive desktop/mobile layout, keyboard, fullscreen, actual browser image decoding, and browser CORS checks were not run: no Chromium/Chrome executable is installed. Controller and HTTP tests cover the nonvisual behavior, but these manual checks remain to be performed in a browser.

## Adaptations

- Photos use browser file selection and session-local object URLs rather than the reference's native directory picker/watcher. Preferences persist, but files must be reselected after reload or page disposal.
- Clock format controls use locale date styles, hour cycle, and seconds rather than custom desktop formatting tokens.
- Forecast lists are placed in an expandable section to keep the corner overlay compact on small screens. Weather conditions use text descriptions rather than copied icon assets.
- No runtime dependency on the sibling checkout or its empty weather submodule was introduced.
