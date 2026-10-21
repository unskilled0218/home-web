# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Reproduce wildcard routing differences](#1-reproduce-wildcard-routing-differences)
    - [2. Preserve live bypass matching at the adapter boundary](#2-preserve-live-bypass-matching-at-the-adapter-boundary)
    - [3. Verify routing and transport lifecycle](#3-verify-routing-and-transport-lifecycle)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Resolve the wildcard-domain compatibility warning in `tasks/63-weather-proxy-and-shutdown-coverage/5-code-review.md` and the environment-refresh warning in this task's `3-plan-review.md`. Limit runtime changes to `src/weather-provider.js` and extend the existing loopback routing tests in `test/weather-provider.test.js`. Extend `test/fixtures/weather-network.js` and `test/fixtures/weather-network-client.mjs` for reused-client environment edits and real socket-disposal assertions. Retain the existing service lifecycle suite.

## Implementation Plan

### 1. Reproduce wildcard routing differences

- Extend the existing `NO_PROXY` matrix with `*.weather.invalid` applied to `weather.invalid` and `sub.weather.invalid`, using both `network.httpUrl` and `network.httpsUrl`. Both names already have fixture DNS mappings and trusted certificate names.
- Run each scenario through native fetch and the weather transport in separate child processes with identical proxy opt-in and environment variables. Assert successful fixture data and the actual change in `network.requests.length`; both clients must bypass the proxy for the domain and its subdomains.
- Exercise uppercase `NO_PROXY`, lowercase `no_proxy` alone, and lowercase precedence with a conflicting uppercase rule. Include an explicitly empty lowercase value overriding an uppercase wildcard; that request must remain proxied.
- Add matching and nonmatching wildcard port rules for each protocol's fixture port. Include a comma-separated mixed list with whitespace and an unrelated allowed destination such as `wrong.invalid` over HTTP to prove supplemental matching does not turn a domain wildcard into a global bypass.
- Extend the child fixture with a sequence mode that creates one weather transport, or reuses native fetch, and accepts indexed request steps over IPC. Each step applies only explicit child-local bypass-variable edits, awaits response consumption, and reports a unique step result. Represent deletion explicitly and use `delete process.env.no_proxy` or `delete process.env.NO_PROXY`, rather than assigning `undefined`. Keep the client and transport alive between requests; stop only on an explicit disposal or exit command. Extend the parent helper to await the matching step identifier, avoiding its current first-message-by-type lookup for repeated results.
- Compare native and weather sequences for uppercase-only and lowercase-selected bypass variables over HTTP and HTTPS: nonmatching rule → matching `*.weather.invalid` rule → nonmatching rule on the same transport. Assert fixture data and per-step proxy request deltas of `1 → 0 → 1`. Repeat the transition with an ordinary exact-host rule to characterize behavior that must remain delegated to Undici.
- Add a precedence sequence with uppercase `NO_PROXY=*.weather.invalid`: a conflicting lowercase value proxies, deleting lowercase falls back to uppercase and bypasses, setting lowercase to an empty string proxies, and deleting it bypasses again. Also remove the uppercase rule with lowercase absent and assert proxy use resumes. Keep startup proxy opt-in unchanged throughout every sequence.
- Run the focused provider test before the fix and record that the weather domain-itself cases fail while the equivalent native requests bypass. Use the existing proxy-enabled runtime guard; required verification must run on a runtime where these cases execute.

### 2. Preserve live bypass matching at the adapter boundary

- Keep the existing `http.globalAgent.options?.proxyEnv` startup-policy check. Apply compatibility handling only to the enabled `EnvHttpProxyAgent` path; the disabled direct `Agent` path must remain direct despite ambient proxy variables.
- Construct the enabled `EnvHttpProxyAgent` without an explicit `noProxy` option, retaining its existing per-dispatch environment refresh. Compose it through the public `dispatcher.compose(interceptor)` API. The interceptor must return a two-argument `(options, handler)` dispatch function and either delegate to the supplied dispatch function or use an additional owned direct `Agent` for the one missing domain-itself match. Continue passing the composed dispatcher to the matching imported Undici fetch.
- Add a small private wildcard-domain-itself predicate in `src/weather-provider.js`. On every dispatch, select `process.env.no_proxy ?? process.env.NO_PROXY ?? ''`, preserving empty lowercase precedence, and split using the existing comma/whitespace separators. Recognize only ordinary `*.domain` entries with an optional numeric port. Compare the normalized domain itself to the request origin hostname, case-insensitively and consistently with Undici's trailing-dot handling. Respect explicit ports against the effective request port, including defaults 80 and 443; do not broaden a port-restricted rule.
- Route an exact domain-itself wildcard match to the supplemental direct agent. Delegate all other requests to the original environment agent, including subdomains it already matches, bare `*`, leading-dot rules, ordinary hosts, IP literals, empty values, unrelated domains, and unsupported wildcard syntax. Do not copy the full proxy parser, rewrite global environment variables, or access Undici's private fields or symbols.
- Lazily allocate at most one supplemental direct agent per weather transport, using the same `connect` configuration as the existing direct path. Keep `connect`, `proxyTls`, and `requestTls` settings on the environment agent unchanged. This preserves two-second family selection and ordinary target/proxy certificate validation on both routes.
- Preserve the returned `fetch`/`stop` interface. `stop()` must prevent further supplemental dispatches and await destruction of both the underlying environment dispatcher and any supplemental direct agent. Cache the stop promise so repeated calls share completion. Use a settle-all strategy so cleanup waits for both destruction attempts even if one rejects, then propagate cleanup failure. Destroying a composed dispatcher alone does not own or destroy the supplemental agent.
- Add a concise comment explaining that the extra route supplements only native Node's wildcard domain-itself behavior while leaving environment refresh with Undici. Do not create new environment agents per rule edit or maintain an unbounded dispatcher cache.

### 3. Verify routing and transport lifecycle

- Run `node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js`. Confirm startup opt-in and disabling, lowercase precedence, exact and suffix bypass, wildcard controls, proxy selection, TLS validation, connection settings, cancellation, owned pool shutdown, and caller-owned transport reuse all pass.
- Extend fixture socket observation to distinguish accepted target sockets from proxy sockets, without production-only disposal hooks. In a reused weather-client sequence, make HTTPS requests first through the proxy and then through the supplemental wildcard bypass route. Confirm both routes have live idle connections before stop, invoke transport stop twice, and await actual target and proxy socket closure while the child remains alive. Make fixture target keep-alive timeouts long enough that ordinary server expiry cannot satisfy the assertion.
- Add a stalled-body request through the wildcard domain-itself route and assert cancellation and transport stop release its socket. Check supplemental direct connection observations for the scoped two-second family-selection settings and unchanged process defaults. Retain an untrusted-target HTTPS case through this route to prove bypass does not disable certificate verification.
- Temporarily disable the supplemental wildcard route and rerun the new domain-itself regression cases. Confirm the routing assertion fails, then restore it. Separately freeze the bypass selection at transport creation and confirm the reused-client transition tests fail before restoring live selection. These checks must assert actual proxy use even when both routes return valid data.
- Run `npm run check`, `npm test`, and `git diff --check` after restoring the fix. Report meaningful failures and proxy-runtime skips accurately; the fixture helper's discovery as an inert module is not evidence that routing scenarios executed.
- Keep all network verification within the existing loopback fixture, including HTTPS trust checks and cleanup. Record implementation details, test results, preserved environment refresh, and both owned pools' disposal evidence in this task's `4-implemented.md` when implementation is requested.

## Acceptance Criteria

- Native fetch and weather fetch bypass both the domain itself and its subdomains for `*.domain` rules over HTTP and HTTPS.
- Uppercase and lowercase bypass variables work; lowercase values, including an empty string, retain precedence over uppercase values.
- Wildcard port restrictions and unrelated-host controls preserve actual proxy routing, with successful response assertions and proxy request counts for every new case.
- Existing transports observe bypass-variable edits before the next dispatch. Native and weather requests agree on uppercase and lowercase `1 → 0 → 1` routing transitions, exact-host refresh, empty lowercase overrides, and lowercase deletion/fallback without recreating the transport.
- Proxy opt-in remains governed by effective Node startup policy. Scoped two-second family selection, target/proxy TLS validation, abort behavior, and owned dispatcher cleanup retain their existing coverage and behavior.
- Transport stop settles destruction of every owned pool, including the supplemental direct agent, before returning. Repeated stop calls share completion, and real socket assertions pass while the child stays alive.
- The wildcard regression fails without supplemental routing, and environment-transition regressions fail when bypass selection is frozen. Both pass with live routing on the available Node `v24.22.0` runtime with Undici `8.11.2`.
- Focused tests, syntax checks, full Node tests, and whitespace checks pass. The implementation report records live environment selection and cleanup of both owned routes.

## Risks And Decisions

- Reject the previous explicit `noProxy` snapshot: review probes showed that both native fetch and the current weather transport observe bypass edits between requests. Preserve that behavior through public dispatcher composition and a narrow per-dispatch wildcard supplement, addressing the review's R2 warning without changing the user-facing transport interface.
- One lazily allocated direct pool is the bounded cost of preserving refresh without relying on Undici internals, replacing its complete parser, or rotating environment agents. All pools remain transport-owned; real disposal checks are required because the existing environment-agent destruction spy alone cannot prove supplemental socket cleanup.
- The proxy-enabled integration tests require a Node runtime supporting `--use-env-proxy` and the fixture's existing `openssl` executable. Older supported Node releases may skip these scenarios; skips do not validate compatibility.
- Keep matching bounded to the confirmed wildcard-domain-itself behavior. Leave established subdomain and non-wildcard routing to Undici. Do not interpret arbitrary malformed wildcard syntax or broaden a port-qualified rule; native-versus-weather controls must expose accidental bypass expansion.
- This planning task creates only `2-plan.md`. Implementation, version updates, and test execution belong to the subsequent implementation task.
