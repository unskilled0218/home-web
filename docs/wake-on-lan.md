# Wake-on-LAN API

Wake-on-LAN remains a backend capability without controls on the photo dashboard. Existing devices and wake audit records remain saved. API clients can list devices with `GET /api/devices`, add them with `POST /api/devices`, and update or delete them through `/api/devices/<id>`. A device uses `name`, `macAddress`, `broadcastAddress`, and optional `ipAddress` and `group`. Set `broadcastAddress` to the target PC's directed subnet broadcast address, for example `192.168.1.255` for a PC at `192.168.1.42` on a `255.255.255.0` network. Use `POST /api/devices/<id>/wake` to request a wake packet. A successful response means the host sent the UDP magic packet; it does not prove that the target computer booted.

See the [Operational checklist](operations.md) for network setup, packet delivery, and troubleshooting.

[Back to README](../README.md)
