# Critical security and reliability fixes plan

## Goal

Resolve the three Critical findings from `tasks/10-whole-project-review/4-code-review.md`: prevent saved Linkwarden token disclosure during reconnect, block DNS-rebinding access to the trusted-LAN API, and ensure malformed inbound or upstream traffic cannot terminate the dashboard process.

## Scope boundaries

- Fix only the three Critical findings in this task. The warning-level Linkwarden TLS verification policy, browser bulk-wake reporting, test breadth, `.env` workflow, UTF-8 decoding, token eviction, accessibility, and suggestion-level findings remain separate follow-up work.
- Preserve the existing unauthenticated trusted-LAN product model, but make the network names accepted by that model explicit rather than trusting arbitrary `Host` values.
- Preserve existing Linkwarden credential encryption, atomic connection replacement, collection tokens, cache behavior, device CRUD, wake dispatch, and static-file serving except where failure containment requires a narrow change.
- Return concise client errors and log only actionable server-side categories; never log access tokens, encrypted token fields, request bodies, certificate contents, or raw upstream payloads.

## Critical fix 1: safe Linkwarden token reuse

- Continue allowing a blank token when reconnecting to the exact saved Linkwarden identity.
- Define identity as the normalized `baseUrl` and normalized username together. Both must match the saved configuration before decrypting or reusing the existing access token.
- If URL or username changes while the submitted token is blank, reject the request before any outbound connection is attempted and explain that a new token is required.
- Keep explicit-token reconnects valid for changed URLs or usernames, and retain the existing atomic behavior in which failed remote validation does not overwrite working saved credentials.
- Do not expose whether the rejected destination was contacted through response details; tests must prove it was not contacted and the old configuration remained unchanged.

## Critical fix 2: DNS-rebinding-resistant API host validation

- Add `DASHBOARD_ALLOWED_HOSTS` as an optional comma-separated list of exact dashboard hostnames or IP literals, without schemes or paths. Normalize and validate it at startup and combine it with the configured `HOST` value.
- Treat `127.0.0.1`, `localhost`, and `::1` as equivalent local defaults when the service is bound to a loopback address. A deployment using a private DNS name or reverse proxy must list that public-facing hostname explicitly.
- Validate the request `Host` header for every `/api/` request, including GET requests, before applying route logic. Reject missing, malformed, or unlisted hosts without revealing configuration details.
- Keep the existing private-client-address check as defense in depth. For non-GET requests, continue requiring an `Origin` and request Host match when Origin is present, but parse both safely and require their normalized hostname to be allowed.
- Do not trust `X-Forwarded-Host`, `X-Forwarded-For`, or other proxy headers. Reverse proxies must preserve an allowed Host or be configured through `DASHBOARD_ALLOWED_HOSTS`.
- Update Compose, `.env.example`, and README deployment instructions with direct-IP, private-DNS, and reverse-proxy examples and a warning that broad wildcard host acceptance would reintroduce DNS rebinding.

## Critical fix 3: process-level failure containment

- Stop using the untrusted Host header as the base needed to parse `request.url`; parse the request target against a fixed internal base after validating the Host independently.
- Add one final asynchronous error boundary around every HTTP request. If route or static handling rejects unexpectedly, return a generic 400 for malformed request metadata or 500 for an internal failure when headers are still writable; otherwise safely terminate that response. The server process must remain available.
- Refactor `fetchLinkwarden()` so all synchronous work inside HTTP response and redirect callbacks is caught and converted into promise rejection.
- Validate upstream status codes before constructing a Fetch `Response`. For body-forbidden statuses such as 204, 205, and 304, do not attach the Node response stream as a body; consume or close it as needed and let the normal Linkwarden error boundary report an unavailable/invalid response.
- Preserve same-origin redirect limits, timeout aborts, response-size bounds, stale bookmark fallback, and bearer-token confinement to the configured Linkwarden origin.
- Make wake-attempt persistence failure-safe: once UDP dispatch succeeds, a concurrent device deletion or audit failure must not trigger another unguarded audit write or crash the process. Keep the response truthful about packet dispatch while reporting persistence failures only through sanitized server diagnostics.

## Implementation sequence

