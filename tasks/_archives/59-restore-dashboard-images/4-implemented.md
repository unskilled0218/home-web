# implemented

- [implemented](#implemented)
  - [Diagnosis](#diagnosis)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Existing Browser Failures](#existing-browser-failures)
  - [Deployment Verification](#deployment-verification)

Branch: `59-restore-dashboard-images`. Version: `0.17.27` → `0.17.28`, updated in `package.json` and both root version fields in `package-lock.json`.

## Diagnosis

The default Local controller disables its shared follower's metadata polling. When first-load image decoding fails, that follower previously only reported automatic retry; it did not own a retry timer. A single-image pool has no rotation timer, so the image stayed blank until the next 60-second Local manifest refresh. A new unit regression and a real Chromium single-image scenario both failed before the production change and passed afterward. Global normally recovered through metadata polling, but that mechanism cannot guarantee image recovery when the next metadata request stalls.

The real local-file/server/browser fixture successfully delivered legacy and Local manifests, a Global selection, nonempty PNG bytes with `image/png`, and decoded visible backgrounds. Default Local rotation and Local/Global switching preserved shared preferences and the Global cursor. No discovery, streaming, CSS, or filename-validation defect was demonstrated in these fixtures, so those mechanisms were preserved.

## Changes

- `public/dashboard-photos.js`: failed or timed-out image decodes now schedule their own five-second retry independently of metadata polling and rotation. Pending retries are canceled when decoding is retired, including hiding, disposal, scope replacement, and selection changes. Owner/selection guards reject obsolete work, the ten-second decode deadline remains, and successful recovery restores the current source status.
- `test/local-photo-manifest-api.test.js`: added same-URL single-photo Local recovery without rescanning, hidden-page retry cancellation, visible resume, disposal/late decode rejection, and Local/Global replacement coverage.
- `test/dashboard.test.js`: added timeout-then-retry coverage without polling and recovery despite a stalled Global metadata request. Existing tests retain unchanged-selection recovery, last-good backgrounds, authoritative clearing, and pending-decode deduplication.
- `e2e/photo-display-recovery.spec.js`: added real API/PNG delivery, decoded visible default-Local display, independent Local rotation, scope switching, and unchanged single-image recovery in both scopes. Recovery does not reload, rotate, change selection/revision, or modify shared settings. The initial Local image assertion accepts either eligible image because the default order is random.
- `e2e/settings-environment.js`: allows a one-photo fixture and reuses the same loopback port across restart. Previously, restarting on a new random port changed the browser origin and incorrectly discarded access to its Local preferences.
- `e2e/settings-scope.spec.js`: persisted-page resume now checks retained Local scope and selected photo instead of expecting the transient save-status message to reset. Both scope test issues were observed in the pre-fix baseline run.
- `docs/nfs-backgrounds.md` and `docs/testing.md`: documented image retry timing, cancellation, source-status recovery, and the focused verification commands.

## Verification

- Pre-fix `node --test test/local-photo-manifest-api.test.js`: 5 passed, 1 failed; the new five-second single-photo Local recovery regression failed with no image shown.
- Pre-fix `npm run test:browser -- e2e/photo-display-recovery.spec.js`: 2 passed, 1 failed; same-URL Local recovery failed while the healthy display/switching and Global recovery cases passed.
- Post-fix `node --test test/dashboard.test.js test/local-photo-manifest-api.test.js test/photo-library.test.js test/photo-slideshow-data.test.js test/photo-slideshow.test.js test/photo-slideshow-api.test.js test/large-photo-library-api.test.js`: all 77 passed.
- Final `npm test`: all 506 passed, with no failures or skips, on Node.js `v24.22.0`.
- `npm run check` and individual `node --check` invocations for every changed JavaScript file: passed. The final edit to the new browser test was syntax-checked again.
- Final `npm run test:browser -- e2e/photo-display-recovery.spec.js e2e/settings-scope.spec.js e2e/server-photo-rotation.spec.js`: all 14 passed in Chromium, including the recovered source status.
- Broader `npm run test:browser -- e2e/photo-display-recovery.spec.js e2e/settings-scope.spec.js e2e/server-photo-rotation.spec.js e2e/dashboard-home.spec.js e2e/background-display-options.spec.js`: 75 passed and 5 failed. All five failures were reproduced with the original production controller; details follow. This run preceded the final status-restoration assertion and the correction for random initial Local ordering; the final focused run above covers those changes.
- `git diff --check`: passed. No live NAS or external integration was needed for these checks.

## Existing Browser Failures

The five broader-suite failures were independently rerun with `public/dashboard-photos.js` restored to its committed pre-implementation contents, then the implementation was restored. The baseline command was `npm run test:browser -- e2e/dashboard-home.spec.js e2e/background-display-options.spec.js --grep "remote fullscreen flags|remote visibility retains|tabs support pointer|hourly and daily visibility save"`; all five failed identically.

- `e2e/background-display-options.spec.js:85` and `:131`: stale-save assertions expect `changed in another browser`, but the current source/revision guard reports `Settings source or revision changed. Reload preferences before saving.`
- `e2e/dashboard-home.spec.js:613`: the General-panel keyboard test expects `timeVisible` to receive focus immediately after the panel, despite the current earlier controls.
- `e2e/dashboard-home.spec.js:888`, at both 601px and 600px: calling `document.exitFullscreen()` fails with `Document not active`.

These failures remain recorded rather than changing unrelated production behavior. The entire browser suite was not run; the plan's broader named group and the final focused photo/scope group were run as listed.

## Deployment Verification

The affected deployment URL, browser/version, effective NFS settings, and Images status were not supplied, and there is no `.env` in this checkout. No live mount or filesystem probes were performed. The confirmed retry defect and fixture verification do not establish the cause of the user's deployed missing-image report or prove NAS access.

To verify the deployment, obtain its URL, browser/version, active scope, and Images status; follow `docs/nfs-backgrounds.md` to distinguish disabled/unavailable/empty sources from image response or decoding failures, then confirm initial decoded display and a later rotation when multiple eligible photos exist. Mount/configuration failures still require the documented configuration correction and restart.
