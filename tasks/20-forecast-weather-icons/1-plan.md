# Task 20: Show Icons in Hourly and Daily Forecasts

## Objective

Display the bundled reference weather icons in every rendered next-24-hours and seven-day forecast item on `/dashboard`, including correct hourly day/night variants, without changing forecast sampling, provider refresh behavior, or accessible condition text.

## Request and Scope

- Request from `~/workdir/command.md`: “Show weather icon for next 24 hours and 7 days.”
- Add icons to the existing sampled next-24-hours list and seven-day list inside the expandable forecast section.
- Continue showing the existing timestamp/date, temperature, and textual condition in every item. Icons supplement rather than replace text.
- Reuse only the 12 local SVG files introduced by task 19. Do not add, alter, duplicate, or remotely fetch artwork.
- Preserve the existing three-hour sampling behavior (up to eight hourly entries) and up-to-seven daily entries.

## Inspected Context

- Current branch `19-reference-weather-icons` includes task 18’s transparent weather presentation and task 19’s reference icon files; neither dependent task has been merged to `main` yet. Task 20 therefore builds directly on that branch history.
- `weatherIconFile()` in `public/dashboard-helpers.js` already returns a fixed allowlisted filename for WMO code/day inputs, including separate clear and partly-cloudy day/night assets and stable malformed-code fallback.
- `weatherUrls()` in `public/dashboard-weather.js` requests hourly `temperature_2m` and `weather_code`, but not hourly `is_day`. Current conditions already request `is_day`.
- `normalizeForecast()` retains hourly time, temperature, and code and daily date/min/max/code. It bounds source arrays to 192 hourly and seven daily values and tolerates missing weather codes through a null fallback.
- `renderWeather()` currently creates each forecast `<li>` as one text node using safe DOM text properties. Daily weather codes represent a day aggregate; they do not need a night variant.
- The existing forecast lists are horizontal scrolling flex rows. Each item has a fixed minimum width and opaque cell background inside the otherwise transparent weather section.
- Tests already verify the icon asset allowlist/routes, bounded WMO filename mapping, provider query construction, malformed forecast behavior, static safe rendering, and weather-controller races/failures.

## Implementation Plan

### 1. Request and normalize hourly day/night data

- Add `is_day` to the fixed Open-Meteo hourly field list in `weatherUrls()`. Keep endpoint, timezone, epoch format, units, forecast length, timeout, and all other query parameters unchanged.
- Extend each normalized hourly row with `day` based on the matching `hourly.is_day` entry:
  - retain numeric `0` as night and numeric `1` as day;
  - normalize missing, malformed, nonnumeric, or out-of-range values to null;
  - do not drop an otherwise valid time/temperature row solely because day/night data is unavailable.
- Leave weather codes nullable as today. `weatherIconFile(code, day)` will safely choose a cloudy fallback for a malformed code and the day variant when `day` is null.
- Keep `sampleHours()` and its next-24-hours/three-hour spacing semantics unchanged so adding icons does not alter which forecast periods appear.
- Continue normalizing daily records exactly as date, min, max, and code. Daily icons always use the day variant because Open-Meteo’s daily code summarizes the calendar day rather than a specific nighttime observation.

### 2. Render safe decorative icons in each forecast item

- Replace the single text-node construction for hourly and daily `<li>` elements with small DOM-built item structures containing:
  - a decorative `<img class="forecast-icon" alt="" aria-hidden="true">`;
  - a bounded local `src` formed only from `/weather-icons/` and `weatherIconFile()`;
  - separate text elements for time/date, temperature range, and existing condition description.
- Pass each hourly row’s normalized `day` value to `weatherIconFile()` and `weatherDescription()` so clear conditions say/show night when the provider marks that hour as night.
- Pass day mode to daily icon/description presentation and keep current daily labels and min-to-max temperature wording.
- Preserve empty-list fallback messages without an icon. Do not display a misleading icon when no hourly/daily entry exists.
- Continue using `textContent`/safe element creation only. Never insert raw provider HTML or use provider data directly in an asset path.

