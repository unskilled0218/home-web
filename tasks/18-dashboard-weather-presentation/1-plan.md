# Task 18: Refine Dashboard Weather Presentation

## Objective

Make the `/dashboard` weather section background transparent and add a local weather icon for the current Open-Meteo condition, while preserving readability, accessibility, responsive behavior, and existing weather failure states.

## Request and Scope

- Request from `~/workdir/command.md`: under the dashboard weather area, make the background transparent and add a weather icon.
- Interpret “background transparent” as removing the translucent rounded panel behind the top-level `#weather` section. Keep the existing photo canvas, text shadow, and forecast-item surfaces so information remains readable over varied photos.
- Interpret “weather icon” as the prominent current-condition icon shown beside current temperature in the sibling `dash-board` reference. Do not add an icon to every hourly or daily row in this focused change.
- Keep weather data acquisition, cache/refresh ownership, settings, units, textual condition labels, and stale/error handling unchanged.

## Inspected Context

- `public/dashboard.css` currently gives `#weather` `background: #08101bcc`, padding, and a border radius; the overall information overlay already applies a dark text shadow.
- `public/dashboard.js` renders current temperature, a text description from the WMO code/day flag, wind, humidity, and precipitation into `#current-weather` using text-only DOM construction.
- `public/dashboard-helpers.js` already classifies Open-Meteo WMO codes into clear, cloud, fog, drizzle, rain, snow, thunderstorm, and unknown text, including day/night handling for clear conditions.
- `public/dashboard-weather.js` already requests and validates current `weather_code` and `is_day`, so no provider query or response-shape change is required.
- The reference uses local SVG weather assets for the current condition. Those files have no license metadata in the inspected checkout, so they should not be copied into this project.
- `test/dashboard.test.js` covers route delivery, settings, weather normalization, and controller behavior, but currently has no icon-mapping or weather-presentation assertions.

## Implementation Plan

### 1. Add a bounded weather-icon mapping

- Add a pure helper beside `weatherDescription()` in `public/dashboard-helpers.js` that maps finite Open-Meteo WMO weather codes to a small allowlisted icon key.
- Cover clear, partly cloudy, cloudy, fog, drizzle, rain/showers, snow/freezing precipitation, and thunderstorm families using the same WMO group boundaries as the text description.
- Distinguish day and night for clear and partly cloudy conditions using normalized `is_day`; use one shared icon for condition families where a day/night variant adds no value.
- Return an explicit unknown/fallback key for null, malformed, or unsupported codes. Never derive a file path or fragment identifier directly from provider data.
- Keep the existing textual description visible so meaning does not depend on icon recognition alone.

### 2. Add project-owned local icon artwork

- Add one locally authored SVG sprite under `public/` containing only the finite symbols referenced by the helper. Use simple vector geometry, `currentColor`, a shared view box, and no scripts, external resources, text, animation, or copied reference paths.
- Use one sprite rather than multiple files to keep static delivery and maintenance small. Reference symbols only by allowlisted fragment IDs produced by the helper.
- Confirm the existing `.svg` MIME mapping serves the asset correctly and add it to the dashboard route/asset regression coverage.
- Do not add a package, CDN dependency, remote icon request, or runtime dependency on `~/workdir/dash-board`.

### 3. Render an accessible current-condition icon

- Add a stable current-condition icon container in `public/dashboard.html` or create it through safe DOM APIs in `public/dashboard.js`.
- During successful forecast rendering, create/update an SVG `<use>` reference from the bounded icon key and place it with the primary temperature/condition content.
- Give the SVG an accessible name based on the existing bounded condition description, or mark it decorative when adjacent visible text would otherwise produce redundant output. Preserve the visible description in either case.
- Clear or hide the icon whenever there is no current forecast, including initial no-location and unavailable states, so an icon cannot remain from stale data after a location reset.
- Continue using DOM text properties and element creation; do not introduce raw provider HTML or dynamic unbounded URL construction.

### 4. Make the weather section transparent

- Change `#weather` to an explicitly transparent background and remove panel-only border radius/padding that would leave an invisible card footprint. Retain deliberate spacing between clock, weather content, and photo caption.
- Rebalance current-condition alignment so the icon and temperature form a clear primary row and wind/humidity/precipitation remain readable metadata for both left- and right-aligned layouts.
- Size the icon responsively with `em`/`clamp`, preserve `currentColor` contrast, and prevent it from shrinking or overflowing at high user scale or narrow viewport widths.
- Keep text shadow or a similarly minimal local readability treatment. Do not add a replacement opaque/blurred weather wrapper that contradicts the transparent-background request.
- Preserve the existing styled forecast list items inside the expandable details section; they are individual data cells rather than the removed weather panel background.

### 5. Test and verify

- Add table-driven helper tests for every supported WMO family, clear/partly-cloudy day/night variants, boundary codes, and malformed/unknown fallback behavior.
- Extend the dashboard route/static tests to fetch the SVG sprite, verify its SVG content type, and assert only expected local symbols/assets are referenced by the dashboard implementation.
- Add static presentation assertions that the weather section remains present, the current icon hook exists, and its top-level background is transparent rather than the previous translucent color.
- Keep existing weather normalization, partial-failure, stale-data, request-race, and route-containment tests passing without changing provider calls.
- Run `npm test`, `npm run check`, and `git diff --check`.
- Manually verify configured/no-location/loading/error/stale states; clear/partly-cloudy day and night; rain, snow, fog, and thunderstorm icons; left/right alignment; mobile width; high scale; photo backgrounds; reduced motion; keyboard/screen-reader output; and direct `/dashboard` and `/dashboard/` loads. Record unavailable browser checks explicitly.

### 6. Documentation and release record

- Update the README photo-dashboard section to mention local current-condition artwork and the intentionally transparent weather presentation where useful; keep provider attribution unchanged.
- Bump `package.json` from `0.12.0` to `0.12.1` because this is a backward-compatible presentation enhancement with no new API or settings.
- Write `tasks/18-dashboard-weather-presentation/3-implemented.md` with actual changes, verification evidence, icon-authoring/source details, and any departures from this plan.

## Acceptance Criteria

- The `/dashboard` weather content no longer has the translucent card background or an equivalent replacement panel.
- A recognizable local icon accompanies current weather whenever a valid forecast is displayed, including appropriate clear/partly-cloudy day and night variants.
- Unknown/malformed weather codes use a stable fallback without exposing provider data as a URL, path, fragment, or HTML.
- Visible text still describes the condition, and assistive technology does not receive an unexplained or needlessly duplicated icon announcement.
- The icon disappears with cleared/unavailable forecast data and cannot remain from a previously selected location.
- Weather controls, provider requests, units, refresh behavior, stale/partial failures, forecast lists, and existing dashboard features remain unchanged.
- Desktop and narrow-screen layouts remain readable over both dark and light photos.

## Planning Verification

- Inspected the current dashboard weather markup, rendering, WMO text mapping, styles, tests, and sibling reference icon usage.
- Confirmed the reference checkout has weather SVG files but no discovered license metadata; this plan explicitly calls for newly authored local artwork instead of copying those paths.
- This task adds only `tasks/18-dashboard-weather-presentation/1-plan.md`; no implementation code is modified during planning.
