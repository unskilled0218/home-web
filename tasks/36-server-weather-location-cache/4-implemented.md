# implemented

## Changes

- Implemented task 36 on the new branch `36-server-weather-location-cache`.
- Added shared weather normalization, snapshot validation, canonical-unit presentation, and timezone-aware update-time formatting in `public/weather-data.js`.
- Added revision-checked location persistence and replaceable weather snapshots through `src/weather-store.js`, composed into the existing SQLite store in `src/db.js`. Forecast registrations are bounded to eight including UTC; AQI has one location-wide snapshot. Existing database records are preserved.
- Added the server weather service in `src/weather.js`, with asynchronous startup and hourly unattended retrieval, a coalesced serialized work queue, ten-second deadlines, a 1 MiB provider-response bound, independent forecast/AQI failure handling, persisted successful timestamps and retry attempts, and guarded writes for location revisions and evicted registrations.
- Added cached `GET /api/weather`, revision-checked `PUT /api/weather/location`, and asynchronous `POST /api/weather/refresh`, using the existing local-network, Host, Origin, JSON-body, and non-storing response controls.
- Integrated service startup and stop-before-SQLite-close handling in `src/server.js`. Constructing an API server without an injected weather service does not start provider requests.
- Replaced browser forecast retrieval with cached-first server snapshot loading, server freshness requests, five-second polling during work, sixty-second normal polling, visibility cancellation, and guarded shared-location saves. Units remain browser-local and convert from canonical data without extra provider calls. Legacy local locations never configure weather or upload automatically.
- Added the current saved location to Settings → Weather and a separate forecast update-time element. Stale weather retains its persisted update time; AQI-only updates do not advance it. Location search and **Clear results** preserve location, displayed weather, search text, and drafts.
- Added server, API, shared-data, controller, and Chromium regression cases covering persistence, timing, caching, concurrency, eviction recovery, failures, units/timezones, and update-time behavior.
- Updated `docs/dashboard.md` and `docs/testing.md`. Bumped `package.json` and both root lockfile versions from `0.17.5` to `0.17.6`, following recent patch-version releases.

## Verification

- `npm run check`: passed.
- `npm test`: passed, 170 Node test entries, zero failures or skips. Includes real temporary SQLite persistence and protected API requests, provider deadlines and size bounds, hourly retrieval with no browser, initial-failure throttling, independent forecast/AQI timestamps, coordinate and label-only revision races, timezone eviction and recovery, canonical conversions, controller visibility and late-response guards, and existing integration regressions.
- `npm run test:browser`: passed, all 24 Chromium cases. Includes cached weather before delayed updates, retained stale timestamps, later successful forecast timestamps and reload persistence, visible AQI without a successful forecast, server location overriding local preferences, location-save failures and conflicts, open Settings draft preservation, shared-save completion after clearing results, per-browser units/timezones, mobile Settings, keyboard navigation, forecasts, photos, calendar, and fullscreen.
- Each runtime JavaScript module and changed test file was checked separately with `node --check` in addition to the project's check command.
- `git diff --check`: passed. Final diff inspection confirmed additive weather persistence, server-owned provider retrieval, retained browser-local display settings, consistent package/lockfile versions, and no unrelated integration changes.
- Browser verification initially hit a missing Playwright executable, then a missing `libglib-2.0.so.0` dependency. The user installed Chromium and its system libraries inside the container. Final browser assertions ran successfully. The first runnable suite exposed an existing select-label locator ambiguity and a fake-clock jump that aborted an in-flight Settings snapshot; the test now uses the combobox role and advances timers in order for that scenario.

## Implementation Decisions

- Weather SQL is isolated in `src/weather-store.js` and composed into `src/db.js` using its existing connection. This keeps the cache's transaction and revision rules together without expanding unrelated device and integration persistence methods.
- One serialized server queue handles forecast variants and the shared AQI part independently. Each successful part persists immediately; a failed part leaves the other part's cached data and timestamps intact.
- Location changes remain installation-wide and revision-checked. Timezone registrations use internal unique tokens so an evicted registration's late response cannot overwrite a newer registration for the same timezone. Browser refresh requests touch activity even when data is fresh, while ordinary reads and unattended retrieval do not.
- Successful update time means server retrieval time, not provider observation time. Canonical temperature and wind presentation rounds to one decimal place, precipitation to two, preserving missing readings and daily provider-local dates.
