# Automatic Linkwarden encryption key implementation

## Delivered

- Added a startup key resolver that gives a non-empty `LINKWARDEN_CONFIG_ENCRYPTION_KEY` precedence, otherwise reads or creates the configured key file, and keeps Linkwarden optional when neither source is present.
- Generated keys use 32 cryptographically random bytes, canonical base64 encoding, exclusive atomic creation, and owner-only file permissions.
- Persisted key files are validated before use. Empty, malformed, unreadable, or uncreatable files fail startup without replacing existing secret material, while concurrent first starts converge on the file created by the winner.
- Wired `LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` into application configuration and configured Compose to persist the generated key at `/app/data/linkwarden-config-encryption.key` through the existing writable `data` mount.
- Added Compose forwarding for an explicitly managed encryption key and the existing Linkwarden cache duration. Explicit keys remain compatible with the prior behavior, including allowing Wake-on-LAN to start while Linkwarden reports an invalid key as unavailable.
- Ignored generated `.key` files under `data`, documented automatic Compose setup, explicit-key precedence, direct-run options, failure behavior, and joint database/key backup requirements.
- Added focused tests for secure creation, restart reuse, explicit override precedence, optional no-key operation, application-config wiring, malformed and empty files, path failures, generated-value validation, and atomic creation races.
- Bumped the application version from `0.6.1` to `0.6.2`.

## Verification

- `npm test` passes with 27 tests.
- `node --check src/linkwarden-key.js`, `node --check src/config.js`, and `node --check test/linkwarden-key.test.js` pass.
- `git diff --check` passes.
- `git check-ignore -v data/linkwarden-config-encryption.key` confirms the generated secret path is ignored by `data/*.key`.
- Automated subprocess coverage imports the real application configuration with only `LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` set and confirms it creates and loads a valid persistent key.
- Compose rendering and live container recreation were not run because the Docker CLI is not installed in this development container (`docker: command not found`). The Compose file changes were inspected, but deployment verification remains required on a Docker host.
