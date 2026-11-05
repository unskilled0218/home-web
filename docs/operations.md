# Operations

- [Operations](#operations)
  - [Network safety](#network-safety)
  - [Backups](#backups)
  - [Wake delivery](#wake-delivery)
  - [Shutdown](#shutdown)

## Network safety

The dashboard has no authentication. Keep it on a trusted LAN, restrict its port, and use exact allowed hostnames. Do not expose it to the internet.

## Backups

Back up `data/wol.db` and `data/linkwarden-config-encryption.key` together, plus your private configuration. Use configured paths instead if overridden. If the key comes from an environment secret, preserve that same secret securely.

Stop the service cleanly before copying SQLite, or use a SQLite-aware backup method. The database contains devices, wake history, settings, and encrypted integration credentials. A database without its original key cannot recover those credentials.

Keep backups private and retain a matching data backup before image upgrades. Image rollback does not reverse migrations.

## Wake delivery

- Enable Wake-on-LAN in the target's BIOS/UEFI, NIC, and operating-system power settings.
- Set the correct directed broadcast address, such as `192.168.1.255` for a `/24` subnet.
- Allow the required UDP traffic. VLANs and routers usually block broadcasts; configure routing deliberately.

The server sends the standard 102-byte magic packet to the saved IP when present, the saved broadcast, `255.255.255.255`, and active local IPv4 interface broadcasts. It uses UDP ports `9` and `47009`, plus `WOL_PORT` if different.

If Moonlight wakes a PC but the dashboard does not, compare packet destinations and ports with the wake audit record. Confirm the dashboard host can reach the target subnet. Sending successfully does not prove the PC booted.

## Shutdown

Use Ctrl+C for development and SIGTERM for production/containers. The server stops new requests, cancels scheduled work, drains handlers and scans, then closes SQLite. HTTP connections get five seconds to drain; the overall application deadline is 30 seconds. The development supervisor waits up to 35 seconds before reporting failure.

A clean stop exits 0 and releases the port. Failed or forced cleanup exits nonzero. Repeated signals do not start another cleanup or replacement server. See [local setup](local-setup.md#development) for npm signal and `kill EACCES` limitations.

NFS mount helpers and filesystem work must actually finish before clean shutdown can be confirmed. A timeout or parent exit does not prove a child or kernel operation stopped. If signal permission is denied, use disabled NFS or a safely pre-mounted source, or ask the operator for narrow assistance.

Do not hide diagnostics, delete existing core files/logs, or broadly kill processes as a shutdown fix. See [NFS troubleshooting](nfs-backgrounds.md#troubleshooting).

[Back to README](../README.md)
