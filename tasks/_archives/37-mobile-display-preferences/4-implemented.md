# implemented

## Changes

Implemented task 37 on the new branch `37-mobile-display-preferences`. This record was created before implementation edits and completed after verification.

- Added six mobile visibility/scale preferences in `public/dashboard-helpers.js`, preserving the existing desktop fields and storage key. Missing mobile values default to all views visible at scale 1; scales use strict finite input handling, clamping to 0.5–2, and one-decimal rounding compatible with native 0.1-step validation. Loading defaults does not rewrite storage.
- Added `MOBILE_MEDIA_QUERY` and the pure `resolveDisplayPreferences` projection. Mobile uses independent visibility/scales, overall scale 1, and left alignment; saved desktop values remain intact.
- Added **Mobile display** controls to the existing Time, Weather, and Calendar Settings panels. Restricted **Desktop display** to visibility and scale, and placed common time options and weather units in **Shared format** and **Shared units**. All controls retain the existing preferences form, save action, hidden-panel validation, and tab draft behavior.
- Separated `applyPresentation` from full preference application in `public/dashboard.js`. A single media-query listener updates presentation without controller configuration, storage writes, photo reloads, or animation resets. The existing section nodes move into actual DOM order: time → weather → calendar at widths up to 600px and calendar → time → weather above it. The heading, caption, IDs, and rendered service content retain their identities.
- Made clock timer eligibility use the active display profile. Calendar refresh eligibility now uses either saved profile's visibility, so resizing does not toggle its controller or introduce extra event requests. Hiding calendar in both profiles pauses event retrieval while preserving connection controls. Weather location discovery and snapshot polling keep their existing independent behavior.
- Updated mobile CSS for top alignment, per-view font scaling, scale-aware clock sizing, full-width wrapping forecasts, readable long readings and calendar content, and normal vertical scrolling. Mobile sections use `flow-root` to contain paragraph/time margins so a hidden preceding view cannot leave an unintended top gap. Desktop presentation remains unchanged.
- Added four Node checks for mobile normalization, legacy defaults, independent projection, and Settings grouping. Added 17 Chromium scenarios covering populated mobile geometry at two widths and three scales, toggle isolation, reload persistence, fractional stored values, hidden-panel validation, shared settings, breakpoint/orientation transitions, draft preservation, clock/refresh ownership, and calendar eligibility.
- Updated `docs/dashboard.md` with mobile defaults, controls, scale normalization, shared settings, and refresh behavior. Bumped `package.json` and both root entries in `package-lock.json` from `0.17.6` to `0.17.7`, following the existing patch-version convention.

## Verification

- `node --test test/dashboard.test.js`: passed, all 31 focused dashboard checks.
- Focused Chromium verification for mobile views, preference saving, hidden-panel validation, projection changes, and request ownership passed. An initial toggle geometry check exposed collapsed child margins above the first visible section; `flow-root` containment fixed that gap before final verification.
- `npm run check`: passed.
- Separate `node --check` checks passed for `public/dashboard-helpers.js`, `public/dashboard.js`, `test/dashboard.test.js`, and `e2e/dashboard-home.spec.js`.
- `npm test`: passed, all 174 Node test entries, zero failures or skips. Existing weather, calendar, photo, persistence, and integration checks remain passing.
- `npm run test:browser`: passed, all 41 Chromium cases. The six populated-layout cases cover widths 320px and 390px at scales 0.5, 1, and 2, checking computed sizing, seven hourly/daily forecast items, readable long temperature ranges and calendar titles, nonoverlapping sections, and no horizontal page overflow.
- Breakpoint checks cover 600px, 601px, portrait/landscape-sized viewports, repeated crossings, retained DOM nodes, unchanged stored preferences, and Settings drafts. Request-owner cases cover calendar enabled only in either profile, unchanged weather/calendar/photo request counts during resizing, five normal weather polling cycles, one five-minute calendar event refresh, one clock interval, and retained photo-layer identity.
- Existing fullscreen, keyboard navigation, short/mobile Settings, service forms, Clear results, shared-location saves/conflicts, cached-first loading, and update-time scenarios all pass in the full browser suite.
- `git diff --check`: passed. Final diff inspection confirmed the planned frontend-only presentation changes, documentation, checks, and version entries.

## Decisions

- Calendar eligibility is stable across the two saved profiles rather than tied to the current viewport. A hidden active calendar can continue refreshing when the other profile enables it; this is documented and verified to keep breakpoint changes request-free.
- The runtime reorders existing section nodes only when layout mode changes, preserving both actual reading order and cached content without rebuilding views.
- Mobile font scales remain independent of desktop overall scale. Forecast text wraps rather than using the desktop ellipsis behavior, and tall layouts use vertical document flow instead of clipping or transformed sizing.
