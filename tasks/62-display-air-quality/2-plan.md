# plan

- [scope](#scope)
- [Implementation Plan](#implementation-plan)
  - [1. Reproduce and locate the air-quality failure](#1-reproduce-and-locate-the-air-quality-failure)
  - [2. Correct the failing data-flow boundary](#2-correct-the-failing-data-flow-boundary)
  - [3. Verify service recovery and dashboard display](#3-verify-service-recovery-and-dashboard-display)
- [Acceptance Criteria](#acceptance-criteria)
- [Risks And Decisions](#risks-and-decisions)

## scope

Restore the weather widget's current US AQI for the selected location in both Global and Local settings modes. Fix the cause of the incorrect unavailable state while preserving truthful failure and stale-data messages.

The existing flow is `src/weather-provider.js` → `normalizeAir()` in `public/weather-data.js` → Global SQLite cache in `src/weather.js` or Local memory cache in `src/local-weather.js` → weather API snapshots → browser controllers → `renderWeather()` in `public/dashboard.js`.

Inspection found that both services request `current=us_aqi` and require a finite `current.us_aqi`. A planning-time request for Berlin using the existing query parameters returned a valid `current.us_aqi`. The affected location, runtime response, and root cause remain unconfirmed; the sample does not establish that the deployed service works.

## Implementation Plan

### 1. Reproduce and locate the air-quality failure

1. Identify whether the affected browser uses Global or Local weather and obtain its selected coordinates and timezone from the existing settings and weather requests. Read deployment state without changing the saved location or cache.
2. Inspect `/api/weather?timezone=...` or the existing `/api/weather/local` response, including `air`, `airUpdated`, `airError`, and `refreshing`. Compare the browser's rendered state with the response to distinguish a service failure from a display failure.
3. Use `weatherUrls()` to make a read-only request for those coordinates from the same Node/container runtime as the application. Inspect HTTP status, provider error response, and the current AQI field. Distinguish transport, timeout, provider rejection, missing data, normalization, persistence, and browser validation failures.
4. For Global mode, inspect the `air` cache row's payload, revision, attempted time, update time, and failure flag. For Local mode, reproduce through the service query and its polling lifecycle. Account for the existing one-hour retry deadline before interpreting repeated unavailable snapshots.
5. Turn the observed failure into a deterministic regression fixture and identify the first boundary where valid data is lost or rejected. If the affected runtime cannot be accessed, record that limitation and obtain a sanitized failing response or reproducible case before selecting a speculative provider change.

### 2. Correct the failing data-flow boundary

1. Apply the smallest fix supported by the reproduction. Shared provider request or parsing corrections belong in `src/weather-provider.js` and `public/weather-data.js`, so Global and Local weather use the same contract.
2. Keep the provider request and normalizer aligned with the documented response. Preserve valid zero AQI values. Reject missing, null, nonnumeric, and nonfinite readings rather than presenting them as successful measurements.
3. If the defect is in service state or caching, update only the affected path in `src/weather.js`, `src/local-weather.js`, or `src/weather-store.js`. A successful attempt must publish `{ aqi }`, advance `airUpdated`, and clear `airError`; a failed attempt must retain any valid same-location reading and its update time.
4. If valid AQI reaches the API but is lost in the browser, fix the affected validation or controller boundary in `public/weather-data.js`, `public/dashboard-weather.js`, or `public/dashboard-local-weather.js`. Preserve location identity checks and rejection of late results from previous locations.
5. Verify `renderWeather()` displays `US AQI: <value>` independently of forecast availability. Change rendering only if the reproduced case demonstrates a defect. Retain the existing stale annotation after failed refreshes and the unavailable message when no valid reading exists.
6. Preserve server-side provider ownership, independent forecast/AQI failures, bounded requests, and existing hourly refresh behavior. Do not add a second provider, browser-side provider requests, or a fallback data shape unless the reproduced provider contract requires it.

### 3. Verify service recovery and dashboard display

1. Add the regression at the failing boundary. Use a realistic sanitized provider response rather than relying only on the existing minimal `{ current: { us_aqi: 20 } }` fixtures. Assert relevant URL parameters if the request contract changes.
2. Extend `test/weather.test.js` and `test/local-weather.test.js` as needed to verify valid AQI, zero AQI, initial failure followed by successful hourly recovery, and a failed refresh retaining a previous reading. Confirm AQI recovery clears its error and updates its timestamp while forecast state remains independent.
3. Use `test/weather-api.test.js` or `test/local-weather-api.test.js` if the defect involves snapshot propagation. Verify the existing `{ aqi }`, `airUpdated`, and `airError` contract reaches the browser unchanged.
4. Extend `e2e/dashboard-home.spec.js` for AQI-only failure and recovery: a valid forecast remains visible while AQI is unavailable, a later successful snapshot shows the reading, and a later failed refresh retains the reading with the stale annotation. Include zero AQI and valid AQI with no forecast. Use `e2e/settings-scope.spec.js` if scope-specific behavior changes.
5. Run `node --test test/weather.test.js test/local-weather.test.js test/weather-api.test.js test/local-weather-api.test.js test/dashboard.test.js`, then `npm run check` and `npm test`. Run `npm run test:browser -- e2e/dashboard-home.spec.js e2e/settings-scope.spec.js` for the affected browser paths.
6. Repeat the read-only provider/API check and inspect the widget in the affected runtime when available. Record the reproduced cause, changed boundary, verification results, and any remaining runtime-access limitation in the implementation report.

## Acceptance Criteria

- A valid current AQI for the selected location reaches the weather snapshot and appears as `US AQI: <value>` in both settings modes.
- AQI `0` renders as a valid reading; missing or invalid data never becomes a fabricated successful reading.
- AQI can display when forecast data is unavailable, and an AQI failure does not hide a valid forecast.
- An initial AQI failure recovers on the next eligible successful refresh, clears `airError`, and advances `airUpdated`.
- A failed refresh preserves a valid same-location AQI with its existing stale annotation and unchanged update time.
- Changing coordinates cannot display a previous location's AQI or accept its late response.
- The observed defect has a deterministic regression test, and the relevant Node and browser checks pass.

## Risks And Decisions

- Root cause is not established. The existing endpoint supports the requested current field in the successful sample, so changing to hourly data without failure evidence could introduce the wrong measurement time.
- A successful planning-time fetch does not verify connectivity, provider coverage, or rate limits in the deployed Node process. Runtime-specific transport failures need runtime evidence.
- The services retain failed-attempt state for up to one hour. Verify recovery with controlled clocks in tests; do not bypass retry limits or erase production caches to make the widget appear fixed.
- Preserve the existing normalized `{ aqi }` cache and snapshot shape unless a confirmed defect requires a change. The present scope does not require a schema migration, AQI categories, or a widget redesign.
- Live provider requests are diagnostic checks, not automated test dependencies. Use deterministic fixtures for regressions.
