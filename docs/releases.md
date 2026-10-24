# Container release operations

- [Container release operations](#container-release-operations)
  - [Status and activation blockers](#status-and-activation-blockers)
  - [Configuration and prerequisites](#configuration-and-prerequisites)
  - [Local verification](#local-verification)
  - [Future publication and recovery](#future-publication-and-recovery)
  - [Provenance and local adaptations](#provenance-and-local-adaptations)

## Status and activation blockers

**Live publication is disabled.** `./scripts/release.sh` with no arguments refuses before helpers, credentials, prerequisites, lock/temp state, or external commands. There is no environment, configuration, marker-file, or CLI bypass. Do not remove the guard manually. The old archive publisher is retired; this checkout intentionally cannot publish releases until a separately reviewed enablement change meets all prerequisites below. Existing remote releases, images, tags, and downloaded archives are unchanged.

- N1: upstream's later release guard still accepts the captured predecessor after promotion. Enablement must demonstrate that `latest` returning to the predecessor after confirmed promotion prevents release POST.
- N2: private Docker auth can change discovery of a Buildx executable installed only under the original Docker configuration. Enablement must demonstrate consistent plugin selection across preflight and private authentication, not merely preserved builder metadata.
- Planning observed `GET https://git.lan/api/v1/version` returning `28.2.0`. New package-link writes are authorized by the pinned template only on stable Gitea `1.25.x`; do not broaden that guard without reviewing server refusal semantics. On other versions, require an exact existing package/repository association before publication. Missing/unlinked packages require a separately approved compatibility or association decision, followed by fresh read-only identity evidence. This adoption does not perform either operation.

An existing correct link does not waive N1/N2. Fixes or a verified newer upstream pin, regression evidence, and server/package readiness must be reviewed before removing the unconditional publication guard in a code change. Local tests do not certify live publication, package UI rendering, emulation, or cross-service atomicity.

## Configuration and prerequisites

`scripts/release.json` is strict schema-1 JSON data, not shell code. It selects `https://git.lan`, `dev/home-web`, image `git.lan/dev/home-web`, username `dev`, both `linux/amd64` and `linux/arm64`, notes `docs/releases/0.17.35.md`, and private token-file path `~/.config/git/token`. Unknown/duplicate fields, inconsistent scopes, unsafe paths, and symlinks are refused. Do not copy the template's Hello World image target or Dockerfile.

Root `VERSION` is authoritative. Keep `package.json`, both root version fields in `package-lock.json`, README, the configured notes path, and notes heading synchronized; `npm test` checks these mirrors. New notes must begin `# Release v<version>` and contain project changes, not machine identity. Future publication requires notes committed as a UTF-8 regular blob. The tag is derived as `v<version>`; do not reuse existing versions or attempt to adopt old-format tags as new publication evidence.

Local validation needs Bash and Python 3.11+ standard library on Linux/POSIX. Future publication additionally requires Git, curl, Docker Buildx, working local filesystem locks, independent Git authentication, trusted HTTPS in Git/curl/Docker, and a builder advertising both platforms on running nodes. No jq, pip package, or Node release-engine dependency is required. Node 24 remains required for application checks. Ask the host administrator to prepare native builders or QEMU/binfmt if needed; scripts never install privileged emulation support. Advertised capability is not proof of actual ARM64 execution.

An operator must privately provision a non-symlink, user-owned, readable mode-0600 or mode-0400 token file outside the project. The token needs repository/package read/write permissions and access to the target repository's packages unit. `GIT_TOKEN` optionally overrides the **file path**, never the token value; `GIT_USERNAME` optionally overrides the login. Never put token values in `.env`, Compose, Git, command arguments, inline assignments, or shell history. No credential provisioning is performed by this task. The current SSH remote `ssh://git@git.lan/dev/home-web.git` remains compatible; source fetch/push destinations must resolve to the configured repository.

## Local verification

```sh
./scripts/release.sh --help
./scripts/release.sh --validate
python3 -B -m unittest discover -s test/release-template -v
npm test
npm run check
```

`--validate` checks local settings, version, and required paths without credentials, network, Docker, lock creation, or temporary state. It does not establish committed-note validity, package readiness, test completion, remote source agreement, or permission to publish. Invocation from another directory still uses the script's project root. Unsupported arguments, including the old `--promote-latest`, are refused.

Application checks run separately, not inside the release engine. See [testing](testing.md) for packaging and isolated release coverage. Publication fixtures copy only allowlisted inputs into owned temporary Git repositories with fake Git/curl/Docker ports; only those temporary copies have the activation-guard block removed. No production bypass is shipped. Fixture success does not resolve the upstream blockers.

## Future publication and recovery

After reviewed activation only, an operator must first run application/release checks, commit and independently push clean `main`, and serialize all writers to the repository/image/package through completion. The checkout lock is not a distributed lock and does not exclude other checkouts, UI actions, or in-flight requests.

The fixture-tested sequence checks source and builder evidence, prepares private authentication, then reads the exact repository and literal package `latest` association **before** registry login, build, tag push, promotion, or release creation. Correct existing links are read-only without a version check. Missing/unlinked packages require supported stable `1.25.x`; conflicts, failed reads, or malformed identities stop without writes. A successful package 404 is only candidate absence, never permission to skip final validation. The final association checks remain mandatory even after early readiness.

After complete bounded release/tag inventories, fresh publication captures the predecessor, reuses verified staging or builds once from a private committed source snapshot, verifies both platform manifests/configuration labels, publishes the exact annotated version tag, promotes the verified digest to `latest` without rebuilding, creates a notes-only Gitea release, verifies publication, and checks/links only the configured package under the supported-server guard. Immutable image identity is `git.lan/dev/home-web@sha256:<digest>`; staging tags remain recovery evidence. Docker auth is private and run-owned; inherited helpers/registry auth are not reused. Preserve selected Docker context/host/builder settings, subject to unresolved N2 above.

No image archives/checksum attachments, automatic application tests, source pushes, `FORGEJO_TOKEN` value input, or rebuild-based `--promote-latest` recovery remain. Completed matching retries verify the bound digest/tag/notes/alias and do not rebuild or republish; an explicitly unlinked package can be the one narrowly authorized completed-retry write. Tag-only/release-only, foreign aliases, old-format tags, changed configuration/scripts/notes, and conflicting identities are refusals, not repair authority. Matching staging may be reused; there is no exactly-once guarantee after an unrecoverable staging build.

After any failure, inspect exact remaining state using the original source/pin. A nonzero exit may follow accepted remote writes. Never assume rollback, refresh evidence to force permission, delete history, rewrite tags, reassign links, or blindly retry changed identity. The engine performs no remote rollback/deletion or retention cleanup. Old releases and archives remain historical; no checkpoint migration or second maintained legacy workflow is provided. Rollback deployment by a recorded immutable digest only with the corresponding data backup; image rollback does not reverse database migrations.

## Provenance and local adaptations

Vendored from [container-release-template](https://git.lan/dev/container-release-template) version `0.5.0`, commit `3c73528231ac1cbdd43600a5ca723390db804bac`. Imported `scripts/release.sh`, `scripts/release-common.sh`, `scripts/release-data.py`, schema-1 configuration, and the 99-method Python/fake-port test suite. No network self-update or managed installer is included.

Local adaptations: home-web targets/version/notes; unconditional publication guard and matching help; early read-only package readiness reusing strict package/repository identity checks and supported-server policy; builder-advertisement normalization limited to explicitly running nodes, canonical/variant/starred tokens, and multi-node aggregation. Strict published OCI manifest validation is unchanged. Tests use `test/release-template/`, project-aware paths, realistic node/status advertisements, a controlled temporary-copy guard transformation, consumer characterization cases, and updated association read counts/order assertions. Version mirrors are checked in consumer tests rather than extending the strict template schema. The Node 24 runtime image, root execution, production dependency installation, and Compose mounts/network remain unchanged except the source metadata default now uses HTTPS.

[Back to README](../README.md)
