# Task 24: Fit Weather Forecast Rows without Scrolling

## Objective

Keep every hourly forecast card on one horizontal row and every daily forecast card on a second horizontal row, fitting both rows within the dashboard's available width without wrapping or scrollbars.

## Request and Interpretation

- Updated request from `~/workdir/command.md`: “no line break and no scroll for hourly/daily weather”.
- Interpret “no line break” as preventing the hourly cards from wrapping onto another row and preventing the daily cards from wrapping onto another row. Hourly and daily remain separate semantic lists.
- Interpret “no scroll” as showing each complete forecast row within its available width without horizontal or vertical overflow regions, scrollbars, wheel interception, or drag controls.
- Preserve the user's latest dashboard layout changes from commit `4a4cbd1`, including calendar-first ordering, hidden weather headings/attribution, compact current conditions, always-visible forecast lists, and the existing stacked content inside each forecast card.
- Keep forecast data, hourly sampling, daily range, weather icons, settings, provider requests, refresh behavior, and fullscreen behavior unchanged.

## Inspected Context

- `public/dashboard.html` places sibling `<ul id="hourly">` and `<ul id="daily">` elements directly inside `#forecast-details`; visible headings and the former `<details>` disclosure were removed by the latest UI-preference commit.
- `public/dashboard.js` builds both forecast types with the same `forecastItem()` function. Each item contains an icon, label, temperature, and condition, and hourly rendering is capped at eight sampled entries while daily rendering contains seven normalized days.
- `public/dashboard.css` already keeps each list on one flex line because flex wrapping defaults to `nowrap`, but every card has a fixed `8em` basis and the lists use `overflow-x: auto`. The fixed basis forces scrolling when all cards cannot fit.
- `.forecast-item` intentionally stacks icon and text vertically. The corrected request does not require flattening each card's contents into one text line; changing that would make eight hourly cards substantially harder to fit at narrow widths.
- `#information` is limited to `55rem` and supports configurable overall/weather scales from 0.5 through 2. The mobile breakpoint currently has no forecast-specific sizing rules.
- Empty forecast states are inserted as a single plain `<li>`, so any equal-width card layout must allow a lone message to span the full row.
- `test/dashboard.test.js` statically verifies transparent cards and icon styling but does not assert no-wrap flex behavior, flexible card widths, overflow removal, or narrow-screen sizing.
- The project is version `0.15.0`, uses native CSS/JavaScript without a build step, and verifies browser assets through `node:test` plus `npm run check`.

## Product and Layout Decisions

- Keep hourly and daily as two separate list rows in their existing order. Do not combine all 15 entries into one row or reintroduce visible headings.
- Add `aria-label="Hourly forecast"` and `aria-label="Daily forecast"` because the latest layout removed the headings that previously identified each list.
- Keep both lists as non-wrapping flex rows. Replace each card's fixed width with `flex: 1 1 0` and `min-width: 0` so all entries share the available width and shrink together.
- Remove scrolling from both axes. The lists should fit their own content box and clip only unavoidable text overflow; they must not become scroll containers.
- Retain the existing icon/label/temperature/condition stack within each card. Use responsive gaps, padding, icon dimensions, and font sizes so the forecast remains legible at normal dashboard widths.
- Apply `white-space: nowrap`, bounded width, and ellipsis to textual fields that can exceed their share. Prefer clipping a long condition or localized label over wrapping a card, widening the page, or adding a scrollbar.
- Keep one-item empty states readable by allowing `li:only-child` to use the full row rather than one eighth or one seventh of it.
- Preserve transparent backgrounds and the current image-overlay visual language. Do not add card fills, pagination, arrows, scroll controls, wheel handlers, hidden forecast entries, or viewport-dependent JavaScript sampling.
- At narrow widths and high scale settings, continue showing every returned forecast item. Responsive compression and ellipsis are preferable to wrapping, scrolling, or silently reducing the existing eight-hour/seven-day datasets.

## Implementation Plan

### 1. Clarify forecast list semantics

- Update `public/dashboard.html` to give the hourly and daily `<ul>` elements explicit accessible labels while preserving their IDs, sibling order, and always-visible container.
- Keep `#forecast-details` hidden as a unit when no forecast exists and avoid reintroducing the removed disclosure, headings, location title, or attribution.

### 2. Fit each complete forecast list into one row

