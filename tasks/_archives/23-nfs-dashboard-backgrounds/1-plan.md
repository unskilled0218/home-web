# Task 23: Load Dashboard Backgrounds from NFS

## Objective

Replace the dashboard's browser-local photo picker with an automatically loaded slideshow backed by an optional NFS share. `npm start` must attempt to connect the configured share before starting the HTTP server, but an unavailable or failed NFS mount must not prevent the rest of the dashboard from deploying.

## Request and Scope

- Request from `~/workdir/command.md`: connect NFS for dashboard backgrounds instead of the folder picker, connect when `npm start` runs, and continue deployment without NFS if the connection fails.
- Add operator-provided NFS source, local mount-point, and mount-option configuration; do not hard-code a server, export, credential, or machine-specific path in the repository.
- Use supported JPEG, PNG, WebP, and GIF files from the connected share as the `/dashboard` slideshow source. Keep the existing ordering, transition, interval, opacity, blur, filename, visibility, and reduced-motion behavior.
- Remove browser file selection and its session-only copy. Do not add uploads, image mutation/deletion, NFS browsing controls, credential persistence, or database schema changes.
- Treat NFS as optional. Missing configuration disables NFS quietly; an attempted mount or later directory-read failure produces a bounded warning/status while the clock, weather, calendar, home page, and server remain available.
- Linux NFS client installation, server export configuration, network/firewall setup, and mount authorization are deployment prerequisites, not application-managed concerns.

## Inspected Context

- The project is version `0.14.2`, requires Node 24, has no runtime dependencies, and starts with `node --env-file-if-exists=.env src/server.js`; `src/server.js` validates configuration and starts listening immediately.
- `src/config.js` resolves filesystem settings such as the database and CA paths but has no NFS or photo-library configuration. `.env.example`, `README.md`, and `docker-compose.yml` likewise have no NFS contract.
- `public/dashboard.html` currently contains a multiple-file input and explains that images remain in the browser session. `public/dashboard.js` passes its `FileList` to `createPhotoController()` and asks users to reselect after reload or a non-persisted page lifecycle.
- `public/dashboard-photos.js` owns slideshow timers, decode-failure skipping, object URL creation/revocation, and visibility handling. Its photo objects already expose a URL plus file name/modification time, so it can retain most slideshow behavior while accepting server-provided records.
- `public/dashboard-helpers.js` bounds browser selections to 100 images, 20 MiB per image, and 200 MiB total and sorts by file name or modification date. Equivalent server-side bounds are needed because NFS contents are not trusted input.
- `src/app.js` has a contained public-file server and LAN/Host checks for `/api/*`. It does not currently expose arbitrary files or stream image content from outside `public/`.
- `test/dashboard.test.js` covers dashboard routes, photo ordering, invalid-image skipping, timer ownership, replacement races, and object URL cleanup. `test/config.test.js`, `test/env.test.js`, and `test/server-security.test.js` cover runtime settings, startup, and LAN/Host restrictions.
- The Compose image is `node:24-bookworm-slim`, the application tree is read-only, and the container has neither an NFS client nor mount privileges. Container-side mounting should not be enabled merely to support this feature.

## Startup and Product Decisions

- Introduce `NFS_SOURCE` (for example `nas.lan:/photos`), `NFS_MOUNT_PATH` (an application-readable local directory), and optional `NFS_MOUNT_OPTIONS`. NFS remains disabled unless a source is configured; a source without a mount path is reported as an NFS setup failure but remains non-fatal.
- Keep Node's env-file flag on `npm start` so NFS settings are loaded before application modules initialize. Perform the NFS preparation in the Node startup path before creating the photo library and before `server.listen()`.
- Use `execFile`/`spawn` argument arrays, never a shell command. Attempt a read-only NFS mount with fixed safety options (`ro,nosuid,nodev,noexec`) plus validated comma-separated operator options, a short timeout, bounded captured output, and no interpolation into shell syntax.
- Detect an existing NFS/NFS4 mount at the configured mount point and reuse it instead of mounting again. Create only the configured local mount directory when needed. Do not automatically unmount on shutdown because the mount can predate or outlive this process and may be shared with other services.
- If the executable is missing, authorization is insufficient, the source is unreachable, the command times out, or the result is not an NFS mount, log one sanitized warning and continue startup with the photo library unavailable. Do not print environment contents, command output without bounds, or credentials embedded in an invalid source.
- For direct `npm start`, document that the service account must already have permission to perform the configured mount, normally through a narrowly scoped system mount policy. Do not invoke `sudo`, prompt for a password, or require the Node process to run as root.
- For Compose, document host-side NFS mounting and a read-only bind mount into the container instead of adding `privileged`, `CAP_SYS_ADMIN`, `/dev`, host mount propagation, or package installation to the application container. Configure the container to read the bind-mounted photo path without attempting a second mount.
- Recursively discover regular supported image files while refusing symbolic links and non-regular entries. Apply deterministic bounds of 100 accepted images, 20 MiB per image, 200 MiB total, a bounded traversal depth/entry count, and stable relative-path ordering before applying the user's selected name/date/shuffle order.
- Return opaque per-snapshot photo identifiers and public metadata (`name`, modification timestamp, image URL), not absolute mount paths or NFS source details. Resolve image requests only through the library's allowlisted snapshot and apply the existing trusted-LAN and Host protections.
- Scan when the browser requests the photo manifest so a page reload sees share changes without restarting the service. A failed scan returns an available-but-empty/unavailable state rather than crashing the server; no background watcher or recurring server poll is required.

