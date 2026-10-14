# goal

## command

- check nfs connection
  - it seems like nfs doesn't work
- test: `truenas.lan:/mnt/my-1/sync/Wallpaper`

Request source: `~/workdir/command.md`.

## goal

Diagnose why NFS backgrounds appear unavailable using `truenas.lan:/mnt/my-1/sync/Wallpaper` as the requested test export. Establish where the failure occurs, verify the supported dashboard photo path end to end when the environment permits it, and identify the precise project correction or operator action needed. Do not claim the export works based only on mocked tests or directory existence.

## Current Behavior

- `src/config.js` selects disabled, application-managed mount, or existing-mount mode from `NFS_MOUNT_MODE`, `NFS_SOURCE`, `NFS_MOUNT_PATH`, and `NFS_MOUNT_OPTIONS`. No export is hard-coded.
- `src/nfs.js` inspects `/proc/self/mountinfo`, requires bounded read-only safety options, optionally invokes the NFS mount client, and verifies the resulting mount. Preparation failures collapse to a generic `failed` result; `src/server.js` logs a generic warning and falls back to no photos.
- `docker-compose.yml` defaults NFS to disabled and binds an operator-provided host directory to `/photos`. The image/Compose deployment expects host-managed NFS rather than privileged mounting inside the container. Existing-mode validation examines the mount visible to the application, which may differ from the host's mount view.
- `src/photo-library.js` scans accepted directories for bounded supported image records and serves files through opaque photo URLs. Configuration, mount verification, traversal permissions, scanning, HTTP delivery, and browser decoding are distinct possible failure points.
- `docs/nfs-backgrounds.md` describes direct and Compose setup, required read-only options, and the unavailable fallback. Unit tests use injected mount operations and temporary image directories; they do not prove this TrueNAS export is reachable or readable.

## Required Outcomes

- Determine the relevant run mode and effective NFS configuration without exposing unrelated environment values, integration secrets, or persisted user data. Distinguish an unset/disabled source from an actual failed connection.
- Use bounded, read-only diagnostics for the requested server/export: name resolution and relevant service reachability, client/tool availability, visible mount identity/options, and application-user directory/file access. Separate container limitations from host/export failures; DNS or TCP success alone is not a successful NFS mount.
- Inspect direct-run and host-mounted Compose boundaries as needed. Establish whether existing-mode validation correctly recognizes the intended read-only host share as seen inside the container, rather than assuming every bind mount has the same filesystem/options representation.
- Trace the photo pipeline through mount preparation, supported image discovery, manifest response, protected image delivery, and browser decoding/display. Distinguish unavailable, available-but-empty, unsupported/filtered files, and unreadable content. Preserve image bounds, symlink/path protections, trusted-host checks, and normal background fallback.
- Record concrete observations and the earliest failing stage, with actionable operator guidance for missing clients, mount authorization, TrueNAS export/client restrictions, NFS version/path compatibility, root-squash/traversal permissions, or host/container bind configuration where supported by evidence.
- If a project defect is confirmed, scope its correction during planning and preserve existing safe direct/existing-mount behavior. Avoid broad rewrites or relaxing safety validation merely to make an unverified share pass. Keep diagnostic details appropriately scoped: do not expose absolute export paths, mount commands, or raw host errors in public photo responses.
- Add focused regression verification for any confirmed code correction and document the actual live test result separately from simulated tests. If required host privileges, packages, network access, or a prepared mount are unavailable, state the blocker and exact operator prerequisite instead of claiming live success.

## Acceptance Criteria

- The report identifies whether the requested export was actually tested, which stages passed/failed, and the evidence supporting the diagnosis. Live mounting, manifest/image delivery, and rendered-photo success are not inferred from one another.
- A permitted live test either demonstrates a supported image from this export reaching the dashboard or records the precise blocking stage and operator action needed. An empty supported-image catalog is reported distinctly from connection failure.
- Any eventual project correction has targeted regression coverage and retains read-only bounded mount options, photo limits/security, non-fatal unavailable behavior, saved preferences, and unrelated integrations.
- Direct/Compose setup guidance matches the diagnosed deployment path. No root operation, package installation, NAS/export mutation, mount replacement/unmount, permission change, or privileged container configuration is performed automatically.

## Scope Boundary

This goal stage only creates and commits this task document. No live mount/network probe, implementation change, runtime server, environment-file edit, dependency/version update, or user-data mutation is performed here. Later work must request operator help for missing packages or privileges and must not alter TrueNAS or production mounts without explicit authorization. Archived review findings are not automatically included; address them only if directly implicated by the confirmed NFS failure. Do not touch `todo.md`.
