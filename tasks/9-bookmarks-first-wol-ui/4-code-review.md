# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Entire `home-web` project: 7 server modules, 3 browser assets, 4 test files, deployment configuration, and operator documentation
**Health Score:** 15/100

The project is compact and its current tests pass quickly, but three trust-boundary failures can disclose credentials or terminate the process, while important browser and device API behavior remains untested.

---

## Findings

### Critical

**Change Propagation — Blank-token reconnect can forward a saved secret to a new origin**
Symptom: `credentialsFromInput()` reuses the existing decrypted token whenever the submitted token is blank, even when the submitted base URL differs from the saved URL; `PUT /api/linkwarden` then sends that token to the newly supplied origin before saving (`src/server.js:103-107`, `src/server.js:146-151`).
Source: A Philosophy of Software Design — Information Leakage; Clean Architecture — Boundary integrity
Consequence: An accidental URL edit or any client able to invoke the trusted-LAN API can transmit the saved Linkwarden bearer token to an attacker-controlled HTTP(S) server.
Remedy: Permit blank-token reuse only when the normalized submitted origin and account identity match the saved configuration; otherwise require a new token before making any outbound request, and add an integration test proving the old token is never sent to a changed origin.

**Dependency Disorder — DNS rebinding bypasses the LAN and same-origin boundary**
Symptom: API authorization trusts the browser's private `remoteAddress`, while mutation origin checks accept any `Origin` matching the request's attacker-controlled `Host` header (`src/server.js:25-38`, `src/server.js:121-123`).
Source: Clean Architecture — Policy/detail boundaries; Software Engineering at Google — Hyrum's Law
Consequence: A malicious website whose hostname is rebound to the dashboard can make same-origin requests from a victim browser and enumerate or mutate devices, dispatch wake packets, read bookmarks, and replace or delete Linkwarden configuration.
Remedy: Validate `Host` and `Origin` against an explicit configured allowlist or require an unguessable/authenticated request boundary; cover rebinding-style Host/Origin combinations and preflight behavior in server integration tests.

**Accidental Complexity — Transport exceptions escape and can terminate the process**
Symptom: The async `http.createServer` callback has no top-level error boundary, so malformed Host data can reject the handler at `new URL()` (`src/server.js:188-191`); separately, `fetchLinkwarden()` constructs a body-bearing `Response` for every status, and Node throws for 204, 205, and 304 inside an event callback (`src/linkwarden.js:8-25`). A wake/delete race can also make both audit writes fail outside the intended recovery path (`src/server.js:163-183`).
Source: Code Complete — Defensive Programming and explicit error paths
Consequence: A malformed LAN request, unusual reverse-proxy response, or database race can become an unhandled rejection or uncaught exception and stop the entire dashboard.
Remedy: Put one final error boundary around every inbound request, reject or normalize invalid upstream statuses before creating a Fetch `Response`, make audit failures non-recursive, and add child-process tests proving malformed metadata and 204/304 upstream responses return errors without process exit.

### Warning

**Dependency Disorder — Linkwarden TLS identity verification is disabled globally for that integration**
Symptom: Every Linkwarden HTTPS request sets `rejectUnauthorized: false`, and the test suite explicitly requires an untrusted hostname-mismatched certificate to succeed (`src/linkwarden.js:8-12`, `test/linkwarden.test.js:173-194`).
Source: Code Complete — Defensive Programming; Clean Architecture — Protecting boundary credentials
Consequence: Any actor able to intercept traffic on the supposedly trusted network can impersonate Linkwarden and receive the bearer token; the documented trust assumption turns one network compromise into credential compromise.
Remedy: Restore normal certificate and hostname verification, support a deployment-provided CA bundle for private PKI, and make any insecure mode an explicit off-by-default setting with a prominent warning.

**Cognitive Overload — Bulk Wake converts every failure into success**
Symptom: `wake()` catches API errors and resolves normally, so every promise passed to `Promise.allSettled()` is fulfilled and the final bulk status always reports success (`public/app.js:135-138`, `public/app.js:165-170`).
Source: Code Complete — Error-handling discipline; A Philosophy of Software Design — Simple interfaces with truthful contracts
Consequence: Operators can be told that wake packets were sent when some or all requests failed, masking the exact operational failure the dashboard is intended to report.
Remedy: Let `wake()` propagate a structured failure to the bulk caller or return an explicit result object, aggregate successes and failures without each request overwriting shared status, and test mixed-success and all-failure batches.

**Coverage Illusion — Device APIs and browser behavior are effectively untested**
Symptom: The integration test exercises Linkwarden and health endpoints, packet tests call `wol.js` directly, and the only browser check searches HTML text without executing `public/app.js` (`test/linkwarden-server.test.js:20-161`, `test/wol.test.js:5-72`).
Source: Working Effectively with Legacy Code — Characterization Tests and seams; How Google Tests Software — Change coverage over line coverage
Consequence: Device CRUD, wake-route cooldown/auditing, bulk wake reporting, modal errors, focus behavior, and collection transitions can regress while all 27 tests remain green.
Remedy: Add server integration cases for device CRUD and wake responses with an injectable packet sender, then add focused DOM tests for bulk wake outcomes, dialogs, collection transitions, and focus preservation.

**Knowledge Duplication — The documented `.env` local workflow is not implemented**
Symptom: README instructs users to copy `.env.example` and run `npm start`, but the start script is only `node src/server.js` and Node does not load `.env` automatically (`README.md:5-14`, `package.json:10-14`); the copied template also leaves both Linkwarden key sources empty (`.env.example:7-12`).
Source: The Pragmatic Programmer — DRY as one authoritative configuration decision
Consequence: Local environment settings are silently ignored and the same instructions claim Linkwarden can be connected before a usable encryption key has been loaded.
Remedy: Make the start command load the optional environment file or remove the copy step and document explicit exports; ensure the first-run path establishes a persistent key before directing users to Connect.

