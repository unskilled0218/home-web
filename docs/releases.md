# Publishing releases

- [Publishing releases](#publishing-releases)
  - [Publish](#publish)
  - [Prerequisites](#prerequisites)
  - [Package-link compatibility](#package-link-compatibility)
  - [Verification](#verification)
  - [Progress and retries](#progress-and-retries)
  - [Cancellation and recovery](#cancellation-and-recovery)
  - [Provenance](#provenance)

## Publish

Commit and independently push clean `main`, then run:

```sh
bash scripts/release.sh
```

This authorizes real publication after verification. It is not a harmless test. There is no skip-tests, force, or cached-verification bypass.

For local inspection without publication:

```sh
bash scripts/release.sh --help
bash scripts/release.sh --validate
```

`--validate` checks settings, versions, and required paths without credentials, network, Docker, installation, or temporary state. It does not prove publication readiness. Unsupported arguments fail before external effects.

## Prerequisites

- Linux with `/proc` and child-subreaper support, Bash, Python 3.11+, Node 24+, npm, Git, curl, Docker Buildx, filesystem locks, and trusted TLS.
- An already running builder advertising `linux/amd64` and `linux/arm64`.
- Actual execution support for both platforms on the selected daemon, through native hardware or existing emulation.
- Independent Git authentication and a private Gitea token file.

Ask the operator to prepare missing tools, builders, or emulation. The script does not bootstrap builders, install privileged support, provision credentials, push source, or bump versions. Browser tests are a separate developer check.

`scripts/release.json` selects `https://git.lan`, repository `dev/home-web`, image `git.lan/dev/home-web`, login `dev`, and token path `~/.config/git/token`. The token file must be owned, readable, non-symlink, and mode 0600 or 0400. `GIT_TOKEN` overrides its path, not its value; `GIT_USERNAME` overrides login.

Tokens need repository/package permissions and access to the repository's packages unit. Never put token values in Git, `.env`, arguments, history, or logs.

Keep `VERSION`, npm manifest/lock versions, README, notes path, and `# Release v<version>` synchronized. Never reuse a published version. Current notes: [0.17.46](releases/0.17.46.md).

Serialize all repository, image, and package writers, including other checkouts, UI actions, and in-flight requests. The checkout lock is not distributed exclusion.

## Package-link compatibility

New links support stable Gitea `1.25.x` and exact Gitea `28.2.0`. For `28.2.0`, fresh HTTPS version and Swagger responses must identify exactly `28.2.0` and `Gitea API`. Other patches, prereleases, forks, malformed responses, or conflicting associations refuse new link writes.

Correct existing associations are read-only and do not require version discovery. Missing or unlinked packages need supported-server evidence before staging. No unlink, reassignment, repair, or version override exists.

The inspected upstream sources are Gitea `v28.2.0`, commit `829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1`: [link service](https://github.com/go-gitea/gitea/blob/829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1/services/packages/package_update.go), [response converter](https://github.com/go-gitea/gitea/blob/829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1/services/convert/package.go), and [database update](https://github.com/go-gitea/gitea/blob/829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1/models/packages/package.go).

The service rejects stored existing links, even when response filtering hides them as null. Its update is not compare-and-set, so excluding concurrent writers remains mandatory. Metadata is a compatibility signal, not proof of deployed source. No live link mutation was used to inspect compatibility.

A new link uses one scoped POST and exact readback. Explicit HTTP 400/403 refusals are final. Transport-uncertain writes are reconciled once without repeating the POST.

## Verification

The command holds a checkout lock and verifies clean pushed source, destinations, and notes. It then:

1. Captures the selected Buildx executable and checks running-node platforms without `--bootstrap`.
2. Exports committed source into private temporary storage, excluding secrets, data, and installed dependencies.
3. Installs locked dependencies with `npm ci --ignore-scripts`, checks metadata/syntax, runs application tests serially, runs release fixtures, and checks production packaging.
4. Rechecks source, the original Buildx executable, and running-node platforms before authentication.
5. Prepares private authentication and verifies package and remote publication state.
6. Builds or reuses staging, verifies immutable manifests and OCI labels, then runs both platform images to prove architecture, dependencies, readiness, HTTP, key creation, and clean SIGTERM shutdown.

Runtime probes use `docker exec` and owned daemon-side named volumes. They do not assume workstation loopback or bind paths exist on a remote daemon. A real ARM64 failure blocks publication.

Only then does it publish the annotated version tag, promote the verified digest to `latest` without rebuilding, create a notes-only release, and verify publication and package association.

Missing evidence, timeout, output overflow, or failed checks stop publication. Main budgets are 60 seconds per builder inspection, 300 seconds for dependencies, 120 seconds for syntax, 1,200 seconds per suite, 180 seconds for packaging, and 300/120 seconds per platform for pull/readiness.

Temporary storage prefers `/tmp/opencode`. `RELEASE_TEMP_PARENT` may select an existing absolute, owned, writable, non-symlink directory outside the project. It changes storage only, not verification requirements.

## Progress and retries

Progress appears on stderr with sanitized gate output and ten-second heartbeats for quiet commands. A heartbeat means work is pending, not healthy. Authenticated output stays captured. Only final readbacks authorize **Publication verified**.

Do not write secrets into test output; filtering cannot recognize every encoding. Blocked consoles may lose records but must not stall deadlines or cleanup.

Failures may leave a staging image or accepted remote objects. Nonzero does not mean nothing changed. A matching completed retry reruns verification read-only without rebuilding or republishing, except a verified missing package association on a supported server.

Changed identity, partial tag/release state, or foreign aliases are refusals, not repair requests. If `latest` changes after confirmed promotion, the script stops rather than overwriting it. No force push, remote rollback/deletion, archive upload, or rebuild-based recovery is provided.

## Cancellation and recovery

Cancellation stops new work and terminates identity-checked owned descendants, allowing ten seconds before escalation and five more for confirmation. Docker cleanup has a 60-second budget.

Private `smoke-resources.json` records exact names, ownership labels, daemon identity, and resource IDs before creation. Lost responses can be reconciled only against those identities. Shared builders, unrelated resources, pulled images, and remote objects are not cleanup targets.

If cleanup cannot be confirmed, inspect the exact reported evidence and resources. Do not broadly delete processes, containers, volumes, caches, or registry objects. Private authentication is removed independently of retained diagnostics. SIGKILL or power loss cannot guarantee cleanup.

Inspect source identity and remote state before retrying. Keep deployment digests and matching data backups for operator-controlled rollback.

## Provenance

Based on container-release-template `0.5.0`, commit `3c73528231ac1cbdd43600a5ca723390db804bac`, adopted in task 66. Later work adds automatic verification, isolated fixtures, nested supervision, remote-daemon checks, and stricter promotion/executable identity checks. There is no network updater or second publisher.

[Back to README](../README.md)
