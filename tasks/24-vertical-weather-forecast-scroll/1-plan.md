# Task 24: Use One-Line Vertical Weather Forecast Lists

## Objective

Change the dashboard's hourly and daily forecasts from horizontally scrolling columns of stacked cards into compact one-line entries inside bounded vertically scrolling lists.

## Request and Interpretation

- Request from `~/workdir/command.md`: “no line break and vertical scroll for hourly/daily weather”.
- Interpret “no line break” as keeping each forecast entry's time/date, icon, temperature, and condition on one visual row without wrapping.
- Interpret “vertical scroll” as making the hourly and daily lists use native `overflow-y` scrolling within a bounded height, rather than translating wheel input into horizontal movement.
- Preserve the user's latest dashboard layout changes from commit `4a4cbd1`, including calendar-first ordering, hidden weather headings/attribution, compact current conditions, and always-visible forecast lists.
- Keep forecast data, sampling, weather icons, settings, provider requests, refresh behavior, and fullscreen behavior unchanged.

## Inspected Context

- `public/dashboard.html` places sibling `<ul id="hourly">` and `<ul id="daily">` elements directly inside `#forecast-details`; the former visible headings and `<details>` disclosure were removed by the latest UI-preference commit.
- `public/dashboard.js` builds both forecast types with the same `forecastItem()` function. Each item contains an icon followed by label, temperature, and condition nodes, so the requested layout can be achieved without changing forecast data or DOM construction.
- `public/dashboard.css` currently gives both lists `display: flex`, fixed-width `8em` cards, and `overflow-x: auto`. `.forecast-item` uses `flex-direction: column`, which creates the current internal line breaks.
- Hourly rendering remains capped at eight sampled entries through `sampleHours()`, while daily rendering produces the provider's seven normalized days. Empty-state list items must remain readable under the new layout.
- `#information` is limited to `55rem` and scales with the dashboard's overall and weather scale settings. The mobile media query currently has no forecast-specific rules.
- `test/dashboard.test.js` statically verifies transparent forecast cards and icon styling but does not assert scroll direction, wrapping, bounded height, list labeling, or narrow-screen behavior.
- The project is version `0.15.0`, uses native CSS/JavaScript without a build step, and verifies browser assets through `node:test` plus `npm run check`.

## Product and Layout Decisions

- Keep hourly and daily forecasts as two separate semantic lists so their data types remain distinguishable and can be styled independently if needed.
- Add non-visual accessible names such as `aria-label="Hourly forecast"` and `aria-label="Daily forecast"` because the latest layout removed visible headings.
- Lay out `#forecast-details` as two responsive forecast panes. Use two columns when sufficient width exists and collapse to one column on narrow screens so neither list becomes unusably compressed.
- Render each `.forecast-item` as a horizontal row with fixed icon sizing and text fields that use `white-space: nowrap`. Do not allow cards or their contents to wrap onto another line.
- Remove the fixed `8em` horizontal card basis. Let entries fill the available list width while keeping text aligned and allowing the condition field to consume remaining space.
- Give each list a bounded responsive `max-height` and `overflow-y: auto`; hide horizontal overflow. Use native scrolling rather than wheel listeners so mouse, touch, trackpad, and keyboard behavior follow browser conventions and do not trap page scrolling at list boundaries.
- Reserve scrollbar space where supported to avoid layout shifts, retain visible focus outlines, and ensure a focused list can be scrolled by keyboard. Add `tabindex="0"` only if manual browser verification shows that the target browsers do not make the overflow region keyboard-scrollable naturally.
- Keep empty-state messages as normal one-line list rows. If an unusually long localized condition cannot fit, clip or ellipsize only the flexible condition text rather than wrapping or widening the dashboard.
- Preserve transparent backgrounds and the existing image-overlay visual language; do not reintroduce card fills, forecast headings, provider attribution, or the old disclosure UI as part of this task.

## Implementation Plan

### 1. Clarify forecast list semantics

- Update `public/dashboard.html` to give the hourly and daily lists explicit accessible labels while retaining their current IDs and sibling placement.
- Keep `#forecast-details` as a non-disclosure container and avoid reintroducing removed visible copy.
- Confirm `hidden` behavior still applies to the whole forecast container when no forecast is available.

### 2. Convert forecast presentation to vertical scrolling

