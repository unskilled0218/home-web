# Implementation results

- [Outcome](#outcome)
- [Diagnosis](#diagnosis)
- [Changes](#changes)
- [Verification](#verification)
- [Remaining limitations](#remaining-limitations)

## Outcome

Implemented on the new branch `62-display-air-quality`. Version increased from `0.17.30` to `0.17.31` in `package.json` and both lockfile version entries, following the project's patch-release convention.

Live Global and Local weather APIs returned `{ "aqi": 91 }` for Seoul with `airError: false` and successful update times. Both browser scopes rendered `US AQI: 91` using real provider data and the production weather services.

## Diagnosis

- Read the existing SQLite database in read-only mode. Its saved Global location was Seoul (`37.566`, `126.9784`); the forecast cache had data, but the air row had a null payload/update time and `failed: 1`.
- Reproduced the current provider request in Node.js `v24.22.0`. Default fetch failed repeatedly after approximately 250–289 ms with `ETIMEDOUT`. The nested errors showed IPv4 connection timeout and IPv6 `ENETUNREACH`.
- DNS returned IPv4 and IPv6 addresses. Node's process-wide address-family attempt timeout was 250 ms. Curl returned HTTP 200 with `current.us_aqi: 91`, confirming the requested current field and selected coordinates were supported.
- Increasing the connection-attempt window to 2000 ms returned valid AQI from the same Node/container runtime. A fresh successful request took approximately 1.3 seconds. The request and normalization contract were correct; transport abandoned the IPv4 connection too early before trying unreachable IPv6.

## Changes

- Added `createWeatherTransport()` in `src/weather-provider.js`, using the existing Undici dependency's matching `Agent` and `fetch`. It enables dual-stack address selection with a two-second per-family attempt window, scoped to weather traffic.
- Both services use their own transport when no fetch implementation is injected and destroy its connection pool during shutdown after their existing work drains. Caller-injected fetches retain their existing ownership.
- Preserved the ten-second request deadlines, verified TLS, response byte limits, fixed Open-Meteo endpoints, hourly attempts, independent forecast/AQI state, and normalized `{ aqi }` API/cache shape. No fallback provider, schema migration, or rendering change was needed.
- Added loopback transport checks for connector policy, unchanged process defaults, and cancellation of stalled body reads. Added a representative provider response fixture, direct malformed/zero AQI checks, Local hourly recovery and malformed-refresh retention, and explicit Global/Local late-location AQI assertions. Extended existing Global recovery coverage to include zero rather than duplicating the scenario.
- Added a browser unavailable → zero → stale AQI case while retaining the existing AQI-without-forecast test. API propagation required no route changes; live HTTP checks exercised both APIs with the corrected default transport.
- Updated `README.md`, `docs/dashboard.md`, and `docs/testing.md` with relevant weather behavior, connection policy, recovery semantics, and verification commands.

## Verification

- `node --test test/weather-provider.test.js test/weather.test.js test/local-weather.test.js test/weather-api.test.js test/local-weather-api.test.js test/dashboard.test.js`: 66 passed, zero failures or skips.
- `npm run check`: passed. Individually syntax-checked all nine changed JavaScript files, including the new transport test and browser spec; all passed.
- `npm test`: 570 passed, zero failures or skips, approximately 12.7 seconds.
- `npm run test:browser -- e2e/dashboard-home.spec.js e2e/settings-scope.spec.js`: initially blocked because Playwright expected missing Chromium build 1243.
- Repeated with the already-installed Chromium headless shell build 1248 through `/tmp/opencode/weather-playwright.config.mjs`, without changing repository browser configuration: `npm run test:browser -- --config=/tmp/opencode/weather-playwright.config.mjs e2e/dashboard-home.spec.js e2e/settings-scope.spec.js`. Result: 59 passed and three failed. The new AQI recovery case, existing AQI-without-forecast case, cached weather case, and all four scope cases passed.
- Confirmed all three failures on an isolated detached worktree at pre-implementation commit `17c3d3c` with the same installed browser: General-tab keyboard focus expected `timeVisible`, and two forecast-visibility cases failed `exitFullscreen` with `Document not active`. The baseline worktree was removed after verification. These failures are not introduced by this change.
- Live smoke used an in-memory store, loopback production server, default Global/Local weather transports, and two isolated Chromium contexts. Both API scopes returned AQI 91, valid `airUpdated`, and no forecast or air error; both page scopes displayed `US AQI: 91` without an unavailable or stale annotation. Services, browser contexts, and server were closed afterward. The existing database and saved location were not changed.
- `git diff --check`: passed.

## Remaining limitations

The requested two-spec browser run is not entirely green because of the three baseline failures above. Verification used installed build 1248 rather than Playwright's expected build 1243; installing that exact browser with `npx playwright install chromium` remains an operator action if exact-version verification is required.

The original browser profile was not inspected and the deployed process was not restarted. Live end-to-end verification used the same container runtime and selected coordinates with isolated application state. Restart or redeploy the updated server to activate the transport for the running installation; Global startup retrieval refreshes immediately, while Local retrieval starts on demand.
