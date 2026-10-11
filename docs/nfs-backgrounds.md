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

```sh
NFS_MOUNT_MODE=existing
NFS_MOUNT_PATH=/srv/dashboard-photos
```

The standard Compose service runs as root but does not install an NFS client or receive mount capabilities. The host-mounted share must allow that container process to read and traverse the files; account for the NFS export's root-squash and mode settings on the host. Mount NFS on the Docker host with the bounded read-only options above, then enable the integrated read-only mount:

```sh
NFS_MOUNT_MODE=existing NFS_HOST_MOUNT_PATH=/srv/dashboard-photos docker compose up -d
```

Compose mounts `${NFS_HOST_MOUNT_PATH:-./photos}` at `/photos` but leaves NFS disabled unless `NFS_MOUNT_MODE=existing` is set.

The browser receives only bounded relative names and temporary opaque image URLs. Absolute mount paths and the NFS source are not exposed. Photo API requests retain the dashboard's trusted-LAN and allowed-Host checks.

See [Docker deployment](deployment.md) for container setup and [Photo dashboard](dashboard.md) for image preferences.

[Back to README](../README.md)
