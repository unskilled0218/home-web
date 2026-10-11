# Task 24: Keep Forecast Text Unbroken without Scrolling

## Objective

Prevent text inside each hourly and daily forecast item from breaking across lines, while removing forecast scroll regions and allowing the forecast cards themselves to reflow within the available dashboard width.

## Request and Interpretation

- Current request from `~/workdir/command.md`: “no line break and no scroll for hourly/daily weather”.
- User clarification: “no line break” applies to text inside `.forecast-item`, not to the hourly or daily list as a whole.
- Apply non-wrapping behavior to each forecast item's label, temperature, and condition text. Preserve the existing vertical stack between those separate fields; each field stays on one line but the card does not become one long inline sentence.
- Remove horizontal and vertical scrolling from the hourly and daily forecast lists. Let forecast cards wrap/reflow into additional rows when the available width cannot contain every card at a readable size.
- Preserve the user's latest dashboard layout changes from commit `4a4cbd1`, including calendar-first ordering, hidden weather headings/attribution, compact current conditions, always-visible forecast lists, and stacked forecast-card content.
- Keep forecast data, hourly sampling, daily range, weather icons, settings, provider requests, refresh behavior, and fullscreen behavior unchanged.

## Inspected Context

- `public/dashboard.html` places sibling `<ul id="hourly">` and `<ul id="daily">` elements directly inside `#forecast-details`; visible headings and the former `<details>` disclosure were removed by the latest UI-preference commit.
- `public/dashboard.js` builds both forecast types with `forecastItem()`. Each item contains an icon, label, temperature, and condition, and hourly rendering is capped at eight sampled entries while daily rendering contains seven normalized days.
- `public/dashboard.css` currently gives both lists a non-wrapping flex row, fixed-width `8em` cards, and `overflow-x: auto`. This creates horizontal scrolling instead of letting cards reflow.
- `.forecast-item` uses `flex-direction: column`, intentionally placing icon, label, temperature, and condition on separate rows within the card. The user clarification requires protecting each text field from internal wrapping, not flattening this structure.
- `#information` is limited to `55rem` and supports configurable overall/weather scales from 0.5 through 2. The mobile breakpoint currently has no forecast-specific layout rules.
- Empty forecast states are inserted as a single plain `<li>`, so list-layout changes must keep those messages readable and avoid styling them as narrow cards.
- `test/dashboard.test.js` statically verifies transparent cards and icon styling but does not assert text `white-space`, list wrapping, scrolling removal, empty states, or narrow-screen behavior.
- The project is version `0.15.0`, uses native CSS/JavaScript without a build step, and verifies browser assets through `node:test` plus `npm run check`.

## Product and Layout Decisions

- Keep hourly and daily as separate semantic lists in their current order. Add `aria-label="Hourly forecast"` and `aria-label="Daily forecast"` because visible headings no longer identify them.
- Keep each `.forecast-item` as a centered vertical stack. Apply `white-space: nowrap` to `.forecast-label`, `.forecast-temperature`, and `.forecast-condition` so text within each field never breaks onto a second line.
- Remove `overflow-x: auto` and do not introduce `overflow-y`, custom wheel handling, pagination, or carousel controls.
- Allow list items to wrap as complete cards by enabling flex wrapping. A forecast card moves intact to the next row when needed; its internal text remains unbroken.
- Retain a practical card basis/minimum width near the current `8em` presentation so text is not made unreadably narrow merely to force every card into one row.
- Bound long localized labels, temperatures/units, and condition descriptions with `max-width`, `overflow: hidden`, and `text-overflow: ellipsis`. Ellipsis is preferable to internal text wrapping, list scrolling, or page-width overflow.
- Use responsive gaps, card sizing, and icon sizing so desktop layouts use the available width efficiently and narrow screens reflow cards cleanly.
- Let a single unavailable-message item span the full list width and render without ellipsis where practical.
- Preserve transparent backgrounds and the current image-overlay visual language. Do not reintroduce headings, attribution, card fills, or the old disclosure UI.

## Implementation Plan

### 1. Clarify forecast list semantics

- Update `public/dashboard.html` to add explicit accessible labels to the hourly and daily `<ul>` elements while preserving their IDs, sibling order, and always-visible container.
- Keep `#forecast-details` hidden as a unit when no forecast exists and avoid restoring removed visible copy.

### 2. Remove scrolling and let complete cards reflow

- Update `#hourly` and `#daily` in `public/dashboard.css` to use `display: flex`, `flex-wrap: wrap`, bounded gaps/padding, and `max-width: 100%`.
- Remove `overflow-x: auto` and avoid creating overflow regions on either axis. The lists should expand vertically as cards wrap rather than scroll internally.
- Retain a bounded card basis close to the current width, but allow cards to grow and shrink enough to distribute leftover row space cleanly.
- Add `min-width: 0` and width containment where needed so intrinsic text width cannot widen the list or dashboard.
- Add an `:only-child` rule for “Hourly forecast unavailable.” and “Daily forecast unavailable.” so those messages occupy the full row instead of one card-width slot.
- Keep chronological order unchanged as cards wrap from left to right and then top to bottom, including when the information panel is right aligned.

