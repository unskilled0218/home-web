# implemented

- [implemented](#implemented)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Migration](#migration)

## Changes

- Created branch `65-nfs-mount-mode-on-off` from `2093676` and implemented the complete plan.
- `src/config.js` now accepts trimmed, case-insensitive `on` and `off`. Omitted mode defaults to `off` even with a source. Enabled configuration requires a mount path; legacy, empty, and unknown mode values produce nonfatal configuration errors. Source/options validation and immutable configuration remain intact.
- `src/nfs.js` returns immediately under `off` without mount inspection, directory creation, file access, or command execution. Under `on`, a nonempty source uses application-managed mounting; an empty source verifies an existing mount. Mount safety options, source/type conflict checks, command timeout, verification, child ownership, and runtime result reasons are preserved.
- `src/server.js` enables the slideshow and photo APIs only under `on`, retaining enabled-but-unavailable status after failed preparation. Cleanup advice uses the new values.
- Updated test and helper environments, Compose parser coverage, `.env.example`, README, and NFS/operations/testing documentation. Added configuration-matrix coverage and real normal/development startup assertions for photo status, Local manifests, slideshow snapshots, settings access, warnings, and clean shutdown. Shutdown fixtures also clear inherited `NFS_MOUNT_OPTIONS` for isolation.
- Updated `package.json` and both root version entries in `package-lock.json` from `0.17.33` to `0.17.34`, following the existing task-level patch increment convention.

## Verification

- Runtime: Node.js `v24.22.0`.
- `node --test test/config.test.js test/nfs.test.js test/server-shutdown.test.js test/startup-key.test.js test/home-assistant-tls.test.js test/release-config.test.js`: passed, 45 tests, 0 failures, 0 skips.
- `npm run check`: passed.
- `npm test`: passed, 645 tests, 0 failures, 0 skips.
- Docker Compose configuration parsing passed, including forwarding `NFS_MOUNT_MODE=on`, an empty source, fixed `/photos`, and the read-only host bind.
- Existing mount-safety, command-verification, preparation-child ownership, background rotation, and shutdown tests passed. New real-server checks passed for normal and development launches: `off` reports disabled without an NFS warning; `on` with an unavailable existing mount reports enabled/unavailable, warns, serves settings, and shuts down cleanly.
- Active-source/test/script searches found no remaining legacy mode comparisons or environment assignments. Current documentation retains legacy names only for migration; historical task documents retain their original context.
- `git diff --check`: passed. Reviewed the complete implementation diff.
- No live NAS or privileged mount operation was used. Browser tests and the opt-in production-install smoke were not run; this task's planned verification used unit, isolated real-server, deployment-parser, and full Node test coverage.

## Migration

- Replace `disabled` with `off`.
- Replace `mount` with `on`, retaining `NFS_SOURCE` and the mount path.
- Replace `existing` with `on`, clearing `NFS_SOURCE` and retaining the mount path. Compose continues to use the host-prepared share at `/photos`.
- Source-only configurations now require explicit `NFS_MOUNT_MODE=on`. Restart the application after updating configuration.
