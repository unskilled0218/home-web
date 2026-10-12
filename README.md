# dashboard

A self-hosted photo dashboard with a clock, weather forecasts, an optional Baikal calendar, and Linkwarden bookmarks. Designed for a trusted local network.

## Quick start

Requires Node.js 24 or later. The server needs no runtime package installation.

```sh
cp .env.example .env
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). A clock and dark background work immediately.

## Settings

Use the **General**, **Time**, **Weather**, **Calendar**, **Bookmarks**, and **Images** tabs to customize the dashboard. Display preferences are saved in your browser. **Clear results** clears weather search results while keeping the selected location. See [Linkwarden setup](docs/linkwarden.md) for the bookmark tree and fullscreen option.

## Documentation

Run documented commands from the repository root.

- [Local setup and LAN access](docs/local-setup.md)
- [Dashboard features and preferences](docs/dashboard.md)
- [NFS photo backgrounds](docs/nfs-backgrounds.md)
- [Baikal calendar setup](docs/calendar.md)
- [Docker deployment](docs/deployment.md)
- [Operations and backups](docs/operations.md)
- [Tests](docs/testing.md) and [publishing releases](docs/releases.md)

Home Assistant and Wake-on-LAN remain backend APIs without dashboard controls. See [Home Assistant](docs/home-assistant.md) and [Wake-on-LAN](docs/wake-on-lan.md).
