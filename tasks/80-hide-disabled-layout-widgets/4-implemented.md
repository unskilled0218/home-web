# implemented

- [implemented](#implemented)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limitations](#limitations)

## Changes

- Implemented on the new branch `80-hide-disabled-layout-widgets`.
- Added `public/dashboard-layout-visibility.js` to resolve all six widgets through shared display projection, using the selected editing profile and actual fullscreen state. Visibility uses composed effective category preferences, not current-viewport DOM flags or captured layout settings.
- Filtered editor frames, selector options, and layer rows. Removed hidden-widget placeholders and their unused CSS. Covered, tiny, or temporarily empty enabled widgets retain toolbar access.
- Added selection fallback and a safe all-hidden state with empty/disabled widget controls, status guidance, and available profile/Cancel/layout actions. Hiding the selection cancels its captured gesture, discards uncommitted numeric text, and recovers focus without rebasing completed drafts or save tokens.
- Guarded selector, numeric, deferred, pointer, and layer actions against hidden targets. Kept source/revision conflict handling and Automatic no-op saves intact.
- Extended layer operations with an optional eligible-ID list. Visible Up/Down/front/back operations reorder only visible slots; hidden entries retain their exact layers and rectangles. Unrestricted callers and the six-widget storage schema remain supported without migration.
- Added unit and browser coverage for mappings, inactive/pinned profiles, fullscreen, empty states, raw input, gestures, stale events, layer boundaries, Local/Global isolation, re-enabling, and stored geometry preservation. Updated old hidden-widget editor expectations.
- Updated README and relevant dashboard/layout documentation. Advanced the patch version to `0.17.48` across version files, release configuration, links, and new release notes. No release was published.

## Verification

- Runtime: Node.js `v26.13.0` with existing locked dependencies and operator-installed Chromium.
- `npm run check`: passed.
- Focused layout verification across nine Node test files: 98 passed, zero failed. Log: `/tmp/opencode/80-layout-verification.log`.
- `npm test`: 720 tests, 695 passed, 25 failed, all in unchanged weather-proxy scenarios. These match the failures reproduced on the pre-implementation baseline during task 79; no weather code or dependency versions changed. Log: `/tmp/opencode/80-unit.log`.
- Initial planned four-spec browser run: 88 passed, one obsolete all-hidden editing assertion failed, and the existing Firefox/Chromium interoperability case could not launch because Firefox is absent. Updated that assertion to require disabled geometry controls and no visible editing frames, selector options, or layer rows. Log: `/tmp/opencode/80-browser.log`.
- `npm run test:browser -- e2e/dashboard-layout.spec.js e2e/background-display-options.spec.js e2e/settings-scope.spec.js e2e/image-visibility.spec.js --grep-invert 'Firefox and Chromium'`: 89 passed, zero failed. Only the separately documented cross-browser case was excluded. Log: `/tmp/opencode/80-browser-verified.log`.
- `bash scripts/release.sh --validate` and `git diff --check`: passed.

## Limitations

- The cross-browser interoperability scenario remains blocked by missing Playwright Firefox. The operator can install it with `npx playwright install firefox`, then rerun `npm run test:browser -- e2e/dashboard-layout.spec.js --grep 'Firefox and Chromium'`. No browser binaries or system packages were installed by this task.
- The unrelated baseline weather-proxy failures still prevent a completely green Node suite. Their cause was not changed in this task.
- Unrelated local changes in `docker-compose.dev.yml`, `todo.md`, and the deletion of the task 78 goal remain untouched and are excluded from the implementation commit.