### 3. Prevent line breaks inside forecast text

- Keep `.forecast-item` as a vertical column and retain centered alignment.
- Apply `white-space: nowrap`, `max-width: 100%`, `overflow: hidden`, and `text-overflow: ellipsis` to `.forecast-label`, `.forecast-temperature`, and `.forecast-condition`.
- Keep icon dimensions bounded and non-shrinking, with responsive `clamp()` sizing where needed. Preserve the existing icon filter and transparent card background.
- Add focused mobile rules for card basis, gap, padding, icon size, and secondary condition size while preserving no-wrap text and no-scroll lists.
- Verify long weekday/month names, AM/PM labels, negative temperatures, wide units, and long descriptions truncate within their own field rather than wrapping or affecting neighboring cards.

### 4. Preserve rendering and empty states

- Keep `forecastItem()` and its safe `textContent` construction unchanged unless a minimal class/attribute addition is required for styling.
- Preserve all eight sampled hourly records and seven daily records; do not reduce data to avoid scrollbars.
- Ensure empty, loading, stale, and unavailable weather states do not create empty scroll containers or narrow clipped messages.
- Confirm current conditions and air-quality layout are unaffected by forecast-only selectors.

### 5. Add regression coverage

- Extend `test/dashboard.test.js` to require accessible labels on the hourly and daily lists.
- Assert forecast lists use wrapping layout and no longer contain `overflow-x: auto` or any vertical scroll declaration.
- Assert forecast label, temperature, and condition selectors use `white-space: nowrap` plus bounded ellipsis behavior.
- Assert `.forecast-item` remains a vertical stack so the clarification is not mistakenly implemented as one inline row.
- Assert the `:only-child` empty-state treatment and responsive forecast sizing are present.
- Retain existing assertions for transparent cards, local icons, safe text insertion, item ordering, and hourly day/night icon selection.

### 6. Documentation, version, and implementation record

- Update the README weather description only if needed to mention that forecast cards reflow without list scrolling and their text remains single-line.
- Bump `package.json` from `0.15.0` to `0.15.1` for the focused user-visible layout fix.
- Write `tasks/24-no-scroll-weather-forecast/3-implemented.md` before the implementation commit with final CSS choices, changed files, verification evidence, browser availability, and any departures from this clarified plan.

## Verification

Run from the repository root:

```bash
node --test test/dashboard.test.js
npm test
npm run check
git diff --check
```

Also verify manually in a browser when available:

1. Load `/dashboard` with all eight hourly and seven daily records; confirm neither forecast list has horizontal or vertical scrolling.
2. Resize from desktop to narrow mobile widths and confirm complete cards reflow onto additional rows while each label, temperature, and condition remains on one line.
3. Check left/right information positions, weather scales 0.5 and 2, overall scales 0.5 and 2, and 12/24-hour labels for page-width overflow or overlap.
4. Test long weekday/month names, AM/PM labels, negative temperatures, wide units, and long condition descriptions; confirm ellipsis occurs inside the relevant field without line breaks.
5. Confirm all hourly and daily records remain visible in chronological left-to-right/top-to-bottom order after wrapping.
6. Confirm unavailable messages use the full list width and remain readable.
7. Confirm current conditions, air quality, clock, calendar, photo slideshow, fullscreen-hidden controls, and settings behavior are unchanged.

## Acceptance Criteria

- Text inside every forecast label, temperature, and condition remains on one line; long values ellipsize instead of wrapping.
- Hourly and daily lists have no horizontal or vertical scrolling and expose no scrollbar or custom scroll controls.
- Forecast cards may wrap as whole units to additional rows, preserving chronological order and readable card widths.
- Every existing sampled hourly and daily record remains rendered; no data is removed to fit the layout.
- `.forecast-item` retains its icon-and-text vertical stack, and empty forecast messages remain readable across the available width.
- Existing weather data, icons, refresh/error states, current conditions, and non-weather dashboard behavior remain unchanged.
- Focused and full automated checks pass, version `0.15.1` is recorded, and browser-only verification is reported accurately.

## Planning Verification

- Applied the user's clarification that “no line break” refers specifically to text inside `.forecast-item`, not to list wrapping or placing every card on one row.
- Reinspected the current fixed-width horizontal-scroll implementation, card structure, item counts, scaling settings, mobile breakpoint, relevant tests, package version, and latest UI-preference commit.
- This revision changes only `tasks/24-no-scroll-weather-forecast/1-plan.md`; implementation code remains unchanged.
