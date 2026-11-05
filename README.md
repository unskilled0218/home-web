# dashboard

A self-hosted dashboard with photos, a clock, weather, calendars, bookmarks, Home Assistant readings, and Wake-on-LAN buttons.

Use only on a trusted LAN. The dashboard has no user accounts or authentication.

Version 0.17.46: [release notes](docs/releases/0.17.46.md).

- [dashboard](#dashboard)
  - [Quick start](#quick-start)
  - [Settings](#settings)
  - [Documentation](#documentation)

## Quick start

Requires Node.js 24 or later. For a new installation:

```sh
cp .env.example .env
npm ci
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The clock works without extra setup. Photos and integrations are optional.

## Settings

Open **Settings** to choose widgets and connect services. Widget settings can stay **Local** to this browser or use **Global** shared values. New browsers start Local.

Use **Edit layout** to move and resize widgets. In **Images**, turn off **Show image** to hide photos without hiding widgets.

## Documentation

Run commands from the repository root.

- Setup: [Local and LAN](docs/local-setup.md), [Docker](docs/deployment.md).
- Display: [Dashboard](docs/dashboard.md), [Widget layout](docs/dashboard-layout.md), [NFS photos](docs/nfs-backgrounds.md).
- Settings: [Local and Global](docs/settings-scope.md), [Import and export](docs/settings-import-export.md).
- Integrations: [Baikal calendar](docs/calendar.md), [Linkwarden](docs/linkwarden.md), [Home Assistant](docs/home-assistant.md), [Wake-on-LAN](docs/wake-on-lan.md).
- Maintenance: [Operations and backups](docs/operations.md), [Tests](docs/testing.md), [Publishing releases](docs/releases.md).
