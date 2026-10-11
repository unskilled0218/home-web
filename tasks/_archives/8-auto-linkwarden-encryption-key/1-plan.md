# Automatic Linkwarden encryption key plan

## Goal

Make the Compose deployment create and reuse a valid `LINKWARDEN_CONFIG_ENCRYPTION_KEY` automatically, so Linkwarden can be configured without a manual secret-generation step and saved credentials remain decryptable after container recreation.

## Current behavior

- `src/config.js` only reads `LINKWARDEN_CONFIG_ENCRYPTION_KEY` from the process environment and otherwise leaves the optional Linkwarden integration without a usable encryption key.
- `docker-compose.yml` does not pass that variable into the container, despite `.env.example` and `README.md` instructing operators to set it.
- The application bind mount is read-only, but `/app/data` is writable and already persists the SQLite database across container recreation.
- A fresh random key on every startup would be unsafe because the Linkwarden access token in `data/wol.db` is encrypted with that key.

## Scope and decisions

- Add an optional `LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` configuration path. When this path is set and no non-empty explicit encryption key is supplied, startup will load the key from that file or create a base64-encoded 32-byte key there.
- Configure Compose to use a key file under `/app/data`, beside the persistent database. Container recreation will therefore reuse the same secret through the existing data bind mount.
- Preserve `LINKWARDEN_CONFIG_ENCRYPTION_KEY` as the highest-priority source for existing deployments and deliberate external secret management. Do not overwrite or create the file when an explicit key is present.
- Keep direct non-Compose startup backward compatible: when neither an explicit key nor a key-file path is configured, Wake-on-LAN starts normally and Linkwarden remains unavailable until a key is supplied.
- Create the key file atomically with owner-only permissions. If another startup wins a creation race, read and validate the winning file rather than replacing it.
- Validate loaded and generated values with the existing base64/32-byte contract. If a persisted file is empty, malformed, unreadable, or cannot be created, fail startup with an actionable error instead of silently replacing it and losing access to encrypted credentials.
- Never print the key, return it through an API, copy it into `.env`, or store it in SQLite. Ignore the generated key file in Git and document that the database and key file must be backed up and restored together.
- Do not auto-generate Linkwarden URLs, usernames, or access tokens; those are deployment/account-specific and remain configured through the existing Bookmarks settings flow.

## Implementation sequence

1. Extract a small startup key resolver that accepts the explicit environment value and optional key-file path, reuses the existing encryption-key validation, reads an existing key, or securely generates and atomically persists a new one.
2. Wire the resolver into `src/config.js` so `config.linkwardenEncryptionKey` receives the resolved value before the server initializes, while retaining an empty value when neither source is configured.
3. Update `docker-compose.yml` to forward an optional `LINKWARDEN_CONFIG_ENCRYPTION_KEY` override and set `LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` to a stable path under `/app/data`. Continue using the existing writable `./data:/app/data` mount; do not make the read-only application mount writable.
4. Add the generated key filename pattern to `.gitignore` and describe the key-file option and explicit-key precedence in `.env.example` without including a real secret.
5. Update `README.md` so Compose users can start without running `openssl`, understand where the key is persisted, and know to back up and protect both the key file and `wol.db`. Retain manual key-generation instructions for direct runs or externally managed secrets and warn that deleting or replacing the key prevents decryption of saved Linkwarden credentials.
6. Update the project version according to the existing patch-release convention and record implementation details and verification in `3-implemented.md` during implementation.

## Automated coverage

- Add unit coverage using temporary directories to prove the resolver creates a canonical base64-encoded 32-byte key with restrictive permissions.
- Verify a second startup reads exactly the same persisted key rather than rotating it.
- Verify a non-empty explicit environment key takes precedence and does not create or modify the configured file.
- Verify no source configured preserves the current empty-key behavior for direct Wake-on-LAN-only startup.
- Verify malformed or empty persisted content, unreadable paths, and creation failures produce clear startup errors without replacing existing data.
- Cover the atomic-create collision path so concurrent initializations converge on the persisted winner.
- Preserve all existing encryption/decryption, Linkwarden server, bookmark, and Wake-on-LAN tests.

## Verification

- Run `npm test` and syntax checks for every changed JavaScript file.
- Run `docker compose config` with no `.env` key and with an explicit `LINKWARDEN_CONFIG_ENCRYPTION_KEY` override to confirm both deployment paths render correctly.
- Start Compose with a clean disposable data directory, verify the key file is created under the mounted data path with restrictive permissions, and confirm Linkwarden reports encryption as ready.
- Recreate the container and verify the key file is unchanged and previously saved Linkwarden credentials remain readable.
- Corrupt the disposable key file and verify startup fails without replacing it; restore the file and verify recovery.
- Run `git status --short` to confirm the generated key is ignored, then run `git diff --check`.

## Acceptance criteria

- `docker compose up` on a fresh deployment automatically creates a valid encryption key without requiring `openssl` or manual `.env` editing.
- The generated key survives container recreation through the existing data mount, so encrypted Linkwarden credentials remain readable.
- An explicitly supplied `LINKWARDEN_CONFIG_ENCRYPTION_KEY` remains supported and takes precedence for existing or externally managed deployments.
- Invalid persisted key material causes a visible startup failure and is never silently regenerated or disclosed.
- Direct Wake-on-LAN-only startup remains possible without configuring Linkwarden secrets.
- Documentation and ignore rules prevent operators from accidentally treating the generated key as disposable or committing it to source control.
