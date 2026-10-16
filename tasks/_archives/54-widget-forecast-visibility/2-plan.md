# Plan

- [Plan](#plan)
  - [Scope](#scope)
  - [Implementation plan](#implementation-plan)
    - [1. Extend shared preferences safely](#1-extend-shared-preferences-safely)
    - [2. Add settings controls](#2-add-settings-controls)
    - [3. Project fullscreen widget visibility](#3-project-fullscreen-widget-visibility)
    - [4. Render forecast visibility independently](#4-render-forecast-visibility-independently)
    - [5. Add regression coverage and documentation](#5-add-regression-coverage-and-documentation)
  - [Acceptance criteria](#acceptance-criteria)
  - [Risks and decisions](#risks-and-decisions)

## Scope

Allow each of the six dashboard widgets to be hidden in fullscreen without changing its desktop/mobile visibility. Add independent hourly and daily forecast visibility settings. Persist all choices through the existing shared, revision-controlled preferences. Do not change integration connections, forecast retrieval, layout geometry, or slideshow behavior.

## Implementation plan

### 1. Extend shared preferences safely

- In `public/dashboard-helpers.js`, add boolean preferences `hideTimeFullscreen`, `hideWeatherFullscreen`, `hideCalendarFullscreen`, `hideHomeAssistantFullscreen`, and `hideWolFullscreen`, defaulting to `false`. Retain the existing `hideBookmarksFullscreen` key and its saved value.
- Add `weatherHourlyVisible` and `weatherDailyVisible`, both defaulting to `true`. These two preferences apply across desktop, mobile, and fullscreen.
- Extend `decodeStoredDashboardPreferences` with defaults for missing new fields only, preserving existing fields, strict type validation, unknown-field rejection, revisions, and read-only decoding. This also upgrades the shared browser cache through its existing decoder.
- Keep current-schema writes strict through `validateDashboardPreferences`; older open clients must reload before saving. Do not add a database table or separate local preference store.

### 2. Add settings controls

- In `public/index.html`, add a clearly labeled fullscreen group under General with one “Hide … in fullscreen” checkbox for each widget. Explain that these options only hide widgets already enabled by the active desktop/mobile profile.
- Move the existing `hideBookmarksFullscreen` checkbox from Bookmarks into that group without duplicating its form control or changing its meaning. Preserve the existing hidden `mobileBookmarksMode` control.
- Add “Show hourly forecast” and “Show daily forecast” checkboxes under Weather in a shared forecast display group.
- Associate all controls with the existing `preferences` form. Use the generic preference fill, draft, validation, and save handling in `public/dashboard.js`; do not introduce auto-saving or preview unsaved values.
- Update tests that locate the bookmark fullscreen checkbox through the Bookmarks tab to use General.

### 3. Project fullscreen widget visibility

- In `public/dashboard-display.js`, resolve the active desktop/mobile profile first, then apply each fullscreen hide flag to its widget's visibility. Derive information/device wrappers, columns, device rows, content visibility, and background-only state from these effective values.
- Preserve independent filename captions and background-only fullscreen tools. Hiding every widget must leave Settings and Exit fullscreen reachable.
- Extend the relevant snapshot change detection in `public/dashboard.js` so local saves and remote snapshots apply fullscreen flags immediately, including while fullscreen is already active. Reuse the existing fullscreen change handler and layout view update path.
- Keep saved widget positions, sizes, layers, and desktop/mobile profiles unchanged in Automatic and Custom layouts. Exiting fullscreen must restore only widgets enabled by the current profile.
- Treat fullscreen hiding as presentation-only. Do not create or reconfigure integration request owners, change calendar enablement, or restart the slideshow or clock just to hide a widget.

### 4. Render forecast visibility independently

- In `renderWeather` in `public/dashboard.js`, set `#hourly.hidden` and `#daily.hidden` from their preferences, and hide `#forecast-details` when no forecast exists or both lists are disabled.
- Keep current conditions, air quality, Updated time, and existing unavailable/stale messages unchanged. Re-enabling a forecast list must restore its latest data or unavailable message without a new provider request.
- Re-render weather when either forecast preference changes through a local save or remote snapshot. Keep visibility application in the normal weather render path so later weather callbacks cannot reveal a disabled list.
- Verify existing CSS honors list `hidden` attributes in both Automatic and Custom layouts; add only narrowly scoped CSS if necessary.

### 5. Add regression coverage and documentation

- Extend `test/dashboard-settings-api.test.js` and `test/dashboard-settings-sync.test.js` for defaults, missing-field upgrades of stored records and caches, explicit saved values, invalid boolean rejection, strict writes, revision conflicts, and persistence across reopening the store.
- Extend `test/dashboard-display.test.js` for each fullscreen flag, both profiles, fullscreen entry/exit, already-disabled widgets, collapsed wrappers, caption-only states, and unchanged input settings.
- Extend `e2e/background-display-options.spec.js` for save-only changes, per-widget fullscreen hiding, restoring the active profile after exit, background-only tools, remote propagation while fullscreen, and persistence after reload/restart.
- Add forecast browser coverage in a focused spec or the existing weather tests in `e2e/dashboard-home.spec.js`. Exercise all four hourly/daily combinations with a deterministic weather fixture, current conditions retained, unavailable forecasts, later weather updates, and remote saves.
- Extend `e2e/dashboard-layout.spec.js` with Custom layout fullscreen hiding and forecast toggles. Assert hidden widgets retain their saved geometry and layer order after exit/re-enabling.
- Cover desktop and mobile, including the 600px/601px boundary. Confirm display-only changes do not add provider requests, restart photo playback, or create extra polling owners.
- Update `docs/dashboard.md` to describe the General fullscreen controls, shared forecast toggles, defaults, upgrade behavior, and visibility precedence. Maintain a table of contents for its headers if adding any.
- Run `npm run check`, `npm test`, and `npm run test:browser`. If browser dependencies are unavailable, report the blocker rather than installing system packages.

## Acceptance criteria

- All six widgets have independent fullscreen hide controls. Existing installations retain their current appearance and bookmark fullscreen choice.
- Fullscreen hiding combines with active desktop/mobile visibility; exiting fullscreen never reveals a widget disabled in that profile.
- Automatic and Custom layouts respect effective visibility without changing saved layout data. Background-only fullscreen retains usable Settings and Exit fullscreen controls.
- Hourly and daily forecasts can each be shown or hidden independently on every screen. Hiding both leaves current weather visible without an empty forecast container.
- Choices apply only after successful save, survive reload and restart, and propagate through existing shared settings synchronization without overwriting dirty drafts.
- Existing records and caches missing only the new fields decode successfully. Invalid values and stale writes remain rejected.
- Display changes do not modify connections, selections, weather refresh schedules, or background playback. All applicable checks pass.

## Risks and decisions

- Interpret “widget on fullscreen” as per-widget hiding, extending the existing bookmark behavior rather than adding a separate fullscreen layout or global hide-all switch.
- Use one fullscreen hide setting per widget across desktop and mobile. These settings cannot force a widget visible when its active profile disables it.
- Forecast list settings are shared rather than separate desktop/mobile profiles; the request does not require additional profile controls.
- The exact-field preference schema makes missing-field decoding essential. Upgrade stored reads and caches, but do not silently accept incomplete writes from older clients.
- Fullscreen projection and weather callbacks are separate update paths. Both must apply current preferences consistently to avoid stale visibility after polling, resizing, caption updates, or remote saves.
- Custom layout nodes can live outside their original wrappers. Apply visibility to widget nodes themselves and preserve the existing layout view ownership.
