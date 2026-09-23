# dashboard

dashboard is a small, self-hosted website for Home Assistant devices, Linkwarden bookmarks, and Wake-on-LAN controls on a trusted local network. It has no accounts or internet-facing use case. A successful wake request means the host sent the UDP magic packet; it does not prove that the target computer booted.

## Run locally

This project requires Node.js 24 or later. No package installation is necessary.

```sh
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000` to connect Home Assistant or Linkwarden, or to add Wake-on-LAN devices. For **Broadcast address**, enter the target PC's directed subnet broadcast address: for example, use `192.168.1.255` for a PC at `192.168.1.42` on a `255.255.255.0` network. The database is created at `data/wol.db` and should be backed up along with the configuration.

`npm start`, `npm run start:lan`, and `npm run dev` use Node's native optional env-file support to load the repository-root `.env` before the process initializes. Values already supplied by the process environment take precedence, and the file is optional. Loading before initialization is required for TLS settings such as `NODE_EXTRA_CA_CERTS`. `start:lan` uses the same safety checks as `start`; configure the explicit private `HOST` address and any browser-facing `DASHBOARD_ALLOWED_HOSTS` in `.env` rather than enabling an unrestricted wildcard bind.

For another device on the LAN to reach the dashboard, set `HOST` to the server's explicit private address, such as `192.168.1.10`. That address is accepted automatically as an HTTP Host. If the browser uses a private DNS name instead, also set `DASHBOARD_ALLOWED_HOSTS` to that hostname. Do not bind the service to a public interface or expose its port through a router.

## Container deployment

The supplied `docker-compose.yml` uses the official Node image and host networking because UDP broadcast packets need to leave through the LAN interface. It automatically creates the integration-credential encryption key at `data/linkwarden-config-encryption.key` on first startup and reuses it after container recreation. No encryption secret must be configured before a fresh Compose deployment. On Linux, set `HOST` to the host's private address before running:

```sh
HOST=192.168.1.10 docker compose up -d
```

For private DNS, list the exact hostname used in the browser:

```sh
HOST=192.168.1.10 DASHBOARD_ALLOWED_HOSTS=home.lan docker compose up -d
```

`DASHBOARD_ALLOWED_HOSTS` is a comma-separated list of hostnames or IP addresses without schemes, ports, paths, or wildcards. Every API request must use either the configured `HOST` address or one of these names. If a reverse proxy is used, keep it LAN-only, preserve the browser-facing Host header, and list that hostname. Do not allow arbitrary Host values or trust forwarded-host headers because that would reintroduce DNS-rebinding access. A wildcard bind such as `0.0.0.0` or `::` requires at least one explicit allowed host.

Restrict port 3000 at the host firewall to the trusted LAN. Host networking behaves differently on Docker Desktop; run the service directly on the LAN host there.

To retain an existing externally managed key, set `LINKWARDEN_CONFIG_ENCRYPTION_KEY` in Compose's `.env` file before the first startup. The legacy variable name is retained for compatibility, but the key encrypts both Linkwarden and Home Assistant credentials. An explicit key takes precedence and the automatic key file is not created. Keep using the same value after every restart.

The project directory is mounted read-only at `/app`, so optional CA bundles under `./certs` are available to both direct runs and Compose under the same relative paths. Keep these files out of version control; `certs/` is ignored. For a CA stored elsewhere, add a read-only bind mount in a Compose override and set the relevant CA variable to its container path.

## Operational checklist

- The service host must be able to route broadcasts to each target subnet. Enter the correct broadcast address for each device, for example `192.168.1.255`.
- Wake requests use Moonlight-compatible static delivery: the standard 102-byte magic packet is sent to the saved IP address (when supplied), the saved directed broadcast address, `255.255.255.255`, and every active local IPv4 interface broadcast address, on UDP ports `9` and `47009`. A custom `WOL_PORT` is included too when it differs from those ports.
- If a PC wakes from Moonlight but not this dashboard, capture a Moonlight wake attempt on the dashboard host or target subnet and compare its destinations and ports with the audit entry. Confirm that the dashboard host can route broadcasts to the target VLAN; broadcasts generally do not cross routers.
- Allow UDP port 9 (or the configured `WOL_PORT`) on the host and network path. The port may differ for a target environment.
- Enable Wake-on-LAN in each target's BIOS/UEFI and NIC/operating-system power settings.
- VLANs and routed subnets commonly block broadcasts. Place the service appropriately or configure network forwarding deliberately.
- Keep the dashboard on a trusted LAN. It intentionally has no authentication, so do not expose it on an untrusted network.
- Back up `data/wol.db` and `data/linkwarden-config-encryption.key` together; the database contains the device inventory, wake attempt audit trail, and encrypted integration credentials.

## Checks

```sh
npm test
npm run check
```

The tests validate Home Assistant WebSocket handling, private-CA TLS, and encrypted credentials, Wake-on-LAN packet handling, Linkwarden credential storage and migration, collection trees, bookmark caching, API behavior, and scoped Linkwarden private-CA TLS. A safe packet-dispatch integration test requires a disposable UDP receiver on the deployment network.

