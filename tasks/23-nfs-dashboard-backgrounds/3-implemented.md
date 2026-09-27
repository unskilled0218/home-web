# Task 23: NFS Dashboard Backgrounds Implementation

## Result

Implemented optional read-only NFS-backed dashboard backgrounds. `npm start` now prepares the configured share before listening, reports a generic warning when preparation fails, and continues serving the dashboard without photos. `/dashboard` automatically loads a bounded server-side photo manifest instead of asking the browser to select local files.

## Changes

- Added `NFS_MOUNT_MODE`, `NFS_SOURCE`, `NFS_MOUNT_PATH`, and `NFS_MOUNT_OPTIONS` configuration with fail-open validation for this optional integration.
- Added `src/nfs.js` to parse Linux mount information, reuse only matching safe mounts, support explicitly pre-mounted shares, and invoke `mount` through an argument array without a shell.
- Forced `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2` for application-mounted shares. Existing mounts must expose equivalent effective options. Unsafe, hard/background, and retry-control options are rejected.
- Added a five-second mount-command deadline, post-mount verification, sanitized failure handling, and no automatic unmount on process shutdown.
- Added `src/photo-library.js` with stable opaque tokens, bounded token retention, coalesced ten-second scans, stable directory/file handles, symlink refusal, root containment, recursive depth/entry limits, file/count/aggregate limits, and an eight-stream concurrency cap.
- Image delivery now streams from the exact validated open file handle and is capped to the validated file size, closing pathname replacement and file-growth races.
- Added LAN/Host-protected `GET /api/dashboard/photos` and `GET /api/dashboard/photos/<token>` routes with safe metadata, image MIME types, no-sniff, private no-cache behavior, and no absolute path or NFS source disclosure.
- Reworked `public/dashboard-photos.js` to fetch the manifest automatically with a ten-second browser deadline, ignore stale responses, retain slideshow ordering/transitions, and degrade to a clock-only background state on failure.
- Removed the browser file input, object URL lifecycle, session-only reselection copy, and unused client-side file-selection helper.
- Added `docker-compose.nfs.yml` for a host-mounted read-only share. The base Compose service now runs under configurable `DASHBOARD_UID`/`DASHBOARD_GID` values, defaulting to 1000, without mount capabilities or a privileged container.
- Updated `.env.example` and `README.md` with direct mount, pre-mounted, non-root Compose, permissions, limits, security settings, and failure behavior.
- Bumped the project version from `0.14.2` to `0.15.0`.

## Tests

- Added `test/nfs.test.js` for mount-info parsing, disabled/invalid configuration, safe existing mounts, conflict rejection, exact command arguments, verification, and fail-open errors.
- Added `test/photo-library.test.js` for unavailable roots, recursive discovery, unsupported/oversized/symlink exclusion, opaque metadata, stable-handle streaming, replacement races, count limits, stable tokens, scan deadlines, and stream concurrency.
- Extended configuration, startup, dashboard, and HTTP tests for NFS variables, startup continuation, automatic manifest loading, stale request suppression, browser timeout fallback, removed picker copy, protected image routes, MIME/security headers, and unknown tokens.
- Updated the existing dashboard photo-controller tests from browser `File`/object URL ownership to server records.

## Verification

Passed:

```text
npm test
128 tests passed, 0 failed

npm run check
node --check src/*.js && node --check public/*.js

git diff --check
```

Focused NFS, photo-library, configuration, dashboard, environment/startup, app-server, and server-security tests also passed during implementation.

Unavailable in this environment:

- `docker compose config` and the NFS override render because the `docker` executable is not installed.
- A live NFS export, browser, and container runtime, so real mount/disconnect, visual desktop/mobile, and container read-only permission checks were not performed.

## Departures from Plan

- Stable HMAC-derived photo tokens are retained in a size-bounded process-local map instead of expiring after a fixed TTL. This prevents long-running dashboards and maximum one-hour slideshow intervals from losing valid images while still bounding memory and revalidating every file access.
- The implementation additionally forces bounded `soft,timeo=20,retrans=2` NFS behavior and requires it for pre-mounted shares so disconnected filesystem operations cannot remain indefinitely blocked.
- Compose was changed to an explicit non-root UID/GID because the original image defaulted to root, which conflicted with the task's unprivileged deployment requirement. Existing root-owned `data/` files require a host-admin ownership adjustment before upgrade.
