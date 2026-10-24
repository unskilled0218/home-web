# Implementation

- [Implementation](#implementation)
  - [Outcome](#outcome)
  - [Changes and provenance](#changes-and-provenance)
  - [Verification](#verification)
  - [Limits and activation prerequisites](#limits-and-activation-prerequisites)

## Outcome

Implemented validation-only container release template adoption on branch `66-container-release-template`, with project version `0.17.35`. Root `VERSION`, npm manifest/lockfile metadata, README, configuration, and versioned notes agree. Real publication is unconditionally disabled; operational release enablement is not complete. No remote release/image/tag/link was created, deleted, pushed, or reassigned. Existing application behavior and Compose deployment contracts remain unchanged.

## Changes and provenance

- Imported the Bash/Python workflow and 99-method isolated test suite from `https://git.lan/dev/container-release-template` at commit `3c73528231ac1cbdd43600a5ca723390db804bac`, template version `0.5.0`. The temporary reference checkout is `/tmp/opencode/home-web-release-reference`; no self-updater or Hello World Dockerfile was imported.
- Configured `https://git.lan`, repository `dev/home-web`, image `git.lan/dev/home-web`, username `dev`, private token-file path `~/.config/git/token`, committed notes `docs/releases/0.17.35.md`, and Linux AMD64/ARM64. Read-only `git ls-remote --tags origin` and the repository releases API returned empty inventories during implementation; local historical tags did not include `v0.17.35`. No remote version was claimed or published.
- Added an unconditional checked-in publication guard before helper sourcing, credentials, prerequisite checks, lock/temp state, or external commands. No-argument and empty-argument publication attempts refuse; environment overrides do not bypass the guard. `--help` and `--validate` remain usable. There is no alternate publication launcher or operational bypass.
- Added bounded read-only package readiness before registry login/build/tag/promotion/release writes, reusing strict package/repository identity validation and supported-server policy. Correct existing links pass read-only on `28.2.0`; missing/unlinked packages need stable `1.25.x`. Conflicting, failed, or malformed evidence refuses without publication writes. Final association checks remain mandatory and detect changes after early readiness.
- Adapted builder-advertisement parsing to explicitly running nodes, canonical/variant/starred tokens, and multi-node aggregation; rejected stopped/error-only capabilities, malformed/empty advertisements, substring impostors, and inspection failures. Published OCI index/configuration validation remains strict.
- Preserved upstream source snapshots, bounded inventories/I/O, private auth, immutable verification, annotated identity, digest promotion without rebuilding, completed retries, and conservative ambiguity/refusal behavior behind the publication guard. `scripts/release-common.sh` is unchanged from the pin; the other local adaptations are documented in `docs/releases.md`.
- Ported consumer platform coverage before removing unused `scripts/check-build-platforms.js` and `test/build-platforms.test.js`. Removed the old archive export/publish scripts after checking active callers. Ignored `dist/` artifacts and archived task records were left untouched.
- Preserved the restrictive `.dockerignore`, Node 24 runtime, root execution, locked production-only dependencies, source/public copies, startup command, and Compose paths/network/mounts. Changed only the Dockerfile source metadata default to HTTPS; the template supplies effective release version/revision/source labels through Buildx.
- Added release-state/Python-cache ignores and consumer version/configuration/guard assertions. Tests remove the exact guard block only in owned temporary repositories after installing fake command ports; they verify path ownership and guard count and never modify the real checkout. No real credentials are used.
- Updated README, deployment/release/testing documentation, and versioned notes with tables of contents, prerequisites, breaking workflow changes, upstream provenance, local deviations, and the deliberate temporary loss of publication.

## Verification

- `node --version`: `v24.22.1`; `python3 --version`: `Python 3.12.3`. Docker client/server `29.9.2` were available; no host tools or elevated setup were installed.
- `python3 -B -m unittest discover -s test/release-template -v`: 108 passed in 542.714 seconds, zero failures. Retained all 99 upstream test methods and added nine consumer methods; scenarios also include subtests. The final run used frozen release source.
- `python3 -B -m unittest test_bash_release.BashInterfaceTests test_bash_release.BashDataTests -v` from `test/release-template/`: passed all interface/data cases, including local validation without credentials/network/state and the intact publication guard with no tools/helpers and bypass-like environment settings.
- Focused platform-characterization and preflight-order tests: two passed before old helper removal. Focused hidden-link, post-link verification, refreshed identity, and publication-change tests: four passed after adapting early-readiness read counts. Four focused early-readiness/change tests and the association-prerequisite refusal matrix also passed separately.
- `npm test`: 630 passed, zero failed/skipped. Repeated after the final guard/consumer assertion changes. `node --test test/release-config.test.js`: six passed, including actual Compose configuration parsing.
- `npm run check`, `node --check test/release-config.test.js`, `bash -n scripts/release.sh scripts/release-common.sh`, `./scripts/release.sh --help`, `./scripts/release.sh --validate`, and `git diff --check`: passed. Validation used no credentials or remote operations.
- AST comparison confirmed every upstream test method remains; a contents-link check confirmed all headings in the six created/updated Markdown documents have table-of-contents links. The shared shell helper matches the pinned upstream file byte-for-byte.
- `node scripts/check-production.js`: passed isolated production-only install, local Undici resolution, absence of browser dependencies, readiness/HTTP, automatic key, and IPC shutdown. It did not alter the working dependency tree.
- Local-only `docker build --label org.opencontainers.image.version=0.17.35 --label org.opencontainers.image.revision=<current HEAD> --label org.opencontainers.image.source=https://git.lan/dev/home-web --tag home-web-task66:0.17.35 .`: passed on AMD64. Effective labels, root runtime, absence of release/test/secret/browser files, HTTP settings readiness, SIGTERM exit zero, and encryption-key persistence across two recreated containers sharing one owned volume passed. Temporary containers/volume were removed; the local image remains `home-web-task66:0.17.35`. Nothing was pushed. Its revision label identifies the pre-implementation HEAD used for the local working-tree smoke, not a published release commit.
- Exploratory verification corrections: an initial image-smoke harness assumed Docker inspect always included `Config.User`; accepting its absent-field root default fixed the harness. An early full Python run was invalidated by editing the guard while its test module had cached the prior exact guard block; reran after freezing source. These are not reported as passing publication evidence.

## Limits and activation prerequisites

- Publication intentionally remains disabled. A separately reviewed code change must resolve N1 (predecessor accepted after confirmed promotion) and N2 (config-local Buildx executable discovery under private auth), with their required regressions, before removing the guard. This task documents those regression requirements rather than claiming the upstream defects are fixed.
- The observed `28.2.0` server is not approved for new link writes by the retained stable-`1.25.x` guard. Future activation requires fresh exact existing association evidence or a separately approved server compatibility/association decision; no private package inspection or mutation was attempted here.
- Early readiness is not a distributed lock, rollback guarantee, or final-link authorization. Exclusive repository/image/package writers and final fresh checks remain necessary. Nonzero future publication exits may follow accepted remote writes; no automatic repair/deletion/reassignment is supported.
- No ARM64 build/runtime, live registry/Gitea publication, Packages-tab rendering, emulation installation, or hardware/NFS behavior was certified. Browser tests were not run because no application/browser implementation changed. No credentials were provisioned or read for live publication.
