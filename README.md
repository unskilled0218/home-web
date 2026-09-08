# LAN Wake

LAN Wake is a small, self-hosted Wake-on-LAN dashboard for a trusted local network. It has no accounts or internet-facing use case. A successful wake request means the host sent the UDP magic packet; it does not prove that the target computer booted.

## Run locally

This project requires Node.js 24 or later. No package installation is necessary.

```sh
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`, add devices, then send wake packets. For **Broadcast address**, enter the target PC's directed subnet broadcast address: for example, use `192.168.1.255` for a PC at `192.168.1.42` on a `255.255.255.0` network. The database is created at `data/wol.db` and should be backed up along with the configuration.

For another device on the LAN to reach the dashboard, set `HOST` to the server's explicit private address, such as `192.168.1.10`. Do not bind it to a public interface and do not expose the port through a router.

## Container deployment

The supplied `docker-compose.yml` uses the official Node image and host networking because UDP broadcast packets need to leave through the LAN interface. On Linux, set `HOST` to the host's private address before running:

```sh
HOST=192.168.1.10 docker compose up -d
```

Restrict port 3000 at the host firewall to the trusted LAN. If a reverse proxy is used, keep it LAN-only and pass requests directly to the private-bound application. Host networking behaves differently on Docker Desktop; run the service directly on the LAN host there.

## Operational checklist

- The service host must be able to route broadcasts to each target subnet. Enter the correct broadcast address for each device, for example `192.168.1.255`.
- Wake requests use Moonlight-compatible static delivery: the standard 102-byte magic packet is sent to the saved IP address (when supplied), the saved directed broadcast address, `255.255.255.255`, and every active local IPv4 interface broadcast address, on UDP ports `9` and `47009`. A custom `WOL_PORT` is included too when it differs from those ports.
- If a PC wakes from Moonlight but not this dashboard, capture a Moonlight wake attempt on the dashboard host or target subnet and compare its destinations and ports with the audit entry. Confirm that the dashboard host can route broadcasts to the target VLAN; broadcasts generally do not cross routers.
- Allow UDP port 9 (or the configured `WOL_PORT`) on the host and network path. The port may differ for a target environment.
- Enable Wake-on-LAN in each target's BIOS/UEFI and NIC/operating-system power settings.
- VLANs and routed subnets commonly block broadcasts. Place the service appropriately or configure network forwarding deliberately.
- Keep the dashboard on a trusted LAN. It intentionally has no authentication, so do not expose it on an untrusted network.
- Back up `data/wol.db`; it contains the device inventory and wake attempt audit trail.

## Checks

```sh
npm test
```

The tests validate MAC handling, IPv4 validation, and magic-packet construction. A safe packet-dispatch integration test requires a disposable UDP receiver on the deployment network.

## Linkwarden bookmarks

Bookmarks are optional and do not affect Wake-on-LAN. Before connecting Linkwarden, generate a server-only encryption secret and add it to the environment:

```sh
openssl rand -base64 32
```

Set that output as `LINKWARDEN_CONFIG_ENCRYPTION_KEY`, restart the service, then use **Bookmarks settings** to enter the Linkwarden base URL, username, and a least-privilege access token. Choose **List collections** to retrieve every collection available to that account and select one by name; numeric collection IDs are never shown. Linkwarden authenticates the remote request with the access token, while the username is stored as the dashboard's account label. The token is encrypted in `data/wol.db`; it is never returned to the browser. The dashboard requests only the selected collection through its own local endpoint, caches results for 60 seconds by default, and can refresh explicitly.

The Linkwarden service must be reachable from the dashboard host with valid TLS appropriate to the deployment. Back up the database and encryption secret together. Losing the secret makes saved credentials unrecoverable; changing it requires deliberately decrypting and re-encrypting the saved token while the old secret is available. Existing collection-ID configuration is retained but asks for re-authentication before it is used. Use **Disconnect** to delete the saved configuration and encrypted token.