1. Extend `src/config.js` with strict `DASHBOARD_ALLOWED_HOSTS` parsing and a normalized allowed-host set derived from the configured bind host plus explicit deployment aliases.
2. Replace `sameOrigin()` in `src/server.js` with safe Host/Origin parsing that validates every API request against the configured set before route dispatch, while retaining the private remote-address guard.
3. Parse request paths using a fixed internal origin and wrap the complete async server callback in a final rejection handler that cannot itself throw while writing an error response.
4. Tighten `credentialsFromInput()` so blank-token reuse requires matching saved base URL and username before decryption. Reject changed identities before calling `listCollections()`.
5. Harden `fetchLinkwarden()` callback and redirect handling, validate response status values, and construct bodyless responses correctly for 204, 205, and 304.
6. Separate wake packet dispatch from database bookkeeping and guard mark/audit operations so concurrent deletion or persistence errors cannot escape or misreport a successfully dispatched packet.
7. Add the allowed-host setting to `.env.example` and `docker-compose.yml`, and document configuration for direct private-IP access, private DNS, and LAN-only reverse proxies in `README.md`.
8. Update the project version with a patch release according to the existing convention and record delivered changes and verification in `3-implemented.md`.

## Automated coverage

- Extend the child-dashboard integration harness so requests can set raw Host and Origin headers and verify process liveness after malformed requests.
- Cover accepted direct loopback/private-IP hosts, an explicitly configured private DNS hostname, missing/malformed Host, unlisted Host, an attacker Origin matching an unlisted Host, and an allowed Host with a mismatched Origin.
- Assert rejected Host/Origin requests cannot read devices/bookmarks or mutate devices/Linkwarden settings and that `/api/health` remains available afterward through an allowed host.
- Add a second recording Linkwarden server and prove a blank-token reconnect to a changed URL or username returns 400 without sending any request or bearer token to that server; prove the original saved configuration remains usable.
- Preserve and explicitly cover blank-token reconnect to the unchanged normalized URL and username, plus explicit-token migration to a changed identity.
- Add real HTTP/HTTPS upstream fixtures for 204, 205, 304, malformed redirect locations, and ordinary errors. Each must reject the Linkwarden operation without uncaught exceptions, unhandled rejections, token forwarding across origins, or process exit.
- Add a child-process malformed-request test using a raw TCP request with an invalid Host, then verify the same dashboard process still answers a valid health request.
- Add coverage for a device disappearing or persistence failing after wake dispatch through the smallest practical injected store/dispatcher seam, asserting no second failing audit escapes and the response remains truthful about dispatch.
- Preserve all existing encryption, collection tree, bookmark pagination/cache, automatic key, self-signed Linkwarden, device packet, and browser markup tests.

## Verification

- Run `npm test` and syntax checks for every changed JavaScript file.
- Run `docker compose config` with default direct-IP settings and with `DASHBOARD_ALLOWED_HOSTS` set to a private DNS/reverse-proxy hostname when Docker is available.
- Run `git diff --check` and inspect logs/test output for accidental access-token, encryption-key, request-body, or upstream-payload disclosure.
- Send valid direct-host, configured private-DNS, mismatched Origin, unlisted Host, and malformed raw HTTP requests; confirm only the intended host/origin combinations succeed and the process remains alive after every rejection.
- Connect Linkwarden, attempt blank-token reconnects with changed URL and username, and verify no request reaches the changed destination and the original connection remains configured.
- Exercise upstream 204, 205, 304, malformed redirect, timeout, and oversized responses and verify they produce bounded unavailable errors rather than process termination.
- Race wake dispatch against device deletion in a disposable database and confirm the process remains available and does not claim dispatch failed when UDP sending already succeeded.

## Acceptance criteria

- A saved Linkwarden token is reused only for the same normalized base URL and username and is never sent to a changed destination without an explicitly submitted token.
- Every API request requires a valid allowed Host, and browser mutations additionally enforce a matching allowed Origin; an attacker-controlled rebinding hostname is rejected even when the client has a private source address.
- Missing or malformed Host/Origin values, unusual upstream statuses, malformed redirects, and wake persistence races cannot produce an uncaught exception, unhandled rejection, or dashboard process exit.
- Existing trusted direct-IP access works by default, while private DNS and reverse-proxy deployments have an explicit documented allowlist path.
- All previous functionality and regression tests continue to pass, and new tests demonstrate each Critical finding is closed.
