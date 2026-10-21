# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Define the on/off configuration contract](#1-define-the-onoff-configuration-contract)
    - [2. Update preparation and server enablement](#2-update-preparation-and-server-enablement)
    - [3. Align deployment examples and operational guidance](#3-align-deployment-examples-and-operational-guidance)
    - [4. Update regression coverage and run checks](#4-update-regression-coverage-and-run-checks)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Replace the public `NFS_MOUNT_MODE` values `disabled`, `mount`, and `existing` with `on` and `off`. Preserve both application-managed mounting and host-managed mounts by selecting the preparation path from `NFS_SOURCE` when enabled. Update configuration, startup wiring, fixtures, and current documentation.

## Implementation Plan

### 1. Define the on/off configuration contract

- In `src/config.js`, keep the normalized `nfs.mode` field but accept only `on` and `off` after trimming and lowercasing. Change the validation message to `NFS_MOUNT_MODE must be on or off.`
- Default an omitted `NFS_MOUNT_MODE` to `off`, including when `NFS_SOURCE` is present. An explicitly empty mode remains invalid, matching the current treatment of empty values.
- Require `NFS_MOUNT_PATH` when mode is `on`. A nonempty trimmed `NFS_SOURCE` selects application-managed mounting; an empty source selects an existing mount. Remove the old requirement tied to mode `mount`.
- Retain source syntax checks, resolved mount paths, option validation, and immutable configuration. Invalid values continue to populate `nfs.error` rather than aborting the dashboard.

### 2. Update preparation and server enablement

- In `src/nfs.js`, return the existing disabled result immediately for mode `off`, before inspecting mounts, creating directories, reading files, or invoking a command. Keep the current early configuration-error result for invalid enabled configuration.
- For mode `on` with no source, use the existing pre-mounted-directory branch. Verify the exact mount point and bounded read-only options before directory access, and never invoke `mount` in this branch.
- For mode `on` with a source, retain matching-mount reuse, source/type conflict checks, forced safety options, command timeout, post-command verification, and preparation-child ownership.
- In `src/server.js`, replace both `mode !== 'disabled'` checks with `mode === 'on'`. Preserve the distinction between enabled-but-unavailable and disabled sources, the generic warning, and shutdown ownership behavior. Update the cleanup error's configuration advice to use `off` or `on` with an existing mount and empty source.
- Preserve preparation result reasons such as `disabled`, `existing`, and `mounted`; these describe runtime outcomes, not accepted environment values.

### 3. Align deployment examples and operational guidance

- Set `.env.example` to `NFS_MOUNT_MODE=off`. Explain that `on` plus a source manages a mount, while `on` with an empty source uses a prepared mount.
- Update every current example in `docs/nfs-backgrounds.md` to use `on`; explicitly leave `NFS_SOURCE` empty for Compose and pre-mounted direct development. Document `off`, the omitted-value default, restart requirements, and migration from all three old values.
- Update mode terminology in `docs/operations.md` and `docs/testing.md` so preparation-child and host-mount guidance matches the new contract.
- Keep Compose's existing env-file forwarding, `/photos` container path, and read-only host bind. Its image lacks an NFS client and mount capabilities, so the documented Compose setup uses `on` with an empty source.
- Update explicit disabled environments in `scripts/check-production.js`, `e2e/server-setup.js`, `test/startup-key.test.js`, `test/home-assistant-tls.test.js`, and `test/server-shutdown.test.js` to `off`. Change the shutdown test's existing-mount setup and `test/release-config.test.js` Compose fixture/assertion to `on` with no source.

### 4. Update regression coverage and run checks

- Extend `test/config.test.js` to cover omitted mode with and without a source, explicit `off` with otherwise valid mount settings, normalized `on`/`off`, `on` with and without a source, a missing enabled path, invalid/empty mode, and rejection of each legacy value. Retain malformed-source and unsafe-option cases under explicit `on`.
- Convert `test/nfs.test.js` fixtures to `on`/`off`, selecting the preparation branch through source presence. Assert that `off` with configured source/path invokes none of the mount, directory, stat, or command dependencies. Retain unsafe existing-mount rejection before file access, successful pre-mounted reuse without a command, matching-source reuse, conflicts, fixed command options, verification failures, and child ownership.
- Use existing real-server shutdown/startup fixtures to verify that `on` with an unavailable existing mount still reaches readiness, exposes an enabled-but-unavailable photo source, and shuts down cleanly; verify `off` remains disabled. Keep test files and mounts simulated or temporary.
- Run `node --test test/config.test.js test/nfs.test.js test/server-shutdown.test.js test/startup-key.test.js test/home-assistant-tls.test.js test/release-config.test.js`, then `npm run check` and `npm test`. Record Docker Compose parser skips explicitly if Docker is unavailable.
- Search active source, tests, scripts, `.env.example`, and current documentation for remaining old environment assignments or mode comparisons. Review matches individually because runtime result reasons remain valid. Check the final diff for consistency and whitespace errors.

## Acceptance Criteria

- `NFS_MOUNT_MODE` accepts only normalized `on` and `off`; an omitted value disables NFS even when a source exists. Legacy and unknown values produce a nonfatal configuration error.
- `off` performs no NFS preparation or photo discovery and reports the disabled source state.
- `on` requires a mount path and uses source presence to choose application-managed or existing-mount preparation.
- Safe existing mounts work without a mount command; unsafe mounts remain rejected before file access. Application-managed mounting retains existing safety, verification, timeout, and lifecycle behavior.
- An enabled mount failure leaves the dashboard usable and the photo source unavailable rather than disabled. Unrelated widgets and shutdown behavior continue to work.
- Current examples, fixtures, validation messages, and operational guidance consistently use `on`/`off`. Compose still forwards `on` and preserves its fixed container path and read-only bind.
- Required automated checks pass, with any unavailable optional Compose parser check recorded accurately.

## Risks And Decisions

- This intentionally breaks legacy environment values. Document migration: `disabled` becomes `off`; `mount` becomes `on` with the source retained; `existing` becomes `on` with the source empty. Historical task documents remain historical records.
- Defaulting to `off` removes the previous implicit enablement from `NFS_SOURCE`. Source-only deployments must explicitly set `NFS_MOUNT_MODE=on`.
- Source presence is the only preparation selector. A stale source in a previously existing-mode deployment would select application-managed mounting; migration guidance must explicitly clear it.
- Keep existing validation for configured source/options even under `off`; disabling guarantees no NFS work, while malformed stored settings can still produce the existing generic warning.
- Preserve the mount safety policy and result-reason vocabulary. This task changes the configuration interface, not filesystem eligibility or slideshow behavior.
- Verification uses simulated mounts and isolated application processes. No live NAS access, privileged mount operations, or new system packages are required.
