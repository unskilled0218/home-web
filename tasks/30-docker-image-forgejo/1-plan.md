# Task 30: Build and Publish the Docker Image to Forgejo

## Objective

Package the dashboard as an immutable, unprivileged Node 24 image and add a repeatable release workflow that tests the exact source revision, publishes versioned AMD64/ARM64 images to the Forgejo container registry, updates `latest` only after a successful release, and keeps deployment data and secrets outside the image.

## Request and Scope

- Source: `~/workdir/command.md`: create a Docker image and push it to Forgejo, using `https://git.lan/dev/my-rss/src/branch/main/scripts` as the release-workflow reference.
- Publish the registry image as `git.lan/dev/home-web`, matching this repository's `dev/home-web` Forgejo origin.
- Adapt the reference project's validation, multi-platform Buildx, token handling, immutable release tag, Forgejo release, archive/checksum, and `latest` promotion patterns to this Node application. Do not copy Python virtual-environment, Playwright-browser installation, port, data-path, or root-runtime assumptions that do not apply here.
- Keep direct `npm start` development unchanged. Container deployment must run the code baked into the image instead of bind-mounting the repository over it.
- Preserve host networking for Wake-on-LAN broadcasts, the configurable runtime UID/GID, persistent database and encryption-key files, optional private CA files, and the existing host-mounted NFS photo override.
- Do not commit a Forgejo token, Docker credentials, private CA, database, encryption key, generated image archive, or other deployment secret/artifact.

## Inspected Context

- The project is on clean `main` at `c28139f`, version `0.16.3`, with no Git tags. Task 30 is the next number after inspecting `tasks/`.
- `package.json` requires Node 24 and has no runtime dependencies. Production starts with `node src/server.js`; `@playwright/test` is development-only and must not be installed in the runtime image.
- `src/server.js` serves the checked-in `public/` assets, opens SQLite through `DATABASE_PATH`, creates/reuses the integration credential key under the configured key-file path, handles termination signals, and needs no compile or asset-build step.
- The current `docker-compose.yml` uses `node:24-bookworm-slim`, bind-mounts the full checkout read-only at `/app`, stores mutable files under `/app/data`, uses host networking, and runs as `${DASHBOARD_UID:-1000}:${DASHBOARD_GID:-1000}`. There is no `Dockerfile`, `.dockerignore`, or release script.
- Relative private-CA paths currently work because the whole checkout is mounted. Removing that mount requires a dedicated read-only `./certs:/app/certs` deployment mount or documented equivalent while continuing to keep certificate material out of the image and Git.
- `docker-compose.nfs.yml` adds an externally mounted photo directory at `/photos` and configures `NFS_MOUNT_MODE=existing`; it can remain an override as long as the release image and base Compose service retain the same environment contract.
- The reference repository currently provides `Dockerfile`, `.dockerignore`, `scripts/export_image.sh`, `scripts/publish_image_release.sh`, and `scripts/release.sh`. Its release command checks a clean `main`, runs tests, derives a semantic tag, builds/exports AMD64 and ARM64 images, logs into `git.lan` via `--password-stdin`, pushes a multi-platform version tag, creates a Forgejo release with checksum assets, and promotes the successful version manifest to `latest`.
- The reference image runs as root and its helper depends on a Python virtual environment; this project should instead use the official image's non-root `node` account and Node for small JSON/version operations.
- Docker is not installed in the current planning environment. Implementation can run shell/static/unit checks here, but image build, platform inspection, registry push, and container smoke tests must be performed on a Docker/Buildx-capable release host and reported accurately.

## Release Decisions

### Image Contents and Runtime

- Base the image on `node:24-bookworm-slim`, set `/app` as the working directory, and copy only `package.json`, `package-lock.json`, `src/`, and `public/` with ownership suitable for the non-root `node` user.
- Do not run `npm install` in the production image because the application has no runtime package dependencies. Keep Playwright and all development dependencies out of the image.
- Create `/app/data` with UID/GID 1000 ownership for direct `docker run`, declare port 3000 as metadata, switch to `USER node`, and use exec-form `CMD ["node", "src/server.js"]` so Node receives stop signals as PID 1.
- Add a whitelist-oriented `.dockerignore` that excludes `.git`, `.env`, `node_modules`, `tasks`, `test`, `data`, `certs`, generated archives, screenshots/logs, and all other files not required at runtime. Runtime state and trust material must never enter an image layer or build context.
- Add OCI labels for source revision, application version, source repository, and image description through Docker build arguments so registry metadata identifies what was published without embedding credentials.