## Home Assistant devices

Home Assistant is optional and read-only. Open **Home Assistant settings**, enter the instance origin such as `http://homeassistant.local:8123`, and provide a long-lived access token from the Home Assistant user profile. Prefer a dedicated Home Assistant user with only the access needed to read the device and area registries.

The dashboard server connects to Home Assistant's `/api/websocket`, authenticates there, reads `config/device_registry/list` and `config/area_registry/list`, and closes the connection after receiving the snapshot. Device cards show the saved display name, area, manufacturer, model, and disabled state. They do not show an online/offline claim and cannot control entities, call services, change automations, or import devices into Wake-on-LAN. **Refresh** bypasses the short snapshot cache.

The long-lived token is encrypted in `data/wol.db` with the same server key used for Linkwarden credentials. It is never returned to the browser or prefilled after saving. Leave the token field blank to keep the saved token when the URL is unchanged; changing the URL requires a new token. A failed reconnect leaves the last working configuration intact. **Disconnect** deletes the saved Home Assistant URL and token.

Normal certificate-chain and hostname verification applies to `https://` Home Assistant URLs. If Home Assistant uses a private CA, save only its public issuing CA/intermediate bundle and configure Node to load it before startup:

```sh
mkdir -p certs
cp /path/to/home-assistant-ca.pem certs/home-assistant-ca.pem
printf '\nNODE_EXTRA_CA_CERTS=./certs/home-assistant-ca.pem\n' >> .env
npm start
```

The PEM file must contain one or more CA certificates and no private key. A self-signed Home Assistant leaf certificate can be used only when that certificate is itself the trust anchor. The hostname in the configured Home Assistant URL must appear in the certificate's subject alternative names; adding the CA does not bypass hostname, expiration, or chain verification. Changing or rotating the bundle requires a full dashboard process restart because Node reads `NODE_EXTRA_CA_CERTS` only during initialization.

`NODE_EXTRA_CA_CERTS` augments trust for the whole Node process because the built-in WebSocket client has no per-connection CA option. Use the narrowest appropriate private CA. The supplied Compose service forwards the same variable, and the existing read-only project mount makes `./certs/home-assistant-ca.pem` available at that path inside `/app`. For a CA outside the project, mount it read-only and use its container path.

If a connection fails, verify that the dashboard host can reach Home Assistant, the URL uses the certificate's exact DNS name or IP SAN, the full issuing chain is present, and the certificates and system clock are current. A trust error points to `NODE_EXTRA_CA_CERTS`; a hostname error requires correcting the URL or certificate rather than adding another CA. Node 24 may report some WebSocket TLS failures only as a generic network error, so check all of these items when no narrower category is available. Plain `http://` sends the token over the local network and should be used only on a network you trust. Keep the dashboard and Home Assistant LAN-only.

## Linkwarden bookmarks

Bookmarks are optional and do not affect Home Assistant or Wake-on-LAN. The example environment configures the same persistent server-only encryption-key file for direct and Compose runs:

```sh
LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=./data/linkwarden-config-encryption.key npm start
```

Alternatively, generate a key once and provide that same value through the process environment on every run:

```sh
openssl rand -base64 32
```

Set that output as `LINKWARDEN_CONFIG_ENCRYPTION_KEY` and restart the service. Open **Bookmarks settings**, enter the Linkwarden base URL, username, and a least-privilege access token, then choose **Connect**. A successful connection validates access, encrypts the token in `data/wol.db`, and immediately displays every available collection as a tree. Select any collection in the tree to load its HTTP(S) URL records through Linkwarden's current search API; note, image, and archive-only records without a web URL are omitted. Each collection has an independent 60-second cache and can be refreshed explicitly. The browser receives short-lived opaque collection tokens instead of Linkwarden's numeric collection IDs. On a later reconnect, leave the access-token field blank to retain the saved token. Use **Disconnect** beside the collection tree to delete the saved configuration and encrypted token.

The Linkwarden service must be reachable from the dashboard host. HTTPS certificate chains and hostnames are verified by default. If Linkwarden uses a private CA, save only the public CA bundle and configure it for these requests:

```sh
mkdir -p certs
cp /path/to/private-ca.pem certs/linkwarden-ca.pem
printf '\nLINKWARDEN_CA_FILE=./certs/linkwarden-ca.pem\n' >> .env
```

Unlike Home Assistant's process-wide `NODE_EXTRA_CA_CERTS`, the configured `LINKWARDEN_CA_FILE` extends trust only for Linkwarden requests; hostname verification remains enabled and other Node HTTPS traffic is unaffected. An unreadable or empty CA file stops startup with a configuration error. Protect and back up the database and encryption key together. Losing, deleting, or replacing the key makes saved credentials unrecoverable; changing it requires deliberately decrypting and re-encrypting the saved token while the old secret is available. A malformed or unreadable persisted key stops startup rather than silently replacing the secret. Existing saved URL, username, and encrypted-token data is retained when upgrading from the former single-collection configuration.
