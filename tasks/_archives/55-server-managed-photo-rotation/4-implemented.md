# Implemented

- [Implemented](#implemented)
  - [Task and version](#task-and-version)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limitations and decisions](#limitations-and-decisions)

## Task and version

- Implemented `tasks/55-server-managed-photo-rotation/2-plan.md`, including the producer/consumer bounds from `3-plan-review.md` and the subsequent plan update.
- Created the new branch `55-server-managed-photo-rotation` from `4702f46`; no existing task branch was reused.
- Updated `package.json` and both project version entries in `package-lock.json` from `0.17.23` to `0.17.24`, following the task-level patch release convention.

## Changes

- Added `public/photo-slideshow-data.js` as the shared strict snapshot/current-photo contract. It validates version/instance/revision/timestamps, explicit source states, eligible counts and deadlines, safe opaque image paths, well-formed relative names of at most 1,024 UTF-8 bytes, and snapshots of at most 8,192 serialized UTF-8 bytes. Controls, invalid segments, backslashes, absolute drive paths, external URLs, and unknown fields are rejected.
- Added `src/photo-slideshow.js` with construction free of scans/timers, explicit start/configure/snapshot/stop operations, injected clock/timers/randomness, and unbiased production Fisher–Yates choices through `crypto.randomInt`. One bounded process-owned pool/cursor advances without viewers, preserves name/date semantics, avoids random cycle-boundary repeats, advances only once on late timers, and never creates a per-client sequence.
- Discovery runs at startup and 60 seconds after the previous scan settles. Only one scan is active; rotation continues from the last-good pool during slow scans. Unchanged refreshes preserve selection/deadline, changed pools reconcile membership, missing/ineligible current records are replaced, failures mark last-good data stale, and confirmed empty/all-rejected pools clear the current selection. Empty/single-image pools do not schedule rotation.
- Applied the shared photo contract before records enter slideshow selection. Counts include only eligible records, accepted names/URLs retain their exact identity, and exclusions neither mutate the legacy library manifest nor expand its existing accepted pool. Updated default opaque tokens to incorporate observed path/mtime/size metadata while preserving unchanged-file URLs and bounded history.
- Integrated startup after HTTP readiness, confirmed preference loading, successful save/initialization notifications, and shutdown ownership. Unrelated/unchanged preferences do not reset rotation. Corrupt/unreadable initial preferences do not become invented defaults; a later valid configuration can enable operation. Notification errors cannot relabel committed saves as failures.
- Added the protected read-only `GET /api/dashboard/slideshow` endpoint with no-store snapshots, strict producer validation, 405 method handling, and bounded 503 errors for missing/invalid services. Reads neither scan NFS nor advance selection or write SQLite. Existing manifest and opaque image streaming routes remain available with their existing admission/security protections.
- Extended shutdown to stop/drain the slideshow alongside HTTP/weather before SQLite closure. Timers stop immediately, late scan results cannot republish, and outstanding filesystem work remains owned until settlement. Late resource attachment, including after a startup shutdown deadline, still stops the service; unconfirmed drains retain unsafe/nonzero deadline outcomes.
- Replaced `public/dashboard-photos.js` with one bounded snapshot follower. It coalesces reads, limits bodies to 8 KiB, bounds fetch/body/decode waits to ten seconds, polls from server-relative deadlines within 250ms–5s, rejects obsolete responses/decodes, and adopts fresh instances. Unchanged snapshots do not restart pending decodes or transitions. Metadata/image failures retain the last-good image and retry without choosing or skipping images locally. Removed the unused browser ordering/shuffling helper and obsolete local-sequence tests.
- Kept rendering, captions, animation/reduced motion, and blur/color/opacity in `public/dashboard.js`. Presentation updates modify the existing layer; canceled transitions remove obsolete layers when hidden or reduced motion changes. Visibility, online reconnection, and persisted-page restoration read current server state without resetting its cursor; persisted-page suspension retains the last-good background and pauses browser work.
- Added focused service/schema/API coverage, UTF-8 and real-library round trips, stream-limit checks during concurrent snapshot reads, replacement-token coverage, rewritten controller regressions, actual scan-drain shutdown tests, and normal/development process tests proving rotation occurs before the first HTTP read. Existing unrelated Node regressions remain passing.
- Added seven real-service browser scenarios in `e2e/server-photo-rotation.spec.js` for no-viewer rotation/reopening, two-browser convergence, visibility/persisted-page resume, unchanged layers, presentation saves, fresh instances, bad-image retention, and single/empty/disabled/unavailable sources. Updated existing caption/layout/home fixtures to publish explicit server snapshots and distinguish expected metadata polling from extra decodes/scans/provider owners.
- Updated `docs/dashboard.md`, `docs/nfs-backgrounds.md`, and `docs/testing.md` for server ownership, cadence, eligibility/counts, restart/failure behavior, deterministic fixtures, and focused verification commands.

## Verification

- `node --test test/photo-slideshow.test.js test/photo-slideshow-data.test.js test/photo-slideshow-api.test.js test/photo-library.test.js test/dashboard.test.js test/shutdown.test.js test/http-shutdown.test.js test/server-shutdown.test.js`: passed all 90 tests, with zero failures, cancellations, or skips.
- `npm run check`: passed on version `0.17.24`.
- Individually ran `node --check` on all 22 changed/new JavaScript implementation and test/fixture files, including every affected browser spec and the shared helper: passed. This supplements the existing glob-based check script.
- `npm test`: passed all 464 Node tests, with zero failures, cancellations, or skips. This includes real loopback HTTP/SQLite/filesystem fixtures, normal/development startup/shutdown, reload ownership, actual SIGINT/SIGTERM capability checks, and terminal Ctrl+C outcomes.
- After the final canceled-transition layer cleanup, reran `node --test test/dashboard.test.js`: all 35 tests passed; `node --check public/dashboard.js` and `node --check e2e/server-photo-rotation.spec.js` also passed. Actual animation/reduced-motion browser assertions remain blocked by the executable dependency below.
- `npm run test:browser -- --list`: successfully collected 158 scenarios in eight spec files, including the seven new server-rotation scenarios.
- `npm run test:browser -- e2e/background-display-options.spec.js -g "caption|photo"`: blocked before browser assertions because Playwright Chromium is absent.
- `npm run test:browser`: attempted the full suite; all 158 cases failed at browser launch with `Executable doesn't exist at /home/container/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`. No browser assertion is reported as passing. Global setup successfully started/stopped the application through its normal IPC lifecycle.
- `git diff --check`: passed.

## Limitations and decisions

- Browser execution remains blocked by the missing Playwright executable. The operator must run `npx playwright install chromium`, then rerun `npm run test:browser`. The suite's existing cross-engine cases also require Firefox, as documented by `npx playwright install chromium firefox`. No browser or system packages were installed during this task.
- Local injected filesystem/service/process fixtures establish behavior without accessing a live NAS or mounting an export. They do not certify deployment NFS access or browser rendering in this environment.
- Saved name/date modes remain supported. Random connection behavior means joining an independently advancing shared shuffled traversal; simultaneous connections may show the same image. Selection history remains in memory and starts fresh after process restart.
- Discovery waits 60 seconds after scan settlement rather than overlapping or abandoning a slow scan. Filesystem cancellation remains cooperative; shutdown success still requires confirmation that actual work ended.