**Cognitive Overload — JSON decoding corrupts split UTF-8 and enforces the wrong size unit**
Symptom: `readJson()` concatenates each Buffer into a string independently and limits JavaScript character count rather than received bytes (`src/server.js:51-57`).
Source: Code Complete — Defensive input handling
Consequence: A multibyte device name split across TCP chunks can acquire replacement characters, while payloads larger than the stated byte limit can pass depending on character encoding.
Remedy: Count raw Buffer bytes, enforce the limit before decoding, and decode the complete buffer or use `StringDecoder`; add a request test that splits a multibyte character across chunks.

**Accidental Complexity — Collection-token capacity invalidates unrelated active sessions**
Symptom: Collection-list requests retain one-hour tokens until the map exceeds 1,000 entries, then clear the entire map instead of evicting expired or oldest entries (`src/server.js:85-100`).
Source: A Philosophy of Software Design — Information Hiding and predictable abstractions
Consequence: Repeated refreshes, multiple users, or a large collection tree can invalidate every visible selection well before its advertised expiry and produce arbitrary 400 responses.
Remedy: Bound the map with per-entry expiry plus oldest-entry eviction, avoid issuing duplicate token sets unnecessarily, and test capacity behavior without invalidating recent selections.

**Cognitive Overload — Modal errors and names are outside the accessible interaction boundary**
Symptom: Device-save failures update the page-level status behind the still-open modal, and both dialogs lack `aria-labelledby` or `aria-label` despite having visible headings (`public/app.js:156-164`, `public/index.html:27-48`). Checkbox and collection rerenders also replace the focused control (`public/app.js:41-54`, `public/app.js:81-103`).
Source: A Philosophy of Software Design — Interface complexity; Code Complete — Error paths must be visible at the point of action
Consequence: Keyboard and assistive-technology users can lose focus or receive no usable error/name context while completing core device and bookmark operations.
Remedy: Give each dialog an explicit accessible name and local alert region, render form failures inside the active dialog, and update selected controls in place or restore focus after rerender.

### Suggestion

**Cognitive Overload — Collection changes leave stale bookmark cards visible while loading**
Symptom: Selecting a collection clears `state.bookmarks` and rerenders the tree but does not rerender the bookmark grid before awaiting the next request (`public/app.js:110-116`, `public/app.js:131-133`).
Source: The Pragmatic Programmer — Orthogonality between model state and rendered state
Consequence: Old links remain displayed under the newly selected collection until the request completes, creating a brief but misleading mismatch between selection and content.
Remedy: Clear or replace the bookmark grid with a loading state synchronously when selection changes, then render only the response matching the current token.

**Dependency Disorder — Existing encryption-key files can be accepted with unsafe permissions**
Symptom: Newly generated key files use mode `0600`, but existing files and atomic-creation race winners are only read and cryptographically validated (`src/linkwarden-key.js:14-21`, `src/linkwarden-key.js:30-43`).
Source: Code Complete — Defensive Programming
Consequence: A pre-provisioned or accidentally recreated group/world-readable key is silently accepted, allowing another local account with database access to decrypt the stored Linkwarden token.
Remedy: Verify the key path is a regular file owned by the expected account with no group/other permission bits, and fail startup with an actionable message when the check fails.

**Domain Model Distortion — Connection failures are classified as client input errors**
Symptom: `PUT /api/linkwarden` catches timeouts, DNS failures, remote 5xx responses, and protocol errors in the same outer block that returns HTTP 400, while collection and bookmark outages return 503 (`src/server.js:127-153`, `src/server.js:181-183`).
Source: Domain-Driven Design — Ubiquitous Language; Code Complete — Precise error reporting
Consequence: Clients and operators cannot distinguish invalid credentials/input from a temporarily unavailable dependency, encouraging incorrect retries and troubleshooting.
Remedy: Separate validation/authentication failures from upstream availability failures and return consistent 4xx versus 503 statuses without exposing sensitive remote details.

**Cognitive Overload — Integer configuration silently accepts malformed values**
Symptom: `Number.parseInt` accepts prefixes, so values such as `3000junk`, `9.5`, or `1e3` are silently converted instead of rejected (`src/config.js:3-9`).
Source: Code Complete — Defensive Programming and explicit invariants
Consequence: Typographical configuration mistakes produce unintended ports, cooldowns, or cache periods while startup claims the values were valid integers.
Remedy: Validate the complete trimmed string with an integer grammar before conversion and add malformed-environment tests.

**Knowledge Duplication — Firewall guidance contradicts the actual wake delivery plan**
Symptom: README correctly states every wake uses ports 9 and 47009 and may add a custom port, then advises allowing port 9 “or” the custom port while omitting 47009 (`README.md:32-36`, `test/wol.test.js:33-48`).
Source: The Pragmatic Programmer — DRY; A Philosophy of Software Design — Information Leakage
Consequence: Operators can follow the documentation exactly and still block part of the Moonlight-compatible delivery set, making troubleshooting harder.
Remedy: Document ports 9 and 47009 as always required and the custom port as additional, deriving future operator text from the same named constants where practical.

Recommended fix order: stop cross-origin token reuse; harden the API trust boundary; add top-level process error containment; restore verifiable TLS; correct bulk-wake reporting; then add tests around these paths before addressing the remaining operational and accessibility findings.

---

## Summary

The most urgent work is to protect Linkwarden credentials and make malformed inbound or upstream traffic non-fatal. After those boundaries are safe, the highest leverage improvement is behavior-level coverage for device routes and browser state transitions, because the current fast suite passes despite several confirmed user-visible failures.
