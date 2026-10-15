# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Plan review of `tasks/46-env-config-automatic-key/2-plan.md` at `061446f`, checked against the updated goal and the current key, lifecycle, package, Dockerfile, and release-test boundaries. This is a proposed implementation review, not an implemented security or container-runtime verification. No `.brooks-lint.yaml` was found; balanced defaults apply.
**Health Score:** 99/100
**Trend:** Stable at 99 relative to the latest PR Review record, which reviewed task 45's diagnostic branch; different scope/stage means this is not a like-for-like quality trend.

The plan is actionable and preserves the intended security boundaries, with one small production-packaging verification gap to close before implementation is considered fully verified.

## Findings

### Suggestion

**R2 Change Propagation — verify the newly dependent runtime outside the development install**

Symptom: `2-plan.md:46,53-55` introduces the first runtime package, Undici, and changes Docker from a source-only image to `npm ci --omit=dev` at build time. The verification list at lines 59–65 covers application/TLS tests, full Node/browser suites, static Dockerfile/release assertions, and optional Compose configuration parsing, but does not explicitly require a clean production-only dependency install and runtime import/startup check. The current release tests at `test/release-config.test.js:12-22` only inspect Dockerfile/.dockerignore text, and tests running in the ordinary developer dependency tree cannot demonstrate the production-only artifact resolves the new transport.

Source: *Software Engineering at Google* — Dependency Management and Code Sustainability; *How Google Tests Software* — Change Coverage. A new runtime dependency changes the deployment contract, so verification must exercise the production dependency boundary rather than relying solely on developer-tree success and build-command text.

Consequence: an implementation could pass scoped TLS and browser tests locally while a missing/misclassified production dependency, unsupported selected version, or image packaging omission prevents the container's server from importing or reaching readiness. No dependency has been selected or code implemented yet, so this is a planning completeness suggestion, not an observed deployment failure.

Remedy: add an isolated production-artifact smoke check: copy only the intended runtime/manifests into an owned temporary directory, install with `npm ci --omit=dev`, and import/start the runtime with an isolated temporary database/key and disabled NFS, then shut it down through owned IPC. Assert Undici resolves from that production tree and development/browser packages are absent. When a Docker build is available and authorized, the equivalent built-image loopback/readiness smoke provides stronger evidence; otherwise record that an image build/runtime was not tested. Do not mutate the working dependency tree, user's Docker services, or real key/data directories, and report registry/network/tooling blockers without treating static assertions as equivalent evidence.

## Assessment

- Scope and R2 Change Propagation: `.env` forwarding, startup bootstrap, scoped Home Assistant trust, packaging, and related tests/docs are coordinated parts of the explicit goal. The plan distinguishes those changes from archived shutdown/NFS/bookmark remedies. Removing repetitive Compose forwarding intentionally changes shell-to-env-file precedence; the new precedence and override mechanisms are explicitly documented/tested instead of silently promising identical behavior.
- R1 Cognitive Overload: the plan separates pure configuration, startup-owned secret initialization, scoped transport trust, resource cleanup, and image installation. These boundaries give each stage a clear owner and prevent config-import side effects or generic troubleshooting infrastructure. The detailed verification is justified by persistence, TLS, and startup risk rather than speculative extensibility.
- R3 Knowledge Duplication: it reuses the current key module, native env parser, certificate validation, client factory seam, and shutdown coordinator. One canonical database-adjacent key default and one HA-specific setting replace competing startup assumptions. Compose retains only intentional container mappings rather than becoming a second application-default implementation for every variable.
- R4 Accidental Complexity: Undici is justified by a supported scoped WebSocket dispatcher API, not by a requirement for a new framework. The plan rejects custom protocol implementations, internal Node imports, a dotenv dependency, global TLS mutation, and extra settings/polling owners. Build-time production installation is a necessary consequence of that dependency; the finding concerns its verification, not authorization to add unrelated packages.
- R5 Dependency Disorder: configuration remains validation/projection-only; startup composes filesystem, storage, TLS, and clients. Injected factories stay caller-owned. The HA dispatcher is disposed after admitted HTTP work drains, including startup-failure paths, within the existing shutdown budget; the plan does not destroy caller resources or require a new lifecycle subsystem.
- R6 Domain Model Distortion: first-time generation is distinct from losing a key for existing ciphertext. Explicit secret/file sources remain authoritative; malformed/unreadable persisted data is not a reason to rotate. Host NFS/CA paths and container-visible roots remain separate. `HOME_ASSISTANT_CA_FILE` becomes the direct/Compose trust interface rather than a Compose-only alias to process-global trust.

## Security And Compatibility Checks

- Pure `loadConfig()` inspection no longer performs file reads, random generation, or persistent writes. Bootstrap belongs to the owned server startup path; test defaults must be isolated so automatic generation cannot unexpectedly write into the user's repository data directory.
- The standard key filename/location remains compatible with the current default `./data` and `/app/data` layout. Database relocation and explicit overrides are treated as operator migrations. The missing-key/ciphertext guard avoids silently replacing lost credentials with a fresh random key; unrelated saved dashboard/device data does not prevent legitimate first initialization.
- Complete temporary-file publication plus exclusive final-path creation addresses the current direct-write race. Winner reads must validate completed persisted bytes, and failure/temp cleanup cannot authorize deleting or overwriting the winner. New directory/file modes are restrictive without retroactively changing user ownership/permissions.
- Invalid explicit secrets, invalid persisted keys, unreadable storage, and publication failure remain nonzero startup failures before readiness. No generated secret belongs in logs, browser APIs, preferences, `.env.example`, or committed user `.env`; database/key backups remain paired.
- HA trust is client-scoped and used for both listing and service calls. Public/default trust, hostname checks, rejection of malformed/private-key-bearing CA files, and unrelated-client isolation are planned. Linkwarden/CalDAV retain their separate CA settings; no verification bypass or global dispatcher/default-root mutation is proposed.
- The env-file route preserves Node-native parsing and fresh-child reloads. Compose requires explicit example-file setup and keeps fixed container paths; image secrets/files remain excluded. Ordinary setup commands no longer require inline prefixes, but available overrides remain documented rather than globally removed.
- No production key, `.env`, filesystem mount, external integration, or existing user service needs to be modified to perform the proposed verification. Required transport-lifecycle additions stay limited to the new owned resource and do not fold in archived fixes.

## Verification Review

Quick Test Check is skipped as a production/test-code assessment because the reviewed change is a documentation-only plan. Proposed tests meaningfully cover key bytes/modes, forbidden writes, actual competing initializers, stored credential continuity, lost-key refusal, scoped private-CA success/failure/hostname checks, actual dev trust changes, env precedence, shutdown/readiness, and Compose mappings. The production-only packaging check above supplements that portfolio rather than replacing functional tests or demanding live integration accounts.

No test suite, package installation, image build, runtime server, key initialization, live NFS access, or network probe was run during this review. The Undici release/API remains to be selected and verified during implementation; plan review does not certify it. Score calculation is 100 minus one Suggestion at one point, with zero Critical or Warning findings.

## Summary

Add explicit clean production-only runtime verification for the new dependency/image contract, then implement with the existing isolated key/TLS/lifecycle checks. The plan otherwise addresses the updated goal without silently rotating keys, weakening TLS, or conflating host and container configuration. Only this review and history entry are committed; the plan, implementation, dependencies, version, `.env`, user data, and `todo.md` remain unchanged.
