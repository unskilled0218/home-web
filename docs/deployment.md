# Docker deployment

- [Docker deployment](#docker-deployment)
  - [Start](#start)
  - [Network access](#network-access)
  - [Persistent data](#persistent-data)
  - [Upgrade and rollback](#upgrade-and-rollback)

## Start

Images are published to the private registry at `git.lan/dev/home-web`. For a new installation:

```sh
docker login git.lan
mkdir -p data certs
cp .env.example .env
```

Edit `.env` before starting. Set `HOST` to the Docker host's private address:

```dotenv
HOST=192.168.1.10
DASHBOARD_ALLOWED_HOSTS=home.lan
```

Then pull and start:

```sh
docker compose pull
docker compose up -d
```

Do not overwrite an existing `.env`. Compose requires it. The image contains Node 24 and production dependencies; nothing installs at startup. It runs as root and uses host networking for UDP broadcasts. Docker Desktop users should run directly on a LAN host instead.

## Network access

Open `http://192.168.1.10:3000`, or the allowed private hostname. Restrict port 3000 to the trusted LAN; the dashboard has no authentication.

`DASHBOARD_ALLOWED_HOSTS` accepts comma-separated hostnames/IPs without schemes, ports, paths, or wildcards. The configured `HOST` address is allowed automatically. Wildcard binds require explicit allowed hosts.

Keep reverse proxies LAN-only. Preserve the browser-facing Host header and list that hostname. Do not accept arbitrary Host values or trust forwarded-host headers.

## Persistent data

- `./data` mounts at `/app/data` and contains SQLite and the integration key. New files are normally root-owned.
- `./certs` mounts read-only at `/app/certs` for private CA bundles.
- `${NFS_HOST_MOUNT_PATH:-./photos}` mounts read-only at `/photos`. Photos remain disabled until configured; see [NFS photos](nfs-backgrounds.md).

Back up the database and encryption key together. Missing key material with saved credentials stops startup; restore the original key. An explicit `LINKWARDEN_CONFIG_ENCRYPTION_KEY` takes precedence over the file and must stay unchanged across restarts.

Compose fixes SQLite to `/app/data/wol.db` and the photo path to `/photos`. Key-file overrides must point to persistent paths visible inside the container. Shell values affect Compose interpolation, not every application setting in `env_file`; use a Compose override or `docker compose run -e` when needed.

## Upgrade and rollback

1. Back up the database and key consistently; see [operations](operations.md#backups).
2. Record the deployed image digest.
3. Run `docker compose pull` and `docker compose up -d`.
4. Verify the dashboard before removing the matching backup.

Compose defaults to mutable `latest`. To pin a known image, set this in `.env`:

```dotenv
HOME_WEB_IMAGE=git.lan/dev/home-web@sha256:<digest>
```

An image rollback does not undo database migrations. Retain the matching data backup. Staging tags are release evidence, not deployment recommendations. See [publishing releases](releases.md).

[Back to README](../README.md)
