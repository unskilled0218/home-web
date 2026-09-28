# Task 28: Streamlined Home Widgets Implementation

## Result

Implemented the streamlined home widget presentation and editing controls. This record was created before application code changes and completed after verification.

## Changes

- Removed the editor-generated visible title from every home widget while preserving each root's existing accessible name and widget-specific Move, Remove, and Resize labels.
- Hid the top edit-control container outside edit mode, retained the dashed edit outline, and removed normal home widget borders and obsolete title/forecast spacing styles.
- Removed the home-only Hourly and Daily markup and rendering. The home weather widget continues to show current icon, temperature, condition, wind, humidity, precipitation, status/stale state, and air quality.
- Left the shared Open-Meteo transport and the separate `/dashboard` current/hourly/daily forecast presentation unchanged.
- Added initially hidden Save and Cancel buttons beside Settings with explicit accessible labels. Rendering shows them only for an active draft and synchronizes disabled states with the Settings-dialog controls.
- Routed toolbar and dialog Save/Cancel through shared shell actions. Toolbar success/cancel returns focus to Settings, failed saves retain the draft and controls, and cancellation stops active gestures before reloading saved state.
- Extended editor, shell, and served-asset tests for title-free labeled controls, edit-only chrome, toolbar save failure/success/cancel behavior, current-only home weather markup, borderless CSS, and unchanged photo-dashboard forecasts.
- Updated `README.md` for the new presentation and workflow and bumped `package.json` from `0.16.1` to `0.16.2`.

## Verification

Passed:

```text
node --test test/home-widgets.test.js test/home-shell.test.js test/dashboard.test.js
29 tests passed, 0 failed

npm test
156 tests passed, 0 failed

npm run check
node --check src/*.js && node --check public/*.js

git diff --check
```

- Focused tests exercise real editor handlers through the existing injected DOM surface, both toolbar and dialog shell paths, failed-save draft retention, focus restoration, gesture cancellation, and static HTTP delivery of the revised home assets.
- Existing `/dashboard` assertions continue to cover hourly/daily forecast markup, styles, weather queries, normalization, and rendering references, confirming the home-only scope.
- No Chromium, Chrome, Firefox, or other browser executable is installed in the environment, so desktop/mobile visual layout, 320px wrapping, real pointer capture, and rendered focus were not browser-verified. No live Open-Meteo, CalDAV, Home Assistant, Linkwarden, NFS, or Wake-on-LAN integration checks were performed.

## Plan Notes

- The planned optional dedicated home-information DOM test was not added because served-source assertions prove deleted node references and forecast-only helpers are absent, while the existing weather-controller and `/dashboard` tests continue to cover data and refresh behavior.
