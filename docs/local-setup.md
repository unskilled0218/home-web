# Local setup

- [Local setup](#local-setup)
  - [Start](#start)
  - [LAN access](#lan-access)
  - [Development](#development)
  - [Encryption key](#encryption-key)

## Start

Requires Node.js 24 or later. For a new installation:

```sh
cp .env.example .env
npm ci
npm start
```

Open `http://127.0.0.1:3000`. Configure optional services in **Settings**. SQLite is created at `data/wol.db`.

Startup reads `.env` when present. Existing process environment values take precedence. Do not overwrite a configured `.env`.

## LAN access

Set the server's private address in `.env`. Add the exact hostname if browsers use private DNS:

```dotenv
HOST=192.168.1.10
DASHBOARD_ALLOWED_HOSTS=home.lan
```

Restart, then open `http://192.168.1.10:3000` or `http://home.lan:3000`. `npm run start:lan` uses the same checks as `npm start`.

Keep the port on a trusted LAN. Do not expose it through a router or bind to a public interface.

## Development

```sh
npm run dev
```

The supervisor checks `src/`, `public/`, `.env`, and `package.json` every 500ms. Changes restart the server after the previous child stops. Reload the browser for frontend changes.

Invalid code or configuration waits for another edit instead of retrying repeatedly. Inherited environment values still win. Restart the supervisor after changing `src/lifecycle-constants.js`.

Use Ctrl+C to stop development. If npm reports `kill EACCES`, use `node scripts/dev.js` directly. An npm signal exit alone does not prove an application crash; check the server's cleanup result. See [shutdown](operations.md#shutdown).

For private integration certificates, use the service-specific CA settings in the integration guides. Restart after replacing certificate contents. Never disable certificate verification.

## Encryption key

First startup creates `linkwarden-config-encryption.key` beside SQLite. Later starts reuse it. Back up the database and key together.

- `LINKWARDEN_CONFIG_ENCRYPTION_KEY` supplies an explicit key instead of creating a file.
- `LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` selects another persistent file path.
- Missing key material with saved credentials stops startup. Restore the original key; do not replace it.

[Back to README](../README.md)
