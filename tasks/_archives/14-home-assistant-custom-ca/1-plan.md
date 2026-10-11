# Task 14: Trust a Home Assistant Private CA

## Objective

Allow the dashboard to connect securely to a self-hosted Home Assistant instance whose `wss://` certificate is issued by a private CA. Fix the reported connection failure without disabling certificate-chain or hostname verification, preserve dependency-free startup, and provide an actionable error and setup path for direct and Compose deployments.

## Root Cause

- The Home Assistant integration uses Node 24's browser-compatible global `WebSocket`, which performs normal TLS verification but does not expose a per-connection CA option.
- A private issuer is therefore rejected unless it is trusted when the Node process initializes.
- Node reads `NODE_EXTRA_CA_CERTS` only once during process startup. The current `src/start.js` loads `.env` from JavaScript after Node has initialized TLS, so putting this variable in the existing `.env` workflow would be too late.
- The browser-visible `NetworkError when attempting to fetch resource.` does not explain the server-to-server certificate failure or how to correct it.

## Scope

1. Load an optional private CA before Node initializes TLS for local npm startup and Compose.
2. Keep certificate and hostname verification enabled.
3. Validate the configured certificate file and improve safe Home Assistant TLS diagnostics.
4. Add real `wss://` trust and hostname tests.
5. Document certificate placement, restart requirements, trust scope, and troubleshooting.

## Out of Scope

- A trust-all option, `NODE_TLS_REJECT_UNAUTHORIZED=0`, or `rejectUnauthorized: false`.
- Uploading certificates through the browser or storing certificate contents in SQLite.
- Client certificates/mTLS, automatic certificate enrollment, or operating-system trust-store modification.
- Changing Linkwarden's existing request-scoped `LINKWARDEN_CA_FILE` behavior.
- Adding a WebSocket package solely to obtain transport-specific CA options.

## Implementation Plan

### 1. Move `.env` loading to true process startup

- Update `start`, `start:lan`, and `dev` in `package.json` to invoke `src/server.js` with Node 24's `--env-file-if-exists=.env` option. Keep `--watch` on the development command.
- Remove the now-redundant `src/start.js` and `src/env.js` JavaScript loader. This prevents two parsers with subtly different semantics and ensures Node sees TLS-related variables before runtime initialization.
- Replace the custom parser tests with subprocess tests for Node's native env-file behavior:
  - a missing `.env` is accepted;
  - comments, blank lines, empty values, and quoted values are accepted;
  - an explicit process environment variable wins over the file;
  - host, port, database, and encryption-key settings reach production startup.
- Keep an injectable env-file path in subprocess tests by invoking Node with `--env-file-if-exists=<temporary path>` directly; the production npm scripts continue to use the root `.env`.

### 2. Add private-CA startup configuration

- Add an optional `NODE_EXTRA_CA_CERTS` entry to `.env.example`, using `./certs/home-assistant-ca.pem` as the documented convention while leaving it disabled by default.
- Forward `NODE_EXTRA_CA_CERTS` through `docker-compose.yml`. Because the project root is already mounted read-only at `/app`, the same relative `./certs/...` path resolves correctly for direct runs and inside the Compose service.
- Do not add the private CA to the repository. Keep relying on the existing ignored `certs/` directory and document that only public CA/intermediate certificates belong there, never private keys.
- Make clear that `NODE_EXTRA_CA_CERTS` augments Node's process-wide trust roots. It is selected because the built-in WebSocket has no scoped CA option; hostname verification remains active, and the smallest appropriate private CA should be used.
- Keep public-CA and trusted-LAN `http://` Home Assistant configurations working when the variable is unset.

### 3. Validate the configured CA bundle clearly

- Add a small reusable CA-file validator or generalize `src/linkwarden-ca.js` without changing Linkwarden trust semantics.
- During production composition, when `NODE_EXTRA_CA_CERTS` is set:
  - resolve the same path Node received;
  - require a readable, non-empty PEM file;
  - require at least one parseable `CERTIFICATE` block;
  - reject private-key material in the bundle;
  - fail startup with a concise variable-specific error when validation fails.
- Never log certificate contents. Filesystem-path details may appear only in startup/operator diagnostics, not in browser API responses.
- Note that validation happens after Node has loaded trust material, so changing or rotating the file still requires a complete process restart.

### 4. Classify Home Assistant TLS failures safely

