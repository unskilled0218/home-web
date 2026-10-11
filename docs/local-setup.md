# Run locally

This project requires Node.js 24 or later. No package installation is necessary.

```sh
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000` for the photo dashboard. Use **Settings** to choose display preferences, search for a weather location, or connect a Baikal calendar. A clock and dark background work immediately without configuration. The database is created at `data/wol.db` and should be backed up along with the configuration.

`npm start`, `npm run start:lan`, and `npm run dev` use Node's native optional env-file support to load the repository-root `.env` before the process initializes. Values already supplied by the process environment take precedence, and the file is optional. Loading before initialization is required for TLS settings such as `NODE_EXTRA_CA_CERTS`. `start:lan` uses the same safety checks as `start`; configure the explicit private `HOST` address and any browser-facing `DASHBOARD_ALLOWED_HOSTS` in `.env` rather than enabling an unrestricted wildcard bind.

For another device on the LAN to reach the dashboard, set `HOST` to the server's explicit private address, such as `192.168.1.10`. That address is accepted automatically as an HTTP Host. If the browser uses a private DNS name instead, also set `DASHBOARD_ALLOWED_HOSTS` to that hostname. Do not bind the service to a public interface or expose its port through a router.

[Back to README](../README.md)
