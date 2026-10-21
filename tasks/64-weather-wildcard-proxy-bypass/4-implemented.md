# Implementation results

- [Implementation results](#implementation-results)
  - [Outcome](#outcome)
  - [Changes](#changes)
  - [Routing and lifecycle evidence](#routing-and-lifecycle-evidence)
  - [Verification](#verification)
  - [Scope and limits](#scope-and-limits)

## Outcome

Implemented the complete wildcard proxy bypass plan on a freshly created `64-weather-wildcard-proxy-bypass` branch. The pre-existing branch was preserved as `64-weather-wildcard-proxy-bypass-planning` before creating the required branch at the same planning commit. Existing uncommitted regression-test work was retained, completed, and verified. Increased the patch version from `0.17.32` to `0.17.33` in `package.json` and both lockfile version entries, following the existing release convention.

## Changes

- `src/weather-provider.js` retains Node's initialized startup-policy check and constructs `EnvHttpProxyAgent` without an explicit `noProxy` snapshot. Public dispatcher composition supplements only the wildcard domain-itself match; all other matching remains delegated to Undici with its live environment refresh.
- The private predicate reads `process.env.no_proxy ?? process.env.NO_PROXY ?? ''` at dispatch time. It recognizes ordinary `*.domain` rules with optional numeric ports, normalizes case and trailing dots, respects effective HTTP/HTTPS ports, and excludes IP literals. Empty lowercase values retain precedence, and deletion falls back to uppercase.
- One supplemental direct agent is allocated lazily per enabled transport. It shares the existing two-second family-selection connection settings and ordinary target TLS validation. The environment agent retains its existing `connect`, `proxyTls`, and `requestTls` settings.
- Transport stop prevents further supplemental dispatch, caches one completion promise, and settles destruction attempts for every owned agent before propagating cleanup failure. The returned `fetch`/`stop` interface is preserved.
- Extended `test/weather-provider.test.js` and both existing network fixtures with native/weather wildcard comparisons, indexed reused-client requests, explicit bypass-variable deletion, request-level proxy routing counts, accepted target socket observation, and supplemental cancellation/TLS/shutdown checks. The existing service lifecycle suite remains intact.
- Updated the relevant weather description in `README.md`, runtime behavior in `docs/dashboard.md`, and regression instructions in `docs/testing.md`.

## Routing and lifecycle evidence

- Before the fix, the focused suite reported 40 passes and 28 failures with no skips. Native wildcard domain-itself requests bypassed while weather requests used the proxy. That run also exposed a fixture counting problem: a reused CONNECT tunnel carries additional requests without creating another CONNECT event.
- Corrected sequence assertions to count target requests whose peer ports belong to known proxy upstream sockets. Fresh-process scenarios retain their proxy request/CONNECT counts. Native and weather reused-client sequences now both prove actual proxy → direct → proxy request deltas of `1 → 0 → 1`, even when both routes return valid AQI data.
- HTTP and HTTPS coverage includes domain-itself/subdomain wildcard matching, uppercase/lowercase variables, empty lowercase precedence, matching/nonmatching ports, mixed lists, case-insensitive rules, and an unrelated HTTP destination. Reused transports also cover ordinary exact-host refresh and lowercase deletion/uppercase fallback.
- Temporarily disabled supplemental routing and ran `node --test --test-name-pattern="wildcard domains bypass" test/weather-provider.test.js`. Twelve weather domain-itself subcases failed actual routing assertions after native success; seven controls passed, and the containing test also failed, giving 7 passes and 13 failures. Restored the route afterward.
- Temporarily froze the supplemental bypass selection at module import, which precedes transport creation in the child fixture, and ran `node --test --test-name-pattern="reused weather transports" test/weather-provider.test.js`. Six wildcard/precedence subcases failed actual weather routing assertions while four delegated exact-host cases passed; including the containing test, the result was 4 passes and 7 failures. Restored live selection before final verification.
- The owned-pool shutdown case establishes one live proxy connection and two live accepted target sockets: one tunneled and one supplemental direct connection. Repeated stop calls return the same promise. Both proxy and target socket sets reach zero within the 1.5-second assertion deadline while the child remains alive; the HTTPS fixture keep-alive timeout is 60 seconds.
- Supplemental stalled-body abort and transport stop both release their socket. Connector observations retain `autoSelectFamily=true`, a 2000 ms attempt timeout, and unchanged process defaults. An untrusted target still fails certificate validation on the bypass route. Existing startup opt-in/disable, target/proxy TLS, service-owned disposal, and caller-owned transport reuse cases pass.

## Verification

- Runtime: Node `v24.22.0`, Undici `8.11.2`; all proxy scenarios executed without prerequisite skips.
- After restoring both mutations, `node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js`: 68 passed, zero failures, cancellations, or skips.
- `npm run check`: passed. Individual syntax checks of `src/weather-provider.js`, `test/weather-provider.test.js`, `test/fixtures/weather-network.js`, and `test/fixtures/weather-network-client.mjs` also passed.
- `npm test`: 638 passed, zero failures, cancellations, or skips, approximately 16.1 seconds. The total includes inert fixture discovery; routing and lifecycle tests also executed through their owning suites.
- `git diff --check`: passed.

## Scope and limits

All network verification used owned loopback fixtures and temporary certificates. No live provider or deployment data was required. Browser tests were not run because this task changes only server transport routing and its fixtures. Other Node versions were not executed; runtimes without native proxy support retain the existing direct path and explicit proxy-test prerequisite skips. No release publication or deployment restart was performed.
