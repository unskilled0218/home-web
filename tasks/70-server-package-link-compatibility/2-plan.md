# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Establish server identity and association semantics](#1-establish-server-identity-and-association-semantics)
    - [2. Implement the smallest verified compatibility boundary](#2-implement-the-smallest-verified-compatibility-boundary)
    - [3. Prove supported and refused behavior](#3-prove-supported-and-refused-behavior)
    - [4. Update version and relevant documentation](#4-update-version-and-relevant-documentation)
    - [5. Verify and record results without publication](#5-verify-and-record-results-without-publication)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Resolve the package-association compatibility refusal for `https://git.lan`, whose operator-provided `/api/v1/version` response is `{"version":"28.2.0"}`. Inspect and, only with sufficient evidence, extend `scripts/release-data.py` package-link support. Preserve the existing stable Gitea `1.25.x` path and all publication, ownership, confidentiality, runtime, and retry safeguards. Add owned regression fixtures and document the precise supported server identity and behavior. This task does not authorize live publication, association mutations, downgrade, privileged setup, or unrelated fixes.

## Implementation Plan

### 1. Establish server identity and association semantics

- Identify the actual deployed product and release using read-only public server metadata and authoritative release/source information. A numeric version alone does not identify Gitea, Forgejo, or another implementation. Do not infer that `28.2.0` is a particular product solely from its shape or existing project terminology. If public metadata is insufficient, request sanitized operator-provided product/build identity rather than reading deployment secrets or guessing.
- Trace the exact release's version endpoint, package GET representation, link route, authorization checks, association service, and database update behavior. Record immutable source references and the call chain in `4-implemented.md`; link relevant evidence from the operations documentation. API schemas or version strings alone do not prove that an existing association cannot be replaced.
- Establish whether inaccessible associated repositories appear as `repository: null`, whether the link operation rejects all already-linked packages including hidden associations, and whether its check/update semantics are safe under the documented writer-exclusion requirement. Verify owner/name routing, required permissions, success/refusal statuses, and accepted-write/lost-response behavior. Check the existing Gitea support assumptions while retaining its established behavior unless evidence reveals a concrete safety problem.
- Separate confirmed facts from assumptions. Do not probe link/unlink endpoints on the live server. If source evidence cannot establish non-reassignment, stop before broadening support and record the exact missing evidence or operator decision. Do not compensate with retrying POST, force flags, unlink/relink, or a generic version bypass.

### 2. Implement the smallest verified compatibility boundary

- Keep `supported_link_server()` as the narrow shared boundary used by both `package_readiness()` and `package_association()`, or extract one small evidence classifier if product-specific response parsing requires it. Use strict documented product/version evidence; reject unknown, malformed, development, prerelease, or ambiguous identities unless specifically verified. Do not widen support to every `28.x` or future patch based on one inspected release.
- If the deployed release satisfies the safety contract, add only that evidenced identity/version policy and adapt request/response handling only where confirmed behavior differs. If independent identity evidence is required, collect it through the existing bounded HTTP helpers, not arbitrary commands or a new configuration override. Match the API data actually supplied by the verified server rather than inventing fixture-only product fields.
- Preserve the early read-only readiness check before staging/publication writes: an absent package or explicit unlinked package needs supported server evidence; an exact existing association returns without requiring link capability. A 404 is not proof that a hidden association is safe to overwrite. Final association still requires a real package with explicit unlinked evidence; failed reads are never mutation authority.
- Preserve exact positive package/repository IDs, owner, repository full name, package type/name/version, refreshed target/package evidence immediately before mutation, and refusal of conflicting links. A response containing `repository: null` is not sufficient without proven server-side non-reassignment semantics. Existing correct links, including on otherwise unsupported servers, remain read-only and do not query version unnecessarily.
- Maintain one scoped POST only after complete final identity evidence, followed by fresh exact readback. Reconcile transport-uncertain outcomes once without repeating POST; explicit HTTP refusals must not turn into success through reconciliation. Preserve no rollback, no unlink, no reassignment, no unrelated package mutation, and no success banner before final verification. Retain bounded capture and sanitized progress; do not print raw remote bodies or credentials.
- Replace the Gitea-only refusal text with an accurate description of the supported compatibility policy and safe next action. Do not claim that every unsupported server is incompatible, and do not echo arbitrary remote version/body text. Preserve machine-output contracts and command exit categories.

### 3. Prove supported and refused behavior

- Extend `test/release-template/test_bash_release.py` and `fixtures/bash_release_ports.py` with evidence-based server responses and semantics. Current fixtures default to Gitea `1.25.0` and hard-code safe link refusal; do not simply change their version string to claim independent proof of another server's behavior. Model each supported implementation's verified behavior explicitly and document where the fixture derives it.
- Add focused classifier/helper cases for supported Gitea, the verified deployed release, malformed/non-string/missing identity/version fields, unknown families, near-match versions, prereleases/development suffixes, failed discovery, and identity/version disagreement when applicable. Unverified combinations must refuse without a link POST.
- Extend owned publication scenarios for fresh absent-package readiness, preexisting unlinked package, an existing exact link without version discovery, visible foreign link, hidden foreign link represented as null, changed target/package evidence, and unsupported server readiness before any build/tag/promotion/release/link write. On the supported deployed release, prove that hidden foreign association is unchanged even if a POST is attempted and refused server-side.
- Cover fresh publication and completed retries with a verified deployed-release fixture: only a missing safe association may cause one link POST; a subsequent retry is read-only. Retain Gitea regression coverage and unknown-server correct-link behavior. Update earlier tests that categorically reject `28.2.0` only after the supported identity contract has been established.
- Exercise accepted-but-lost link responses, denied/conflicting/incorrect status responses, transport timeout, failed/malformed/oversized readbacks, and ignored/incorrect associations. Assert no duplicate POST, no unlink/DELETE or reassignment, unchanged foreign/unrelated package sentinels, retained publication evidence after failure, and no false `Publication verified` message. Reuse existing cases where practical rather than duplicating the whole expensive publication suite.
- Treat fixture tests as client-contract regression coverage, not proof of the server implementation. If authoritative source evidence needs executable confirmation, use only an isolated, unprivileged, owned server test harness with no live credentials or targets. If that requires unavailable tools or services, request operator help rather than installing or provisioning them.

### 4. Update version and relevant documentation

- Follow the existing patch-release convention: choose the next unpublished patch after `0.17.38`, verify available read-only tag/release inventory, and synchronize `VERSION`, npm manifest/root lockfile version mirrors, `scripts/release.json` notes path, README, and versioned release notes. Do not change dependency resolutions or claim/publish a remote version.
- Update `docs/releases.md` with the supported product/release evidence, permissions, hidden-link safety policy, unchanged writer-exclusion requirement, unsupported/ambiguous-server refusal, and read-only existing-link behavior. Remove the blanket `28.2.0` refusal only if replaced by verified support. Keep README simple and update `docs/testing.md` for the added contract scenarios and their source-evidence limits.
- Create `4-implemented.md` with a contents list, exact evidence references, implemented compatibility boundary, verification results, and remaining limits. If identity or non-reassignment safety remains unproven, explicitly record the blocker and leave link writes disabled; do not report the requested compatibility as complete.

### 5. Verify and record results without publication

- Run focused helper, readiness, association, lost-response, and publication-retry tests first using owned repositories and fake external ports. Run the full Python release suite with `python3 -B -m unittest discover -s test/release-template -v` after focused cases pass. Preserve existing mandatory test deadlines rather than relaxing them to hide regressions.
- Run `node --test test/release-config.test.js`, `npm run check`, `bash -n scripts/release.sh`, `bash -n scripts/release-common.sh`, `./scripts/release.sh --validate`, Python syntax validation without checkout bytecode artifacts, and `git diff --check`. Confirm no dependency-resolution changes and validate contents links in new Markdown files.
- Exercise the real local verifier through an owned isolated committed snapshot, including locked dependency installation, serial application tests, full Python release tests, and production packaging, without publication credentials. Reuse its full-suite evidence rather than unnecessarily running the expensive Python suite twice. Do not invoke the live no-argument release command as a test.
- Record commands, counts, durations, skips, and limits. Confirm only intended files changed and no live remote mutations occurred, then commit the implementation under the normal task workflow. This planning stage changes only `2-plan.md`.

## Acceptance Criteria

- The deployed server implementation and exact supported release are identified with authoritative evidence; numeric `28.2.0` alone is not treated as proof of safe package-link semantics.
- Verified deployed-release behavior permits fresh and retry association through the narrow compatibility boundary, or an explicit evidence blocker keeps writes disabled without falsely claiming completion.
- Stable Gitea support and read-only exact associations remain functional; unknown, malformed, ambiguous, or unsafe identities never acquire link-write permission.
- Exact package/repository identities, refreshed pre-mutation evidence, server-side non-reassignment, one-POST uncertain-outcome reconciliation, writer exclusion, and final exact readback remain required.
- Visible and hidden foreign associations and unrelated package sentinels remain unchanged. Failed evidence and explicit HTTP refusal never authorize overwrite, duplicate POST, rollback, or a success banner.
- Regression tests distinguish verified compatibility from simulated fixture behavior. Relevant suites, static checks, isolated local verification, version consistency, and documentation checks pass with recorded results.
- No live publication, link/unlink/reassignment, downgrade, privileged setup, secret disclosure, or unrelated implementation change occurs.

## Risks And Decisions

- The current error is an intentional association-safety refusal, not proof that the credentials or server are broken. Avoid downgrading or weakening that gate merely to remove the error.
- Product discovery can itself be ambiguous or configurable. Trusted-TLS metadata plus exact upstream/build evidence must justify the selected policy; HTML branding alone is insufficient. Custom/patched builds outside the verified contract remain unsupported.
- Client read-before-write cannot by itself protect an inaccessible existing association or a race. If the deployed API can replace associations, extra GETs and version allowlisting do not satisfy this task's safety requirement. Seek a separately approved safe design instead.
- Existing user-managed writer exclusion remains mandatory; the checkout lock is not distributed locking. Do not introduce claims of atomic server protection not supported by inspected source or tests.
- Keep this work scoped to package-link compatibility. Task 69's regular-file log-offset and heartbeat warnings, task 67's inherited findings, ARM64 host readiness, and live release authorization remain separate work.
