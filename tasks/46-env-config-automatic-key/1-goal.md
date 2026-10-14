# goal

## command

- use docker-compose.yml config. Don't use environment for all
  - use .env
- create encryption key automatically when server start first time
- Follow-up: use `HOME_ASSISTANT_CA_FILE` for Home Assistant, not `NODE_EXTRA_CA_CERTS`.

Request source: `~/workdir/command.md`.

## goal

Make deployment and local startup consistently configurable through `.env` and the supplied `docker-compose.yml`, without requiring users to repeat every setting as an inline shell environment assignment. Automatically create and persist the shared integration-credential encryption key on first server startup when no existing or explicitly supplied key is available, and reuse it on later starts.

## Current Behavior

- `docker-compose.yml` explicitly forwards many settings through its `environment` block, using interpolation from the shell or Compose `.env`. It fixes the container database/key paths under `/app/data`, mounts certificates read-only, and uses `/photos` for the optional operator-mounted NFS share. Compose defaults NFS to disabled.
- `.env.example` already lists application settings, optional explicit-key override, key-file path, certificate paths, and direct/Compose NFS settings. Direct `npm start` uses Node's native optional `.env` loading; `scripts/dev.js` supervises child startup and env-file reloads. Documentation still frequently demonstrates inline variable assignments.
- `src/config.js` loads configuration from `process.env` and resolves the key during configuration loading. `src/linkwarden-key.js` already generates a random 32-byte base64 key with exclusive creation and mode `0600` when a key-file path is configured; existing keys are reused and creation-race losers read the persisted winner.
- Compose specifies the persistent key-file path, but a direct startup without `.env` or `LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` returns an empty key rather than automatically bootstrapping one. The current resolver does not create a missing key parent directory.
- The legacy `LINKWARDEN_CONFIG_ENCRYPTION_KEY`/`LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` names cover the shared key for Linkwarden, Home Assistant, and CalDAV credentials. `.env` and `data/*.key` are ignored by Git. Database and key must remain paired across upgrades/backups.
- Compose currently maps `HOME_ASSISTANT_CA_FILE` to `NODE_EXTRA_CA_CERTS`, while direct-run documentation and Home Assistant error messages require the Node variable. This is not yet the consistent integration-specific configuration requested in the follow-up.

## Required Outcomes

- Establish `.env` as the normal user-edited configuration source for supported Compose and local startup paths. Users can set host/allowed hosts, ports, cache/CA settings, and NFS choices there and then use ordinary startup commands without inline prefixes for every value.
- Keep Compose responsible for image/network/volume topology and container-specific path mapping. Simplify repetitive setting forwarding where appropriate during planning; do not confuse Compose interpolation with passing `.env` values into the application, or assume a host path is also a valid container path. Runtime environment variables remain an implementation mechanism and supported operator override, not something that must be globally removed.
- Define and document precedence for `.env`, explicit process/Compose overrides, application defaults, and fixed container paths. Preserve certificate trust initialization before affected connections and dev supervisor reload behavior. Do not introduce a second incompatible `.env` parser or require privileged configuration edits.
- Use `HOME_ASSISTANT_CA_FILE` as the Home Assistant CA setting for both direct and Compose runs. Users must not need to configure `NODE_EXTRA_CA_CERTS` for Home Assistant. Plan the trust-loading mechanism accordingly rather than leaving a Compose-only alias that fails in direct runs. Preserve certificate-chain and hostname verification, public/default trust, and the existing integration-specific Linkwarden/CalDAV CA settings; never disable TLS verification or treat a CA bundle as a private key. Update examples, error guidance, and relevant TLS/startup/reload tests to use the requested variable.
- Preserve separation between host-mounted NFS paths and the application-visible root. Compose should support `.env`-configured existing mode without NFS client/capability additions; direct runs can use their existing/mount modes. No auto-mount, NAS mutation, or unsafe fallback is implied by this configuration task.
- Automatically choose a stable persistent key-file location for first server startup when no explicit secret/path is supplied. Define the default's relationship to application data/database storage during planning so direct and container runs retain the same key across restart, container recreation, and normal deployment upgrades.
- Create only the necessary owned key directory/file with restrictive permissions when needed. Generate cryptographically random 32-byte key material, preserve exclusive-create/race-winner behavior, and never print or return the secret in logs, browser APIs, shared preferences, or diagnostic reports. Keep the generated key outside committed `.env.example` and version control; do not silently rewrite the user's `.env`.
- Reuse a valid persisted key without rewriting, rotating, or changing ownership/permissions of existing user files. Retain an explicitly configured external secret/path and preserve compatibility with current credential records. A missing writable key file can be created through the first-start path; unreadable/malformed existing keys, invalid explicit secrets, and persistence failures must produce actionable sanitized failures rather than replacing existing secrets or reporting successful ephemeral encryption.
- Protect startup/configuration boundaries: pure validation or unit-test configuration inspection should not unexpectedly create keys in the user's data directory. Decide initialization timing during planning while preserving startup/shutdown behavior and early CA trust requirements.
- Update focused configuration, key/bootstrap, startup/dev, and Compose/deployment verification to cover clean first start, omitted optional configuration, explicit overrides, restarts, races, failure cases, and unchanged credentials. Use isolated temporary storage; do not generate, replace, or decrypt a real user's key during development verification.
- Update `.env.example` and directly related deployment/local/NFS/key setup documentation to show the ordinary `.env` workflow and automatic key persistence/backups. Keep README simple and link to dedicated existing docs.

## Acceptance Criteria

- The documented Compose/local setup requires editing `.env` once, followed by normal startup commands; no repeated inline assignments or manual key-generation command is needed for the default first-start path.
- `.env` values reach the intended application settings with tested/documented precedence and correct host/container paths. Existing explicit environment overrides, certificate trust timing, and dev env-file reload behavior remain supported.
- `HOME_ASSISTANT_CA_FILE` works consistently for Home Assistant in direct and Compose startup without requiring `NODE_EXTRA_CA_CERTS`; documentation and error messages identify the requested setting, and trusted/untrusted CA plus hostname-verification tests remain covered.
- First server startup creates one valid persistent restricted key when none is configured; subsequent starts and container recreation reuse it. Existing explicit secrets/files and saved encrypted credentials remain intact.
- Invalid/unwritable key state does not silently rotate keys, create a memory-only replacement, leak secrets, or pretend integrations are safely configured. Required parent creation and race behavior have isolated regression coverage.
- Relevant tests verify default bootstrap, persistence, overrides, Compose wiring, and startup failures without touching user databases, keys, `.env`, mounts, or service processes.

## Scope Boundary

This goal stage and its follow-up update only write and commit this document. No implementation, version/dependency update, `.env` edit, key creation, runtime server, mount operation, user-data change, or push is performed. Later implementation must preserve the existing storage/security model and must not auto-fix archived review findings, change container privilege/network design, broaden NFS safety policy, or rotate integration credentials. The Home Assistant CA configuration change above is explicitly in scope. Do not touch `todo.md`.
