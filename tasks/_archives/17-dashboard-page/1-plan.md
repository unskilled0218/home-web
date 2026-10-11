# Task 17: Add a Reference-Inspired Dashboard at /dashboard

## Objective

Add a browser-native photo, clock, and weather dashboard to `home-web` at `/dashboard`, using `~/workdir/dash-board` as the functional and visual reference.

## Request and Interpretation

- Request from `~/workdir/command.md`: “See ~/workdir/dash-board for example” and “dash-board as /dashboard”.
- Interpret `/dashboard` as a new page in this application's existing server. Keep the existing home page available at `/`, with navigation between the two pages.
- Use the reference's full-screen image presentation, lower-corner clock/weather overlay, and settings controls as the design basis. Adapt desktop functionality to browser capabilities.
- Browser-specific decisions below are implementation assumptions derived from the reference, rather than additional explicit user requirements.

## Inspected Context

- `src/app.js` serves `/` as `public/index.html` and otherwise resolves a file under `publicRoot`; `/dashboard` currently has no page mapping. Static delivery already supports HTML, JavaScript, CSS, and SVG.
- `public/index.html` and `public/app.js` implement the existing Linkwarden, Home Assistant, and Wake-on-LAN page. Its initialization expects those elements to exist, so the new page needs its own entry module.
- The application uses native browser modules, Node 24, `node:test`, and no installed application dependencies. Current version is `0.11.0`.
- Reference `src/ui/App.tsx` combines `Image`, `Time`, `Weather`, and `Setting`, uses Tauri fullscreen and filesystem APIs, and stores settings in the desktop app cache.
- Reference `Image.tsx` and `SettingImage.tsx` support directory-selected photos, ordering, timed transitions, fade/slide effects, opacity, solid/blurred backgrounds, and image information. Directory watching and native asset paths require browser adaptation.
- Reference `Time.tsx`, `Weather.tsx`, and `default-settings.tsx` provide timezone/date/time settings, weather location and unit settings, current weather, forecast, and air quality. The visual default places information at the lower left over a dark background.
- The reference's `src/open-meteo-api` submodule directory is empty in this checkout. Its API implementation cannot be copied or assumed available; use documented public API contracts when implementing.

## Product Decisions

- Serve `/dashboard` and `/dashboard/` as the same dashboard document using explicit route aliases and absolute asset URLs; direct navigation and reload must work.
- Provide a working clock and dark background on first visit without configuration. Weather prompts for a location; photos prompt for selection.
- Keep preferences local to each browser using a versioned localStorage key. Invalid or unavailable storage falls back to defaults without preventing rendering.
- Select photos with a standard multiple-file image input. Use object URLs for session-local files; preferences persist, but photos must be reselected after reload. Explain that behavior in settings. No server upload or native directory watcher is required for this browser adaptation.
- Fetch weather directly from fixed HTTPS Open-Meteo endpoints using browser `fetch`; add provider attribution and explain that location queries/coordinates are sent to the provider. No arbitrary upstream URL setting or new server proxy is needed.
- Use browser Fullscreen API controls with graceful unsupported/denied behavior. Maintain accurate button state after Escape and external fullscreen changes.
- Implement with native JavaScript/CSS and browser APIs consistent with this project; no React, Tauri, bundler, or new dependency is required.

## Implementation Plan

### 1. Page delivery and navigation

- Add `public/dashboard.html`, `public/dashboard.js`, and `public/dashboard.css`; keep reusable pure formatting/settings functions in `public/dashboard-helpers.js` and weather access in `public/dashboard-weather.js` as needed.
- Extend `serveStatic()` in `src/app.js` with explicit `/dashboard` and `/dashboard/` aliases to the new HTML file, preserving public-root containment, MIME types, and unknown-file 404 behavior.
- Link to `/dashboard` from the existing home page and add an accessible home link on the dashboard. Use absolute local asset paths so slash variants load identically.
- Load only the dashboard entry module on the new page. Do not initialize existing integration clients or controls there.

### 2. Settings and visual shell

- Build a viewport-sized dark canvas with a photo layer, readable clock/weather overlay aligned left or right, and keyboard-accessible settings/fullscreen/home controls.
- Provide a labeled settings dialog grouped into information layout, time, weather, and images. Restore focus to the invoking button on close and keep settings usable on small screens.
- Start from the reference defaults: lower-left information, scale 1, visible clock/weather, browser timezone, Celsius, km/h, millimeters, 60-second image interval, 3-second fade, and black background.
- Normalize saved settings through an explicit schema: allowlisted enum values, valid IANA timezone, finite bounded scales/opacity/timings, bounded location label, valid latitude/longitude, and a valid color. Ignore unknown fields and recover from corrupt JSON or storage exceptions.
- Bound scale to 0.5–2, photo interval to 5–3600 seconds, transition duration to 0–10 seconds and below the interval, opacity to 0–1, and blur to 0–100 pixels. Persist only settings, never object URLs or image bytes.
- Support visibility and scale for time/weather plus overall information position/scale. Use responsive layout rather than relying on the reference's desktop-only dimensions.

### 3. Clock and date