- Extend the Home Assistant WebSocket error boundary to inspect only safe error codes exposed by Node's error event.
- Map trust-chain failures such as self-signed, unknown issuer, and incomplete chain to a concise message explaining that Home Assistant's certificate is not trusted and `NODE_EXTRA_CA_CERTS` must be configured before restart.
- Map hostname/SAN mismatch separately so users fix the Home Assistant URL or certificate instead of incorrectly adding more trust roots.
- Keep expired/not-yet-valid certificate errors distinct and actionable.
- Fall back to the existing generic connection error when Node does not expose a classifiable code. Do not return raw error messages, certificate data, URLs containing credentials, or access tokens.
- Ensure the API and dialog preserve these safe server messages rather than collapsing them into a browser `NetworkError` when the dashboard server remains reachable.

### 5. Add TLS and startup coverage

- Generate an ephemeral private CA and a CA-signed server certificate with explicit subject alternative names using OpenSSL in tests; skip only the OpenSSL-dependent cases when the executable is unavailable.
- Add a minimal local secure WebSocket fixture sufficient for the Home Assistant authentication and device/area command exchange. Keep framing/handshake support inside test helpers rather than production code.
- Use subprocesses because `NODE_EXTRA_CA_CERTS` cannot be changed after a Node process starts. Prove:
  - the private-CA `wss://` fixture is rejected without extra trust;
  - the same fixture succeeds when the child starts with `NODE_EXTRA_CA_CERTS` pointing to the CA bundle;
  - a trusted certificate is still rejected when the URL hostname does not match its SAN;
  - no test sets `NODE_TLS_REJECT_UNAUTHORIZED=0` or otherwise disables verification.
- Add focused unit tests for CA validation: missing, unreadable, empty, malformed, private-key-containing, and valid multi-certificate bundles.
- Add error-classification tests using injected WebSocket error events for trust, hostname, validity-period, and unknown failures, asserting that no raw upstream detail or token reaches the result.
- Update startup tests to prove a temporary env file containing `NODE_EXTRA_CA_CERTS` is applied before application modules load.

### 6. Documentation and release update

- Update the Home Assistant section in `README.md` with exact direct-run steps:

```sh
mkdir -p certs
cp /path/to/home-assistant-ca.pem certs/home-assistant-ca.pem
printf '\nNODE_EXTRA_CA_CERTS=./certs/home-assistant-ca.pem\n' >> .env
npm start
```

- Explain that the file must contain the issuing CA/intermediate chain in PEM form, not a private key; a self-signed leaf may be used only when it is itself the trust anchor.
- Explain that the Home Assistant URL hostname must be listed in the certificate SAN and that changing the bundle requires a full dashboard restart.
- Document the process-wide trust implication and contrast it with Linkwarden's scoped `LINKWARDEN_CA_FILE`.
- Update Compose instructions to use the same path under the existing read-only project mount.
- Add troubleshooting for issuer/chain errors, hostname mismatch, expiration, and the generic connection fallback.
- Add `tasks/14-home-assistant-custom-ca/3-implemented.md` during implementation with changes and exact verification evidence.
- Bump the patch version from `0.9.0` to `0.9.1` after implementation and verification pass.

## Verification

Run from the repository root:

```bash
npm test
npm run check
git diff --check
```

Also verify:

1. `npm start` succeeds with no `.env` and with the documented copied `.env.example` workflow.
2. A private-CA Home Assistant fixture fails before trust is configured and succeeds only after restart with `NODE_EXTRA_CA_CERTS` present at process launch.
3. A trusted but hostname-mismatched certificate still fails.
4. Missing, empty, malformed, or private-key-containing CA files stop startup with actionable diagnostics and do not expose certificate contents.
5. Publicly trusted `wss://` and trusted-LAN `ws://` configurations remain unaffected when no extra CA is configured.
6. Browser/API errors distinguish trust, hostname, validity-period, authentication, and generic connectivity failures without leaking secrets.
7. Existing Linkwarden private-CA, Home Assistant protocol, Wake-on-LAN, env precedence, and security tests continue to pass.
8. If Docker is available, run `docker compose config` and start the service with `NODE_EXTRA_CA_CERTS=./certs/home-assistant-ca.pem`; record Docker unavailability rather than claiming success when it cannot run.

## Acceptance Criteria

- A dashboard started with the documented CA bundle can connect to Home Assistant over `wss://` using its private certificate chain.
- The same endpoint is rejected without the configured CA, and hostname, validity-period, and chain verification remain enabled.
- Root `.env` values, including `NODE_EXTRA_CA_CERTS`, are loaded before Node initializes TLS for npm startup.
- Compose forwards the same CA path and uses the existing read-only project mount; no certificate or private key is committed.
- Invalid CA configuration fails startup clearly, and browser-visible errors remain concise and non-sensitive.
- No trust-all code, environment setting, or test is introduced.
- Existing dashboard features and tests remain intact.
- Documentation, environment examples, implementation record, and version `0.9.1` match the delivered behavior.
