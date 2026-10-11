# dashboard

dashboard is a small, self-hosted photo dashboard with a clock, weather forecasts, and an optional Baikal CalDAV agenda on a trusted local network. It has no accounts or internet-facing use case. Home Assistant, Linkwarden, and Wake-on-LAN remain available through backend APIs, without a dashboard interface.

## Run locally

This project requires Node.js 24 or later. No package installation is necessary.

```sh
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000` for the photo dashboard. Use **Settings** to choose display preferences, search for a weather location, or connect a Baikal calendar. A clock and dark background work immediately without configuration. The database is created at `data/wol.db` and should be backed up along with the configuration.

`npm start`, `npm run start:lan`, and `npm run dev` use Node's native optional env-file support to load the repository-root `.env` before the process initializes. Values already supplied by the process environment take precedence, and the file is optional. Loading before initialization is required for TLS settings such as `NODE_EXTRA_CA_CERTS`. `start:lan` uses the same safety checks as `start`; configure the explicit private `HOST` address and any browser-facing `DASHBOARD_ALLOWED_HOSTS` in `.env` rather than enabling an unrestricted wildcard bind.

For another device on the LAN to reach the dashboard, set `HOST` to the server's explicit private address, such as `192.168.1.10`. That address is accepted automatically as an HTTP Host. If the browser uses a private DNS name instead, also set `DASHBOARD_ALLOWED_HOSTS` to that hostname. Do not bind the service to a public interface or expose its port through a router.

## Photo dashboard

The home page `/` shows photos, a clock, weather, and an optional calendar, inspired by the `dash-board` desktop application. `/dashboard`, `/dashboard/`, and `/dashboard.html` redirect to `/`. The former widget canvas and layout editor have been removed. Existing photo-dashboard preferences remain under the browser-local `dashboard.preferences.v1` key on the same origin. Stored integration credentials and former home settings remain in the database; the photo dashboard does not overwrite them.

**Settings** uses five left-side tabs. **General** opens first and contains **Information layout**: lower-left/right position and overall scale. **Time** controls clock visibility/scale, timezone, date style, 12/24-hour format, and seconds. **Weather** contains visibility/scale, weather units, and location search. **Calendar** contains visibility/scale and the Baikal connection. **Images** contains slideshow/background preferences and NFS status. ArrowUp/ArrowDown navigate the tabs; Home/End select the first/last tab. The sidebar stays on the left on mobile, and long panels scroll while Save preferences and Close remain accessible.

Switching tabs retains entered values without saving them. **Save preferences** saves display preferences from all five tabs together; invalid fields reveal their tab before reporting the error. Closing and reopening Settings reloads applied preferences. Selecting a weather location saves it immediately. **Clear results** empties the search results and cancels the current search without changing the selected location, saved preferences, or search text. Calendar connection/disconnection uses the server independently of Save preferences. Date styles use the browser's locale and `Intl` formatting rather than the desktop app's custom format strings. Preferences remain under `dashboard.preferences.v1` in this browser's localStorage; blocked or corrupt storage falls back to defaults, and save failures are reported without stopping the page.

The dashboard automatically loads JPEG, PNG, WebP, and GIF backgrounds from an optional read-only NFS share. It recursively scans up to 5,000 entries and eight directory levels, then accepts up to 100 files, 20 MiB per file, and 200 MiB total. Symbolic links, unsupported files, invalid images, and files outside the configured root are rejected or skipped. Reload `/` after changing the share. Choose name, modification-date, or shuffled ordering; none/fade/slide transitions; interval and transition duration; opacity; a solid or blurred-image background; and optional filename display. Transitions respect reduced-motion preferences, and slideshow timers pause while the page is hidden. If NFS is disabled or unavailable, the page continues with its solid background, clock, weather, and calendar.

### NFS backgrounds

For a direct run, install the NFS client supplied by the host operating system and configure the dashboard service account to mount only the intended export without an interactive password. The application never invokes `sudo` and must not run as root. Set the export and local mount point in `.env`:

```sh
NFS_MOUNT_MODE=mount
NFS_SOURCE=nas.lan:/photos
NFS_MOUNT_PATH=./data/backgrounds
NFS_MOUNT_OPTIONS=vers=4.2
```

