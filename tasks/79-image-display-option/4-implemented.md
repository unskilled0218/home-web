# implemented

- [implemented](#implemented)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limitations](#limitations)

## Changes

- Implemented on the new branch `79-image-display-option`.
- Kept **Show image** as the desktop control and added **Show image on mobile** and **Hide image in fullscreen** in Settings → Images. All use the existing category form, drafts, saving, and Local/Global ownership.
- Mobile visibility applies up to and including 600px. Fullscreen hiding temporarily overrides the active profile. Photos, blurred backgrounds, and captions share the resolved visibility; widgets and solid background remain unchanged.
- Shared the additive stored-preference upgrade between Global/cache and Local/import decoders. Missing mobile visibility inherits the previous desktop choice, preserving hidden images; missing fullscreen hiding defaults off. Explicit values and strict validation remain intact.
- Reused viewport, fullscreen, and photo-completion projection paths. Visibility-only changes do not configure playback, replace photo layers, or change saved widget geometry.
- Extended migration, projection, layout, form, category, scope, API, transfer, and browser tests. Browser scenarios cover boundary widths, independent profiles, fullscreen exit, drafts, reload, Global propagation, Local isolation, and existing playback modes.
- Updated README and relevant dashboard, scope, NFS, transfer, and release documentation. Advanced the patch version to `0.17.47` in `VERSION`, npm manifests, release configuration, current release links, and versioned release notes. No release was published.

## Verification

- Runtime: Node.js `v26.13.0`. Ran `npm ci` to install the unchanged locked dependencies.
- `npm run check`: passed.
- Focused Node run covering nine settings/display/layout test files: 153 passed, zero failed. Log: `/tmp/opencode/79-focused.log`.
- `npm test`: 712 tests, 687 passed, 25 failed. All failures are in unchanged weather-proxy scenarios. Log: `/tmp/opencode/79-unit-verified.log`.
- Re-ran `test/weather-provider.test.js` from a temporary archive of pre-implementation commit `1f23863` with the same installed dependencies: 62 tests, 37 passed, the same 25 failed. This confirms those failures predate this implementation in this environment. Log: `/tmp/opencode/79-baseline-weather.log`.
- `npm run test:browser -- e2e/image-visibility.spec.js e2e/background-display-options.spec.js e2e/dashboard-home.spec.js e2e/settings-scope.spec.js`: 93 passed after the operator installed Chromium and its system dependencies. Log: `/tmp/opencode/79-browser-complete.log`. The image-only rerun also passed all 13 cases: `/tmp/opencode/79-browser-image-recheck.log`.
- The first executable browser run passed 90 cases and exposed three incorrect new test expectations about Settings visibility. Corrected those assertions to preserve existing fullscreen behavior: tools hide when widgets are active and return on exit; the existing caption-only tests verify tools remain accessible when all widgets are hidden. No production behavior changed in this follow-up.
- `bash scripts/release.sh --validate`: passed without credentials or remote operations.
- `git diff --check`: passed.

## Limitations

- Initial browser runs were blocked first by missing Chromium, then by missing `libnspr4.so`. The operator installed the browser and system dependencies; browser verification is now complete.
- Full-suite weather-proxy failures report `ERR_INVALID_ARG_VALUE` / `fetch failed` in this environment. Their root cause was not changed or diagnosed beyond baseline reproduction.
- `npm audit` reports one existing high-severity vulnerable dependency, `undici@8.11.2`, with multiple advisories. Dependency versions were not changed because remediation is outside this image-display task.
- Preserved unrelated user changes to `todo.md` and the deletion of `tasks/78-selected-dashboard-images/1-goal.md`; neither belongs to this implementation commit.
