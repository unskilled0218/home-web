# Task 12: Resolve Whole-Project Review Warnings

## Objective

Resolve every Warning finding in `tasks/10-whole-project-review/4-code-review.md` without taking on the separate Suggestion findings. Preserve the dashboard's current behavior except where the review identified incorrect failure reporting, insecure TLS handling, inaccessible dialogs, or disruptive collection rerenders.

## Scope

1. Restore normal TLS certificate and hostname verification for Linkwarden, with explicit support for a private CA.
2. Make bulk Wake results distinguish full success, partial failure, and total failure.
3. Add direct integration coverage for device CRUD, Wake dispatch/cooldown behavior, and browser behavior that currently has only static-markup coverage.
4. Make the documented root `.env` workflow work for local `npm` commands.
5. Make JSON request parsing byte-bounded and correct when UTF-8 characters span chunks.
6. Replace all-at-once collection-selection token eviction with bounded incremental eviction.
7. Give dialogs accessible names, place errors in their owning dialogs, and preserve focus during collection selection.

## Out of Scope

- Review suggestions concerning integer parsing, stale Linkwarden bookmarks, CSP migration, alternate Wake broadcast discovery, and documentation deduplication.
- A new frontend framework, browser-test framework, or production dependency solely for testing.
- Changes to authentication policy or the device data model beyond what is needed to test existing behavior.

## Implementation Plan

### 1. Create a testable server composition boundary

- Extract the HTTP application/server construction from `src/server.js` into a factory that accepts the device store, Linkwarden client, Wake executor, and runtime configuration.
- Keep production startup in `src/server.js`: load configuration, construct concrete dependencies, listen on the configured host/port, and retain the current startup/error handling.
- Keep route behavior and response shapes unchanged. The factory exists so tests can bind to loopback with an ephemeral port and inject deterministic Wake and Linkwarden fakes instead of launching a child process for every behavior.
- Update existing security integration tests to use the factory where practical while retaining at least one production-startup test for host binding and startup configuration.

### 2. Restore secure Linkwarden TLS with optional private-CA trust

- Remove `rejectUnauthorized: false` from `src/linkwarden.js`; certificate-chain and hostname verification must be enabled by default.
- Add an optional `LINKWARDEN_CA_FILE` configuration value. Load the PEM certificate bundle during production composition and pass it only to Linkwarden HTTPS requests as the `ca` option. Do not replace the process-wide trust store and do not disable hostname checks.
- Fail startup with a clear configuration error if `LINKWARDEN_CA_FILE` is set but cannot be read or is empty.
- Add the variable to `.env.example` and document the local and Compose configuration, including the required read-only bind mount when the CA file is outside an existing mounted directory.
- Replace the existing permissive self-signed-certificate expectation with HTTPS tests that prove:
  - an untrusted self-signed server is rejected by default;
  - the same server succeeds when its CA is explicitly configured;
  - a trusted certificate with the wrong hostname is still rejected.

### 3. Make the documented `.env` workflow executable

- Add a small dependency-free environment loader used by the `start` and `start:lan` npm scripts before application startup. It must:
  - read the repository-root `.env` when present;
  - accept blank lines and comments;
  - parse the documented `KEY=value` format, including quoted values;
  - leave variables already present in the process environment unchanged;
  - treat a missing `.env` as normal startup behavior.
- Keep `docker-compose.yml`'s existing environment handling; Compose already reads `.env` independently.
- Ensure `.env.example` works when copied to `.env` for local npm startup. Use local filesystem paths there, while Compose continues to supply container paths explicitly.
- Add focused tests for precedence, comments/blank lines, quoted values, and missing files. Add a startup/configuration assertion that values from a temporary env file reach the application configuration.

### 4. Make JSON request parsing byte-correct and bounded

- Change `readJson()` to collect `Buffer` chunks, track the accumulated byte count, enforce `MAX_JSON_BODY_BYTES` against bytes, and decode once after the complete body has arrived.
- Reject oversized bodies immediately and ensure no subsequent `end` or stream error can settle the request twice.
- Preserve current status-code behavior for empty bodies, malformed JSON, and oversized requests.
- Add tests where a multibyte UTF-8 character is split across chunks, where the decoded character count is below the limit but byte count exceeds it, and where input is exactly at the limit.

### 5. Replace collection-token map clearing with incremental eviction