- Update `#forecast-details` in `public/dashboard.css` to use a responsive grid with bounded child widths and a gap between hourly and daily panes.
- Change `#hourly` and `#daily` from horizontal flex tracks to vertical lists with zero/minimal outer margins, a responsive maximum height, `overflow-y: auto`, `overflow-x: hidden`, and stable scrollbar layout where supported.
- Change `.forecast-item` from a centered column to a single horizontal row. Explicitly disable wrapping and align the icon, label, temperature, and condition on a shared baseline/center line.
- Remove the fixed card width and use a small grid or flex allocation so labels and temperatures remain stable while condition text takes the remaining width and safely ellipsizes.
- Keep icon dimensions bounded and non-shrinking. Preserve the existing white/drop-shadow treatment and transparent item backgrounds.
- Add a narrow-screen media rule that stacks the two forecast lists into one column while retaining their individual vertical scrolling regions and one-line entries.
- Verify right-aligned information mode does not reverse item order or make text alignment inconsistent; forecast rows should remain left-to-right for scanability, matching the current explicit `text-align: left` list styling.

### 3. Preserve rendering and empty states

- Keep `forecastItem()` and its text-safe DOM construction unless a minimal class assignment is needed for grid/flex sizing; do not alter weather data formatting or icon selection.
- Ensure hourly labels containing weekday, time, and meridiem and daily labels containing weekday/month/day remain single-line under supported scales.
- Ensure “Hourly forecast unavailable.” and “Daily forecast unavailable.” remain visible and do not inherit an unusable multi-column item layout.
- Confirm weather scale settings from 0.5 through 2 do not make the forecast panes overlap the clock, calendar, viewport edges, or each other.

### 4. Add regression coverage

- Extend `test/dashboard.test.js` static asset assertions to require accessible labels on both lists.
- Assert that forecast lists use vertical overflow, hide horizontal overflow, and no longer use `overflow-x: auto` or fixed horizontal card bases.
- Assert that forecast items use a horizontal non-wrapping layout and that flexible condition text has bounded overflow behavior.
- Assert the responsive media rule collapses forecast panes to one column on narrow screens.
- Retain existing assertions for transparent forecast backgrounds, local weather icons, safe text insertion, and hourly day/night icon selection.

### 5. Documentation, version, and implementation record

- Update the README photo-dashboard weather description only if it describes the forecast interaction; note that hourly and daily forecasts are vertically scrollable one-line lists without expanding the operational documentation unnecessarily.
- Bump `package.json` from `0.15.0` to `0.15.1` for the user-visible presentation fix, following the project's patch-version convention for focused UI changes.
- Write `tasks/24-vertical-weather-forecast-scroll/3-implemented.md` before the implementation commit with changed files, final layout choices, automated verification, browser checks, and any departures from this plan.

## Verification

Run from the repository root:

```bash
node --test test/dashboard.test.js
npm test
npm run check
git diff --check
```

Also verify manually in a browser when available:

1. Load `/dashboard` with full hourly and daily forecasts and confirm every forecast entry remains on one line.
2. Confirm hourly and daily lists scroll vertically with mouse wheel, trackpad, touch, and keyboard without causing horizontal scrolling or trapping page scroll at either boundary.
3. Check desktop and narrow mobile widths, left/right information positions, weather scales 0.5 and 2, and overall scales 0.5 and 2 for clipping, overlap, or unexpected wrapping.
4. Confirm the two lists appear side by side when space permits and stack into one column at the mobile breakpoint.
5. Confirm empty, loading, stale, and unavailable forecast states remain readable and do not create empty scroll regions.
6. Confirm current conditions, air quality, clock, calendar, photo slideshow, fullscreen-hidden controls, and settings behavior are unchanged.

## Acceptance Criteria

- Hourly and daily forecast entries display icon, label, temperature, and condition on one visual line without wrapping.
- Each forecast list has a bounded height and scrolls vertically using native browser behavior; horizontal overflow is not used.
- Hourly and daily data remain semantically distinguishable despite having no visible headings.
- The two lists use available desktop width and stack responsively on narrow screens without overlap or page-width overflow.
- Existing weather data selection, formatting, icons, refresh/error behavior, and all non-weather dashboard features remain unchanged.
- Focused and full automated checks pass, version `0.15.1` is recorded, and browser-only verification is reported accurately.

## Planning Verification

- Inspected the latest task numbering, current weather markup, forecast item renderer, dashboard styles/mobile breakpoint, relevant tests, package version, and the user's latest UI-preference commit.
- Distinguished the requested vertical list scrolling from the current horizontal overflow implementation and avoided unnecessary JavaScript wheel interception.
- This planning task adds only `tasks/24-vertical-weather-forecast-scroll/1-plan.md`; implementation code remains unchanged.