## Implementation Plan

### 1. Add optional NFS runtime configuration

- Extend `src/config.js` with normalized NFS source, mount path, mount options, and mount-at-start behavior. Resolve local paths once, reject NUL/control characters and unbounded values, and keep malformed NFS-only settings non-fatal at startup by returning a disabled/error state for this optional integration.
- Distinguish direct startup, where a configured source is mounted, from a pre-mounted/container path that should only be validated and read. Use an explicit setting rather than inferring container execution.
- Add the variables and safe examples to `.env.example`. Keep all deployment-specific values empty by default so existing `npm start`, tests, and installations behave unchanged.

### 2. Implement bounded fail-open NFS startup

- Add a focused startup module that can inspect Linux mount information, create the mount directory, and invoke the system `mount` executable through an injectable process runner.
- Reuse a matching existing NFS/NFS4 mount. Reject a mount point occupied by an unexpected filesystem instead of serving it or mounting over it.
- Build mount arguments without a shell, force read-only safety flags, bound configurable option syntax, enforce a short deadline, and terminate a timed-out child. Convert every mount/setup error into a concise sanitized result suitable for one startup warning.
- In `src/server.js`, await NFS preparation before constructing the photo library and HTTP server. Pass an unavailable library when preparation fails, then continue through normal `server.listen()` so “ignore NFS then deploy” is observable and testable.
- Preserve startup-fatal behavior for core configuration, database, encryption-key, and CA errors; only the optional NFS path is fail-open.

### 3. Add a contained NFS photo library

- Add a server-side photo-library module responsible for bounded recursive scans, supported-extension/MIME mapping, file-size and aggregate-size checks, metadata normalization, opaque snapshot token creation, and token-to-file lookup.
- Use directory-entry and file metadata APIs that do not follow symlinks. Revalidate the selected file immediately before serving so replacement, deletion, or type changes fail closed; ensure its resolved parent chain remains under the configured root.
- Do not expose absolute paths, source host/export strings, skipped entry names in errors, or arbitrary directory listings. Report only counts and a generic unavailable message to the browser.
- Keep memory bounded by storing metadata/token mappings rather than image bytes. Stream accepted files with exact image content types, `X-Content-Type-Options: nosniff`, bounded/private cache behavior, and normal stream-error cleanup.

### 4. Expose LAN-protected photo endpoints

- Extend `createDashboardServer()` with an injectable photo library so tests do not require a real mount. Add a manifest endpoint such as `GET /api/dashboard/photos` and a tokenized image endpoint under `/api/dashboard/photos/<token>`.
- Apply the existing private-address and allowed-Host checks to both manifest and image requests. Reject malformed/unknown tokens, non-GET methods, stale snapshot entries, traversal attempts, directories, symlinks, unsupported types, and files outside the configured root.
- Return `200` with photo metadata when available, an empty/unavailable manifest when NFS is disabled or cannot be read, and safe `404`/`503` responses for inaccessible image data without leaking filesystem details.
- Leave `serveStatic()` restricted to `publicRoot`; do not add the NFS mount as a second generic static root.

### 5. Replace browser selection with automatic NFS loading

- Refactor `createPhotoController()` to load normalized server photo records and retain its existing decode, ordering, timer, visibility, generation, and transition behavior. Remove object URL ownership/revocation because URLs now point to same-origin API resources.
- Add a bounded manifest request on dashboard initialization with cancellation/generation handling so disposal or a newer load cannot be overwritten by a late result. Decode failures should continue skipping only the affected image.
- Update `public/dashboard.js` to fetch photos automatically, display the first valid background, and show useful states for loading, empty share, NFS unavailable, scan failure, and skipped images while preserving a functional clock-only dashboard.
- Remove the file-input listener and page-cache copy that asks users to reselect photos. A restored page should reload the manifest when necessary rather than referencing revoked browser object URLs.
- Replace the “Choose photos” section in `public/dashboard.html` with read-only NFS background status/explanation. Keep image presentation settings in the existing form, including optional filename display based on safe server metadata.

### 6. Support direct and container deployment safely