`npm start` checks for an existing matching NFS/NFS4 mount, otherwise invokes `mount` with the configured source and path before opening the HTTP listener. It always forces `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`, uses no shell interpolation, and bounds mount and disconnected-share operations. A missing client, denied mount, unreachable server, conflicting or unsafe mount point, timeout, or failed verification emits one generic warning and starts the dashboard without photos. The process does not unmount the share at shutdown because the mount may be shared or managed externally. `NFS_MOUNT_OPTIONS` accepts only comma-separated option tokens and cannot relax the forced bounded read-only settings; background, hard-mount, and retry-control options are rejected.

To read a directory that is already mounted by the host or service manager, mount it with `ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2`, omit `NFS_SOURCE`, and use:

```sh
NFS_MOUNT_MODE=existing
NFS_MOUNT_PATH=/srv/dashboard-photos
```

The standard Compose service runs as root but does not install an NFS client or receive mount capabilities. The host-mounted share must allow that container process to read and traverse the files; account for the NFS export's root-squash and mode settings on the host. Mount NFS on the Docker host with the bounded read-only options above, then enable the integrated read-only mount:

```sh
NFS_MOUNT_MODE=existing NFS_HOST_MOUNT_PATH=/srv/dashboard-photos docker compose up -d
```

Compose mounts `${NFS_HOST_MOUNT_PATH:-./photos}` at `/photos` but leaves NFS disabled unless `NFS_MOUNT_MODE=existing` is set.

The browser receives only bounded relative names and temporary opaque image URLs. Absolute mount paths and the NFS source are not exposed. Photo API requests retain the dashboard's trusted-LAN and allowed-Host checks.

