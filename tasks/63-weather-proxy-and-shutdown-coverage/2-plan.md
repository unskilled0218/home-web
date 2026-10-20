# plan

- [scope](#scope)
- [Implementation Plan](#implementation-plan)
  - [1. Preserve effective proxy opt-in in the weather adapter](#1-preserve-effective-proxy-opt-in-in-the-weather-adapter)
  - [2. Add isolated proxy-routing regression tests](#2-add-isolated-proxy-routing-regression-tests)
  - [3. Verify service-owned transport shutdown](#3-verify-service-owned-transport-shutdown)
  - [4. Verify and document the completed change](#4-verify-and-document-the-completed-change)
- [Acceptance Criteria](#acceptance-criteria)
- [Risks And Decisions](#risks-and-decisions)

## scope

Resolve both findings in task 62's `5-code-review.md`: weather's dedicated dispatcher bypasses explicitly enabled environment proxies, and automated service tests do not exercise disposal of the default owned transport.

Keep production changes centered on `src/weather-provider.js`. Preserve the existing `createWeatherTransport()` interface and Global/Local ownership in `src/weather.js` and `src/local-weather.js`; change those services only if lifecycle tests expose an actual defect. Retain the two-second address-family attempt window, ten-second request deadline, TLS verification, body limits, hourly retrieval policy, and existing weather snapshots. This task requires no browser UI, settings schema, or provider endpoint change.

## Implementation Plan

### 1. Preserve effective proxy opt-in in the weather adapter

1. Confirm Node's effective proxy policy in isolated child processes using native fetch as the compatibility reference. Cover `NODE_USE_ENV_PROXY=1`, `--use-env-proxy`, `NODE_OPTIONS=--use-env-proxy`, and explicit disabling/precedence cases. Merely setting `HTTP_PROXY` or `HTTPS_PROXY` must not enable weather proxy routing.
2. Select an owned direct `Agent` when proxy use is disabled and an owned `EnvHttpProxyAgent` from the existing Undici dependency when it is enabled. Keep detection local to the weather adapter. Prefer Node's initialized proxy policy over manually parsing `NODE_OPTIONS`; a planning-time probe on Node `v24.22.0` found `http.globalAgent.options.proxyEnv` populated for enabled startup policy and absent for default or explicitly disabled policy. Validate the chosen surface across supported Node behavior, and keep runtimes without native opt-in support direct rather than raising the engine requirement or importing private Node internals.
3. Delegate `HTTP_PROXY`, `HTTPS_PROXY`, lowercase-variable precedence, and `NO_PROXY` routing to the existing environment-aware dispatcher. Validate the relevant supported patterns against native fetch instead of introducing a second handwritten proxy parser. Continue using the matching Undici `fetch` and dispatcher, not the external Undici Agent with Node's bundled fetch.
4. Define the existing dual-stack connection policy once within the adapter and apply it to direct connections and proxy connection paths. Inspection of Undici `8.11.2` shows direct agents consume `connect`, while `ProxyAgent` builds connectors from `proxyTls` and `requestTls`; setting only `connect` does not cover those proxy paths. Preserve default certificate and hostname checks for both the proxy and target.
5. Retain per-service dispatcher ownership and `stop()` destruction of all underlying direct/proxy pools. Do not replace process-global dispatchers or network defaults. Keep invalid enabled proxy configuration observable as failure rather than silently falling back to direct egress, and do not log credential-bearing proxy URLs.

### 2. Add isolated proxy-routing regression tests

1. Extend `test/weather-provider.test.js` and add narrowly scoped helpers under `test/fixtures/` for owned child processes, loopback HTTP/HTTPS destinations, and a recording proxy. Reuse `deferred()`, `within()`, and existing TLS certificate-generation patterns. Register cleanup immediately after acquiring resources and bound every readiness, request, and shutdown wait.
2. Start each policy scenario in a fresh Node process so startup flags and environment initialization are real. Supply an explicit synthetic environment: remove inherited upper/lowercase proxy variables, `NODE_USE_ENV_PROXY`, and unrelated `NODE_OPTIONS` before applying the case. Avoid printing the parent's environment or touching a user `.env`.
3. Reproduce the review failure with a reserved `.invalid` target reachable only through the loopback proxy: native fetch succeeds, and the pre-fix weather transport fails direct DNS. After the fix, assert weather receives the fixture response and the proxy records the intended destination. Support normal HTTP forwarding and HTTPS CONNECT in the fixture; the installed external Undici and Node's bundled version need not use identical HTTP wire behavior.
4. Cover environment-only opt-in, command-line-only opt-in, opt-in through `NODE_OPTIONS`, proxy variables without opt-in, and explicit negative flag precedence. Check HTTP/HTTPS proxy selection with distinguishable proxy fixtures and lower/uppercase precedence. For disabled policy, use a directly reachable loopback destination and assert the configured proxy receives no request.
5. Cover `NO_PROXY` exact-host bypass, a representative domain-suffix rule, host-with-port behavior, and `*`, with lowercase precedence. Route bypass destinations to loopback and assert both the returned content and zero proxy traffic. Use native fetch to establish any ambiguous pattern semantics rather than assuming the two libraries match.
6. Exercise HTTPS through CONNECT using a temporary trusted test CA loaded through the child process's `NODE_EXTRA_CA_CERTS`. Verify the trusted target succeeds and an untrusted or mismatched target fails. Do not disable TLS validation. Observe connector policy at the network boundary for both direct and proxy connections, retaining the existing assertion that Node's process-wide connection-attempt timeout remains unchanged.

### 3. Verify service-owned transport shutdown

1. Add `test/weather-transport-lifecycle.test.js` using the loopback fixture. In child processes, construct the real Global and Local services without `fetchImpl`, so they create their default owned transport. Use an explicitly enabled loopback proxy to tunnel the unchanged forecast/AQI hostnames to a fixture HTTPS server whose test certificate covers those names. Return `rawForecast()` and `rawAir()` from the existing weather fixtures; no request may leave loopback.
2. For each service, first complete retrieval and validate a successful AQI snapshot. Retain a real idle keep-alive connection with an advertised lifetime longer than the fixture's assertion deadline. Call the service's `stop()` and verify the connection closes within the bounded wait before fixture cleanup destroys sockets. A successful child exit alone is insufficient because idle sockets can be unreferenced.
3. For each service, hold a response body after headers and request shutdown while provider work is pending. In Global mode, complete the forecast first if the held request must be AQI because its queue is serial. In Local mode, account for up to two active requests. Assert cancellation, settled work, no late cache publication, and closure of the owned connections; cover repeated `stop()` calls.
4. Exercise these owners through `createShutdownCoordinator()` with an in-memory Global store or a tracked store-close callback. Assert work drainage and dispatcher disposal settle before SQLite cleanup is allowed. Observe peer-socket closure within a short deadline after stop, without requiring remote FIN delivery to precede local store cleanup; these events occur on different event loops.
5. Preserve injected ownership explicitly: pass an externally owned fetch wrapper with a disposal sentinel, stop the service, and prove it neither calls that sentinel nor prevents another caller from using the transport. Dispose the external resource in fixture cleanup. Extend the existing injected-work shutdown tests only where needed; do not duplicate their full matrix.
6. Check that an idle-pool test would fail if its service's `transport.stop()` call were removed. Use a temporary local mutation and restore it before final verification if needed; no mutation belongs in the final commit. Observe closure before cleanup so fixture teardown cannot hide missing service disposal.

### 4. Verify and document the completed change

1. Run `node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js test/weather.test.js test/local-weather.test.js test/weather-api.test.js test/local-weather-api.test.js test/dashboard.test.js test/shutdown.test.js test/server-shutdown.test.js`. Run new helper modules through their owning tests rather than relying on fixture discovery as proof of coverage.
2. Run `npm run check` and individually syntax-check every changed JavaScript file because the current glob-based script does not check each input separately. Finish with `npm test` and `git diff --check`. Repeat targeted checks only when a subsequent change or failure warrants it.
3. Browser behavior and snapshots are unchanged, so existing browser evidence remains context rather than a new acceptance gate. If implementation changes a browser-facing contract, run the affected weather/scope browser cases and record baseline or browser-version limitations accurately.
4. Update the relevant weather paragraphs in `README.md` and `docs/dashboard.md`, and weather verification instructions in `docs/testing.md`. Explain proxy opt-in, `NO_PROXY`, preserved timing/TLS/deadlines, and pool ownership without including real proxy credentials. Update table-of-contents links for any new headings.
5. During implementation, advance the patch version from `0.17.31` to `0.17.32` in `package.json` and both root-version entries in `package-lock.json`, unless intervening release work requires the next available patch. Write `4-implemented.md` with resolved findings, exact verification outcomes, lifecycle evidence, and any limitations, then commit according to the implementation workflow.

## Acceptance Criteria

- Explicitly enabled Node proxy policy routes both weather scopes through the configured environment proxy; proxy variables alone do not enable routing.
- Startup flag/environment precedence and supported `NO_PROXY` behavior match the native-fetch reference cases, including bypass and lowercase precedence.
- HTTP and HTTPS routing are tested with loopback infrastructure; trusted HTTPS succeeds and invalid TLS trust or hostname fails.
- Direct and proxy connection paths retain the scoped two-second family-attempt policy and existing request deadlines without changing process-global network settings.
- The review's reserved-host proxy regression passes without external DNS success or live provider access.
- Global and Local default transports close real idle connections and cancel pending body work when their owning service stops; shutdown work settles before store cleanup, and repeated stop remains safe.
- Tests observe service-driven socket closure before fixture teardown and detect a missing owned-pool disposal call.
- Services leave caller-injected transport ownership with the caller.
- Relevant Node checks pass, documentation is updated, and the implementation report distinguishes executed verification from unperformed checks.

## Risks And Decisions

- Node startup option precedence is more complex than checking `NODE_USE_ENV_PROXY === '1'` or searching `process.execArgv`; `NODE_OPTIONS` and negative flags matter. Establish effective policy with native reference probes before choosing the detector, and avoid coupling production code to private Node APIs.
- The package supports Node 24 or later, while native proxy features arrived during Node 24's lifetime. Feature-detect availability, document the runtime required for native opt-in behavior, and report prerequisite limitations rather than silently claiming unsupported scenarios passed.
- Undici's environment proxy agent supports routing and owned destruction but is not interchangeable with Node's bundled dispatcher. Its HTTP forwarding behavior, proxy TLS connector options, and `NO_PROXY` patterns require explicit compatibility checks.
- The loopback proxy fixture must allow only its declared test destinations and map them to owned loopback servers. Never forward arbitrary CONNECT destinations or allow fallback live-provider access in lifecycle tests.
- Socket closure must be observed before cleanup, with event-based readiness and bounded waits rather than fixed sleeps. The fixture's idle lifetime must exceed its assertion deadline so natural expiry cannot make a missing `stop()` appear correct.
- No live deployment restart, browser profile change, global dispatcher replacement, new dependency, or production test-only endpoint is required for this work.
