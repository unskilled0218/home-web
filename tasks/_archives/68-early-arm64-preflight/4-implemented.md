# Implementation

- [Implementation](#implementation)
  - [Outcome](#outcome)
  - [Changes](#changes)
  - [Verification](#verification)
  - [Limits and inherited findings](#limits-and-inherited-findings)

## Outcome

Implemented early AMD64/ARM64 builder readiness on branch `68-early-arm64-preflight`, version `0.17.37`. After existing settings/source preflight, unsuitable builders stop before snapshot export, dependency installation, syntax checks, test suites, or packaging. Both early and post-verification inspections omit `--bootstrap`; stopped or missing backends require separate administrator preparation. Mandatory local verification and immutable-image runtime checks remain intact. No live publication, privileged setup, or backend provisioning was performed.

## Changes

- `scripts/release.sh` captures the selected Buildx executable before the local verifier, runs early readiness, executes verification once, then revalidates source, the original plugin identity, and running-platform evidence before release authentication. Late plugin changes cannot be adopted through recapture.
- `scripts/release-common.sh` shares the bounded non-bootstrapping inspection and platform-validation sequence through `builder_ready()`, with explicit failure propagation and phase messages. Each inspection retains a 60-second deadline and 1 MiB stdout/stderr bounds through existing subprocess supervision.
- `scripts/release-data.py` retains the existing parser and extends its failure diagnostic with separate backend/native/QEMU/binfmt preparation guidance. Running-node union, variants, stars, stopped-node rejection, and strict matching are unchanged.
- Publication fixtures record authentication preparation and full Docker arguments, reject bootstrap on every inspection, support per-inspection evidence/failure, and can replace a plugin after simulated verification. Five new behavioral test methods cover backend lifecycle, valid running-node union with an unrelated stopped node, missing plugins, late readiness failure, and plugin replacement. Existing early-refusal, gate-failure, fresh/reuse/completed-retry, and connection assertions now enforce both readiness boundaries and exactly one verifier pass.
- Updated README, release operations, testing documentation, and `docs/releases/0.17.37.md`. Synchronized `VERSION`, npm manifest/root lock versions, and configured notes path without changing dependency resolutions. Shared Buildx resources are explicitly outside smoke-resource cleanup; neither readiness check starts/creates a backend, pulls BuildKit, allocates state, or installs emulation.

## Verification

- Version inventory: `git tag --list v0.17.37` and read-only `git ls-remote --tags origin refs/tags/v0.17.37` returned no matching tag. An unauthenticated read-only `GET https://git.lan/api/v1/repos/dev/home-web/releases?limit=100` returned `[]`. No version was published or remotely claimed.
- Focused early/late/lifecycle/plugin/gate-failure/fresh/reuse/retry run: nine test methods passed in 88.688 seconds. Focused interface/parser/private-auth-plugin/default/context/relative-path/explicit-builder run: 14 methods passed in 58.226 seconds. Publication tests use owned temporary repositories, unmodified release scripts, and fake external command ports; they never invoke recursive full suites or production publication.
- `npm test -- --test-concurrency=1`: 630 passed, zero failures/skips, in 48.117 seconds. Full log: `/tmp/opencode/task68-application-tests.log`.
- Full `python3 -B -m unittest discover -s test/release-template -v`: all 128 tests passed in 1071.275 seconds, exit zero. Log: `/tmp/opencode/task68-release-tests.log`. This includes early/late inspection ordering, backend lifecycle, plugin replacement, all connection scenarios, retry safety, and existing process/resource cleanup tests. Publication fixtures confirmed their owned work directories were removed; lifecycle fixtures preserved shared-resource sentinels.
- `npm run check`, separate `bash -n scripts/release.sh` and `bash -n scripts/release-common.sh`, Python AST parsing of all nine helper/test files without bytecode, `./scripts/release.sh --validate`, and `git diff --check` passed.
- Read-only local Docker metadata: `docker context show` returned `default`; `docker buildx version` returned `v0.38.1`; `docker buildx inspect` without bootstrap reported the default `docker` driver, a running node, and only `linux/amd64`, `linux/amd64/v2`, and `linux/amd64/v3`. This is evidence of missing advertised ARM64 support on the current selected builder, not actual runtime evidence. No backend was started or provisioned for verification.
- Initial focused execution found only case-sensitive test expectations for `Publication did not begin` versus the existing lowercase `publication did not begin` emitted by `stop()`. Assertions were corrected to compare normalized case; production failure behavior was not bypassed or retried into success. The corrected focused run passed.

## Limits and inherited findings

- Current selected builder does not advertise ARM64. Ask the Docker host administrator to prepare the selected backend and native/emulated ARM64 support separately before release. This task did not test actual AMD64/ARM64 images, start a real remote backend, or certify ARM64 execution from advertisements or historical results. Immutable-image runtime checks remain mandatory after staging/reuse and before publication.
- The conservative policy resolves plan-review F1: both readiness inspections use plain `docker buildx inspect`, and stopped/inactive cached advertisements fail without bootstrap. Shared backend resource sentinels remain unchanged in early/late failure fixtures; automatic cleanup never gains authority over shared Buildx containers/volumes. Normal authorized staging-build behavior remains unchanged.
- Task 67's three recorded warnings remain unresolved separate work: independent daemon cleanup can be skipped after process-cleanup failure; the Node version probe still inherits ambient preload/application settings; persistent tests still lack real `local()` orchestration coverage. No claim is made that this ordering change resolves those findings.
- No live token was read, no no-argument release command was executed against the live checkout, no checkout dependency install occurred, and no remote source/tag/image/release/package link was written. Existing lock, credentials, package-server restrictions, promotion guards, immutable runtime probes, deployment contracts, archived task records, and `todo.md` are unchanged except for readiness ordering and its diagnostics/tests/documentation.