- Render immediately, then update at most once per second. Use `Intl.DateTimeFormat` with the selected timezone so displayed time actually follows the setting.
- Provide date style, 12/24-hour time, and seconds preferences as browser-friendly equivalents of the reference's formatting settings; document this adaptation instead of importing its custom formatter.
- Validate unsupported timezones and fall back to the browser timezone. Own and clear timers when settings change or the page is disposed; never start duplicate intervals.
- Avoid an every-second live region announcement while retaining semantic date/time content.

### 4. Photo presentation

- Accept decodable JPEG, PNG, WebP, and GIF files with an explicit bounded selection (up to 100 files, 20 MiB each, 200 MiB total); report excluded files and decode failures in the settings UI.
- Use session-owned object URLs and release them when files are replaced or the page is disposed, after they are no longer displayed. Keep only the current/next image decoded in slideshow state where practical.
- Support name order, modification-date order, and shuffled order; handle empty/single-image selections without a recurring transition loop.
- Implement none/fade/slide transitions, interval/duration settings, image opacity, solid or blurred-image background, and optional filename display. Insert names as text.
- Reset slideshow state cleanly after a new selection or relevant preference change, skip failed images, and fall back to the background if none can be displayed.
- Respect reduced-motion preferences. Pause unnecessary animation while the page is hidden and resume without accumulating timers.

### 5. Weather and location

- Implement location search against `https://geocoding-api.open-meteo.com/v1/search`, forecasts against `https://api.open-meteo.com/v1/forecast`, and air quality against `https://air-quality-api.open-meteo.com/v1/air-quality` using documented query parameters.
- Request only needed fields: current temperature, weather code/day flag, wind, humidity, precipitation, a next-24-hour forecast sampled at three-hour intervals, seven daily forecasts, and current air-quality data. Render provider units and label the chosen air-quality index explicitly.
- Confirm provider parameter/timezone semantics during implementation. Prefer epoch timestamps and format with the configured timezone to avoid mixing browser-local and forecast-local dates; align hourly samples against the current instant.
- Support location selection, Celsius/Fahrenheit, km/h/mph/m/s/knots, and mm/inch preferences. Limit search text to 120 characters and results to 10; validate returned coordinates, finite values, and bounded display strings.
- Fetch on initial configured load and location/unit/timezone changes, then refresh hourly while visible. Use a single owned refresh timer, 10-second request timeouts, cancellation, and request-generation checks to prevent old results overwriting new settings.
- Provide loading, no-location, empty-results, unavailable, and visibly stale states. Preserve last successful data on transient errors for the same settings only; handle forecast and air-quality failures independently.
- Use local weather-code presentation or simple accessible symbols with text fallbacks. Verify licensing before copying any reference icon assets; do not depend on unavailable submodule files.

### 6. Tests and verification

- Add HTTP route tests for `/dashboard`, `/dashboard/`, reload-equivalent requests, dashboard assets and MIME types, the existing `/`, unknown paths, and public-root containment. Follow existing injected server fixture patterns.
- Add meaningful pure helper tests for corrupt settings recovery, bounds, timezone formatting across date boundaries, image ordering, and forecast sampling when data is missing or exhausted.
- Test weather with injected fetch and clock fixtures: endpoint/query construction, units, malformed responses, timeout/cancellation, partial failure, stale results after location changes, and absence of duplicate refresh work.
- Exercise photo lifecycle and timer cleanup through small injectable seams where appropriate, avoiding a new browser-test dependency or tests that only reproduce implementation details.
- Run `npm test`, `npm run check`, and `git diff --check`. Keep new JavaScript directly under `public/` so existing syntax-check coverage includes it.
- Manually verify desktop/mobile layouts, keyboard settings access, fullscreen entry/exit, reduced motion, zero/one/multiple/broken photos, reselection and reload behavior, offline weather, unit/timezone changes, and navigation back to working integrations. Record unavailable browser or live-network checks explicitly.

### 7. Documentation and release record

- Document `/dashboard`, its reference, settings scope, supported photo behavior, browser-local persistence, weather provider/attribution, and fullscreen limitations in `README.md`.
- Bump `package.json` from `0.11.0` to `0.12.0` for the new page.
- Write `tasks/17-dashboard-page/3-implemented.md` with the actual changes, verification evidence, and any departures from this plan during implementation.

## Acceptance Criteria

- Opening or refreshing `/dashboard` or `/dashboard/` shows the new page with successfully loaded local assets and an immediately visible clock.
- Users can select photos, configure a slideshow, change clock/weather/layout preferences, and enter/exit fullscreen where supported.
- Settings survive reload with safe defaults for invalid storage; the UI clearly explains session-only photo selection.
- Weather and location search work with the configured units/timezone and offer useful partial-failure/offline states without stale-location races.
- The visual presentation follows the reference's photo canvas and corner information overlay and remains usable with keyboard input and narrow screens.
- Existing home-page integrations remain accessible and pass regression tests.
- No runtime dependency on the sibling checkout, Tauri APIs, or the missing submodule is introduced.

## Planning Verification

- Inspected the target server/static entry points, current package configuration, task numbering, and the reference UI/defaults and desktop API dependencies.
- This task creates a new plan only. Implementation and verification commands belong to the implementation phase.
