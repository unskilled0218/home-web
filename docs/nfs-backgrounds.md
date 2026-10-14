# NFS backgrounds

For a direct run, install the NFS client supplied by the host operating system and configure the dashboard service account to mount only the intended export without an interactive password. The application never invokes `sudo` and must not run as root. Set the export and local mount point in `.env`:

```sh
NFS_MOUNT_MODE=mount
NFS_SOURCE=nas.lan:/photos
NFS_MOUNT_PATH=./data/backgrounds
NFS_MOUNT_OPTIONS=vers=4.2
```

`npm start` checks for an existing matching NFS/NFS4 mount, otherwise invokes `mount` with the configured source and path before opening the HTTP listener. It always forces `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`, uses no shell interpolation, and bounds mount and disconnected-share operations. A missing client, denied mount, unreachable server, conflicting or unsafe mount point, timeout, or failed verification emits one generic warning and starts the dashboard without photos. The process does not unmount the share at shutdown because the mount may be shared or managed externally. `NFS_MOUNT_OPTIONS` accepts only comma-separated option tokens and cannot relax the forced bounded read-only settings; background, hard-mount, and retry-control options are rejected.

To read a directory that is already mounted by the host or service manager, mount it with `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`, omit `NFS_SOURCE`, and use:

```dotenv
NFS_MOUNT_MODE=existing
NFS_MOUNT_PATH=/srv/dashboard-photos
```

The standard Compose service runs as root but does not install an NFS client or receive mount capabilities. The host-mounted share must allow that container process to read and traverse the files; account for the NFS export's root-squash and mode settings on the host. Mount NFS on the Docker host with the bounded read-only options above, then enable the integrated read-only mount:

```dotenv
NFS_MOUNT_MODE=existing
NFS_HOST_MOUNT_PATH=/srv/dashboard-photos
```

Save those values in `.env`, then run `docker compose up -d`. Compose mounts `${NFS_HOST_MOUNT_PATH:-./photos}` at `/photos` but leaves NFS disabled unless existing mode is set. Direct development uses `NFS_MOUNT_MODE=existing` and the application-visible `NFS_MOUNT_PATH` in `.env`, followed by `node scripts/dev.js`. A host mount alone does not configure a server that already started with NFS disabled.

## TrueNAS host mount example

For Docker/Compose, use **existing** mode. Mount the share on the Docker host, not inside the dashboard container. For example, the operator can configure an existing mount directory in `/etc/fstab`:

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
NFS_MOUNT_MODE=existing
NFS_HOST_MOUNT_PATH=/srv/dashboard-photos
```

Compose keeps `NFS_MOUNT_PATH=/photos` inside the container; `NFS_HOST_MOUNT_PATH` is the different host-side path. A `:ro` Docker bind protects against writes but does not convert a host's `hard,timeo=600` NFS retry policy to `soft,timeo=20`. The application validates mount options visible in its own namespace and can reject an unsafe share before accessing its files. Container root must still have read/traverse access under the export's root-squash/ACL rules; do not disable root-squash as a generic workaround.

## Diagnose by stage

1. Confirm the deployment and effective NFS settings. Compose defaults to disabled; an absent/mistyped host path can bind an empty local directory rather than the share. Do not dump unrelated environment values or secrets.
2. Check name resolution and NFS service reachability from the relevant host/container. DNS success and TCP port 2049 access establish only transport reachability, not export authorization, a valid NFSv4 export path, readable photos, or a mounted share. `showmount` may not establish NFSv4-only export availability.
3. Inspect mount identity/options on the host and inside the application namespace. A generic unavailable warning can result from missing safety options or no exact mount at the configured path, even when the NAS is reachable. Do not remove the checks or accept an arbitrary directory to bypass a rejected mount.
4. Only after safe topology and a bounded cleanup mechanism are established, check directory enumeration and a small supported-image read as the application identity. `stat()` alone proves neither traversal nor file readability. Do not chmod/chown, write to the export, or run a recursive inventory merely to diagnose access.
5. Check the manifest and image separately. `/api/dashboard/photos` returning `available: false` means the photo source/scan is unavailable; `available: true` with `photos: []` means no accepted files were found. Supported types are JPEG, PNG, WebP, and GIF; limits include 100 accepted files, 20 MiB per file, 200 MiB total, 5,000 scanned entries, and eight directory levels. Symbolic links and unsupported/empty/oversized files are excluded. Retrieve one returned opaque image URL before testing browser display.
6. Confirm browser decoding and a visible photo layer, not just an HTTP 200. “No supported photos were found” differs from “NFS backgrounds are unavailable”; image-decode failures can also cause individual photos to be skipped. Keep the solid-background fallback and unrelated overlays usable.

Use explicit deadlines for network probes and verified owned-process cleanup for live filesystem checks. Photo scan deadlines are cooperative checks between filesystem awaits, not guaranteed cancellation of a stuck kernel NFS operation. A shell timeout, client HTTP timeout, or JavaScript promise race cannot prove filesystem cleanup. If safe cleanup is unavailable (including signal-denied environments), stop before file access and request operator-run checks. Keep live stage results separate from mocked unit tests; never report a working export based only on DNS, mount metadata, or simulated fixtures.

The browser receives only bounded relative names and temporary opaque image URLs. Absolute mount paths and the NFS source are not exposed. Photo API requests retain the dashboard's trusted-LAN and allowed-Host checks.

See [Docker deployment](deployment.md) for container setup and [Photo dashboard](dashboard.md) for image preferences.

[Back to README](../README.md)
