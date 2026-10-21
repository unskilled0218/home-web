# Implementation results

- [Outcome](#outcome)
- [Changes](#changes)
- [Regression And Lifecycle Evidence](#regression-and-lifecycle-evidence)
- [Verification](#verification)
- [Limits](#limits)

## Outcome

Implemented on the new branch `63-weather-proxy-and-shutdown-coverage`. Resolved task 62's proxy-compatibility warning and added the requested service-owned pool lifecycle coverage. Version increased from `0.17.31` to `0.17.32` in `package.json` and both lockfile version entries.

## Changes

- `src/weather-provider.js` now reads Node's initialized environment-proxy policy from `http.globalAgent.options?.proxyEnv`, avoiding handwritten startup-flag or `NODE_OPTIONS` parsing. It creates an owned `EnvHttpProxyAgent` only when proxy use is enabled, otherwise retaining a direct `Agent`.
- The existing Undici dependency handles upper/lowercase HTTP/HTTPS proxy selection and `NO_PROXY`. The two-second dual-stack connection policy is shared across `connect`, `proxyTls`, and `requestTls`, covering direct, bypass, proxy, and tunneled-target connections. Matching Undici fetch remains paired with its dispatcher; no global agent or network-default mutation was introduced.
- TLS verification, ten-second service request deadlines, response limits, provider URLs, hourly attempts, snapshot schemas, and browser behavior are preserved. Global and Local service shutdown code required no production changes.
- Extended `test/weather-provider.test.js` with fresh-process native-fetch comparisons for opt-in, explicit disabling, proxy selection, case precedence, and `NO_PROXY`. Added trusted/untrusted target and HTTPS-proxy checks, including hostname rejection and connector-policy observations.
- Added `test/weather-transport-lifecycle.test.js` with real default Global and Local services, idle and pending HTTPS connections, repeated stop, coordinator store cleanup, and externally owned injected transports.
- Added narrowly scoped fixtures in `test/fixtures/weather-network.js` and `test/fixtures/weather-network-client.mjs`. They own loopback HTTP/HTTPS destinations and proxies, temporary certificates, explicit child environments, bounded IPC/readiness/shutdown waits, and fixture-only DNS mapping. Reserved hosts cannot resolve externally, and proxies map only declared destinations to owned loopback servers.
- Updated the relevant weather text in `README.md`, `docs/dashboard.md`, and `docs/testing.md`. Proxy-specific tests report a prerequisite skip on Node versions without native proxy support rather than claiming those scenarios passed.

## Regression And Lifecycle Evidence

- On Node `v24.22.0`, startup-policy probes confirmed direct behavior by default and enabled behavior for `NODE_USE_ENV_PROXY=1`, `--use-env-proxy`, and `NODE_OPTIONS=--use-env-proxy`. Explicit `--no-use-env-proxy` overrides both environment and `NODE_OPTIONS` opt-in. Routing tests compare native and weather fetch independently in fresh processes.
- Temporarily restored the former unconditional direct dispatcher and ran `node --test --test-name-pattern="weather proxy opt-in" test/weather-provider.test.js`. All three enabled-weather scenarios failed with `ENOTFOUND` after native fetch successfully used the loopback proxy; the three disabled-policy scenarios passed. Node also reported the containing test as failed. Restored the proxy-aware implementation afterward.
- Temporarily removed both services' `transport.stop()` calls and ran `node --test --test-name-pattern="idle pool" test/weather-transport-lifecycle.test.js`. Both tests failed their bounded socket-close wait instead of passing through natural keep-alive expiry, fixture teardown, or child exit. Restored both calls exactly; neither service file has a final diff.
- Idle lifecycle fixtures advertise a 60-second connection lifetime and assert closure within 1.5 seconds while the child remains alive. Pending-body cases retain response work until service shutdown, then confirm cancellation, closure, and no Global AQI publication. Local reads reject after stop.
- The fixture observes completion of the public environment-proxy dispatcher's actual `destroy()` method without replacing destruction. Coordinator store-close callbacks require both service-stop completion and owned-pool disposal; peer socket closure is checked separately to avoid cross-event-loop FIN ordering assumptions.
- Caller-injected cases assert zero disposal-sentinel calls and zero pool destruction by the service, successfully reuse the external transport after service stop, then explicitly dispose it from the caller and observe socket closure.

## Verification

- `node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js test/weather.test.js test/local-weather.test.js test/weather-api.test.js test/local-weather-api.test.js test/dashboard.test.js test/shutdown.test.js test/server-shutdown.test.js`: 130 passed, zero failures or skips, approximately 11.5 seconds.
- `npm run check`: passed. Individually syntax-checked the changed provider, both test files, and both helper modules; all passed.
- `npm test`: 603 passed, zero failures or skips, approximately 14 seconds. This total includes Node's discovery of inert fixture modules; routing and lifecycle scenarios also ran through their owning test files.
- After strengthening the fixture's explicit dispatcher-completion/store-ordering assertion, reran `node --test test/weather-transport-lifecycle.test.js`: all six lifecycle cases passed. Repeated syntax checks for those two changed files and `npm run check` passed.
- `git diff --check`: passed.
- OpenSSL `3.0.13` generated the temporary test certificates. All network verification used loopback; no provider, deployment database, browser profile, or user `.env` was accessed.

## Limits

Runtime verification used Node `v24.22.0`. Older Node 24 releases were not executed here; the adapter falls back to direct behavior when the initialized native proxy policy is unavailable, and proxy test prerequisites are feature-detected. Documentation identifies native environment-proxy support as requiring Node 24.5 or later.

No browser-facing contract changed, so browser tests and live-provider checks were not repeated. The existing baseline browser limitations recorded in task 62 are not new failures from this task. No deployment restart or release publication was performed.
