# dashboard

A self-hosted photo dashboard with a clock, weather forecasts, an optional Baikal calendar, and Linkwarden bookmarks. Designed for a trusted local network.

Version 0.17.44: [release notes](docs/releases/0.17.44.md). Bookmarks, Home Assistant, and Wake-on-LAN now have independent desktop/mobile scales. Saved layouts remain unchanged.

- [dashboard](#dashboard)
  - [Quick start](#quick-start)
  - [Settings](#settings)
  - [Documentation](#documentation)

## Quick start

Requires Node.js 24 or later. Edit `.env` once; the integration encryption key is created automatically on first startup.

```sh
cp .env.example .env
npm ci
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). A clock and dark background work immediately.

Enable photo backgrounds with `NFS_MOUNT_MODE=on`; the default is `off`. A configured `NFS_SOURCE` manages a mount; an empty source uses an existing mount. Photo playback uses nonrepeating filename batches and prepares one upcoming image. See [NFS photo backgrounds](docs/nfs-backgrounds.md).

## Settings

Use the **General**, **Time**, **Weather**, **Calendar**, **Bookmarks**, **Home Assistant**, **Wake-on-LAN**, and **Images** tabs to customize the dashboard. Each category defaults to Local for new browsers; its Global choice shares only that category. Arrange widgets with **Edit layout** on the dashboard. See [settings scope](docs/settings-scope.md), [global import/export](docs/settings-import-export.md), and [dashboard preferences](docs/dashboard.md). **Clear results** keeps the selected weather location.

Weather shows current US AQI in both scopes. Server requests retain bounded dual-stack deadlines and honor Node's explicitly enabled environment proxy settings, including live `NO_PROXY` changes and `*.domain` bypass rules; see [weather behavior](docs/dashboard.md).

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
