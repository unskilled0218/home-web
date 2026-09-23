# Bookmarks-first Wake-on-LAN UI implementation

## Delivered

- Reordered the dashboard so Linkwarden Bookmarks is the first functional section and the complete Wake-on-LAN area appears beneath it.
- Removed the top-level title and description entirely and moved the packet-dispatch explanation into the Wake-on-LAN section.
- Moved Bookmarks settings beside Disconnect and Refresh, and moved Add device into the Wake-on-LAN heading so feature controls are no longer mixed in the global hero.
- Added an explicitly labelled Wake-on-LAN section with the same eyebrow, heading, action group, spacing, divider, and status hierarchy as Bookmarks.
- Consolidated bookmark and device grids/cards onto shared dimensions and surfaces while retaining collection navigation, device selection, wake actions, and feature-specific content styles.
- Reorganized the stylesheet into readable shared rules, added consistent button/link focus outlines, protected long account/device/bookmark content from overflow, and added stacked action/toolbar behavior for narrow screens.
- Preserved all existing DOM IDs, independent live status regions, dialogs, Linkwarden collection behavior, device actions, search, selection, and wake logic.
- Changed generated device-group headings from `h2` to `h3` so they sit correctly beneath the new Wake-on-LAN `h2`.
- Extended browser-facing markup coverage for feature order, accessible section labels, action placement, independent status regions, and unique IDs.
- Updated README page-order wording and bumped the application version from `0.6.2` to `0.7.0` for the user-facing layout release.

## Verification

- `npm test` passes with 27 tests.
- `node --check public/app.js` and `node --check test/linkwarden-server.test.js` pass.
- `git diff --check` passes.
- A DOM-selector verification script confirms every literal `public/app.js` ID selector resolves to an element in `public/index.html`.
- Static browser coverage confirms Bookmarks precedes Wake-on-LAN, both sections have `aria-labelledby` headings and independent polite status regions, controls are grouped with the correct feature, and all markup IDs are unique.
- Responsive CSS was inspected at the 700px and 560px breakpoints, including a 320px minimum viewport, wrapping content, stacked section actions, stacked device tools, single-column collection layout, and bounded card grids.
- Interactive desktop/mobile visual and keyboard checks were not run because no Chromium, Firefox, or browser automation installation is available in this development container.
