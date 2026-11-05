# plan

- [plan](#plan)
  - [Scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [Summary](#summary)
    - [1. Reproduce And Separate Failure Causes](#1-reproduce-and-separate-failure-causes)
    - [2. Apply Bounded Compatibility Fixes](#2-apply-bounded-compatibility-fixes)
    - [3. Verify And Document](#3-verify-and-document)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## Scope

Fix the 25 weather-proxy failures blocking application-test release verification. Inspect `src/weather-provider.js`, `test/weather-provider.test.js`, `test/fixtures/weather-network.js`, and `test/fixtures/weather-network-client.mjs`; change production transport or fixtures only where diagnosis establishes a defect. Preserve proxy precedence, TLS verification, intended bypass behavior, connection tuning, and transport disposal. Do not modify release gates, access real credentials, publish a release, or fix unrelated failures.

## Implementation Plan

### Summary

The current environment runs Node.js `v26.13.0` with bundled Undici `8.12.2`; the project pins npm Undici `8.11.2`. Native `fetch` and the weather transport therefore are not identical reference implementations. Tests currently run native cases first, so native failures can hide weather results. The transport deliberately supplements wildcard-apex bypass, while tests assume native fetch also bypasses the apex. Establish the intended contract independently rather than treating either runtime's current behavior as automatically correct.

### 1. Reproduce And Separate Failure Causes

- Create the new implementation branch `82-weather-proxy-verification`. Reproduce with `node --test test/weather-provider.test.js`; record individual failures and runtime/dependency versions, distinguishing failing subtests from parent-test failures.
- Use existing isolated loopback HTTP/HTTPS targets, proxy servers, generated test certificates, and sanitized child environments. Do not use ambient proxies, external weather services, operator credentials, or real DNS destinations.
- Trace the complete nested cause, including argument name/value and stack, behind `ERR_INVALID_ARG_VALUE`. Check the child fixture's `dns.lookup`, `net.connect`, and `tls.connect` wrappers against the actual call forms and Node contracts. Compare native and project fetch paths separately so one failure cannot conceal the other.
- Check installed npm Undici against the lockfile before attributing behavior to a version. Investigate HTTPS-proxy connection options, certificate trust, hostname validation, and lowercase proxy precedence separately; do not assume these share one cause.
- Reproduce wildcard routing for apex and subdomain hosts, matching/wrong ports, mixed lists, case differences, unrelated hosts, and live uppercase/lowercase environment changes. Capture native behavior on Node 26 and the deployment Node 24 runtime when available, with exact versions. If another runtime is unavailable, record that limitation and ask the operator for required tools rather than installing privileged components.

### 2. Apply Bounded Compatibility Fixes

- Fix any confirmed fixture defect without changing the network isolation, timeout bounds, TLS trust model, or cleanup guarantees. Preserve the original connection-call arguments and supported signatures when instrumenting sockets; add regression coverage for the diagnosed failure.
- If the production transport has a defect, make the smallest correction in `src/weather-provider.js`. Keep startup proxy opt-in/opt-out, lowercase precedence including an empty lowercase override, per-request bypass refresh, port restrictions, and explicit wildcard-apex/subdomain bypass intact. Keep the two-second dual-stack attempt timeout and process defaults unchanged.
- Separate application-contract assertions from native-runtime comparison assertions in `test/weather-provider.test.js`. Weather routing must always meet explicit expected outcomes. Keep meaningful native coverage, but model only diagnosed, documented runtime differences explicitly; do not skip cases, accept arbitrary outcomes, catch failures as success, or remove TLS/routing assertions to make tests pass. Native apex differences must not change the weather contract.
- Preserve tests for trusted/untrusted target and proxy certificates, wrong hostnames, non-bypassed requests, and environment edits on reused transports. Verify that native and weather cases both execute independently even when one fails.
- Retain real socket cleanup, stalled-body abort, idempotent stop, and caller-owned transport behavior. Avoid a new general proxy parser or dependency upgrade unless evidence shows the bounded fixes cannot meet the contract; document and justify any necessary dependency change and synchronize its lockfile.

### 3. Verify And Document

- Run `node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js`, then `npm test` and `npm run check`. Repeat focused proxy tests to detect socket races or leaked child processes. Preserve exact failure evidence and distinguish remaining unrelated failures.
- Verify supported behavior on the current Node 26 runtime and an available Node 24 runtime with built-in environment-proxy support. Do not add version-based skips or narrow the advertised runtime range merely to hide failures. Clearly record untested runtime coverage.
- Run `node --test test/release-config.test.js`, `bash scripts/release.sh --validate`, and `git diff --check`. Do not invoke the real no-argument release command; a passing application suite addresses this release gate without publishing. The previously recorded ignored-secret Python release-fixture failure remains outside this task.
- Follow the existing patch-release convention: use the next unused patch after `0.17.49`, synchronize `VERSION`, npm manifest/lock root versions, release configuration's notes path, README release link, and current-notes documentation link. Add versioned release notes and update relevant runtime/proxy guidance with confirmed behavior only. Leave historical records and `todo.md` unchanged.
- Write `4-implemented.md` with confirmed causes, changed files, runtime matrix, test results, and remaining limitations. Commit the implementation and documentation; this planning stage changes no implementation code.

## Acceptance Criteria

- The reported HTTPS-proxy and precedence errors have evidenced causes and regression coverage; supported HTTP/HTTPS proxy requests succeed, and certificate/hostname failures remain rejected for the intended reason.
- Weather bypass tests cover apex, subdomains, ports, case, lists, unrelated hosts, and live environment changes, with lowercase precedence and empty overrides preserved.
- Native-reference differences are explicit and evidence-based; application assertions remain strict, and every relevant native/weather scenario runs without new skips or verification bypasses.
- Focused weather-provider/lifecycle tests and the full application suite pass, or any remaining failures are demonstrated unrelated and recorded accurately. Runtime coverage and limitations are explicit.
- Connection tuning, abort behavior, disposal, and isolation remain intact. Relevant docs and release metadata agree. No real credentials are accessed and no release is published.

## Risks And Decisions

- A native-fetch comparison is a compatibility signal, not an invariant across Node releases. Do not redefine the application's intended wildcard behavior merely to match a changed native runtime.
- `fetch failed` conceals the underlying cause. Fixing only the outer error assertion risks hiding an instrumentation defect or a genuine TLS regression.
- TLS negative tests must still exercise real handshakes. Never use `NODE_TLS_REJECT_UNAUTHORIZED=0`, disable hostname checks, or broaden expected errors to include unrelated argument failures.
- Keep fixes local until evidence warrants broader changes. Do not upgrade dependencies, alter supported Node versions, or replace proxy semantics speculatively.
- The original 25 failures include nested test accounting; success means all affected scenarios pass, not preserving the original total test count.