- Update `package.json` only as needed to keep `npm start` loading `.env` before the NFS-aware startup; direct `node src/server.js` should use the same startup flow once environment variables are already present.
- Keep Compose unprivileged. Add an optional documented override/profile example that bind-mounts a host-mounted photo directory read-only and selects pre-mounted mode, rather than trying to execute an NFS mount in `node:24-bookworm-slim`.
- Document required host packages and permissions generically, the exact environment variables, direct-start and Compose workflows, how to verify the mount without exposing sensitive values, and the guaranteed fallback when NFS is unavailable.
- Update the README photo-dashboard section to remove browser-selection/session language and explain supported formats, recursive bounded discovery, reload behavior, read-only access, and failure status.

### 7. Add startup, security, and browser regression coverage

- Add unit tests for NFS configuration defaults/normalization, pre-mounted mode, safe mount argument construction, existing matching and conflicting mounts, missing commands, denied/unreachable mounts, timeout cleanup, sanitized warnings, and successful continuation to HTTP listen after every NFS failure class.
- Test the photo library with temporary directories containing supported/unsupported files, oversize files, aggregate/count/depth excess, nested directories, symlinks, replacement/deletion races, and duplicate names. Assert stable metadata, opaque tokens, containment, and bounded scans.
- Extend server tests for manifest and image MIME/security headers, streaming, disabled/unavailable states, stale/invalid tokens, traversal-shaped URLs, LAN/Host denial, unsupported methods, and absence of mount/source paths in responses.
- Update dashboard tests for automatic manifest loading, ordering of server records, empty/unavailable states, cancellation and stale-result suppression, decode skipping, timer cleanup, and removal of object URL and file-picker behavior.
- Keep startup tests independent of a real NFS server by injecting mount inspection/process execution/photo-library seams. Reserve one documented manual integration check for an actual NFS export.

### 8. Release and implementation record

- Bump `package.json` from `0.14.2` to `0.15.0` for the user-visible photo-source and deployment configuration change.
- Write `tasks/23-nfs-dashboard-backgrounds/3-implemented.md` before implementation changes are committed, recording actual environment names, mount behavior, bounds, changed files, verification evidence, real-NFS availability, and any departures from this plan.

## Verification

Run from the repository root:

```bash
node --test test/config.test.js
node --test test/env.test.js
node --test test/dashboard.test.js
node --test test/app-server.test.js
node --test test/server-security.test.js
npm test
npm run check
docker compose config
git diff --check
```

Also verify:

1. Start with no NFS settings and confirm the dashboard listens normally, `/dashboard` shows a no-background status, and all non-photo features work.
2. Start with a reachable test export and authorized non-root mount policy; confirm the mount attempt finishes before the listening message and nested supported images automatically rotate without browser selection.
3. Test name, modification-date, and shuffled order; zero, one, and more than 100 files; invalid and oversized image data; transitions; blur; filename display; hidden-tab pause; reduced motion; and desktop/mobile rendering.
4. Stop or deny the NFS server, use an invalid source, remove the mount executable from the test path, and force a timeout; confirm one sanitized warning is emitted and the HTTP server still starts within the bounded delay.
5. Replace or delete a listed image and introduce symlinks/traversal-shaped requests; confirm no file outside the configured mount root is returned and responses reveal no host filesystem or NFS source path.
6. Run Compose with a host-mounted read-only photo directory and pre-mounted mode; confirm no extra capabilities are required and the container cannot write to the share.
7. Confirm the existing home page, Wake-on-LAN, Linkwarden, Home Assistant, CalDAV, weather, clock, fullscreen, and dashboard preferences are unchanged whether NFS is available or unavailable.

## Acceptance Criteria

- `npm start` attempts the explicitly configured NFS connection before listening and automatically uses supported files from that share as `/dashboard` backgrounds.
- Any NFS setup, timeout, or read failure is bounded and non-fatal: a warning/status is provided, the dashboard server still deploys, and non-photo functionality remains usable.
- The browser file picker and session-only reselection behavior are removed; photo settings and slideshow behavior continue to work with server-provided records.
- NFS access is read-only, uses no shell interpolation or `sudo`, does not run the application as root, and does not expose source strings or absolute filesystem paths.
- Photo discovery and delivery are bounded, reject symlinks/traversal/unsupported files, remain inside the configured root, and are protected by the dashboard's LAN and Host checks.
- Existing installations with no NFS configuration continue to start without new dependencies, while Compose remains unprivileged and supports a host-mounted read-only share.
- Automated checks pass, direct and container deployment instructions are current, and version `0.15.0` plus the implementation record accurately describe the shipped behavior.

## Planning Verification

- Inspected task numbering, startup/configuration flow, static and API routing, dashboard photo HTML/controller/helpers, direct and Compose deployment, README behavior, and relevant startup/security/dashboard tests.
- Accounted for non-root operation, the privileged nature of kernel mounts, fail-open startup, container capability risks, filesystem containment, NFS disconnects, and the existing slideshow limits and lifecycle.
- This planning task adds only `tasks/23-nfs-dashboard-backgrounds/1-plan.md`; implementation code remains unchanged.
