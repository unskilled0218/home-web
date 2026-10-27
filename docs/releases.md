# Container release operations

- [Container release operations](#container-release-operations)
  - [One command](#one-command)
  - [Setup and authority](#setup-and-authority)
  - [Package-link compatibility](#package-link-compatibility)
  - [Automatic verification](#automatic-verification)
  - [Visible progress](#visible-progress)
  - [Publication and retries](#publication-and-retries)
  - [Cancellation and recovery](#cancellation-and-recovery)
  - [Provenance](#provenance)

## One command

After one-time setup, commit and independently push clean `main`, then run:

```sh
bash scripts/release.sh
```

This command automatically verifies committed source, runs tests and packaging checks, verifies both platform images, and publishes only when all gates pass. There is no `--skip-tests`, force flag, environment bypass, or verification-success cache. It does not commit, bump versions, push source, provision credentials, install host tools, repair links, or install privileged emulation support. Running it explicitly authorizes publication after verification; do not invoke it as a harmless local test.

`bash scripts/release.sh --help` requires Bash only. `bash scripts/release.sh --validate` checks local settings/version/required paths without credentials, network, Docker, dependency installation, locks, or temporary state; it is not proof that tests or publication prerequisites pass. Unsupported arguments, including explicit empty strings and old `--promote-latest`, fail before external effects. Invocation from another working directory still selects this repository.

## Setup and authority

Requires Linux with `/proc` and child-subreaper support, Bash, Python 3.11+ standard library, Node 24+, npm, Git, curl, Docker Buildx, working filesystem locks, trusted TLS, and independent Git authentication. Both Linux AMD64 and ARM64 must actually execute on the selected daemon through native support or existing emulation. A builder advertising platforms is insufficient; ask the host administrator to prepare missing runtime support. No jq or Python packages are required. Browser E2E/downloads are not part of this mandatory release contract.

The selected builder must already have enough running backend capacity advertising `linux/amd64` and `linux/arm64`. Early and post-verification readiness use `docker buildx inspect` without `--bootstrap`; a configured builder name or cached platform labels on stopped/inactive nodes are insufficient. Ask the host administrator to prepare stopped or uncreated backends separately, then rerun the release command. Automatic bootstrap can create a privileged BuildKit container, pull BuildKit, and allocate a persistent state volume, so neither preflight performs it. Shared Buildx backend resources are not invocation-owned smoke resources and are never release-failure cleanup targets. Normal authorized staging-build behavior after verification is unchanged.

`scripts/release.json` selects `https://git.lan`, repository `dev/home-web`, image `git.lan/dev/home-web`, login `dev`, private token-file path `~/.config/git/token`, both platforms, and committed versioned notes. Its strict schema is data, not shell code. Keep authoritative `VERSION`, npm manifest and root lock versions, README, notes path, and `# Release v<version>` heading synchronized. Do not reuse a published version. Current release notes are [0.17.46](releases/0.17.46.md).

An operator privately provisions a non-symlink, owned, readable mode-0600 or mode-0400 token file outside the project. `GIT_TOKEN` overrides the file path, not the token value; `GIT_USERNAME` overrides the login. Tokens need repository/package permissions and actual access to the repository's packages unit. Never put token values in Git, `.env`, Compose, inline assignments, command arguments, history, or diagnostic logs. Existing SSH Git authentication remains independent and supported.

Serialize all repository/image/package writers, including other checkouts, UI actions, and in-flight requests. The checkout lock is not distributed exclusion. Existing exact package associations are read-only. Missing/unlinked packages require a supported server before staging; see [package-link compatibility](#package-link-compatibility). Failed/malformed/conflicting prerequisite reads never authorize publication, linking, unlinking, or reassignment.

## Package-link compatibility

Link-write support retains stable Gitea `1.25.x` and adds only exact Gitea `28.2.0`, not the whole `28.x` family or future patches. For `28.2.0`, `/api/v1/version` must return that exact version and `/swagger.v1.json` must return `info.title` equal to `Gitea API` and `info.version` equal to `28.2.0`. Both are fresh bounded HTTPS GETs at readiness and again when a final link write is needed. Discovery uses the existing private API configuration, same-origin/no-redirect HTTP boundary, 4 MiB response cap, and command deadline. Missing, malformed, mismatched, unauthorized, or oversized evidence fails closed. A correct existing association does not require version/schema discovery or a POST, even on another server version. Prerelease/custom version suffixes and unverified products are not supported for new links; inspect server identity and compatibility rather than bypassing the guard.

The public `https://git.lan` version endpoint, Gitea HTML/footer, and Gitea API schema identify the observed server as `28.2.0`. Its API shape matches upstream Gitea tag `v28.2.0`, commit `829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1`. The inspected [API route/handler](https://github.com/go-gitea/gitea/blob/829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1/routers/api/v1/packages/package.go) resolves package and repository under the same owner and calls [LinkToRepository](https://github.com/go-gitea/gitea/blob/829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1/services/packages/package_update.go). That service rejects `pkg.RepoID > 0` before updating and requires matching owners and write permission on the target repository's packages unit. Route middleware additionally requires package write access and appropriate token scopes. Successful linking returns empty HTTP 201; existing links are refused with HTTP 400 and permission failures with HTTP 403. Neither explicit refusal permits transport-loss reconciliation or another POST.

The [package converter](https://github.com/go-gitea/gitea/blob/829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1/services/convert/package.go) can hide inaccessible repository associations as null, so null alone never proves that linking is safe. The server service checks the stored association, not its filtered GET representation. The [database update](https://github.com/go-gitea/gitea/blob/829b49c1ae96015e345f9d2a0eb1ea7acd5f31e1/models/packages/package.go) is not compare-and-set: writer exclusion remains mandatory, including already in-flight requests. This is not a guarantee against concurrent writers. The earlier [Gitea 1.25.0 service](https://github.com/go-gitea/gitea/blob/cf644d565d09d1592526919f7eabbb683f5d83ae/services/packages/package_update.go) has the same existing-link rejection; its established stable `1.25.x` support remains unchanged.

Metadata is a trusted-server compatibility signal, not cryptographic attestation of deployed code. No live link request was used to identify or test this server. Operators must not treat a fork or behavior-changing build that copies these metadata fields as a verified upstream implementation. New links still require exact package/target identities, refreshed pre-write reads, one scoped POST, and exact post-write readback. Transport-uncertain writes are reconciled once without repeating POST; there is no unlink, reassignment, rollback, repair mode, or version override.

## Automatic verification

The checkout supervisor acquires one lock, captures clean pushed `main` and matching destinations/notes, then performs:

1. Capture the actual selected Buildx executable path/content and inspect running-node AMD64/ARM64 advertisements before snapshot export, dependency installation, syntax checks, suites, or packaging. `Verify: early builder preflight` reports this phase. Missing/invalid/unavailable evidence stops before the verifier or release credentials, without bootstrap or publication writes.
2. Run the local verifier once: export a private committed-source snapshot excluding worktree secrets, data, and installed dependencies; validate metadata and shell/Python syntax; install locked development dependencies with `npm ci --ignore-scripts` into that snapshot using private npm configuration/cache; check each JavaScript file individually with `npm run check`.
3. Run application tests serially (`npm test -- --test-concurrency=1`), the isolated Python release suite, and production-only dependency/readiness/HTTP/key/shutdown packaging smoke. Report environment-limited test skips without treating missing mandatory image/packaging checks as success. Release tests use fake command ports and never recursively execute the full suites.
4. Revalidate captured source and the original Buildx executable, then inspect running-node platforms again without bootstrap. `Verify: builder readiness recheck` reports the second inspection; capability loss or plugin replacement fails before private authentication. Preserve context/host/TLS/builder selection rather than silently selecting a different connection.
5. Prepare private authentication, pin and verify the same Buildx executable under private Docker configuration, check exact package readiness, and classify bounded remote release/tag inventories. Config-local plugin discovery uses a private link without unrelated credential helpers or registry auth. Revalidate source/configuration after slow checks and before writes.
6. Build/reuse staging once for `linux/amd64,linux/arm64`; verify immutable index, platform configuration, and OCI version/revision/source labels. Pull/run each verified child digest with its explicit platform, prove actual Node architecture/dependency resolution and HTTP/key readiness, and require SIGTERM exit zero before tag/promotion/release writes.

Runtime HTTP probes execute through `docker exec` against container loopback. No host ports are published, no workstation loopback request is used as daemon evidence, and no client path is bind-mounted. Smoke data uses daemon-side owned named volumes, preserving remote contexts and `DOCKER_HOST`; the command never silently falls back to a local daemon. Real ARM64 failure stops publication rather than skipping that platform.

Budgets: each of the two builder inspections 60 seconds, with stdout/stderr capped at 1 MiB each; dependency install 300 seconds; syntax/metadata 120 seconds; each suite 1,200 seconds; production packaging 180 seconds; image pull 300 seconds per platform; startup/readiness 120 seconds per platform; individual probes 15 seconds; graceful container stop 15 seconds plus CLI allowance. Existing bounded process cleanup follows a failed command. Local gate stdout is capped at 16 MiB and stderr at 1 MiB. Overflow, timeout, nonzero status, missing tools, or unconfirmed required evidence fails closed with a gate diagnostic. Expect several minutes after early prerequisites pass, especially the release suite. Early platform readiness is not ARM64 runtime certification; actual immutable-image checks remain mandatory.

Temporary state prefers writable `/tmp/opencode` when available, otherwise the platform temporary directory. `RELEASE_TEMP_PARENT` optionally supplies an existing absolute, owned, writable, nonsymlink parent outside the project; it controls storage only. All explicitly selected fixture paths use this portable policy. No global temporary directory requires administrator creation. Verification children receive no live release lock/token environment, ambient application configuration, shell startup hooks, or Node/Python preload controls. Test Git repositories disable external config/hooks/signing independently of production Git authentication.

## Visible progress

Normal release invocation shows phases immediately and sanitized local gate stdout/stderr as complete records become available. Records identify the gate, stream, and elapsed time. Quiet opted-in commands emit `still running` every ten seconds, including when a child closes its output pipes before it exits. Python release tests use unbuffered output. Other child programs may still buffer their own output; heartbeats indicate an outstanding command, not its health or a completion percentage. Failed gates retain safe context and an exit/timeout/interruption result rather than dumping a raw byte suffix.

New progress goes to stderr; helper JSON, OIDs, digests, HTTP status values, and command-output files remain byte-exact. Authenticated registry/package/Git/build output stays captured, not streamed. Fixed phases and heartbeat-only command labels show build, publication, per-platform pull/readiness/shutdown, and cleanup work without printing auth headers, curl configuration, commands, or Docker environment/inspection records. A command-completed message is not proof that a remote write was accepted; only final readbacks authorize `Publication verified`.

Local display limits are 4 KiB per pending logical line, 1 MiB of child-log content per gate, and an 8 KiB sanitized diagnostic tail. Each stream keeps its sensitive-record state through EOF, including after display suppression. Known proxy credentials, authorization/secret assignments, environment/configuration dumps, private-key blocks, and terminal control sequences are redacted or suppressed. Oversized, malformed, or uncertain records suppress that stream through EOF rather than exposing an unlabelled sensitive continuation. The publisher token is not read to construct a local-log redactor. No filter can promise detection of every deliberately encoded secret; do not write secrets into test output.

The normal-release supervisor forwards worker console output through execution, failure traps, and cleanup with a 64 KiB queue. It also uses that boundary for its own diagnostics. Console descriptor flags inherited by ancestors are not changed. Blocked or closed consumers can lose records, but do not stall command deadlines, cancellation, or release-lock cleanup. Console shutdown gets at most two additional seconds, then undeliverable records are discarded without a blocking fallback. No new persistent log files are created. Original capture limits remain enforced independently of display suppression, and output overflow is still a release failure.

## Publication and retries

After verification, publish the exact annotated version tag, promote the prepared immutable digest to `latest` without rebuilding, create a notes-only release, and freshly verify publication and package association. Before promotion, the alias may equal the captured predecessor or prepared digest; after promotion confirmation only the prepared digest is valid. Predecessor reappearance, absence, changed confirmed tags, or failed evidence stops before release creation/linking. No predecessor refresh grants repair authority.

One staging tag remains evidence. Runtime failure can occur after staging was pushed but before a version tag/alias/release is published; do not assume every nonzero exit means zero remote writes. Completed matching retries rerun local/image checks read-only without rebuilding, retagging, re-promoting, or recreating releases. Their only scoped write exception is an explicitly unlinked package on a supported server after complete identity verification. Existing correct associations do not cause a link POST.

Tag-only/release-only startup, changed script/configuration/notes identity, old-format tags, or foreign aliases are refusals, not automatic repair. No archive uploads, rebuild-based promotion recovery, force pushes, source pushes, remote rollback/deletion/retention, or checkpoint migration is provided. Record immutable digests for deployment rollback together with matching data backups.

## Cancellation and recovery

The Linux supervisor tracks identity-checked owned descendants, including new sessions/double forks. Cancellation stops gate scheduling, forwards cooperative termination, allows ten seconds of cleanup, then escalates against owned survivors with five seconds for confirmation/reaping. A single `killpg` is not treated as ownership of a nested process tree.

Before Docker resource creation, a private parent-visible `smoke-resources.json` records the nonce/ownership label, exact intended names, daemon/connection identity, and confirmed IDs. Preexisting names are refused. A lost create response can be reconciled once by the exact intended name and matching ownership label, never by a broad prefix scan. The surviving supervisor can remove exact owned resources even if a worker dies. Cleanup has a 60-second budget; foreign identities, daemon changes/unavailability, or unconfirmed removal cause failure and retained sanitized evidence, never cleanup of unrelated resources. Pulled/shared images and remote objects are not deleted.

Private auth is removed independently of retained diagnostics. If cleanup cannot be confirmed, inspect the exact reported evidence directory/resource identities; do not run broad process, container, volume, cache, or registry deletion. SIGKILL/power loss cannot guarantee cleanup. Accepted remote objects remain untouched after failures; inspect exact source/pin and state rather than blindly retrying changed identity or assuming rollback.

## Provenance

Based on container-release-template `0.5.0`, commit `3c73528231ac1cbdd43600a5ca723390db804bac`, adopted in task 66. Task 67 adds fixed automatic verification, portable private test/install state, hermetic fixture Git, nested supervision, daemon-side runtime checks, N1's one-way promotion state, and N2 executable identity preservation. All release-authority helpers are included in script identity; older published script hashes cannot be adopted as current ownership. No network updater or second legacy publisher is maintained.

[Back to README](../README.md)