Search for a weather location in **Settings → Weather**. Search terms and selected coordinates are sent directly from the browser to [Open-Meteo](https://open-meteo.com/). The transparent weather overlay pairs visible condition text with local SVG artwork for current conditions, three-hourly samples of the next 24 hours, and seven daily forecasts; it does not request icons from another service. Hourly icons follow Open-Meteo's day/night flag, while daily icons use daytime variants. The artwork is bundled from the sibling `dash-board` project. The page also shows the **US AQI**, with air-quality data attributed to [CAMS ENSEMBLE](https://ads.atmosphere.copernicus.eu/). Weather refreshes hourly while visible and when relevant settings change. Failed refreshes label retained data as stale; weather and air-quality failures are handled independently. The page uses the public provider endpoints and their usage terms, and requires internet access for weather only.

**Enter fullscreen** uses the browser Fullscreen API and may be unavailable or denied by browser policy. Escape exits fullscreen. The dashboard uses native browser modules without a build step, Tauri, or a runtime dependency on the reference checkout.

## Baikal calendar

The calendar is optional. On `/`, open **Settings → Calendar → Baikal calendar** and enter only the Baikal server URL, such as `https://baikal.example.test`, plus a username and password. Do not add `/dav.php/` or a calendar path. The dashboard follows Baikal's same-origin CalDAV discovery flow to locate the authenticated principal, calendar home, and up to 20 event-capable calendars. Use a dedicated least-privilege account when practical.

The client supports Baikal installations configured for either HTTP Basic or HTTP Digest authentication. It follows a Digest challenge using MD5, MD5-sess, SHA-256, or SHA-256-sess with `qop=auth`; unsupported challenge modes fail without exposing the password.

The server rediscovers calendars after each cache expiry or explicit refresh, queries discovered calendars with at most four requests in flight, and merges their results into one agenda. Each bounded depth-1 CalDAV `calendar-query` requests events overlapping the current instant through 14 days ahead. The dashboard displays at most 10 ordered events, including timed, all-day, multi-day, and recurring instances expanded by Baikal/SabreDAV. The integration is read-only: it does not select or label individual calendars, create or edit events, process invitations, display tasks, or execute alarms. A server that does not support standard principal/home discovery and the required RFC 4791 time-range and expansion report cannot be connected.

Some Baikal/SabreDAV installations store `calendar-timezone` as a timezone name instead of the required `VCALENDAR` value and return HTTP 500 when expansion is requested. The dashboard retries that calendar query without expansion so non-recurring events remain available. Recurring instances may be incomplete in this fallback mode until the server's calendar-timezone property is corrected.

Timed events are displayed in the dashboard's selected timezone; all-day dates remain calendar dates and do not drift across timezones. The browser refreshes automatically every five minutes while the calendar is visible, pauses while hidden or disabled, and refreshes immediately when active again. A temporary network or server failure retains a clearly marked stale snapshot, but authentication, authorization, malformed-response, and unsupported-report failures do not serve cached private events.

The Baikal password is sent only from the browser to this dashboard during connection, then encrypted in `data/wol.db` with the shared integration-credential key. It is never returned or prefilled. Leave it blank to retain the saved password only when the normalized server URL and username are unchanged; changing either requires the password again. A failed reconnect preserves the previous working configuration, and **Disconnect calendar** deletes the saved URL, username, and encrypted password. Existing exact collection URLs saved by version `0.13.3` are migrated to their server origin without decrypting or rewriting the password. Back up the database and encryption key together.

Normal HTTPS certificate-chain, hostname, and validity checks apply. For a Baikal server using a private CA, place only the public CA/intermediate bundle under `certs/` and configure scoped trust:

```sh
mkdir -p certs
cp /path/to/baikal-ca.pem certs/baikal-ca.pem
printf '\nCALDAV_CA_FILE=./certs/baikal-ca.pem\n' >> .env
npm start
```

`CALDAV_CA_FILE` affects only CalDAV requests and must contain valid certificates without private keys. It does not alter Linkwarden, Home Assistant, Open-Meteo, or other Node trust. Discovery redirects and hrefs must remain on the configured origin. The default `CALDAV_CACHE_SECONDS=300` matches the browser refresh interval. Plain `http://` server URLs are supported only for trusted-LAN deployments and expose authentication traffic to anyone able to observe or alter that network path; prefer HTTPS even on the LAN.

## Container deployment

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

## Publish a container release

The token must have repository-write and package-write access and remain outside this repository. Reuse the protected reference token file by injecting it only for the release process:

```sh
FORGEJO_TOKEN="$(<"$HOME/.config/forgejo/forgejo-token")" ./scripts/release.sh
```

`scripts/release.sh` runs only from a clean `main` checkout. It reads the exact semantic version from `package.json`, runs all tests and syntax checks, pushes `main`, builds AMD64 and ARM64 image archives with checksum files under ignored `dist/`, creates the matching versioned Git tag and Forgejo release, uploads all four release assets, and finally builds and pushes the two-platform registry image only as `git.lan/dev/home-web:latest`. No versioned or architecture-specific registry tags are published. Run only one release at a time because `latest` is intentionally mutable. `FORGEJO_USER` defaults to `dev` and can be overridden when the shared token belongs to another account. Docker authentication uses a minimal temporary configuration with no inherited credential helper and is removed on exit, so the shared token is not left in the normal Docker credential store or host keychain.

The release workstation needs Node 24, Git, curl, Docker with Buildx, a builder capable of `linux/amd64` and `linux/arm64`, and trusted TLS configuration for `git.lan` in Git, curl, and Docker. Install binfmt support once on a Linux Docker host when cross-platform emulation is required, then confirm the builder before releasing:

```sh
docker run --privileged --rm tonistiigi/binfmt --install amd64,arm64
docker buildx inspect --bootstrap
```

The release command performs real Git, Forgejo API, and registry mutations. Never put `FORGEJO_TOKEN` in `.env`, Compose, shell scripts, command arguments, or Git. If the Git tag, Forgejo release, and all release assets were created but the final `latest` push failed, verify that state and run `scripts/release.sh --promote-latest` with the same token. Recovery verifies `main`, the version tag, and all four release assets before rebuilding and publishing `latest` from that exact commit. For an earlier partial failure, inspect and clean up the incomplete Forgejo release before starting again; release assets are never overwritten silently.

## Operational checklist

- The service host must be able to route broadcasts to each target subnet. Enter the correct broadcast address for each device, for example `192.168.1.255`.
- Wake requests use Moonlight-compatible static delivery: the standard 102-byte magic packet is sent to the saved IP address (when supplied), the saved directed broadcast address, `255.255.255.255`, and every active local IPv4 interface broadcast address, on UDP ports `9` and `47009`. A custom `WOL_PORT` is included too when it differs from those ports.
- If a PC wakes from Moonlight but not this dashboard, capture a Moonlight wake attempt on the dashboard host or target subnet and compare its destinations and ports with the audit entry. Confirm that the dashboard host can route broadcasts to the target VLAN; broadcasts generally do not cross routers.
- Allow UDP port 9 (or the configured `WOL_PORT`) on the host and network path. The port may differ for a target environment.
- Enable Wake-on-LAN in each target's BIOS/UEFI and NIC/operating-system power settings.
- VLANs and routed subnets commonly block broadcasts. Place the service appropriately or configure network forwarding deliberately.
- Keep the dashboard on a trusted LAN. It intentionally has no authentication, so do not expose it on an untrusted network.
- Back up `data/wol.db` and `data/linkwarden-config-encryption.key` together; the database contains the device inventory, wake attempt audit trail, and encrypted integration credentials, including the Baikal password when configured.

## Checks

```sh
npm test
npm run check
npm run test:browser
```

The tests validate bounded CalDAV discovery, REPORT/XML/iCalendar handling, Basic/Digest authentication, configuration migration, scoped private-CA TLS and encrypted credentials, Home Assistant WebSocket handling, Wake-on-LAN packet handling, Linkwarden credential storage and migration, collection trees, bookmark caching, and API behavior. Browser tests verify the root photo dashboard, legacy redirects, saved preferences, desktop/mobile Settings, rendered service data, and fullscreen. Browser tests require development dependencies (`npm ci`) and Playwright Chromium (`npx playwright install chromium`). A safe packet-dispatch integration test requires a disposable UDP receiver on the deployment network.

## Home Assistant devices

Home Assistant is an optional backend integration with no controls on the photo dashboard. Existing connections remain saved. API clients can configure it through `PUT /api/home-assistant` with `url` (the instance origin, such as `http://homeassistant.local:8123`) and `accessToken` (a long-lived access token from the Home Assistant user profile). Use a dedicated non-admin Home Assistant user where practical and grant only the access needed for the entities you intend to read and control. The dashboard has no user accounts of its own and must remain restricted to a trusted LAN.

The dashboard server connects to Home Assistant's `/api/websocket`, authenticates there, and reads the device registry, area registry, display entity registry, and current states before closing the connection. `GET /api/home-assistant/devices` returns the saved display name, area, manufacturer, model, disabled state, current sensor readings, and eligible controls. Adding `?refresh=1` bypasses the short snapshot cache.

Readings include finite numeric `sensor` states such as temperature, humidity, pressure, battery, air quality, illuminance, moisture, energy, power, voltage, current, and signal strength. Home Assistant supplies the state and preferred unit; the API bounds and returns them without conversion or rounding. Diagnostic sensors are included, while hidden/config entities, disabled devices, orphaned sensors, arbitrary text/enum states, malformed values, and raw state attributes are excluded. `Unavailable` and `Unknown` sensors are returned explicitly.

Readings are cached snapshots updated during initial load, cache expiry, explicit refresh, and the refresh after a control action. They are not a live event stream or historical chart, and the dashboard does not calculate trends, thresholds, or alerts. Sensor rows are read-only and never receive control tokens.

On/off controls are available only for enabled, visible `light`, `switch`, `fan`, and `input_boolean` entities attached to a device-registry entry. Hidden, disabled, config/diagnostic, unavailable, unknown, orphaned, and unsupported entities cannot be controlled. Covers, locks, climate, media players, scenes, scripts, automations, brightness, color, speed, and arbitrary service data are intentionally unsupported.

API clients receive short-lived opaque control tokens instead of Home Assistant device or entity IDs. A control request can select only `turn_on` or `turn_off`; the server resolves its token and sends one fixed `call_service` command for the allowlisted entity. Mutating calls are never retried automatically. After Home Assistant accepts an action, clients should perform a separate forced refresh to read authoritative state. Acceptance confirms the service call completed, not that the physical device changed, and a later refresh failure does not undo or reclassify the accepted action.

The long-lived token is encrypted in `data/wol.db` with the same server key used for Linkwarden credentials. It is never returned to API clients. Send an empty `accessToken` to keep the saved token when the URL is unchanged; changing the URL requires a new token. A failed reconnect leaves the last working configuration intact. `DELETE /api/home-assistant` deletes the saved Home Assistant URL and token.

Normal certificate-chain and hostname verification applies to `https://` Home Assistant URLs. If Home Assistant uses a private CA, save only its public issuing CA/intermediate bundle and configure it before startup. For the supplied Compose service, set the dedicated `.env` variable and restart the container:

```sh
mkdir -p certs
cp /path/to/home-assistant-ca.pem certs/home-assistant-ca.pem
printf '\nHOME_ASSISTANT_CA_FILE=./certs/home-assistant-ca.pem\n' >> .env
docker compose up -d
```

For a direct Node run, use Node's native startup variable:

```sh
printf '\nNODE_EXTRA_CA_CERTS=./certs/home-assistant-ca.pem\n' >> .env
npm start
```

The PEM file must contain one or more CA certificates and no private key. A self-signed Home Assistant leaf certificate can be used only when that certificate is itself the trust anchor. The hostname in the configured Home Assistant URL must appear in the certificate's subject alternative names; adding the CA does not bypass hostname, expiration, or chain verification. Changing or rotating the bundle requires a full dashboard process restart because Node reads `NODE_EXTRA_CA_CERTS` only during initialization.

The supplied Compose service maps `HOME_ASSISTANT_CA_FILE` to Node's `NODE_EXTRA_CA_CERTS`; an explicitly supplied `NODE_EXTRA_CA_CERTS` remains a fallback for existing deployments. This augments trust for the whole Node process because the built-in WebSocket client has no per-connection CA option. Use the narrowest appropriate private CA. The existing read-only project mount makes `./certs/home-assistant-ca.pem` available at that path inside `/app`. For a CA outside the project, mount it read-only and use its container path.

If a connection fails, verify that the dashboard host can reach Home Assistant, the URL uses the certificate's exact DNS name or IP SAN, the full issuing chain is present, and the certificates and system clock are current. A trust error points to `NODE_EXTRA_CA_CERTS`; a hostname error requires correcting the URL or certificate rather than adding another CA. Node 24 may report some WebSocket TLS failures only as a generic network error, so check all of these items when no narrower category is available. Plain `http://` sends the token over the local network and should be used only on a network you trust. Keep the dashboard and Home Assistant LAN-only.

## Linkwarden bookmarks

Linkwarden is an optional backend integration with no bookmark interface on the photo dashboard. Existing connections remain saved and do not affect Home Assistant or Wake-on-LAN. The example environment configures the same persistent server-only encryption-key file for direct and Compose runs:

```sh
LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=./data/linkwarden-config-encryption.key npm start
```

Alternatively, generate a key once and provide that same value through the process environment on every run:

```sh
openssl rand -base64 32
```

Set that output as `LINKWARDEN_CONFIG_ENCRYPTION_KEY` and restart the service. API clients can connect through `PUT /api/linkwarden` with `url`, `username`, and a least-privilege `accessToken`. A successful connection validates access, encrypts the token in `data/wol.db`, and returns the available collection tree. `GET /api/linkwarden/collections` returns collections with short-lived opaque collection tokens instead of Linkwarden's numeric collection IDs. Use a token with `GET /api/bookmarks?collection=<collectionToken>` to load HTTP(S) URL records through Linkwarden's current search API; note, image, and archive-only records without a web URL are omitted. Each collection has an independent 60-second cache; add `&refresh=1` to refresh it explicitly. On a later reconnect, send an empty `accessToken` to retain the saved token. `DELETE /api/linkwarden` deletes the saved configuration and encrypted token.

The Linkwarden service must be reachable from the dashboard host. HTTPS certificate chains and hostnames are verified by default. If Linkwarden uses a private CA, save only the public CA bundle and configure it for these requests:

```sh
mkdir -p certs
cp /path/to/private-ca.pem certs/linkwarden-ca.pem
printf '\nLINKWARDEN_CA_FILE=./certs/linkwarden-ca.pem\n' >> .env
```

Unlike Home Assistant's process-wide `NODE_EXTRA_CA_CERTS`, the configured `LINKWARDEN_CA_FILE` extends trust only for Linkwarden requests; hostname verification remains enabled and other Node HTTPS traffic is unaffected. An unreadable or empty CA file stops startup with a configuration error. Protect and back up the database and encryption key together. Losing, deleting, or replacing the key makes saved credentials unrecoverable; changing it requires deliberately decrypting and re-encrypting the saved token while the old secret is available. A malformed or unreadable persisted key stops startup rather than silently replacing the secret. Existing saved URL, username, and encrypted-token data is retained when upgrading from the former single-collection configuration.

## Wake-on-LAN API

Wake-on-LAN remains a backend capability without controls on the photo dashboard. Existing devices and wake audit records remain saved. API clients can list devices with `GET /api/devices`, add them with `POST /api/devices`, and update or delete them through `/api/devices/<id>`. A device uses `name`, `macAddress`, `broadcastAddress`, and optional `ipAddress` and `group`. Set `broadcastAddress` to the target PC's directed subnet broadcast address, for example `192.168.1.255` for a PC at `192.168.1.42` on a `255.255.255.0` network. Use `POST /api/devices/<id>/wake` to request a wake packet. A successful response means the host sent the UDP magic packet; it does not prove that the target computer booted.
