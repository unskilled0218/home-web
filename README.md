# LAN Wake

LAN Wake is a small, self-hosted Wake-on-LAN dashboard for a trusted local network. It has no accounts or internet-facing use case. A successful wake request means the host sent the UDP magic packet; it does not prove that the target computer booted.

## Run locally

This project requires Node.js 24 or later. No package installation is necessary.

```sh
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`, add devices, then send wake packets. The database is created at `data/wol.db` and should be backed up along with the configuration.

For another device on the LAN to reach the dashboard, set `HOST` to the server's explicit private address, such as `192.168.1.10`. Do not bind it to a public interface and do not expose the port through a router.

## Container deployment

The supplied `docker-compose.yml` uses the official Node image and host networking because UDP broadcast packets need to leave through the LAN interface. On Linux, set `HOST` to the host's private address before running:

```sh
HOST=192.168.1.10 docker compose up -d
```

Restrict port 3000 at the host firewall to the trusted LAN. If a reverse proxy is used, keep it LAN-only and pass requests directly to the private-bound application. Host networking behaves differently on Docker Desktop; run the service directly on the LAN host there.

## Operational checklist

- The service host must be able to route broadcasts to each target subnet. Enter the correct broadcast address for each device, for example `192.168.1.255`.
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
