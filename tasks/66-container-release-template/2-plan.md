# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Pin and adapt the release template](#1-pin-and-adapt-the-release-template)
    - [2. Align version and image metadata](#2-align-version-and-image-metadata)
    - [3. Replace the old publication path](#3-replace-the-old-publication-path)
    - [4. Add isolated release verification](#4-add-isolated-release-verification)
    - [5. Update operator documentation](#5-update-operator-documentation)
    - [6. Verify and record results](#6-verify-and-record-results)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Adopt the Bash/Python release workflow from `https://git.lan/dev/container-release-template` at commit `3c73528231ac1cbdd43600a5ca723390db804bac` (template version `0.5.0`). Replace home-web's archive-upload/rebuild workflow with one two-platform staging build, immutable digest verification, annotated version tags, digest promotion to `latest`, notes-only releases, and explicit package association checks. Preserve the Node 24 application image, root execution, runtime dependencies, host networking, persistent data, certificates, and optional photo mounts.

This task changes release tooling, packaging metadata, tests, and documentation only. It does not change dashboard behavior, install host tools, provision credentials, publish a release, push source, delete historical assets, or repair existing remote state.

## Implementation Plan

### 1. Pin and adapt the release template

1. Fetch the pinned template into a temporary location under `/tmp/opencode`; review its four release files and test fixtures before copying. Record the upstream commit and local deviations in `docs/releases.md`. Do not introduce a network updater or copy its Hello World Dockerfile.
2. Replace `scripts/release.sh`; add `scripts/release-common.sh`, `scripts/release-data.py`, and `scripts/release.json`. Preserve upstream validation, bounded I/O, private authentication, locking, source snapshot, and retry/refusal rules. Retain executable modes where required.
3. Configure schema `1`, Gitea origin `https://git.lan`, repository `dev/home-web`, image `git.lan/dev/home-web`, username `dev`, token file `~/.config/git/token`, both Linux AMD64/ARM64 platforms, and this project's versioned release notes. Never copy the template's repository or Hello World image targets.
4. Add `.template-operation.lock`, `.release-template/`, and `.template-transaction/` to `.gitignore`. Keep the existing restrictive `.dockerignore`; release tooling, tests, state, notes, credentials, and runtime data must remain outside the image.
5. Expose only the template's supported CLI: no arguments for publication, `--validate` for side-effect-free local validation, and `--help`. Reject old options before credentials or external effects. Preserve SSH Git authentication for the current `ssh://git@git.lan/dev/home-web.git` remote while validating its effective fetch/push destination against the configured repository.

### 2. Align version and image metadata

1. Add root `VERSION` as the authoritative release version. Use the next unused home-web patch version, provisionally `0.17.35` after current `0.17.34`; verify local and remote release/tag inventories read-only before finalizing it. Do not adopt the template's `0.5.0` application version or reuse an existing publication.
2. Synchronize `package.json` and applicable root metadata in `package-lock.json` with `VERSION`. Add a local automated assertion that catches drift without changing the upstream settings schema. Do not regenerate unrelated dependency resolutions.
3. Add `docs/releases/<version>.md` beginning exactly `# Release v<version>`, with a table of contents and concise project-specific release notes. Set `scripts/release.json` to that committed file.
4. Keep the existing Node 24 Dockerfile, production-only locked dependency install, working directory, root user, port, source/public copies, and startup command. Use the upstream Buildx `--label` arguments for version, revision, and HTTPS source metadata; change the Dockerfile's source URL default to `https://git.lan/dev/home-web` so its fallback is consistent. Do not leave effective release labels dependent on the old build-argument invocation.

### 3. Replace the old publication path

1. Require clean, already-pushed `main`, exact remote destination/source agreement, committed release notes, and a builder advertising both platforms before publication. Run application tests separately before committing/pushing; the release command must not push `main` or embed application test hooks.
2. Preserve the upstream sequence: bounded remote inventories and conflict classification; predecessor capture; verified staging reuse or one build from a private committed snapshot; exact annotated tag publication; digest promotion without rebuilding; notes-only release creation; fresh publication verification; package association and final checks. Preserve staging tags as recovery evidence rather than promising that `latest` is the only registry tag.
3. Preserve completed-retry verification and refusal of tag-only/release-only, old-format, conflicting, or changed-identity states. No force pushes, remote rollback, image deletion, asset replacement, unlinking, or automatic repair is allowed.
4. Preserve package identity checks and the existing exact-link read-only path. An unlinked package may be linked only under the upstream supported-server guard and exclusive-writer prerequisite; conflicting links must stop without reassignment.
5. Remove `scripts/export_image.sh` and `scripts/publish_image_release.sh` from the supported release path and repository after checking active callers. Remove `scripts/check-build-platforms.js` if no active caller remains; its coverage moves to the template's preflight tests. Do not alter archived task records or delete existing ignored `dist/` artifacts.

### 4. Add isolated release verification

1. Import the pinned template's `tests/test_bash_release.py`, `tests/fixtures/bash_release_ports.py`, and required package markers into a dedicated `test/release-template/` directory. Adapt discovery and repository-path assumptions explicitly; retain upstream behavior coverage and keep fixtures from reaching real services.
2. Update `test/release-config.test.js` to retain image/Compose invariants while replacing obsolete archive/token/promotion assertions with the JSON target settings, version synchronization, notes heading, CLI, and ignore-boundary checks.
3. Replace obsolete integration assertions in `test/build-platforms.test.js` or remove that file alongside the unused helper once equivalent fixture coverage exists. Retain missing-platform, failed-inspection, and no-build/login/remote-write guarantees before capability checks succeed.
4. Exercise fresh publication, staging reuse, digest/label/platform mismatch, complete retry without rebuild, partial-state refusal, foreign `latest`, local/remote tag conflicts, malformed configuration, invalid token paths/modes, secret redaction, source snapshot exclusion, private Docker auth, and package association outcomes through fake command/API ports and temporary Git repositories.
5. Add home-web-specific tests for `--validate` without credentials/network/Docker/state, invocation outside the repository, synchronized version metadata, SSH origin mapping, and the `28.2.0` server-version refusal for new package links. Existing correct links must remain read-only on that server version. Use fixture tokens only.

### 5. Update operator documentation

1. Rewrite `docs/releases.md` around setup, prerequisites, separate application verification, committing/pushing clean `main`, `./scripts/release.sh --validate`, and explicit publication. Document Bash, Python 3.11+, Git, curl, Buildx, trusted TLS, independent Git authentication, private token-file permissions, optional path/login overrides, and exclusive publication/package writers.
2. Explain the breaking workflow changes: root `VERSION`, synchronized npm metadata, committed notes, no inline `FORGEJO_TOKEN`, no archive attachments, no automatic source push/tests, staging tags, no `--promote-latest`, digest-based promotion, and refusal rather than automatic partial-state repair. Preserve old published releases and tags unchanged.
3. Update `docs/deployment.md` to use Gitea terminology and describe `latest` plus immutable digest pinning without claiming the registry contains only `latest`. Preserve all existing deployment/data/mount instructions.
4. Add release-test commands and fixture limitations to `docs/testing.md`; keep `README.md` brief and link to the dedicated documentation. Include tables of contents for every created Markdown file and refresh affected document contents where needed.
5. Document the two upstream warnings and the actual server compatibility blocker below. Do not describe local fixture success as live publication readiness.

### 6. Verify and record results

1. Run `bash -n scripts/release.sh scripts/release-common.sh`, `python3 -B -m unittest discover -s test/release-template -v`, `./scripts/release.sh --validate`, `npm test`, `npm run check`, and `git diff --check`. Syntax-check changed JavaScript files individually. Record missing prerequisites as blocked; ask the operator to install tools rather than using elevated permissions.
2. Run `node scripts/check-production.js` for isolated production packaging verification if its prerequisites are available. Optionally build and smoke-test an owned local image without pushing when Docker is available; verify effective labels, HTTP readiness, shutdown, runtime-only dependencies, and persistent-path expectations. Local tests do not establish ARM64 execution or live Gitea behavior.
3. Record exact commands, outcomes, upstream provenance, local adaptations, and remaining blockers in `4-implemented.md`. Commit implementation changes through the implementation workflow. Do not run real publication as a verification shortcut.

## Acceptance Criteria

- The configured release targets only `dev/home-web` and `git.lan/dev/home-web`; no template target or private credential is committed.
- `VERSION`, npm metadata, configured notes, Git tag derivation, and effective image labels agree; drift fails an automated check.
- Local validation succeeds without credentials, network, Docker, or release-state creation; unsupported legacy arguments fail safely.
- Isolated tests demonstrate one multi-platform staging build, immutable verification, promotion without rebuilding, notes-only release creation, package-link guards, and conservative retry behavior.
- The existing Node 24 image and Compose runtime/data/network/mount behavior remain unchanged, except for corrected release metadata.
- Active tests/docs no longer prescribe archive uploads, inline token values, automatic source pushing, or rebuilding via `--promote-latest`; historical task files remain untouched.
- Application and release checks pass or have explicit prerequisite blockers. No remote publication, deletion, reassignment, source push, or credential provisioning occurs during implementation.
- Documentation explicitly distinguishes completed local adoption from blocked live publication readiness.

## Risks And Decisions

- **Observed server mismatch:** read-only `GET https://git.lan/api/v1/version` returned `28.2.0` during planning. The pinned template authorizes new package links only on stable `1.25.x`; an existing exact association is read-only and does not need that version guard. Preserve the guard. If home-web is unlinked, automatic association remains blocked pending a separate review of this server family's refusal semantics or an operator-approved association process. Do not silently broaden accepted versions or perform a link while planning/implementing.
- **Known upstream warnings:** the pinned template documents N1, a later release guard accepting the predecessor after promotion, and N2, config-local Buildx plugin discovery changing under private auth. Carry these warnings prominently; resolving them requires a separately reviewed fix or a verified newer pin. Adoption must not be labeled generally publication-ready while they remain unresolved.
- **History compatibility:** existing home-web tags/releases use the old format. Leave them intact and start with an unused version; retries cannot adopt old evidence or changed script/config hashes.
- **Workflow compatibility:** archives and `--promote-latest` are intentionally retired to match the reference. Existing downloaded archives remain usable, but new releases are registry/digest based. Do not introduce a second maintained legacy workflow.
- **Version authority:** npm still requires version fields, so those fields become checked mirrors rather than independent authorities. Keep this check local to home-web rather than extending the template's strict configuration schema.
- **Operational limits:** the checkout lock does not serialize other checkouts or package UI actions. Trusted TLS, working emulation/native builders, private token provisioning, and exclusive writers remain operator responsibilities; no privileged setup runs automatically.
