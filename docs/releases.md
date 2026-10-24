# Container release operations

- [Container release operations](#container-release-operations)
  - [One command](#one-command)
  - [Setup and authority](#setup-and-authority)
  - [Automatic verification](#automatic-verification)
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

`scripts/release.json` selects `https://git.lan`, repository `dev/home-web`, image `git.lan/dev/home-web`, login `dev`, private token-file path `~/.config/git/token`, both platforms, and committed versioned notes. Its strict schema is data, not shell code. Keep authoritative `VERSION`, npm manifest and root lock versions, README, notes path, and `# Release v<version>` heading synchronized. Do not reuse a published version. Current release notes are [0.17.36](releases/0.17.36.md).

An operator privately provisions a non-symlink, owned, readable mode-0600 or mode-0400 token file outside the project. `GIT_TOKEN` overrides the file path, not the token value; `GIT_USERNAME` overrides the login. Tokens need repository/package permissions and actual access to the repository's packages unit. Never put token values in Git, `.env`, Compose, inline assignments, command arguments, history, or diagnostic logs. Existing SSH Git authentication remains independent and supported.

Serialize all repository/image/package writers, including other checkouts, UI actions, and in-flight requests. The checkout lock is not distributed exclusion. Existing exact package associations are read-only. Missing/unlinked packages require stable Gitea `1.25.x` before staging; the previously observed `28.2.0` family is not authorized for new links. On that server, obtain a separately approved compatibility/association decision and fresh exact association evidence. Failed/malformed/conflicting prerequisite reads never authorize publication, linking, unlinking, or reassignment.

## Automatic verification

The checkout supervisor acquires one lock, captures clean pushed `main` and matching destinations/notes, and verifies once per invocation:

1. Export a private committed-source snapshot, excluding worktree secrets, data, and installed dependencies. Install locked development dependencies with `npm ci --ignore-scripts` into that snapshot only, using private npm configuration/cache.
2. Check version/notes/README consistency, every release shell/Python file, and each JavaScript file individually. `npm run check` now checks `src/`, `public/`, `scripts/`, and `test/` rather than passing several filenames to one `node --check` process.
3. Run application tests serially (`npm test -- --test-concurrency=1`) to avoid concurrent fixture startup/port pressure; run the isolated Python release suite; run production-only dependency/readiness/HTTP/key/shutdown packaging smoke. Report environment-limited test skips without treating missing mandatory image/packaging checks as success. Release tests use fake command ports and never recursively execute the full suites.
4. Verify the actual Buildx executable path/content under original and private Docker configurations, running-node platform advertisements, and context/host/TLS/builder selection. Preserve config-local plugin discovery using a private link to the verified executable, without inheriting unrelated credential helpers or registry auth.
5. Prepare private authentication, check exact package readiness, and classify bounded remote release/tag inventories. Revalidate source/configuration after slow checks and before writes.
6. Build/reuse staging once for `linux/amd64,linux/arm64`; verify immutable index, platform configuration, and OCI version/revision/source labels. Pull/run each verified child digest with its explicit platform, prove actual Node architecture/dependency resolution and HTTP/key readiness, and require SIGTERM exit zero before tag/promotion/release writes.

Runtime HTTP probes execute through `docker exec` against container loopback. No host ports are published, no workstation loopback request is used as daemon evidence, and no client path is bind-mounted. Smoke data uses daemon-side owned named volumes, preserving remote contexts and `DOCKER_HOST`; the command never silently falls back to a local daemon. Real ARM64 failure stops publication rather than skipping that platform.

Budgets: dependency install 300 seconds; syntax/metadata 120 seconds; each suite 1,200 seconds; production packaging 180 seconds; image pull 300 seconds per platform; startup/readiness 120 seconds per platform; individual probes 15 seconds; graceful container stop 15 seconds plus CLI allowance. Local gate stdout is capped at 16 MiB and stderr at 1 MiB. Overflow, timeout, nonzero status, missing tools, or unconfirmed required evidence fails closed with a gate diagnostic. Expect several minutes, especially the release suite.

Temporary state prefers writable `/tmp/opencode` when available, otherwise the platform temporary directory. `RELEASE_TEMP_PARENT` optionally supplies an existing absolute, owned, writable, nonsymlink parent outside the project; it controls storage only. All explicitly selected fixture paths use this portable policy. No global temporary directory requires administrator creation. Verification children receive no live release lock/token environment, ambient application configuration, shell startup hooks, or Node/Python preload controls. Test Git repositories disable external config/hooks/signing independently of production Git authentication.

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
