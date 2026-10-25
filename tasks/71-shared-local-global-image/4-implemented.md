# implemented

- [implemented](#implemented)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limitations](#limitations)

## Changes

- Created branch `71-shared-local-global-image` and implemented the reviewed plan without modifying server APIs, Global preference schemas, or transfer payloads.
- Added **Settings → Images → Show the same image as Global** for Local mode, defaulting to on for fresh, legacy, and existing records without an explicit choice. Explicit false values remain off.
- Stored `followGlobalPhotos` in the Local record outside shared preferences. Preference and option saves share one revision/write. Unrelated weather/layout saves, reload, scope changes, and same-profile storage updates preserve the choice. Invalid values, stale revisions, failed persistence, and Global option writes are rejected.
- Added form draft handling, Save/reload behavior, and disabled-but-preserved Local Order/Interval controls while following. Local presentation, weather, layout, and other settings remain independent. Unsaved checkbox changes do not change playback.
- Updated photo routing to include the settings epoch and effective playback source in owner identity. Local followers reuse the Global slideshow follower without independent manifest polling or rotation. Source replacement disposes and clears the previous owner; transient failures within an unchanged source retain the last-good image.
- Added coordinator and scoped-photo regression tests for persistence, defaulting, routing, visibility, retries, disabled/empty/unavailable states, stale asynchronous work, and foreground/speculative resource release. Updated existing independent Local assumptions and added browser cases for default following, opt-out, same-profile drafts, save failures, and Global import behavior.
- Clarified import success text: unchanged Local settings do not imply unchanged playback for Local followers.
- Updated README, dashboard/settings/NFS/import documentation, release notes, `VERSION`, npm metadata, and release configuration to `0.17.40`.

## Verification

- `npm run check`: passed after final code/test edits; JavaScript files checked individually.
- `node --test test/dashboard-settings-scope.test.js test/dashboard-photo-scope.test.js test/local-photo-manifest-api.test.js test/release-config.test.js test/dashboard.test.js`: passed, 73 tests, zero failures or skips.
- `npm test`: final run passed, 641 tests, zero failures or skips. The first full run exposed old form/control expectations, an independent-controller fixture relying on the former default, and the release notes configuration path; all were updated before the successful rerun. Final log: `/tmp/opencode/home-web-71-node-tests-rerun.log`.
- `npm run test:browser -- e2e/settings-scope.spec.js e2e/server-photo-rotation.spec.js e2e/photo-display-recovery.spec.js e2e/global-settings-transfer.spec.js`: attempted; all 24 cases were blocked before test bodies by the missing Playwright Chromium headless-shell executable.
- `npm run test:browser`: attempted; all 176 cases were blocked by the same missing executable. Log: `/tmp/opencode/home-web-71-browser-tests.log`. Browser behavior is not verified by these runs. A subsequent browser-test-only edit disables Local transitions in the import fixture to keep selection assertions focused; syntax checking covers that final edit.
- `git diff --check`: passed before recording this report.

## Limitations

Install the matching browser with `npx playwright install chromium`, then rerun the focused and full browser suites. No browser or system packages were installed by this task. If Chromium then reports missing system libraries, those must be provisioned separately by the user.

Switching playback sources intentionally clears the previous frame and can show a temporary solid background. Shared selection follows existing polling/decode timing rather than frame-perfect synchronized transitions. Older cached application versions reject the extended Local record under their strict validation; reload the updated application before editing Local settings. No deployment, release publication, or remote Git push was performed.