- Update `#hourly` and `#daily` in `public/dashboard.css` to explicitly use `display: flex`, `flex-wrap: nowrap`, `max-width: 100%`, and bounded gaps/padding.
- Remove `overflow-x: auto` and prohibit vertical overflow. Use non-scroll clipping only as a final containment guard so neither list exposes a scrollbar.
- Replace `flex: 0 0 8em` on forecast list items with an equal flexible basis and `min-width: 0`, allowing eight hourly or seven daily cards to divide the row width evenly.
- Keep `.forecast-item` as a vertical stack, but ensure every child can shrink within the card. Apply non-wrapping ellipsis to label, temperature, and condition text and prevent the icon from forcing a minimum card width.
- Use responsive `clamp()` sizing for forecast icons, text, card padding, and gaps. Preserve the current icon artwork/filter while allowing smaller dimensions on narrow screens.
- Add an `:only-child` rule for unavailable messages so a single item spans the complete list width and remains readable.
- Keep forecast rows left-to-right in both left- and right-position modes; do not reverse item chronology when the information panel is right aligned.

### 3. Handle responsive and scaling constraints

- Add focused mobile rules that reduce gaps, padding, icon dimensions, and secondary condition text size without changing the single-row/no-scroll contract.
- Verify weather scale and overall scale settings do not reintroduce page-width overflow. Constrain forecast list width relative to the scaled information panel rather than allowing intrinsic text width to expand it.
- Ensure long locale-formatted labels, negative temperatures, multi-character units, and long weather descriptions ellipsize independently instead of wrapping neighboring content.
- Preserve all eight sampled hourly records and seven daily records at every supported viewport; do not solve fitting by changing `sampleHours()` or slicing data in the renderer.

### 4. Add regression coverage

- Extend `test/dashboard.test.js` to require accessible labels on the hourly and daily lists.
- Assert explicit `flex-wrap: nowrap`, flexible zero-basis cards, `min-width: 0`, and absence of the old fixed `8em` basis.
- Assert that `overflow-x: auto` is removed and the forecast rows use non-scroll containment on both axes.
- Assert bounded non-wrapping/ellipsis behavior for forecast text and the full-width `:only-child` empty state.
- Assert responsive forecast sizing exists in the mobile media rule while retaining current transparent card and local icon assertions.
- Keep renderer tests unchanged unless a small class/attribute addition is required; weather data, order, icon day/night selection, and safe `textContent` insertion must remain stable.

### 5. Documentation, version, and implementation record

- Update the README weather description only if needed to state that all hourly and daily cards fit into fixed no-scroll rows; avoid expanding operational documentation for a CSS-only behavior.
- Bump `package.json` from `0.15.0` to `0.15.1` for the focused user-visible layout fix.
- Write `tasks/24-no-scroll-weather-forecast/3-implemented.md` before the implementation commit with final CSS choices, changed files, verification evidence, browser availability, and any departures from this revised plan.

## Verification

Run from the repository root:

```bash
node --test test/dashboard.test.js
npm test
npm run check
git diff --check
```

Also verify manually in a browser when available:

1. Load `/dashboard` with all eight hourly and seven daily records; confirm each list uses exactly one row and neither list nor the page gains a forecast-related scrollbar.
2. Confirm all cards remain present and chronologically ordered, with no hidden records, wrapping, pagination, or scroll controls.
3. Check desktop and narrow mobile widths, left/right information positions, weather scales 0.5 and 2, overall scales 0.5 and 2, and 12/24-hour labels for overflow or overlap.
4. Test long weekday/month names, AM/PM labels, negative temperatures, wide units, and long condition descriptions; confirm text ellipsizes within its own card instead of wrapping or widening the row.
5. Confirm hourly and daily unavailable messages span the available row width and remain readable.
6. Confirm current conditions, air quality, clock, calendar, photo slideshow, fullscreen-hidden controls, and settings behavior are unchanged.

## Acceptance Criteria

- All hourly forecast cards remain on one horizontal row and all daily forecast cards remain on one separate horizontal row.
- Both complete forecast lists fit within the dashboard information panel without horizontal or vertical scrolling.
- Every existing sampled hourly and daily record remains rendered in chronological order; fitting does not remove data.
- Forecast cards shrink evenly, their internal text does not wrap, and unavoidable long text ellipsizes without widening the page.
- Empty forecast messages use the full row, and hourly/daily lists remain semantically distinguishable without visible headings.
- Existing weather data, icon, refresh/error, current-condition, and non-weather dashboard behavior remains unchanged.
- Focused and full automated checks pass, version `0.15.1` is recorded, and browser-only verification is reported accurately.

## Planning Verification

- Reread the corrected request, which now explicitly says “no scroll”, and removed the previous vertical-scrolling interpretation.
- Reinspected the current fixed-width horizontal list implementation, forecast item structure, item counts, scaling settings, mobile breakpoint, relevant tests, package version, and latest UI-preference commit.
- Renamed the task directory to match the corrected no-scroll scope. This planning update changes only Task 24's `1-plan.md`; implementation code remains unchanged.
