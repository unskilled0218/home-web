# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Locate the failing image stage](#1-locate-the-failing-image-stage)
    - [2. Reproduce the confirmed failure](#2-reproduce-the-confirmed-failure)
    - [3. Restore display and playback](#3-restore-display-and-playback)
    - [4. Verify the fix](#4-verify-the-fix)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Restore dashboard photo backgrounds and rotation for the configured image source. Diagnose both default Local playback and Global server-owned playback, then fix the stage responsible for the reported missing images. This task covers source configuration, discovery, image serving, validation, decoding, and presentation only where evidence connects them to the failure.

## Implementation Plan

### 1. Locate the failing image stage

- Establish the affected dashboard URL, browser/version, Settings scope, Images status, and effective image settings, particularly opacity. Capture relevant console errors and photo request failures without exporting credentials or unrelated settings.
- Inspect effective NFS configuration through `src/config.js`, preparation through `src/nfs.js`, and library/slideshow startup through `src/server.js`. For Compose, distinguish host `NFS_HOST_MOUNT_PATH` from container `/photos`; `.env` and the affected deployment are not present in this checkout.
- Follow `docs/nfs-backgrounds.md` diagnosis stages for deployment checks. Inspect configuration and mount metadata before filesystem reads, and request operator-run checks when the required host access or bounded cleanup is unavailable.
- Compare `/api/dashboard/photos`, `/api/dashboard/photos/local`, and `/api/dashboard/slideshow`. Record disabled, unavailable, loading, stale, confirmed empty, and nonempty results separately; only the active scope's endpoint controls its playback.
- For a nonempty active source, fetch one returned opaque image URL and check status, content type, byte delivery, and actual browser decoding. Trace failures through `src/photo-library.js` and `src/app.js` rather than treating metadata success as working display.
- If image bytes decode, trace `public/photo-slideshow-data.js`, `public/dashboard-photo-scope.js`, `public/dashboard-local-photos.js`, `public/dashboard-photos.js`, and `public/dashboard.js`; inspect the resulting image dimensions, opacity, layers, and CSS visibility.

### 2. Reproduce the confirmed failure

- Create the smallest failing regression at the responsible boundary using existing test fixtures and temporary local images. Keep ordinary tests independent of the live NAS.
- Check browser compatibility of `String.prototype.isWellFormed()` in `public/photo-slideshow-data.js` if valid metadata is rejected only in the affected browser. Its unconditional use is an investigation lead, not a confirmed cause; any compatibility fix must retain rejection of unpaired surrogates.
- Check first-load and later image failures in Local mode as well as Global mode. Local delegates decoding to a follower with `autoPoll: false` and refreshes manifests every 60 seconds, whereas Global normally retries through metadata polling within five seconds.
- Extend the relevant existing suite: `test/photo-library.test.js` for discovery/streams, `test/photo-slideshow-data.test.js` for validation, `test/local-photo-manifest-api.test.js` for Local behavior, or `test/dashboard.test.js` for the shared follower. Use `test/nfs.test.js` only if preparation is implicated.

### 3. Restore display and playback

- Apply the smallest correction supported by the reproduction. If the failure is deployment configuration, document the exact required correction and verify it with the operator instead of introducing an unrelated code change.
- Preserve eligible filename rules, opaque image URLs, bounded discovery, streamed image delivery, Local/Global settings isolation, and the server's shared rotation ownership.
- If decoding or controller lifecycle is responsible, ensure valid selections render, transient failures recover automatically, and obsolete scope/visibility/decode completions cannot overwrite the active image. Retain the last decoded background during transient failures and clear only on confirmed disabled or empty state.
- If metadata succeeds but rendering fails, correct the demonstrated presentation problem in `public/dashboard.js` or `public/dashboard.css`; preserve intentional opacity settings, solid/blurred backgrounds, transitions, captions, and widget layout.
- Update `docs/nfs-backgrounds.md` or `docs/testing.md` only for a changed diagnostic instruction, behavior, or regression command.

### 4. Verify the fix

- Run the affected focused unit/API suites, then `npm run check` and `npm test`. Syntax-check each changed JavaScript file individually because the current glob-based check does not check every file separately.
- Extend `e2e/settings-scope.spec.js` or add a focused photo-display spec using `e2e/settings-environment.js` for default Local first-load, actual image decoding, later rotation, and switching to/from Global. Assert `complete && naturalWidth > 0` and visible presentation, not just captions or an HTTP 200.
- Run `npm run test:browser -- e2e/settings-scope.spec.js e2e/server-photo-rotation.spec.js e2e/dashboard-home.spec.js e2e/background-display-options.spec.js`, including any new focused spec. Add a recovery scenario at the confirmed failing stage and verify the last-good background remains during a transient outage.
- If the defect depends on a specific browser/version, reproduce and verify there in addition to the repository's Chromium checks. Record missing browser prerequisites as blockers.
- Recheck the affected deployment when accessible, confirming initial display and at least one later rotation with multiple eligible photos. Record fixture evidence separately from live deployment evidence, then run `git diff --check`.

## Acceptance Criteria

- The failing stage and cause are identified with a reproducible case or concrete deployment evidence.
- A configured, readable source containing supported eligible photos displays a decoded background on first load in Local and Global modes.
- Multiple eligible photos rotate according to the active scope's order and interval; a single eligible photo remains displayed without requiring rotation.
- Local playback and scope switching do not change Global preferences or advance the shared cursor; late work from the previous scope cannot replace the active image.
- Transient source/image failures retain the last-good background and recover automatically. Confirmed disabled or empty sources use the solid fallback with an accurate Images status.
- A focused regression fails before the code fix and passes afterward, when a code defect is confirmed. Applicable unit/API/browser checks pass, with live deployment verification reported separately.

## Risks And Decisions

- No root cause is established by the user's report or repository inspection. Investigation precedes the choice of code or deployment fix; compatibility and retry behavior are hypotheses only.
- Existing limits intentionally expose at most 100 accepted images from a bounded scan, not every NAS file. Restoring display does not expand those limits or add unsupported image formats.
- Mount preparation failures require corrected configuration and restart; periodic discovery does not retry mounting. Keep the existing mount safeguards and use operator-controlled host changes when required.
- Temporary-file/browser fixtures demonstrate application behavior but cannot prove that the deployment's NFS export is mounted, readable, or healthy.