### Version and Forgejo Publication

- Use `package.json` as the application-version source. The release tag and registry tag must be `v<package-version>`; reject malformed versions, an existing tag that points elsewhere, a dirty worktree outside generated `dist/`, a detached/non-`main` checkout, or a local `main` that cannot be pushed normally.
- Bump the application to `0.17.0` during implementation because this adds the first packaged distribution and release workflow. The first produced release is therefore `v0.17.0`; do not invent a separate version counter in shell code.
- Add strict Bash helpers under `scripts/`, following the reference layout: `export_image.sh` builds and verifies `linux/amd64` and `linux/arm64` images, writes reproducible gzip archives plus conventional `.sha256` files under ignored `dist/`, and records the source commit; `publish_image_release.sh` validates those artifacts and uploads them to the matching Forgejo release; `release.sh` orchestrates the guarded release.
- `release.sh` must require `FORGEJO_TOKEN`, default `FORGEJO_USER` to `dev`, accept the package's exact `vMAJOR.MINOR.PATCH` tag rather than silently editing source, verify `git`, Docker, and Buildx, log in to `git.lan` with `--password-stdin`, run the repository checks, and push `main` before creating the tag.
- Build and push one multi-platform manifest as `git.lan/dev/home-web:v0.17.0` for `linux/amd64,linux/arm64`. Create/push the matching Git tag and Forgejo release only for the verified HEAD, upload the platform archives and checksums, then promote that immutable version manifest to `git.lan/dev/home-web:latest` as the final publication step.
- Keep the token only in process environment and temporary mode-600 curl configuration, never in command-line URLs, generated metadata, logs, or repository files. Do not add insecure TLS flags; the release workstation must trust the Forgejo CA for Git, Docker, and curl.
- Fail rather than overwrite an existing release asset or retarget an existing version. On an upload failure, remove only assets uploaded by that invocation when safe, leave an already-pushed immutable version image/tag visible for diagnosis, and do not update `latest`.

### Compose and Operations

- Change `docker-compose.yml` to consume `git.lan/dev/home-web:latest`, use the image's command and working directory, and remove the repository source bind mount. Retain host networking, restart behavior, runtime environment, and configurable UID/GID.
- Mount only `./data:/app/data` read-write and `./certs:/app/certs:ro`. Keep all Compose CA variables resolving within `/app/certs`, document directory ownership/read permissions, and preserve an override path for operators whose CA files live elsewhere.
- Keep `docker-compose.nfs.yml` compatible with the release image and host-mounted `/photos`. Do not add NFS clients or mount capabilities to the image; host/service-manager mounting remains the supported container model.
- Document private-package login, `docker compose pull`, startup, upgrade, rollback by immutable version tag, and a standalone `docker run` example with host networking, non-root UID/GID, `/app/data`, and optional CA/photo mounts.
- Document the maintainer release prerequisites and sequence, including Docker Buildx/QEMU for cross-platform builds, trusted Forgejo TLS, token scopes, package-version preparation, clean `main`, generated archive locations, and the fact that the release command performs real Git, registry, and Forgejo mutations.

## Implementation Steps

1. Create `tasks/30-docker-image-forgejo/3-implemented.md` before implementation edits and record the exact source commit, version/tag, image digests, archive checksums, verification results, publication results, and unavailable external checks.
2. Add the minimal non-root `Dockerfile` and whitelist `.dockerignore`; ensure only production source/assets and package metadata enter the context and no runtime dependency installation occurs.
3. Add `/dist/` to `.gitignore`, then implement executable `scripts/export_image.sh`, `scripts/publish_image_release.sh`, and `scripts/release.sh` using strict error handling, validated semantic/image tags, temporary output files, source-commit markers, checksum verification, and secret-safe Forgejo authentication.
4. Make the release orchestrator read the version from `package.json`, enforce clean synchronized `main`, run `npm test` and `npm run check`, export both supported architectures, push the immutable multi-platform registry image, create/publish the matching Forgejo tag and release assets, and update `latest` only after every prior stage succeeds.
5. Update `docker-compose.yml` to run the Forgejo image without a source mount while preserving data, certs, host networking, UID/GID, environment, and restart behavior. Confirm `docker-compose.nfs.yml` still composes cleanly without granting mount privileges.
6. Update `.env.example` comments where container CA paths or image settings need clarification, and revise `README.md` with image deployment, release, upgrade/rollback, persistence, permissions, private CA, NFS, and secret-handling instructions.
7. Add focused static tests for image/release configuration where they provide durable regression value: required Dockerfile base/user/CMD/copy set, excluded sensitive paths, Compose registry image and mounts, package-version/tag validation, shell helper argument/environment rejection, and absence of token literals or insecure TLS bypasses.
8. Bump `package.json` and `package-lock.json` from `0.16.3` to `0.17.0`, run all available checks, perform real Docker/Forgejo verification only from an appropriately equipped release host, and commit the Task 30 implementation on its exact task branch without publishing from an unreviewed branch.