- Encapsulate collection-selection token storage behind a small module rather than manipulating the `Map` directly in request handlers.
- On token creation, first remove expired entries, then evict only the oldest entries needed to stay within the configured capacity. Never clear all active entries because one new collection tree reaches the limit.
- Count every emitted selection token toward the bound and retain the current token entropy, one-hour expiry, settings fingerprint binding, and invalid/expired-token response behavior.
- Make capacity, clock, and token generation injectable for deterministic unit tests.
- Add tests proving expired entries are pruned, oldest active entries are evicted first, recently issued entries remain valid, capacity is never exceeded, and a response containing many collection tokens does not immediately invalidate all of them.

### 6. Correct bulk Wake status reporting and cover device behavior

- Replace the current `Promise.all(...catch(() => null))` bulk action with settled-result accounting that retains each device failure.
- Show a success message only when every request succeeds. Show an error for total failure and a specific partial-failure message with succeeded/failed counts when results are mixed.
- Keep attempts concurrent and always clear the bulk-button busy state after settlement.
- Through the server factory, add integration tests covering device create, read/list, update, delete, validation failures, Wake dispatch, unknown-device Wake, and per-device cooldown rejection. Inject a Wake spy so tests verify dispatch without sending network broadcasts.
- Move the result-aggregation portion of the browser action into an importable pure helper used by `public/app.js`. Test full-success, partial-failure, total-failure, and thrown/rejected requests with Node's built-in test runner.

### 7. Fix dialog semantics, error ownership, and focus stability

- Give each `<dialog>` an accessible name by associating it with its visible heading via `aria-labelledby` and stable heading IDs.
- Add a dedicated error/status region inside the device editor dialog. Route device form validation and save errors there; keep collection-fetch errors inside the collection dialog. Clear dialog-local errors when opening or successfully completing that dialog's action.
- Stop rerendering the complete collection tree for each checkbox change. Update the selected-token state and affected checkbox/button state in place so keyboard focus remains on the toggled control.
- When a full collection rerender is necessary after loading or retrying, restore focus to the corresponding collection checkbox when it still exists.
- Extract only the narrow state/result helpers needed for behavior tests. Add executable tests for selection toggling, aggregate Wake messaging, and dialog-local error targeting, plus static assertions for dialog naming and status-region markup.

### 8. Documentation and versioning

- Update `README.md` with the working local `.env` flow and private-CA setup for both local npm execution and Docker Compose.
- Keep `.env.example`, npm scripts, Compose variables, and README examples consistent.
- Add `tasks/12-warning-findings-fixes/2-implementation.md` during implementation, recording changed files, design decisions, test evidence, and any environmental verification that could not run.
- Bump the package version from `0.7.0` to `0.8.0` after the implementation and tests pass because the task adds configuration and user-visible behavior while preserving compatibility.

## Verification

Run from the repository root:

```bash
npm test
npm run check
git diff --check
```

Also perform these targeted checks:

1. Start with no `.env` and confirm normal defaults still work.
2. Start with a copied `.env.example` and confirm local paths and overrides are loaded.
3. Exercise create, edit, delete, single Wake, and bulk Wake against the injected integration server tests.
4. Verify bulk Wake displays success, partial-failure, and total-failure outcomes accurately.
5. Keyboard-test both dialogs: accessible name announcement, local error announcement/placement, tab order, checkbox focus retention, Escape, and focus return to the opener.
6. Verify Linkwarden rejects an untrusted certificate, accepts a certificate signed by the configured private CA, and rejects a hostname mismatch.
7. If Docker is available, run `docker compose config` and start the stack with and without optional private-CA configuration. Record Docker as unavailable rather than claiming this check passed when the executable is absent.

## Acceptance Criteria

- Linkwarden TLS verification is enabled by default; no production path sets `rejectUnauthorized: false`.
- A configured private CA extends trust only for Linkwarden requests and does not bypass hostname verification.
- Bulk Wake never reports unconditional success when one or more requests failed.
- Automated tests exercise device CRUD, Wake dispatch/cooldown, and the changed browser behavior rather than relying only on HTML string assertions.
- `npm start` and `npm run start:lan` honor a root `.env`, with explicit process environment values taking precedence.
- Split UTF-8 input parses correctly and the JSON body limit is enforced in bytes.
- Collection-selection storage remains bounded without invalidating every active token at once.
- Both dialogs have accessible names, errors render inside the owning dialog, and toggling a collection checkbox does not discard keyboard focus.
- Existing tests and checks pass, documentation matches runtime behavior, and the implementation record contains verification evidence.
