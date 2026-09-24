# Task 19: Use Reference Dashboard Weather Icons

## Objective

Replace the custom weather icon sprite on `/dashboard` with the corresponding SVG weather icons from `~/workdir/dash-board/public/weather-icons`, as explicitly requested, while preserving the transparent weather layout, safe bounded condition mapping, accessible visible text, and existing forecast behavior.

## Request and Scope

- Request from `~/workdir/command.md`: “User `~/workdir/dash-board/public/weather-icons` for weather icon”, interpreted as “Use `~/workdir/dash-board/public/weather-icons` for weather icons.”
- This request supersedes task 18’s decision not to copy the sibling artwork. Retain task 18’s transparent weather presentation and condition mapping safety, but replace its newly authored `public/weather-icons.svg` sprite.
- Use the sibling assets only for the current-condition icon. Hourly/daily forecast rows remain text-only.
- Do not change weather provider requests, normalization, refresh/cache behavior, settings, units, or condition text.

## Inspected Context

- Current branch `18-dashboard-weather-presentation` contains task 18 implementation at `f3c9319`; it has not been merged to `main`. The new task and eventual implementation therefore build directly on the transparent panel and icon work already present.
- `public/dashboard-helpers.js` currently returns internal keys for clear day/night, partly-cloudy day/night, cloud, fog, drizzle, sleet, rain, snow, thunderstorm, and unknown conditions.
- `public/dashboard.js` currently constructs an external `<use>` fragment into `public/weather-icons.svg`; the SVG hook is decorative because adjacent visible text names the condition.
- `public/weather-icons.svg` is original task 18 artwork and can be deleted once all rendering and tests use the requested files.
- The sibling directory contains 12 relevant `weather-*.svg` files plus `snowflake.svg`: sunny, night, partly-cloudy day/night, cloudy, fog, rainy, pouring, snowy-rainy, snowy, lightning, and lightning-rainy.
- The sibling UI uses those assets through `/weather-icons/<name>.svg` and applies `brightness(0) invert(1)` plus a drop shadow. The assets were added in sibling commit `417e91a`.
- No license file or icon-specific copyright/license metadata was found in the sibling checkout. Because the user explicitly directs reuse from their sibling project, record exact provenance and do not invent or imply a third-party license.

## Implementation Plan

### 1. Copy the requested source assets

- Add `public/weather-icons/` in this project and copy the 12 condition assets byte-for-byte from `~/workdir/dash-board/public/weather-icons/`:
  - `weather-sunny.svg`
  - `weather-night.svg`
  - `weather-partly-cloudy.svg`
  - `weather-night-partly-cloudy.svg`
  - `weather-cloudy.svg`
  - `weather-fog.svg`
  - `weather-rainy.svg`
  - `weather-pouring.svg`
  - `weather-snowy-rainy.svg`
  - `weather-snowy.svg`
  - `weather-lightning.svg`
  - `weather-lightning-rainy.svg`
- Do not copy `snowflake.svg`, because no current-condition mapping needs it.
- Preserve the source SVG bytes and path data rather than reformatting or modifying the artwork. Record the source directory and sibling commit provenance in `3-implemented.md`.
- Delete `public/weather-icons.svg` after rendering and tests no longer reference the custom sprite.

### 2. Map WMO codes to an allowlisted filename

- Replace or adapt `weatherIconKey()` so it returns one of the fixed copied filenames, never provider-derived text.
- Map conditions as follows:
  - code 0: `weather-sunny.svg` by day, `weather-night.svg` by night;
  - codes 1–2: `weather-partly-cloudy.svg` by day, `weather-night-partly-cloudy.svg` by night;
  - code 3 and unsupported/malformed values: `weather-cloudy.svg` as a stable fallback while visible text still says the actual/fallback description;
  - codes 45/48: `weather-fog.svg`;
  - drizzle and light/moderate rain/showers: `weather-rainy.svg`;
  - heavy rain/showers: `weather-pouring.svg`;
  - freezing drizzle/rain: `weather-snowy-rainy.svg`;
  - snowfall/snow grains/snow showers: `weather-snowy.svg`;
  - code 95: `weather-lightning.svg`;
  - codes 96/99: `weather-lightning-rainy.svg`.
- Keep day normalization strict and deterministic: only numeric `is_day === 0` selects night artwork; missing/malformed values use day artwork, matching current behavior.
- Preserve `weatherDescription()` and the visible textual labels independently of artwork selection.

