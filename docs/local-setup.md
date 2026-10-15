# Run locally

This project requires Node.js 24 or later. Install the locked dependencies first; Undici supplies the scoped Home Assistant WebSocket transport.

```sh
cp .env.example .env
npm ci
npm start
```

Open `http://127.0.0.1:3000` for the photo dashboard. Use **Settings** to choose display preferences, search for a weather location, or connect a Baikal calendar. A clock and dark background work immediately without configuration. The database is created at `data/wol.db` and should be backed up along with the configuration.

`npm start` and `npm run start:lan` use Node's native optional env-file support for repository-root `.env`. Values already supplied by the process environment take precedence, and the file is optional. `start:lan` uses the same safety checks as `start`; configure the explicit private `HOST` address and any browser-facing `DASHBOARD_ALLOWED_HOSTS` in `.env` rather than enabling an unrestricted wildcard bind.

## Development and stopping

```sh
node scripts/dev.js
```

`npm run dev` runs the same polling supervisor. It checks JavaScript under `src/` and `public/`, `.env`, and `package.json` every 500ms, coalesces changes, and restarts one server child only after the previous child stops. Database writes, tasks, logs, dependencies, and core files do not trigger reloads. This replaces Node's native watch supervisor and its problematic watcher teardown. Reload the browser normally for frontend changes; live-browser reload is not added.

Development resolves `.env` separately for each child using Node's native parser, without mutating the supervisor environment. Inherited values win, and removing `.env` is supported. For Home Assistant private trust, set `HOME_ASSISTANT_CA_FILE=./certs/home-assistant-ca.pem` in `.env`; it loads into the Home Assistant-only transport before connections in direct/dev startup. No `NODE_EXTRA_CA_CERTS` assignment is required. Editing/removing the path restarts the child; replacing certificate contents requires a server restart. Do not disable certificate verification.

Syntax/import errors and invalid environment values leave the supervisor waiting for a new edit, with no automatic retry loop. Correcting the file restarts the child once. A successful listening/readiness notification clears the remembered failure; stopping before recovery retains a nonzero status. Changing `src/lifecycle-constants.js` requires relaunching the supervisor so parent and child use matching shutdown budgets.

Ctrl+C is supported for development through `node scripts/dev.js` and `npm run dev`. The supervisor requests its server child's cooperative shutdown through IPC and waits for its exit. Production/container shutdown uses SIGTERM; production terminal Ctrl+C is not a required workflow, although the existing server SIGINT handler remains available. The server stops admitting requests, cancels weather work, and drains existing handlers before closing SQLite. A five-second grace closes remaining HTTP connections; the overall application deadline is 30 seconds. The supervisor derives its 35-second wait from that budget plus a five-second margin. Forced or failed cleanup is reported and exits nonzero, rather than claiming the server stopped normally.

On the verified Linux Node 24.21.0/npm 11.19.0 combination, npm can itself terminate by SIGINT after a development Ctrl+C even though the supervisor and server both exit normally with code zero. Python reports that wrapper signal as `-2`; shells commonly display signal exits differently. A wrapper signal alone proves neither success nor an application crash. Tests independently require the server's successful cleanup result, supervisor exit zero, no safety-fallback use, no remaining owned processes, and a reusable port.

Some restricted containers deny userspace signals even between owned processes. npm still calls its own `kill()` forwarding path when it receives Ctrl+C and can print `kill EACCES`; application handlers cannot grant that permission. Use the direct development command above when this occurs. A permission-error diagnostic is a separate environment limitation, not silent successful npm shutdown. No root workaround or privilege change is performed by this project.

For another device on the LAN to reach the dashboard, set `HOST` to the server's explicit private address, such as `192.168.1.10`. That address is accepted automatically as an HTTP Host. If the browser uses a private DNS name instead, also set `DASHBOARD_ALLOWED_HOSTS` to that hostname. Do not bind the service to a public interface or expose its port through a router.

## Automatic integration key

Edit `.env` once for host, CA, and NFS settings, then use ordinary startup commands. First server startup generates a key named `linkwarden-config-encryption.key` beside SQLite, with a restricted new directory/file. Later starts reuse it. Back up database and key together. A nonempty `LINKWARDEN_CONFIG_ENCRYPTION_KEY` overrides the file and creates no key file; `LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE` selects another persistent path. Missing key material for existing encrypted credentials fails startup and requires restoring the original key, not generating a replacement. Configuration inspection does not read/create key files or directories.

[Back to README](../README.md)
