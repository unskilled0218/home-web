# NFS photos

- [NFS photos](#nfs-photos)
  - [Enable photos](#enable-photos)
  - [Docker setup](#docker-setup)
  - [Application-managed mount](#application-managed-mount)
  - [Playback and limits](#playback-and-limits)
  - [Troubleshooting](#troubleshooting)

## Enable photos

Photos are optional and disabled by default. `NFS_MOUNT_MODE` accepts only `on` or `off`, ignoring case and surrounding whitespace. Restart after configuration changes.

For a safe existing NFS mount, set this in `.env`:

```dotenv
NFS_MOUNT_MODE=on
NFS_SOURCE=
NFS_MOUNT_PATH=/srv/dashboard-photos
```

The mount must use `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`. These bounded read-only settings are required. A normal directory or unsafe mount is not a substitute.

Setting only `NFS_SOURCE` does not enable photos. Old modes `disabled`, `mount`, and `existing` are rejected: use `off`, or `on` with a source for managed mounting and without a source for an existing mount.

Mount failures leave the rest of the dashboard usable. Fix preparation errors and restart; mounting is not retried automatically.

## Docker setup

Ask the operator to mount NFS on the Docker host. The container has no NFS client or mount capabilities. A host `/etc/fstab` example is:

```fstab
truenas.lan:/mnt/my-1/sync/Wallpaper /srv/dashboard-photos nfs ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2,vers=3,_netdev,nofail 0 0
```

Use your actual export path and supported NFS version; version 3 is only an example. The host needs an NFS client (`nfs-common` on Debian/Ubuntu). The `soft` policy here is for read-only photos, not writable databases or general storage.

Check the active mount without reading files:

```sh
findmnt -M /srv/dashboard-photos -o TARGET,SOURCE,FSTYPE,OPTIONS
```

Then set Compose's host path in `.env`:

```dotenv
NFS_MOUNT_MODE=on
NFS_SOURCE=
NFS_HOST_MOUNT_PATH=/srv/dashboard-photos
```

Run `docker compose up -d`. Compose exposes that mount at `/photos` and sets `NFS_MOUNT_PATH` accordingly. A read-only Docker bind does not change an unsafe host NFS retry policy.

Editing `/etc/fstab` does not update a live mount. Coordinate maintenance with all consumers, stop them, and remount normally. Do not force/lazy-unmount a busy share. Linux can share retry policies between mounts of the same export; verify actual options.

Container root still needs read/traverse access under the export's root-squash and ACL rules. Do not disable root-squash as a generic fix.

## Application-managed mount

For direct Node runs, the operator must install the NFS client and grant the service account permission to mount only the intended export without an interactive password. Do not run the direct application as root; it never invokes `sudo`.

```dotenv
NFS_MOUNT_MODE=on
NFS_SOURCE=nas.lan:/photos
NFS_MOUNT_PATH=./data/backgrounds
NFS_MOUNT_OPTIONS=vers=4.2
```

Startup reuses a matching safe mount or mounts before opening HTTP. Required safety options cannot be relaxed. Failures produce a warning and start without photos. Shutdown does not unmount the share.

## Playback and limits

Global playback scans at startup and about 60 seconds after each scan finishes, even without viewers. It uses saved name/date/random ordering and intervals from 5 to 3600 seconds. Scans do not overlap; unchanged refreshes preserve traversal progress.

Local Images follows Global by default with its own presentation settings. Disable **Show the same image as Global** and save for independent Local playback. Shared selection is not frame-perfect synchronization.

- Supported files: Nonempty regular JPEG, PNG, WebP, and GIF files, at most 20 MiB each. Symlinks are excluded.
- Global inventory: No fixed entry, depth, file-count, or aggregate source-byte cutoff. Metadata accounting defaults to 64 MiB; exceeding it rejects the new scan rather than publishing a partial library.
- Eligible filenames: Valid relative Unicode paths, at most 1,024 UTF-8 bytes, without traversal segments, backslashes, or control characters.
- Independent Local manifest: First 100 eligible files in stable filename order.
- Legacy manifest: Up to 100 supported files within 200 MiB of aggregate source bytes.
- Browser loading: Current image and one immediate upcoming image, not a batch of image downloads. Outgoing transitions and blur layers can temporarily add memory.

**Settings → Images** reports the completed Global playable count, exclusions, and stale/incomplete status. Unknown before the first scan is not zero. One `current` record does not mean a one-image library.

Temporary scan or display failures retain last-good state marked stale. Confirmed empty or disabled sources clear photos. Failed decoding retries within five seconds after settlement, with a ten-second deadline per attempt. Changing source clears the previous frame until the replacement loads.

**Show image** controls desktop visibility; **Show image on mobile** controls widths up to and including 600px. **Hide image in fullscreen** overrides either profile until fullscreen ends. Save in Images to apply. Hiding photos also hides blur and filenames without stopping playback or requests. Hidden browser pages pause their own work. Image bytes stream on demand; metadata limits do not guarantee total server or browser memory usage.

## Troubleshooting

1. Confirm effective mode and paths. A missing Compose host path may expose an empty directory instead of NFS.
2. Check DNS and NFS reachability. Port 2049 access alone proves neither export permission nor readable files.
3. Inspect exact mount identity and safety options on the host and inside the application namespace. Do not bypass rejected checks.
4. Only with bounded cleanup available, test small reads as the application identity. Do not change permissions, write to the export, or run a recursive inventory just to diagnose access.
5. Check `/api/dashboard/photos/status` for completed counts, exclusions, and stale/incomplete errors.
6. Inspect `/api/dashboard/slideshow` or `/api/dashboard/photos/local`, then verify one returned image decodes and later playback advances.

`/api/dashboard/slideshow?version=2` includes an optional upcoming image; metadata reads never advance playback. Local/legacy manifests are bounded projections, not full export listings. APIs expose relative names and opaque image URLs, not absolute mount paths.

A shell timeout or JavaScript deadline cannot prove a stuck kernel NFS operation stopped. If safe cleanup is unavailable, stop before file access and ask the operator to run checks. Automated fixtures do not prove a live NAS works.

[Back to README](../README.md)
