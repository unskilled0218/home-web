# NFS backgrounds

- [NFS backgrounds](#nfs-backgrounds)
  - [Server slideshow and filename eligibility](#server-slideshow-and-filename-eligibility)
  - [Metadata batches and image lookahead](#metadata-batches-and-image-lookahead)
  - [Scan limits and photo counts](#scan-limits-and-photo-counts)
  - [TrueNAS host mount example](#truenas-host-mount-example)
  - [Diagnose by stage](#diagnose-by-stage)

`NFS_MOUNT_MODE` accepts `on` and `off` after trimming whitespace and ignoring case. An omitted value defaults to `off`, even when `NFS_SOURCE` is set. `off` performs no NFS preparation or photo discovery. `on` requires `NFS_MOUNT_PATH`: a nonempty `NFS_SOURCE` selects application-managed mounting, and an empty source selects an existing mount. Invalid configuration is nonfatal and leaves photos unavailable; malformed source/options can still emit a warning under `off`. Restart the server after changing these settings.

Migrate old values before upgrading: replace `disabled` with `off`, replace `mount` with `on` while retaining the source, and replace `existing` with `on` while clearing `NFS_SOURCE`. The old values and an explicitly empty mode are rejected. Deployments that previously enabled NFS by setting only `NFS_SOURCE` must now explicitly set `NFS_MOUNT_MODE=on`.

For a direct run with application-managed mounting, install the NFS client supplied by the host operating system and configure the dashboard service account to mount only the intended export without an interactive password. The application never invokes `sudo` and must not run as root. Set the export and local mount point in `.env`:

```sh
NFS_MOUNT_MODE=on
NFS_SOURCE=nas.lan:/photos
NFS_MOUNT_PATH=./data/backgrounds
NFS_MOUNT_OPTIONS=vers=4.2
```

`npm start` checks for an existing matching NFS/NFS4 mount, otherwise invokes `mount` with the configured source and path before opening the HTTP listener. It always forces `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`, uses no shell interpolation, and bounds mount and disconnected-share operations. A missing client, denied mount, unreachable server, conflicting or unsafe mount point, timeout, or failed verification emits one generic warning and starts the dashboard without photos. The process does not unmount the share at shutdown because the mount may be shared or managed externally. `NFS_MOUNT_OPTIONS` accepts only comma-separated option tokens and cannot relax the forced bounded read-only settings; background, hard-mount, and retry-control options are rejected.

To read a directory that is already mounted by the host or service manager, mount it with `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`, clear `NFS_SOURCE`, and use:

```dotenv
NFS_MOUNT_MODE=on
NFS_SOURCE=
NFS_MOUNT_PATH=/srv/dashboard-photos
```

The standard Compose service runs as root but does not install an NFS client or receive mount capabilities. The host-mounted share must allow that container process to read and traverse the files; account for the NFS export's root-squash and mode settings on the host. Mount NFS on the Docker host with the bounded read-only options above, then enable the integrated read-only mount:

```dotenv
NFS_MOUNT_MODE=on
NFS_SOURCE=
NFS_HOST_MOUNT_PATH=/srv/dashboard-photos
```

Save those values in `.env`, then run `docker compose up -d`. Compose mounts `${NFS_HOST_MOUNT_PATH:-./photos}` at `/photos` but leaves NFS disabled unless `NFS_MOUNT_MODE=on` is set. Keep `NFS_SOURCE` empty because the container uses the host-prepared mount. Direct development uses `NFS_MOUNT_MODE=on`, an empty source, and the application-visible `NFS_MOUNT_PATH` in `.env`, followed by `node scripts/dev.js`. A host mount alone does not configure a server that already started with NFS disabled.

## Server slideshow and filename eligibility

One Global server-owned slideshow scans at startup and every 60 seconds after the last scan settles, including with no connected browsers. Discovery continues if Global preferences cannot load; only Global selection/rotation pauses until valid preferences return. Scans never overlap, and rotation continues from the last successful inventory while a refresh runs. Saved Global name/date/random ordering and 5–3600-second intervals apply to Global viewers and Local followers, which join the current selection through compact metadata polling capped at five seconds. Shared playback traverses the full eligible inventory. Local follows Global by default, including existing profiles without an explicit choice. Turn off **Settings → Images → Show the same image as Global** and save to independently order/play a stable subset of up to 100 eligible images without changing the Global cursor. Random traversal boundaries avoid immediate repeats for multi-image pools. A process restart creates a fresh shared sequence.

The follow option is stored as `followGlobalPhotos` in the Local browser record, not Global preferences. Local followers retain their own transitions, filename display, opacity, blur, and background settings. Order/Interval are ignored and disabled while following, but saved values survive for independent playback. Shared selection is not frame-perfect synchronization: polling, decode readiness, and Local transitions can differ. Saving a source change or switching settings scope clears the previous image before replacement loading; failed replacement reads/decodes leave the solid background until recovery. Last-good-frame retention applies within an unchanged source. Only one owner remains active; following does not retrieve the Local manifest or advance the server cursor.

Slideshow eligibility filters the complete supported-file inventory. Relative names must be nonempty, well-formed Unicode of at most 1,024 UTF-8 bytes, with `/` separators and no empty, `.` or `..` segments, backslashes, absolute drive paths, or U+0000–U+001F/U+007F control characters. Accepted names, including quotes and non-ASCII characters, remain unchanged. Rejected names are excluded before selection rather than shortened or substituted. `/api/dashboard/slideshow` reports eligible-only `count`, without the former 100-image ceiling; an available inventory with all records excluded is authoritative empty (`count: 0`, `current: null`, no deadline). The legacy `/api/dashboard/photos` manifest retains its filename treatment and bounded projection. Default version-1 Global snapshots contain only the current image; opt-in version 2 adds one upcoming image. Both fit within 8,192 serialized UTF-8 bytes, including JSON escaping, regardless of inventory size.

Disabled NFS performs no discovery. Failed mount preparation remains unavailable until configuration/restart; the server does not retry mounting. A prepared source that later fails retries discovery on the normal cadence. A failed rescan retains last-good metadata/current selection marked stale; a successful empty scan clears it. Browsers retain the last decoded image during transient metadata or image failures and retry without advancing the shared sequence. In both Local and Global modes, a failed or timed-out image decode schedules another attempt within five seconds of settlement, even for a single unchanged image without rotation or metadata refresh; each decode retains its ten-second deadline. Hiding the page, changing scope/selection, or disposing the controller cancels its pending image retry. Successful decoding restores the source status. On first-load failure, disabled NFS, or confirmed empty state, the solid background and unrelated widgets remain usable. URLs change when observed file size/modification metadata changes. Active inventory tokens never expire due to a file-count cache limit; previous generations remain resolvable for 30 seconds after replacement, subject to the files still being readable and safe.

Image data stays streamed on demand rather than preloaded into server memory. Shutdown cancels slideshow timers and drains actual pending scans alongside admitted HTTP work before SQLite closes. Cooperative deadlines do not prove cancellation of a stuck filesystem operation; the existing global shutdown deadline reports unsafe/nonzero cleanup when work cannot be confirmed.

Independent Local playback reads `GET /api/dashboard/photos/local`, a version-1 `{ version, enabled, available, count, photos }` manifest capped at 100 eligible records and 256 KiB of serialized UTF-8 JSON. The server selects eligible records before applying this count limit, so rejected legacy names cannot hide later eligible files. Membership uses stable relative-name order, independent of directory enumeration; the browser can order that subset independently. `count` matches the array length. Disabled sources return `enabled: false`, `available: false`, and an empty array without scanning; failed enabled preparation keeps `enabled: true`, `available: false`. Successful empty/all-rejected scans are `available: true`, `count: 0`. Cached last-good projections remain usable during a failed refresh; Settings separately marks the inventory stale. Local browsers clear confirmed disabled/empty sources and retain last-good state on outages within an unchanged source. Manifest/status reads never start scans or configure/advance the Global sequence.

## Metadata batches and image lookahead

Global and independent Local owners share the same filename sequencer but keep independent cursors and eligible pools. Local followers use the Global cursor. A current metadata batch and one queued batch use a 30-second preparation horizon: `ceil(30 / intervalSeconds)`, clamped to 1–32 entries and the remaining eligible count. At five seconds the target is six entries; at 60 seconds it is one. Combined queued photo metadata is capped at 64 KiB of actual serialized UTF-8 bytes, shrinking batches when needed. Queue/index/visited references use the inventory's conservative metadata allowance. These are internal limits, not saved preferences or a fixed ten-image requirement.

The first selection bootstraps promptly. Preparation then yields asynchronously and fills bounded filename batches from discovered metadata only. It does not enumerate directories, open `/photos`, hash files, or preload image bytes. Reserved filenames become visited only when selected. A smaller final batch finishes the cycle before another cycle begins; random cycles avoid an immediate boundary repeat when at least two filenames exist. Holding a displayed frame during recovery does not consume another selection. Identical bytes under different filenames remain separate eligible files.

Inventory changes preserve visited surviving filenames and surviving reservations in order, drop removed identities, and admit new filenames into the remainder. Updated URLs/modification times at the same filename do not make it unseen. Queued names resolve against the active inventory, so long intervals do not depend on expired 30-second grace tokens or retain old generations. Unchanged refreshes and interval/presentation changes preserve traversal progress and the published preview. Changing order or restarting an owner deliberately starts a new traversal. Deleted current files select an eligible replacement; confirmed empty/disabled sources clear normally.

`GET /api/dashboard/slideshow` remains strict version 1. `GET /api/dashboard/slideshow?version=2` adds nullable `next` and a separate nonnegative `queueRevision`; `revision` still describes current selection changes. `next` is null for disabled/unavailable/empty/single-image pools or pending preparation, and otherwise differs from `current` by filename. Unsupported explicit versions return HTTP 400. Reads remain pure and never initiate preparation, scans, streams, or rotation. Neither metadata batch is sent to Global viewers. New followers accept version 1 as a compatibility path without lookahead.

A visible Global or Local-following follower with a successful version-2 multi-image snapshot and `next: null` polls after the smaller of 500 milliseconds and its normal deadline-aware delay. It reuses one poll timer and one in-flight read, restores normal polling when ready, and keeps five-second recovery after read failures. Independent Local playback disables automatic follower HTTP polling; coalesced completion/reconciliation notifications deliver the latest synthetic version-2 snapshot, including changes during an earlier read. Preview-only delivery changes neither current revision nor selection deadline, foreground element, or transition.

After displaying current, the browser decodes only the immediate upcoming image, retaining its element until authoritative selection promotes it into the view. Repeated previews reuse ready/in-flight work; later batch entries remain metadata-only. Urgent current-image work takes priority over obsolete speculation. Failed/stalled decoding keeps the frame and retries within five seconds after failure settlement, with a ten-second deadline per attempt. Global selection never waits for browser readiness, and a late browser skips missed selections.

Application ownership is one foreground layer, at most one outgoing transition layer, and one speculative image slot. Blur can add one background image to each presentation layer. Promotion transfers the decoded foreground element to the view; removing a layer clears its foreground/blur sources. Cancellation, hidden/persisted-page suspension, scope replacement, instance retirement, and disposal release speculative resources and reject late results. Resume reads fresh metadata without consuming a selection. Browser/OS caches can retain additional memory; these ownership bounds do not mean total decoded memory is exactly two images. Stop drains outstanding metadata preparation alongside existing scan/HTTP shutdown work.

## Scan limits and photo counts

Settings → Images shows the completed Global playable image-file count separately from transient display errors. `GET /api/dashboard/photos/status` supplies the same cached count in either settings scope, with supported/eligible counts, filename/permission/race exclusions, entries examined, scan loading/completion/staleness, and a safe error reason. Before the first completed scan the count is unknown, not zero. During failed refreshes the last completed count is labeled stale. Settings polls this compact status only while the Images tab is visible.

- **Supported files:** successfully inspected nonempty regular JPEG, PNG, WebP, and GIF files of at most 20 MiB. Global discovery has no 5,000-entry, eight-level, 100-file, or 200 MiB aggregate source-byte cutoff. Symlinks are excluded, and traversal remains contained beneath the prepared root.
- **Eligible Global files:** supported files accepted by shared filename validation; `eligible + filenameExcluded = supported`. File-local permission denials and vanished/type-changed files are separately reported because their metadata may be unknown. A completed inventory describes the readable observed tree, not an atomic census of every image stored on the NAS.
- **Bounded manifests:** Independent Local receives the first 100 eligible files in stable name order, without an aggregate source-byte limit. Local followers use the shared full-inventory selection instead. Legacy receives at most 100 supported files in stable name order within 200 MiB of aggregate source bytes, skipping an over-budget candidate and continuing to smaller later files. Neither manifest is the complete Global inventory.
- **Current image:** Global snapshots contain one `current` record even when `count` exceeds 7,000, plus at most one `next` record in version 2. Healthy followers normally request current and immediate next; batches never trigger bulk image requests. Check the completed count and later rotation before concluding only one image was discovered.

Discovery enumerates incrementally and yields between bounded batches, including metadata ordering. A slow but progressing scan continues to completion instead of restarting after ten seconds. Complete generations publish atomically; playback continues during refresh and unchanged metadata does not reset a traversal. A 7,001-image eligible tree therefore supplies 7,001 Global selections, including files beyond the old scan and token limits. Name/date order and random traversal cover the complete eligible inventory.

Metadata accounting defaults to 64 MiB across active, staging, and grace-period generations, including conservative allowances for paths, token maps, projections, and playback indexes. This is an accounting guard, not a guaranteed JavaScript heap limit. Exhaustion discards staging and reports `resource-limit`/incomplete instead of silently publishing a smaller library; last-good playback remains available. Image bytes are streamed on demand with eight concurrent streams, rather than retained in the inventory. Actual Raspberry Pi memory includes browser decoding and must be measured separately.

File-local `ENOENT`/`ENOTDIR` races and permission denials are counted exclusions. A verified replacement symlink/nonregular file is excluded. Directory/root loss, unreadable subtrees, containment failures, unknown errors, and source I/O failures such as `EIO`, `ESTALE`, or `ETIMEDOUT` fail the generation and report `scan-failed`; partial directory inventories never claim completeness. Cooperative stopping closes owned traversal resources after pending filesystem work actually settles. It cannot cancel a stuck kernel operation; the overall application shutdown deadline remains authoritative for unconfirmed cleanup.

## TrueNAS host mount example

For Docker/Compose, use `NFS_MOUNT_MODE=on` with an empty `NFS_SOURCE`. Mount the share on the Docker host, not inside the dashboard container. For example, the operator can configure an existing mount directory in `/etc/fstab`:

```fstab
truenas.lan:/mnt/my-1/sync/Wallpaper /srv/dashboard-photos nfs ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2,vers=3,_netdev,nofail 0 0
```

Use your actual host mount path in place of `/srv/dashboard-photos`. This example preserves NFSv3, which was observed for this export during diagnosis; it is not a requirement for other exports. Verify the version and client-visible export path for your server. Install the host's NFS client through the operator if missing (`nfs-common` on Debian/Ubuntu). `_netdev,nofail` affect boot handling; they do not make a default hard mount safe for this dashboard. The `soft` policy is appropriate only for this read-only photo use, not a recommendation for writable NFS databases or general shared storage.

Editing `/etc/fstab` does not change an active mount. During operator-controlled maintenance, stop consumers of that mount (including the dashboard), unmount the path normally, then mount it again with the revised entry. Do not force/lazy-unmount a busy share or assume `mount -a` replaces existing options. Do not change a mount used by other applications without coordinating with them. If mounting a separate instance of the same export while retaining an existing hard mount, Linux may share its superblock/retry policy; the operator must account for that (for example, an isolated `nosharecache` read-only test mount) and verify actual options, not just the requested command.

Check the active host mount without listing files:

```sh
findmnt -M /srv/dashboard-photos -o TARGET,SOURCE,FSTYPE,OPTIONS
```

It must be the intended NFS/NFS4 mount with `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`. Then set these values for Compose, replacing the host path as needed:

```sh
NFS_MOUNT_MODE=on
NFS_SOURCE=
NFS_HOST_MOUNT_PATH=/srv/dashboard-photos
```

Compose keeps `NFS_MOUNT_PATH=/photos` inside the container; `NFS_HOST_MOUNT_PATH` is the different host-side path. A `:ro` Docker bind protects against writes but does not convert a host's `hard,timeo=600` NFS retry policy to `soft,timeo=20`. The application validates mount options visible in its own namespace and can reject an unsafe share before accessing its files. Container root must still have read/traverse access under the export's root-squash/ACL rules; do not disable root-squash as a generic workaround.

## Diagnose by stage

1. Confirm the deployment and effective NFS settings. Compose defaults to disabled; an absent/mistyped host path can bind an empty local directory rather than the share. Do not dump unrelated environment values or secrets.
2. Check name resolution and NFS service reachability from the relevant host/container. DNS success and TCP port 2049 access establish only transport reachability, not export authorization, a valid NFSv4 export path, readable photos, or a mounted share. `showmount` may not establish NFSv4-only export availability.
3. Inspect mount identity/options on the host and inside the application namespace. A generic unavailable warning can result from missing safety options or no exact mount at the configured path, even when the NAS is reachable. Do not remove the checks or accept an arbitrary directory to bypass a rejected mount.
4. Only after safe topology and a bounded cleanup mechanism are established, check directory enumeration and a small supported-image read as the application identity. `stat()` alone proves neither traversal nor file readability. Do not chmod/chown, write to the export, or run a recursive inventory merely to diagnose access.
5. Check `/api/dashboard/photos/status` for completed counts, exclusions, loading, and stale/incomplete errors. The Local/legacy manifests are bounded projections of cached inventory, not complete export listings. Retrieve one returned opaque image URL before testing browser display; see [scan limits and photo counts](#scan-limits-and-photo-counts).
6. Inspect `/api/dashboard/slideshow` for `enabled`, `available`, `loading`, `stale`, eligible `count`, `current`, and the rotation deadline, or inspect `/api/dashboard/photos/local` for the Local eligible array. Confirm actual decoding and later playback, not just HTTP 200 or one startup image request. Confirmed empty inventory differs from unavailable/stale discovery. Keep the solid fallback and unrelated overlays usable.

Use explicit deadlines for network probes and verified owned-process cleanup for live filesystem checks. Cooperative photo scan batches do not guarantee cancellation of a stuck kernel NFS operation. A shell timeout, client HTTP timeout, or JavaScript promise race cannot prove filesystem cleanup. If safe cleanup is unavailable (including signal-denied environments), stop before file access and request operator-run checks. Keep live stage results separate from mocked unit tests; never report a working export based only on DNS, mount metadata, or simulated fixtures.

The browser receives only bounded relative names and temporary opaque image URLs. Absolute mount paths and the NFS source are not exposed. Photo API requests retain the dashboard's trusted-LAN and allowed-Host checks.

See [Docker deployment](deployment.md) for container setup and [Photo dashboard](dashboard.md) for image preferences.

[Back to README](../README.md)