## Verification Plan

- Run `bash -n scripts/export_image.sh scripts/publish_image_release.sh scripts/release.sh` and exercise usage, malformed-version, missing-token, dirty-tree, wrong-branch, missing-artifact, mismatched-commit, and duplicate-asset failure paths without triggering a real release.
- Run focused image/release configuration tests, then `npm test`, `npm run check`, and `git diff --check`.
- Run `docker build --tag home-web:test .`; inspect the image configuration and history to confirm Node 24, `USER node`, exec-form startup, `/app` ownership, expected labels, no development dependencies, and absence of `.git`, `.env`, `data`, `certs`, tests, tasks, token files, and release artifacts.
- Run the image with host networking and a disposable host-owned data directory. Verify startup as a non-root UID/GID, HTTP access on the configured private host/port, SQLite and encryption-key creation under the mounted data directory, graceful SIGTERM shutdown, Wake-on-LAN execution, and persistence after container recreation.
- Run `docker compose config` for the base file and the NFS override. Start the base stack from a directory whose application source is absent, verify it uses image-owned code, then verify optional Linkwarden, Home Assistant, and CalDAV CA paths through the dedicated read-only cert mount.
- On an AMD64/ARM64-capable Buildx host, build both platforms, inspect each archive/image platform, verify all `.sha256` files, and inspect the pushed version manifest for exactly `linux/amd64` and `linux/arm64` entries.
- Use a disposable pre-release/version first when Forgejo verification is available. Confirm private registry authentication, version-image pull, release creation, four asset uploads, duplicate rejection, asset download/checksum/load, source-commit matching, and that an induced pre-promotion failure leaves the previous `latest` digest unchanged.
- For the approved `v0.17.0` release, record the Git tag commit, Forgejo release URL, per-platform archive names/sizes/checksums, version-manifest digest, and final `latest` digest. Pull on a clean deployment host and run the documented Compose flow.
- If Docker, cross-platform emulation, registry credentials, token scopes, Forgejo API access, or a trusted Forgejo CA are unavailable, state exactly which checks remain pending; do not claim an image was built or pushed and do not weaken TLS verification.

## Acceptance Criteria

- `git.lan/dev/home-web:v0.17.0` and `git.lan/dev/home-web:latest` resolve to the same successfully verified AMD64/ARM64 manifest after release, and the matching Git tag/Forgejo release identifies the exact source commit.
- The Forgejo release contains non-empty AMD64 and ARM64 image archives plus valid checksum files, with duplicate or partial publication handled safely and no secret exposure.
- The production image contains only the Node 24 runtime and required application files, starts `node src/server.js` directly as a non-root user, and does not depend on a source checkout, `node_modules`, npm registry access, or startup-time package installation.
- Compose pulls the Forgejo image, does not shadow image code with a repository mount, retains host networking and configurable UID/GID, persists the database/key under `./data`, exposes optional CA files read-only, and remains compatible with the NFS override.
- Release validation prevents dirty, wrong-branch, version-mismatched, wrong-commit, unauthenticated, duplicate, and partially successful releases from silently becoming `latest`.
- Direct local startup, existing application behavior, private-CA trust boundaries, Wake-on-LAN behavior, and photo/NFS behavior remain unchanged outside the container packaging/deployment path.
- Documentation, package version `0.17.0`, implementation record, automated checks, image metadata, and actual Forgejo publication status agree.

## Planning Verification

- Read the shared agent conventions and current request; inspected task numbering, Git state/configuration/history, package metadata, Compose files, runtime startup/configuration/NFS code, persistence and private-CA documentation, test layout, and current release constraints.
- Retrieved and inspected the referenced Forgejo repository despite its private CA, including its Dockerfile, ignore rules, Compose deployment, export/publish/release scripts, documentation, and original Docker-image plan.
- Confirmed Docker is unavailable in this planning container and made external image/registry verification an explicit implementation requirement rather than claiming it now.
- This planning change adds only `tasks/30-docker-image-forgejo/1-plan.md`; implementation code is unchanged.
