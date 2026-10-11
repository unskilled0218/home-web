# Container deployment

Release images are published to the private Forgejo registry as `git.lan/dev/home-web`. The image contains Node 24 and the application source, runs as root, and installs nothing at startup. Compose uses host networking because UDP broadcast packets need to leave through the LAN interface. Log in, create the persistent directories, pull the current image, and start it with the host's private address:

```sh
docker login git.lan
mkdir -p data certs
docker compose pull
HOST=192.168.1.10 docker compose up -d
```

Only `./data` is writable application storage. The root container creates `data/wol.db` and `data/linkwarden-config-encryption.key`, so files newly created through Compose are normally root-owned on the host. Back them up together and use host administrator privileges when ownership or permissions need to change. The source checkout is not mounted into `/app`; recreating the container always runs the code baked into the selected image.

For private DNS, list the exact hostname used in the browser:

```sh
HOST=192.168.1.10 DASHBOARD_ALLOWED_HOSTS=home.lan docker compose up -d
```

`DASHBOARD_ALLOWED_HOSTS` is a comma-separated list of hostnames or IP addresses without schemes, ports, paths, or wildcards. Every API request must use either the configured `HOST` address or one of these names. If a reverse proxy is used, keep it LAN-only, preserve the browser-facing Host header, and list that hostname. Do not allow arbitrary Host values or trust forwarded-host headers because that would reintroduce DNS-rebinding access. A wildcard bind such as `0.0.0.0` or `::` requires at least one explicit allowed host.

Restrict port 3000 at the host firewall to the trusted LAN. Host networking behaves differently on Docker Desktop; run the service directly on the LAN host there.

To retain an existing externally managed key, set `LINKWARDEN_CONFIG_ENCRYPTION_KEY` in Compose's `.env` file before the first startup. The legacy variable name is retained for compatibility, but the key encrypts Linkwarden, Home Assistant, and CalDAV credentials. An explicit key takes precedence and the automatic key file is not created. Keep using the same value after every restart.

Compose mounts `./certs` read-only at `/app/certs`, so paths such as `./certs/linkwarden-ca.pem` resolve inside the image because its working directory is `/app`. Keep certificate bundles out of version control; `certs/` is ignored. For a CA stored elsewhere, add a read-only bind mount in a Compose override and set the relevant CA variable to its container path.

Run the image without Compose by supplying the same host networking, persistent paths, and host checks:

```sh
docker run -d \
  --name home-web \
  --restart unless-stopped \
  --network host \
  --volume "$PWD/data:/app/data" \
  --volume "$PWD/certs:/app/certs:ro" \
  --env HOST=192.168.1.10 \
  --env DATABASE_PATH=/app/data/wol.db \
  --env LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=/app/data/linkwarden-config-encryption.key \
  git.lan/dev/home-web:latest
```

For an upgrade, back up `data/`, record the currently deployed image digest, run `docker compose pull`, and recreate the service. The registry publishes only `latest`; pin a known digest as `HOME_WEB_IMAGE=git.lan/dev/home-web@sha256:<digest>` in `.env` when a stable rollback target is required. Rolling back an image does not reverse data migrations, so retain the matching backup until the new release is verified.

See [NFS backgrounds](nfs-backgrounds.md) for the optional photo mount and [Publishing releases](releases.md) for image publication.

[Back to README](../README.md)
