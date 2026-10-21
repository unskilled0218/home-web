# plan

- [plan](#plan)
  - [scope](#scope)
  - [Implementation Plan](#implementation-plan)
    - [1. Reproduce wildcard routing differences](#1-reproduce-wildcard-routing-differences)
    - [2. Normalize wildcard bypass rules at the adapter boundary](#2-normalize-wildcard-bypass-rules-at-the-adapter-boundary)
    - [3. Verify routing and transport lifecycle](#3-verify-routing-and-transport-lifecycle)
  - [Acceptance Criteria](#acceptance-criteria)
  - [Risks And Decisions](#risks-and-decisions)

## scope

Resolve the wildcard-domain compatibility warning in `tasks/63-weather-proxy-and-shutdown-coverage/5-code-review.md`. Limit runtime changes to `src/weather-provider.js` and extend the existing loopback routing tests in `test/weather-provider.test.js`. Reuse `test/fixtures/weather-network.js` and `test/fixtures/weather-network-client.mjs`; change fixtures only when required by a concrete regression scenario.

## Implementation Plan

### 1. Reproduce wildcard routing differences

- Extend the existing `NO_PROXY` matrix with `*.weather.invalid` applied to `weather.invalid` and `sub.weather.invalid`, using both `network.httpUrl` and `network.httpsUrl`. Both names already have fixture DNS mappings and trusted certificate names.
- Run each scenario through native fetch and the weather transport in separate child processes with identical proxy opt-in and environment variables. Assert successful fixture data and the actual change in `network.requests.length`; both clients must bypass the proxy for the domain and its subdomains.
- Exercise uppercase `NO_PROXY`, lowercase `no_proxy` alone, and lowercase precedence with a conflicting uppercase rule. Include an explicitly empty lowercase value overriding an uppercase wildcard; that request must remain proxied.
- Add matching and nonmatching wildcard port rules for each protocol's fixture port. Include a comma-separated mixed list with whitespace and an unrelated allowed destination such as `wrong.invalid` over HTTP to prove normalization does not turn a domain wildcard into a global bypass.
- Run the focused provider test before the fix and record that the weather domain-itself cases fail while the equivalent native requests bypass. Use the existing proxy-enabled runtime guard; required verification must run on a runtime where these cases execute.

### 2. Normalize wildcard bypass rules at the adapter boundary

- Keep the existing `http.globalAgent.options?.proxyEnv` startup-policy check. Apply compatibility handling only to the enabled `EnvHttpProxyAgent` path; the disabled direct `Agent` path must remain direct despite ambient proxy variables.
- Add a small private normalization helper in `src/weather-provider.js`. Select `process.env.no_proxy ?? process.env.NO_PROXY ?? ''`, preserving empty lowercase precedence. Split using Undici's existing comma/whitespace separators and remove only the leading `*.` from ordinary wildcard-domain tokens, retaining the domain and any port suffix. Pass the resulting list through the public `noProxy` constructor option.
- Leave bare `*`, non-wildcard hosts, leading-dot rules, IPv4/IPv6 entries, and unrelated tokens semantically unchanged. Let Undici continue parsing ports, case, and suffix matching; do not implement a replacement proxy parser or use private Undici symbols.
- Keep the current `connect`, `proxyTls`, and `requestTls` settings, matching Undici fetch/dispatcher imports, and `stop: () => dispatcher.destroy()` ownership contract. Add a concise comment explaining why native Node wildcard compatibility needs normalization.
- Treat the explicit normalized `noProxy` value as a per-transport configuration snapshot. Record this decision in implementation results: existing Undici rereads bypass variables per dispatch, whereas the proposed explicit option requires recreating the transport after bypass-variable edits. Do not imply hot reload remains supported. If preserving runtime edits is required, revise this design before implementing rather than mutating global environment variables or silently adding dispatcher replacement machinery.

### 3. Verify routing and transport lifecycle

- Run `node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js`. Confirm startup opt-in and disabling, lowercase precedence, exact and suffix bypass, wildcard controls, proxy selection, TLS validation, connection settings, cancellation, owned pool shutdown, and caller-owned transport reuse all pass.
- Temporarily remove the normalization and rerun the new domain-itself regression cases. Confirm the routing assertion fails, then restore the fix. This proves the test detects proxy use even when both routes return valid data.
- Run `npm run check`, `npm test`, and `git diff --check` after restoring the fix. Report meaningful failures and proxy-runtime skips accurately; the fixture helper's discovery as an inert module is not evidence that routing scenarios executed.
- Keep all network verification within the existing loopback fixture, including HTTPS trust checks and cleanup. Record implementation details, test results, and the bypass snapshot decision in this task's `4-implemented.md` when implementation is requested.

## Acceptance Criteria

- Native fetch and weather fetch bypass both the domain itself and its subdomains for `*.domain` rules over HTTP and HTTPS.
- Uppercase and lowercase bypass variables work; lowercase values, including an empty string, retain precedence over uppercase values.
- Wildcard port restrictions and unrelated-host controls preserve actual proxy routing, with successful response assertions and proxy request counts for every new case.
- Proxy opt-in remains governed by effective Node startup policy. Scoped two-second family selection, target/proxy TLS validation, abort behavior, and owned dispatcher cleanup retain their existing coverage and behavior.
- The new regression fails without compatibility normalization and passes with it on the available Node `v24.22.0` runtime with Undici `8.11.2`.
- Focused tests, syntax checks, full Node tests, and whitespace checks pass. The normalization's per-transport bypass snapshot behavior is explicitly documented in implementation results.

## Risks And Decisions

- Prefer normalization through Undici's public `noProxy` option over replacing the proxy parser, changing dependencies, or creating extra pools. Undici `8.11.2` already makes a bare domain match the domain itself and subdomains, so removing the wildcard prefix addresses the confirmed mismatch.
- Explicit `noProxy` configuration freezes bypass rules at transport creation, unlike the current implicit Undici environment refresh. This is an intentional lifecycle tradeoff for startup-configured deployments, not a claim of complete native/Undici equivalence. Confirm this boundary during plan review before implementation.
- The proxy-enabled integration tests require a Node runtime supporting `--use-env-proxy` and the fixture's existing `openssl` executable. Older supported Node releases may skip these scenarios; skips do not validate compatibility.
- Keep matching bounded to the confirmed wildcard-domain behavior. Do not normalize arbitrary malformed wildcard syntax or broaden a port-qualified rule; native-versus-weather controls must expose accidental bypass expansion.
- This planning task creates only `2-plan.md`. Implementation, version updates, and test execution belong to the subsequent implementation task.
