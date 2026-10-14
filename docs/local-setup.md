# Run locally

This project requires Node.js 24 or later. No package installation is necessary.

```sh
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000` for the photo dashboard. Use **Settings** to choose display preferences, search for a weather location, or connect a Baikal calendar. A clock and dark background work immediately without configuration. The database is created at `data/wol.db` and should be backed up along with the configuration.

`npm start` and `npm run start:lan` use Node's native optional env-file support for repository-root `.env`. Values already supplied by the process environment take precedence, and the file is optional. `start:lan` uses the same safety checks as `start`; configure the explicit private `HOST` address and any browser-facing `DASHBOARD_ALLOWED_HOSTS` in `.env` rather than enabling an unrestricted wildcard bind.

## Development and stopping

```sh
node scripts/dev.js
```

`npm run dev` runs the same polling supervisor. It checks JavaScript under `src/` and `public/`, `.env`, and `package.json` every 500ms, coalesces changes, and restarts one server child only after the previous child stops. Database writes, tasks, logs, dependencies, and core files do not trigger reloads. This replaces Node's native watch supervisor and its problematic watcher teardown. Reload the browser normally for frontend changes; live-browser reload is not added.

Development resolves `.env` separately for each child using Node's native parser, without assigning its values to the supervisor's environment. Inherited environment values still win, and removing `.env` is supported. The child also receives the native env-file flag. Pre-resolving the child environment ensures `NODE_EXTRA_CA_CERTS` is present at process creation; on the observed Node 24.21.0 runtime, the env-file flag alone populated that variable but did not enable its private CA trust. Normal direct/start launches on affected Node versions should supply this startup-only variable explicitly, for example `NODE_EXTRA_CA_CERTS=./certs/home-assistant-ca.pem node --env-file-if-exists=.env src/server.js`. Do not disable certificate verification.

Syntax/import errors and invalid environment values leave the supervisor waiting for a new edit, with no automatic retry loop. Correcting the file restarts the child once. A successful listening/readiness notification clears the remembered failure; stopping before recovery retains a nonzero status. Changing `src/lifecycle-constants.js` requires relaunching the supervisor so parent and child use matching shutdown budgets.

Ctrl+C requests cooperative shutdown. The server stops admitting requests, cancels weather work, and drains existing handlers before closing SQLite. SIGTERM uses the same path. A five-second grace closes remaining HTTP connections; the overall application deadline is 30 seconds. The supervisor derives its 35-second wait from that budget plus a five-second margin. Forced or failed cleanup is reported and exits nonzero, rather than claiming the server stopped normally.

Some restricted containers deny userspace signals even between owned processes. npm still calls its own `kill()` forwarding path when it receives Ctrl+C and can print `kill EACCES`; application handlers cannot grant that permission. Use the direct development command above, or `node --env-file-if-exists=.env src/server.js` for a normal run. The direct commands passed terminal Ctrl+C tests in the affected container. Silent npm shutdown additionally requires ordinary owned-process signal permission from the operator's environment policy; no root workaround or privilege change is performed by this project.

For another device on the LAN to reach the dashboard, set `HOST` to the server's explicit private address, such as `192.168.1.10`. That address is accepted automatically as an HTTP Host. If the browser uses a private DNS name instead, also set `DASHBOARD_ALLOWED_HOSTS` to that hostname. Do not bind the service to a public interface or expose its port through a router.

[Back to README](../README.md)