### 3. Render the copied file safely

- Replace the inline `<svg><use>` hook in `public/dashboard.html` with a stable decorative `<img>` hook using `alt=""`, `aria-hidden="true"`, and the existing hidden initial state.
- In `renderWeather()`, clear the prior `src` and hide the image before handling the current state. For a forecast, set `src` to `/weather-icons/` plus the allowlisted helper result and reveal it.
- Never build the path from raw WMO values, use `innerHTML`, or accept provider-controlled asset names.
- Keep the visible condition text so weather meaning remains accessible without the image. Hide/clear the image for no-location, cleared, loading-without-data, and unavailable states so prior artwork cannot linger.

### 4. Match reference presentation without restoring a panel

- Keep `#weather` explicitly transparent with no replacement card background.
- Adapt `.weather-icon` from SVG/current-color styling to `<img>` styling using the sibling reference’s white inversion and drop shadow, while retaining task 18’s responsive dimensions, nonshrinking behavior, and mobile/high-scale bounds.
- Preserve left/right alignment, current-value wrapping, photo readability, reduced-motion behavior, and forecast-cell surfaces.

### 5. Update tests and verification

- Replace sprite-symbol assertions with route checks for every copied file, including `image/svg+xml`, expected `<svg>`/viewBox/path structure, and absence of scripts, external references, animation, and text nodes.
- Assert that only the 12 expected source filenames exist in the new weather icon directory and that `snowflake.svg` and the old `weather-icons.svg` are not served.
- Update table-driven mapping expectations for day/night, cloud/fog, light/heavy rain boundaries, freezing precipitation, snow, plain/rainy thunderstorm, and malformed fallback inputs.
- Update static rendering assertions for the decorative `<img>` hook, bounded `/weather-icons/` path construction, clearing/hiding behavior, no `innerHTML`, transparent top-level weather CSS, and reference-style image filter.
- Keep all existing route containment, weather controller, stale/partial failure, settings, photo, and dashboard regression tests passing.
- Compare copied files with their sibling sources during implementation using checksums or byte comparison; record the result without adding a runtime/test dependency on the sibling checkout.
- Run `npm test`, `npm run check`, and `git diff --check`.
- Manually verify each condition family, clear/partly-cloudy day and night, malformed fallback, no-location/loading/error transitions, light/heavy rain distinction, left/right layouts, high scale, narrow screens, dark/light photos, keyboard/screen-reader behavior, and `/dashboard` route variants. Record unavailable browser checks explicitly.

### 6. Documentation and release record

- Correct README wording that currently calls the artwork original/project-owned. State that icons are bundled locally from the sibling `dash-board` project and make no remote icon requests.
- Update the task 18 implementation record only where needed to preserve historical accuracy: task 18 did add original artwork, while task 19 subsequently replaces it. Do not rewrite task 18 as though it used reference files at implementation time.
- Bump `package.json` from `0.12.1` to `0.12.2` as a backward-compatible visual asset correction.
- Write `tasks/19-reference-weather-icons/3-implemented.md` with the copied file list, source provenance, mapping details, checksums/byte-comparison result, verification evidence, and any departures from this plan.

## Acceptance Criteria

- Current weather icons shown on `/dashboard` come from the copied files under `~/workdir/dash-board/public/weather-icons`, not task 18’s custom sprite.
- All copied files used by the page are served locally from `/weather-icons/`; no icon CDN or sibling runtime path is introduced.
- Day/night, light/heavy precipitation, snow/freezing precipitation, and thunderstorm variants resolve to fixed appropriate filenames.
- Unsupported or malformed provider codes resolve to the fixed cloudy fallback and cannot influence a URL/path.
- The icon is decorative beside visible condition text and is cleared whenever no current forecast is displayed.
- The weather section remains transparent and responsive, and all provider, settings, refresh, stale/error, and forecast-list behavior remains unchanged.
- Automated tests prove file delivery, exact mapping bounds, safe rendering references, old-sprite removal, and regression safety.

## Planning Verification

- Inspected the current task 18 sprite/helper/rendering/tests, the sibling weather icon directory and representative SVGs, sibling CSS/rendering, git provenance, and available license metadata.
- This task adds only `tasks/19-reference-weather-icons/1-plan.md`; implementation files are unchanged during planning.
