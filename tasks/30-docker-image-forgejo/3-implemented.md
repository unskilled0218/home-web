# Task 30: Docker Image and Forgejo Release Implementation

## Status

Implementation complete on branch `30-docker-image-forgejo`. The branch started from planning commit `07d86b2`; no release artifact was produced from the unmerged task branch.

## Changes

- Added a root-runtime `node:24-bookworm-slim` `Dockerfile` with OCI version/revision/source labels, an exec-form Node command, no runtime dependency installation, and only the application package metadata, `src/`, and `public/` in the image.
- Added a whitelist `.dockerignore` that excludes repository metadata, tasks, tests, dependencies, runtime data, private CAs, environment files, and generated release artifacts from the build context.
- Added executable `scripts/export_image.sh`, `scripts/publish_image_release.sh`, and `scripts/release.sh` based on the referenced `my-rss` workflow and adapted to `git.lan/dev/home-web` and the version in `package.json`.
- The export helper validates `vMAJOR.MINOR.PATCH` against the package version and clean source revision, builds and verifies `linux/amd64` and `linux/arm64`, writes gzip archives and conventional SHA-256 files under ignored `dist/`, and records the source commit.
- The publication helper validates the source marker and every checksum, creates/pushes the matching immutable Git tag, creates or reads the Forgejo release, rejects duplicate assets, uploads both archives and checksums, and removes only assets uploaded by a failed invocation.
- The release orchestrator enforces clean synchronized `main`, runs the test/check commands, uses the externally supplied shared `FORGEJO_TOKEN`, and isolates Docker authentication in a temporary minimal Docker configuration with no inherited credential helper. It refuses existing registry version/platform tags and fails closed on ambiguous registry inspection errors.
- The orchestrator loads the exact exported archives, pushes their platform tags, creates and verifies the two-platform version manifest, publishes the Git tag/release assets, and promotes `latest` only last. `--promote-latest` safely resumes only the final promotion after checking `main`, the matching Git tag, both manifest platforms, a published Forgejo release, and four nonempty expected assets.
- Updated Compose to use `${HOME_WEB_IMAGE:-git.lan/dev/home-web:latest}` as root without source, user, working-directory, or command overrides. It retains host networking and mounts only persistent `./data` plus read-only `./certs`; the NFS override remains host-mounted and does not add container mount capabilities.
- Removed obsolete `DASHBOARD_UID`/`DASHBOARD_GID` settings, documented root-owned data, private registry deployment, image pinning/rollback, direct `docker run`, private CA/NFS behavior, shared-token release prerequisites, temporary Docker credentials, immutable-tag limitations, partial-release recovery, and `latest` promotion recovery.
- Added release configuration tests for the root image, whitelist context, Compose image/mounts, script syntax and executable modes, token/TLS safeguards, immutable preflight, exact archive loading, invalid arguments, missing tokens, wrong branches, and dirty `main` checkouts.
- Updated `package.json` and `package-lock.json` from `0.16.3` to `0.17.0` and ignored generated `dist/` artifacts.

## Verification

- `npm test`: passed, 166 tests.
- `node --test test/release-config.test.js`: passed, 5 tests.
- `npm run check`: passed.
- `bash -n scripts/export_image.sh scripts/publish_image_release.sh scripts/release.sh`: passed.
- `FORGEJO_TOKEN=unused ./scripts/release.sh`: correctly refused branch `30-docker-image-forgejo` before contacting Docker or Forgejo.
- Automated temporary-repository cases confirmed that release execution refuses a wrong branch and an uncommitted `main` before external operations.
- Invalid tag, missing token, invalid release argument, package/version, Compose structure, Dockerfile contents, sensitive-context exclusion, and insecure-curl cases are covered by `test/release-config.test.js`.
- `git diff --check`: passed.
- A targeted release-script review identified version-tag overwrite, persistent Docker credential-helper, archive/registry mismatch, and failed-final-promotion risks. The implementation now fails closed on registry inspection, uses a credential-helper-free temporary Docker config, pushes images loaded from the exported archives, and provides guarded final-promotion recovery.
- Docker is not installed in this environment (`command -v docker` returned no executable). `docker build`, image inspection/startup, `docker compose config`, cross-platform Buildx execution, archive save/load comparison, registry manifest inspection, and clean-host pull/start verification remain pending on the release workstation.
- No Forgejo token was read during implementation. Forgejo API authentication, immutable/platform image pushes, release/tag creation, asset upload/download verification, manifest digests, archive sizes/checksums, and final `latest` digest remain pending until the implementation is reviewed, merged to clean `main`, and released with the shared token.

## Release

No image, Git tag, Forgejo release, release asset, or registry manifest was published from this implementation branch. The intended first release is `v0.17.0`; its exact release commit, archive names/sizes/checksums, Forgejo release URL, per-platform manifests, version digest, and `latest` digest must be recorded from the real release run on merged `main`.
