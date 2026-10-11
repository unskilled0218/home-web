# Linkwarden custom CA trust plan

## Goal

Allow the dashboard server to connect securely to `https://bookmarks.lan` when Linkwarden uses a certificate issued by a private or self-hosted CA, without disabling TLS certificate or hostname verification.

## Scope and decisions

- Use Node's standard `NODE_EXTRA_CA_CERTS` startup setting to append a deployment-provided PEM CA bundle to Node's normal trusted roots. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`, add a "trust all" option, or weaken the Linkwarden fetch path.
- Treat the configured file as trust material, not an application secret: operators will mount or otherwise provide the root/intermediate CA certificate bundle at deployment time. Do not commit a deployment certificate to the repository or persist certificate contents in SQLite.
- Keep trust configured at process startup because Node reads `NODE_EXTRA_CA_CERTS` only when the process launches. Require a service restart after adding or rotating the CA bundle.
- Preserve normal TLS checks. The Linkwarden server must present a complete chain to the configured CA, be within its validity period, and include `bookmarks.lan` in its subject alternative names; custom trust must not mask hostname, expiry, or malformed-chain failures.
- Make the documented `.env` workflow real by starting Node with `--env-file-if-exists=.env`, while continuing to allow explicitly exported environment variables to take precedence. This lets direct `npm start` deployments configure the encryption key, cache duration, and extra CA path as already implied by the README.
- Extend the Compose service to pass the existing Linkwarden encryption/cache settings and `NODE_EXTRA_CA_CERTS`, and document a read-only certificate mount/path that is visible inside the container. Avoid making the host's entire certificate directory writable or exposing private keys.
- Keep the custom CA optional. Deployments using public certificates or plain HTTP on a trusted LAN must continue to start without a certificate file, and Wake-on-LAN must remain independent of Linkwarden availability.
- Improve troubleshooting enough to distinguish certificate trust/hostname problems from authentication or general Linkwarden unavailability in server-side diagnostics, while browser/API responses remain concise and do not expose access tokens, certificate contents, filesystem paths, or raw remote responses.

## Implementation sequence

1. Update the start/dev scripts in `package.json` to load `.env` with Node 24's `--env-file-if-exists` option, preserving the project's dependency-free runtime and environment-variable precedence.
2. Add an optional `NODE_EXTRA_CA_CERTS` example to `.env.example`, with comments requiring a PEM-encoded CA certificate or bundle and noting that the path is resolved by the Node process (inside the container for Compose).
3. Update `docker-compose.yml` to forward `LINKWARDEN_CONFIG_ENCRYPTION_KEY`, `LINKWARDEN_CACHE_SECONDS`, and `NODE_EXTRA_CA_CERTS`. Provide a narrowly scoped, read-only CA-file mount convention whose container path matches the environment example, without checking deployment-specific trust material into source control.
4. Refine the Linkwarden request failure boundary and server-side logging so TLS failures retain an actionable category for operators while local API responses remain generic and secret-free. Preserve timeout, response-size, pagination-origin, caching, and stale-result behavior.
5. Add automated coverage for Linkwarden request failure sanitization and successful fetch behavior with normal verification intact. Add a subprocess or local HTTPS integration test, where practical, that demonstrates an untrusted test CA fails by default and succeeds only when supplied through `NODE_EXTRA_CA_CERTS`; never test by disabling verification.
6. Update `README.md` with direct-run and Compose instructions for mounting/configuring the CA bundle, restarting after trust changes, and verifying DNS, SAN, validity, and chain completeness for `bookmarks.lan`. Include troubleshooting commands that do not disclose the Linkwarden access token and explicitly warn against `NODE_TLS_REJECT_UNAUTHORIZED=0`.
7. Run `npm test`, syntax checks for changed JavaScript files, a Compose configuration render with and without the optional CA setting, and `git diff --check`. Manually verify the documented container path exists when mounted and that the dashboard still starts when custom trust is omitted.

## Acceptance criteria

- A direct or Compose deployment can connect to `https://bookmarks.lan` after the operator supplies the correct PEM CA bundle through `NODE_EXTRA_CA_CERTS` and restarts the service.
- The same endpoint still fails for an untrusted issuer, hostname mismatch, expired certificate, or incomplete chain; no code or configuration disables TLS verification.
- Publicly trusted Linkwarden deployments and deployments without Linkwarden continue to work without custom CA configuration.
- `.env` settings are honored by `npm start`, and Compose forwards all settings required by the existing Linkwarden integration as well as the optional CA path.
- Browser-visible errors remain non-sensitive, while server-side diagnostics identify TLS trust/configuration failures well enough to resolve deployment issues without logging credentials or certificate contents.
- Automated checks cover secure success/failure behavior and preserve existing Linkwarden cache, credential, collection, and Wake-on-LAN tests.
