# Task 19: Reference Weather Icons Implementation

## Result

Replaced task 18's custom weather sprite with the explicitly requested SVG assets from `~/workdir/dash-board/public/weather-icons`. Current weather now uses locally served individual reference files while retaining the transparent layout, visible condition text, bounded mapping, and existing provider behavior. Updated the project from `0.12.1` to `0.12.2`.

## Source Assets

- Copied the following files byte-for-byte from the sibling directory:
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
- The assets were introduced in sibling commit `417e91a`. No icon-specific license metadata was present in that checkout; this implementation records provenance without adding a license claim.
- `cmp` succeeded for every target/source pair after copying, confirming exact byte equality. Per-file SHA-256 hashes were also generated during verification.
- Deliberately excluded sibling `snowflake.svg`, which has no current-condition mapping.
- Removed task 18's `public/weather-icons.svg` sprite and added a historical note to its implementation record pointing to this replacement.

## Mapping and Rendering

- Replaced `weatherIconKey()` with `weatherIconFile()`, which returns only fixed allowlisted filenames.
- Added separate reference assets for clear and partly-cloudy day/night states, light/moderate versus heavy rain, freezing precipitation, snow, and plain versus rainy thunderstorms.
- Unsupported, malformed, string, null, `NaN`, and infinite codes use the fixed `weather-cloudy.svg` fallback and cannot affect the directory or filename.
- Replaced the decorative inline `<svg><use>` hook with a decorative `<img alt="" aria-hidden="true">`.
- Rendering hides the image and removes `src` before every state update, then uses `/weather-icons/` plus the allowlisted helper result only when current forecast data exists.
- Kept visible condition text as the accessible meaning and retained the transparent weather section, responsive dimensions, nonshrinking layout, and reference-style white inversion/drop shadow.

## Tests and Documentation

- Updated table-driven coverage for every icon family, day/night variants, light/heavy precipitation boundaries, thunderstorm variants, and malformed fallbacks.
- Added exact directory allowlist checks and route/MIME/safe-structure checks for all 12 SVGs.
- Verified the old sprite and unused snowflake return 404, the icon uses a decorative image hook, paths are constructed only from the helper, stale `src` is cleared, no raw HTML is used, and the section remains transparent.
- Corrected README wording to identify the locally bundled sibling artwork and retained existing provider attribution.

## Verification

- `node --test test/dashboard.test.js`: passed, 12 tests.
- `npm test`: passed, 75 tests with no failures or skips.
- `npm run check`: passed.
- `git diff --check`: passed.
- Source-to-target `cmp` loop: passed for all 12 copied SVG files.
- No Chromium, Chrome, or Firefox executable is installed. Interactive checks for actual image rendering, each condition family, left/right and narrow/high-scale layouts, varied photo contrast, and keyboard/screen-reader behavior remain unavailable; mapping, asset delivery, safe rendering structure, and regressions are covered automatically.

## Plan Departures

- None.
