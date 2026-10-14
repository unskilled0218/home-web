# Container deployment

Release images are published to the private Forgejo registry as `git.lan/dev/home-web`. The image contains Node 24 and the application source, runs as root, and installs nothing at startup. Compose uses host networking because UDP broadcast packets need to leave through the LAN interface. Log in, create the persistent directories, pull the current image, and start it with the host's private address:

```sh
docker login git.lan
mkdir -p data certs
cp .env.example .env
docker compose pull
docker compose up -d
```

Before starting, edit `.env` and set `HOST` to the Docker host's private address. Compose forwards ordinary settings through `env_file: .env`; its explicit path settings override that file: SQLite is `/app/data/wol.db` and photos are `/photos`. Key-file overrides must be container-visible persistent paths. Shell values drive Compose interpolation, but do not automatically override ordinary env-file application values; use a Compose override file or `docker compose run -e` when needed. Compose requires `.env`; do not overwrite an existing configured file with the example.

Only `./data` is writable application storage. First startup creates/reuses SQLite and `linkwarden-config-encryption.key` there; new files are normally root-owned on the host. The key is random, restricted, atomically published, and never written into `.env` or logged. Existing keys are not replaced; missing key material with saved credentials fails startup until restored. Back up database and key together. Production dependencies install with `npm ci --omit=dev` at image build time, never server startup; development/browser packages and secrets are excluded. Container recreation retains the mounted data/key and uses source/dependencies from the selected image.

For private DNS, list the exact hostname used in the browser:

Save these values in `.env`, then run `docker compose up -d`:

```dotenv
HOST=192.168.1.10
DASHBOARD_ALLOWED_HOSTS=home.lan
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
  --env-file .env \
  --env DATABASE_PATH=/app/data/wol.db \
  --env LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=/app/data/linkwarden-config-encryption.key \
  git.lan/dev/home-web:latest
```

For an upgrade, back up `data/`, record the currently deployed image digest, run `docker compose pull`, and recreate the service. The registry publishes only `latest`; pin a known digest as `HOME_WEB_IMAGE=git.lan/dev/home-web@sha256:<digest>` in `.env` when a stable rollback target is required. Rolling back an image does not reverse data migrations, so retain the matching backup until the new release is verified.

See [NFS backgrounds](nfs-backgrounds.md) for the optional photo mount and [Publishing releases](releases.md) for image publication.

[Back to README](../README.md)
