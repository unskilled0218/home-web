# dashboard

A self-hosted photo dashboard with a clock, weather forecasts, an optional Baikal calendar, and Linkwarden bookmarks. Designed for a trusted local network.

## Quick start

Requires Node.js 24 or later. Edit `.env` once; the integration encryption key is created automatically on first startup.

```sh
cp .env.example .env
npm ci
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). A clock and dark background work immediately.

## Settings

Use the **General**, **Time**, **Weather**, **Calendar**, **Bookmarks**, **Home Assistant**, **Wake-on-LAN**, and **Images** tabs to customize the dashboard. Settings are saved on the server and synchronize across browsers every five seconds while visible. **Clear results** clears weather search results while keeping the selected location. See [dashboard preferences](docs/dashboard.md) and [Linkwarden setup](docs/linkwarden.md).

## Documentation

Run documented commands from the repository root.

- [Local setup and LAN access](docs/local-setup.md)
- [Dashboard features and preferences](docs/dashboard.md)
- [NFS photo backgrounds](docs/nfs-backgrounds.md)
- [Baikal calendar setup](docs/calendar.md)
- [Docker deployment](docs/deployment.md)
- [Operations and backups](docs/operations.md)
- [Tests](docs/testing.md) and [publishing releases](docs/releases.md)

Select [Home Assistant devices](docs/home-assistant.md) to show read-only readings and use [Wake-on-LAN](docs/wake-on-lan.md) dashboard buttons to wake saved computers.
