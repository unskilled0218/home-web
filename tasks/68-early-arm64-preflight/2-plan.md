# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Check builder platforms before expensive verification](#1-check-builder-platforms-before-expensive-verification)
    - [2. Revalidate readiness after verification](#2-revalidate-readiness-after-verification)
    - [3. Cover early refusal and successful ordering](#3-cover-early-refusal-and-successful-ordering)
    - [4. Update version and operator documentation](#4-update-version-and-operator-documentation)
    - [5. Verify without live publication](#5-verify-without-live-publication)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Make `bash scripts/release.sh` reject an unsuitable selected Buildx builder before installing snapshot dependencies, checking application syntax, running suites, or performing production packaging. The reported failure currently occurs at `scripts/release.sh:56-61`, after the entire local verifier at `:53-54`. Keep the existing command, supported platforms, source requirements, mandatory gates, and immutable-image runtime checks; change prerequisite ordering rather than adding a bypass or automatically configuring ARM64 support.

This task does not fix all task 67 review findings, change application behavior, alter Docker/Compose deployment contracts, broaden package-server authority, or publish a release. The unresolved cleanup, Node-probe isolation, and real local-verifier coverage findings remain recorded in `tasks/_archives/67-one-command-release-verification/5-code-review.md`; do not claim this ordering change resolves them.

## Implementation Plan

### 1. Check builder platforms before expensive verification

1. Create implementation branch `68-early-arm64-preflight` through the implementation workflow. Keep planning changes limited to this document until implementation is requested.
2. Preserve argument parsing, tool availability checks, checkout locking, settings/notes validation, and clean pushed-source capture. Place an explicitly named early builder/platform phase immediately after cheap source/payload preflight and before invoking `release-verify.py local`. No snapshot export, dependency installation, test suite, or packaging command may precede this phase.
3. Capture `original_docker_context` and `original_docker_config` before any private Docker configuration is selected. Run the existing `data buildx-capture`, bounded `docker buildx inspect --bootstrap`, and `data platforms` operations here, using the operator's selected builder/connection. Preserve the original executable identity for the remainder of the invocation instead of overwriting it later.
4. Reuse `advertised_platforms()` in `scripts/release-data.py`; do not introduce a second parser or read the release workstation's architecture/binfmt state as evidence for a remote builder. Preserve running-node union, canonical platform tokens, variants such as `linux/arm64/v8`, starred advertisements, and rejection of misleading substrings, stopped/error nodes, malformed output, or missing AMD64/ARM64.
5. Print a short progress line before inspection so failures are visibly early. Retain a specific missing-platform diagnostic directing the operator to inspect the selected Buildx builder or ask the Docker host administrator about native/QEMU/binfmt support. Distinguish unavailable/failed inspection or plugin discovery from a successfully inspected builder lacking required platforms. Return nonzero with `Publication did not begin` on refusal.
6. Retain existing limits: plugin evidence bounded by the current helper, builder inspection stdout at 1 MiB, stderr at 1 MiB, and a 60-second inspection deadline plus existing bounded process cleanup. Do not add host installation, privileged containers, builder creation/switching, registry login, token reads, package requests, or publication writes to this early phase.

### 2. Revalidate readiness after verification

1. After early readiness passes, run the existing real local verifier exactly once, without skipping or reordering its internal mandatory gates. Keep release tests' fake executable seams test-only; do not add production environment switches or success caches.
2. After the slow verifier returns, retain source revalidation and perform a fresh bounded builder check before private authentication/package classification. Reuse the original captured plugin identity with `data buildx-check`; inspect and validate platform advertisements again rather than recapturing a changed plugin as acceptable. A builder losing ARM64 support during tests must fail before credentials or publication work.
3. Share the small inspection/validation sequence through a focused shell helper in `scripts/release-common.sh` if needed, with explicit failure propagation. Keep executable capture separate from repeat inspection so the helper cannot accidentally reset identity. Do not extract a generic configurable gate framework.
4. Preserve `DOCKER_CONTEXT`, `DOCKER_HOST`, TLS/certificate paths, `BUILDX_CONFIG`, `BUILDX_BUILDER`, config-local plugin discovery, and relative-path behavior through both inspections and the existing private-auth transition. Do not silently select the default/local daemon or a different builder to make the early check pass.
5. Keep fresh release, staging reuse, and completed retries subject to early readiness and mandatory local verification. Retain actual immutable AMD64/ARM64 image pull/run/architecture/HTTP/key/shutdown checks at their current publication boundaries. Passing advertised-platform checks must never be presented as runtime execution evidence.

### 3. Cover early refusal and successful ordering

1. Update `test/release-template/test_bash_release.py` assertions that currently require all five `verify:*` events before `builder`. For missing/invalid platforms or inspection failure, require an early builder attempt, zero dependency/syntax/application/release/packaging events, zero runtime probes, zero token/private-auth preparation, and zero login/build/tag/promotion/release/link writes. Use a missing token fixture to prove the platform diagnostic takes precedence over credential access.
2. For a supported fresh publication fixture, assert early builder inspection precedes `verify:dependencies`; each verification event occurs once; the second builder inspection follows `verify:packaging` and precedes authentication/publication. Check the same prerequisite order for staging reuse and completed retries without changing their no-rebuild/no-republication guarantees.
3. Update verification-failure tests: an early successful builder check is now expected, but no post-verification inspection, credential access, login, build, or publication may follow a failed local gate. Do not weaken these assertions to merely check a nonzero exit code.
4. Extend `test/release-template/fixtures/bash_release_ports.py` with deterministic per-inspection responses/counters so a supported early result followed by missing ARM64, malformed output, or a command failure can be injected. Require the later refusal to occur after exactly one local verification and before authentication or publication. Keep fake suite execution nonrecursive and exercise unmodified release scripts.
5. Add a plugin-change-during-verification scenario proving the second check compares against the original capture rather than accepting a replacement. Preserve the existing private-auth plugin replacement case. Use owned fixture executables only.
6. Retain parser characterization and selected local/default/remote-context/host/TLS/explicit-builder scenarios, asserting both inspections use the expected connection and builder. Exercise invocation outside the repository root. Keep `--help`, `--validate`, unsupported options, and explicit empty arguments free of Docker probes; `--validate` remains credential/network/lock/temp-state free.

### 4. Update version and operator documentation

1. During implementation, use the next unused patch version, provisionally `0.17.37` after current `0.17.36`. Check available version inventories read-only before finalizing; do not claim, reuse, or publish an existing version. Synchronize `VERSION`, `package.json`, both root lockfile version fields, README version, `scripts/release.json` notes path, and a new `docs/releases/<version>.md` with the required heading. Leave dependency resolutions unchanged.
2. Keep README brief: mention early builder/ARM64 readiness before expensive verification and link to release operations. Update `docs/releases.md` with the revised sequence: source/settings, early selected-builder readiness, mandatory local verifier, fresh source/plugin/platform checks, private auth/package/inventory checks, staging build/reuse, actual both-platform runtime checks, then publication.
3. Document the difference between Buildx advertisements and executable image evidence, both inspection deadlines, missing-support remediation by the host administrator, and the absence of automatic emulation installation. Explain that `inspect --bootstrap` can start the selected existing backend or fetch its BuildKit image; the early check is not guaranteed daemon-side-effect-free, but performs no application staging/publication or privileged host setup. Do not label it a purely read-only probe.
4. Update `docs/testing.md` for early/late ordering, zero-suite early failures, per-inspection drift fixtures, and preserved connection/plugin behavior. Update deployment documentation only if directly affected. Add contents links for every heading in created Markdown files. Do not alter archived task records or `todo.md`.
5. Write `4-implemented.md` with exact checks/results, changed ordering, version, unresolved inherited findings, and any environment limits. Existing script-identity hashing already includes `release.sh` and `release-common.sh`; preserve that binding and reject old publication identities rather than migrating them.

### 5. Verify without live publication

1. Run focused parser/platform, CLI, verification-failure, plugin, connection, staging-reuse, and completed-retry cases first. Then run `python3 -B -m unittest discover -s test/release-template -v`, `npm test -- --test-concurrency=1`, `npm run check`, separate `bash -n` checks for both release shell files, Python parsing without bytecode, `./scripts/release.sh --validate`, and `git diff --check`.
2. Use owned temporary repositories and fake publication ports for end-to-end release invocations. Do not execute the enabled no-argument release command against the live checkout, read the live token, push images/tags/source, create releases, link packages, provision credentials, or install host/emulation support.
3. If Docker access is available, inspect existing plugin/connection metadata without login. Do not bootstrap or modify live builders solely to validate this ordering change; deterministic fixture evidence is sufficient for command ordering. Record current platform/runtime capability as unproven unless actually tested through a separately authorized owned check, and never infer ARM64 execution from advertisements or historical task 67 results.
4. Confirm no fixture descendants, owned temporary state, credentials, or unrelated-resource modifications remain after injected failures. Record prerequisite-limited checks accurately instead of installing missing tools or weakening mandatory runtime requirements. Commit implementation, tests, relevant documentation, version updates, and the implementation record through the implementation workflow.

## Acceptance Criteria

- A selected builder lacking AMD64/ARM64 support fails before snapshot dependency installation, syntax/application/release suites, or production packaging, with an actionable platform diagnostic and no publication begun.
- Early missing/invalid/unavailable builder evidence does not read the release token, prepare private auth, log in, run image probes, or cause application build/push/tag/promotion/release/link writes.
- Supported builders proceed through mandatory local verification once, then fresh source/plugin/platform readiness before credentials/publication. Late capability loss or plugin replacement fails closed against the originally captured identity.
- Both inspections retain their bounded output/deadline behavior and the operator's actual local/remote Docker connection and builder selection. Neither inspection creates a privileged emulation installer, selects a replacement builder, or weakens platform matching.
- Real immutable-image runtime checks remain mandatory for both AMD64 and ARM64. Advertisements alone do not certify execution; staging and completed-retry safety policies are unchanged.
- CLI-only paths remain free of builder probes, and local `--validate` remains side-effect-free. Fresh, reuse, retry, early failure, verification failure, and late readiness failure have behavioral event-order and zero-write assertions.
- Version mirrors, README, release/testing documentation, and task results describe the new sequence accurately. No live publication or implementation code change occurs during planning.

## Risks And Decisions

- **Meaning of first:** perform platform readiness immediately after existing cheap source/settings preflight and before expensive verification, not before argument validation, tool checks, lock acquisition, or source safety requirements. Git source-agreement reads may still happen first.
- **Advertisement versus execution:** this task moves the existing Buildx capability guard earlier; it does not introduce an early arbitrary-image pull/run test or promise to detect every runtime-only `exec format error` before suites. The actual built-image gate remains authoritative for runtime capability.
- **Bootstrap effects:** preserve existing `inspect --bootstrap` semantics so inactive existing builders can become inspectable. This can touch the selected builder backend earlier than before; it does not authorize creating builders, installing QEMU/binfmt, modifying shared host setup, or pushing release artifacts. State this boundary explicitly in operator documentation.
- **Stale evidence:** keep a post-verification recheck because suites can take many minutes. The first inspection is an early refusal optimization, not long-lived publication authority. Never overwrite the initial plugin identity to accept drift.
- **Scope and inherited warnings:** task 67's three warnings remain separate work. This task must not conceal them with a success claim or expand into a general release-subsystem rewrite. New early-failure tests must assert real shell ordering even though remote publication operations are simulated.