### 3. Style compact forecast icon cards

- Add a compact internal layout for hourly/daily list items: centered icon, readable time/date label, emphasized temperature, and condition text.
- Size `.forecast-icon` responsively below the current-condition icon, apply the same white inversion/drop shadow as `.weather-icon`, and set fixed flex behavior so it cannot collapse or distort.
- Keep horizontal scrolling, bounded card widths, transparent top-level weather section, existing forecast-cell background, left/right overlay behavior, and narrow-screen usability.
- Avoid animation and preserve reduced-motion behavior.

### 4. Expand tests

- Update provider-query tests to require hourly `is_day` exactly once alongside temperature and weather code.
- Expand forecast fixtures and normalization tests for aligned day/night arrays, missing `is_day`, malformed values, mismatched array lengths, and retention of otherwise valid hourly rows.
- Verify `sampleHours()` preserves the normalized day flag for selected rows across day/night transitions and remains bounded to the next 24 hours/up to eight samples.
- Extend static implementation checks to assert hourly and daily rendering use decorative local forecast images, call `weatherIconFile()` with hourly day/daily day inputs, preserve visible `weatherDescription()` output, and do not use `innerHTML` or provider-derived paths.
- Extend CSS assertions for forecast icon sizing/filtering and preservation of the transparent top-level weather section.
- Keep all task 19 asset directory/MIME/security tests and weather controller stale/partial/race tests passing without additional files or network requests.

### 5. Verification

- Run `node --test test/dashboard.test.js`, `npm test`, `npm run check`, and `git diff --check`.
- Confirm the existing 12 copied icons remain byte-identical to `~/workdir/dash-board/public/weather-icons`; this task must not modify artwork.
- Manually verify the hourly day-to-night transition, clear/partly-cloudy variants, rain/snow/thunderstorm/fallback conditions, all seven daily cards, missing/malformed hourly `is_day`, stale/partial provider states, empty forecasts, left/right layouts, narrow screens, high scale, varied photo contrast, keyboard access, and screen-reader output.
- Record interactive checks as unavailable if no browser executable remains installed.

### 6. Documentation and release record

- Update README weather documentation to state that local condition icons appear for current, next-24-hours, and seven-day forecasts.
- Bump `package.json` from `0.12.2` to `0.12.3` as a backward-compatible dashboard presentation enhancement.
- Write `tasks/20-forecast-weather-icons/3-implemented.md` with actual data-shape/rendering changes, verification evidence, artwork-integrity result, and any departures from this plan.

## Acceptance Criteria

- Every valid rendered next-24-hours sample includes the appropriate local weather icon, including clear/partly-cloudy night artwork when hourly `is_day` is 0.
- Every valid rendered seven-day entry includes the appropriate daytime local weather icon.
- Forecast icons use only allowlisted task 19 filenames and make no remote or provider-derived image requests.
- Each forecast item retains visible date/time, temperature, and condition text; decorative images do not create duplicate screen-reader announcements.
- Missing/malformed day flags or weather codes cannot remove otherwise valid forecast rows, escape the icon directory, or break rendering.
- Empty hourly/daily states continue to show their existing unavailable messages without icons.
- Sampling, provider refresh/caching, stale/error handling, settings, current conditions, transparent presentation, and other dashboard features remain unchanged.
- All copied SVG assets remain unchanged and the complete automated suite passes.

## Planning Verification

- Inspected the current provider query/normalizer, hourly sampling, forecast renderer, icon allowlist, forecast CSS, route/static tests, and task 19 asset provenance.
- Open-Meteo’s documented hourly variables include `is_day`, which is already used by this project for current conditions and can be requested for hourly periods without another endpoint.
- This task adds only `tasks/20-forecast-weather-icons/1-plan.md`; no implementation code is modified during planning.
