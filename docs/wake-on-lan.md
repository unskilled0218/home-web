# Wake-on-LAN

- [Wake-on-LAN](#wake-on-lan)
  - [Add a computer](#add-a-computer)
  - [Wake a computer](#wake-a-computer)
  - [Edit and sync](#edit-and-sync)
  - [API](#api)

## Add a computer

Open **Settings → Wake-on-LAN** and choose Global. Enter:

- Name, up to 80 characters.
- MAC address.
- Directed subnet broadcast address.
- Optional IPv4 address and group, up to 80 characters for the group.

Choose **Add device**. For `192.168.1.42` on a `255.255.255.0` subnet, the broadcast is `192.168.1.255`. Duplicate MAC addresses and invalid IPv4 addresses are rejected.

Devices and wake history are shared server records. Visibility, scale, and fullscreen preferences save separately with **Save Wake-on-LAN settings** and follow Local/Global scope.

## Wake a computer

Choose **Wake** beside its name on the dashboard. Requests occur only after explicit activation; there are no automatic wakes or retries. Each pending button is disabled independently.

Successful dispatch means packets were sent, not that the computer booted. After a timeout or network error, check the computer before retrying. See [operations](operations.md#wake-delivery) for BIOS, network, and packet checks.

## Edit and sync

Choose **Edit**, change fields, then **Save device**. Empty optional fields clear their saved values. **Cancel edit** discards the draft. **Delete** requires confirmation and removes both the device and its wake audit records.

Visible pages refresh devices about every five seconds. Polls preserve edits. If another browser changes a device, cancel and edit again to reload, or explicitly save your draft. Writes use last-successful-write semantics, not revision conflicts.

Failed saves keep the draft. After a timeout, check saved devices before retrying; the server may have committed.

## API

- `GET /api/devices`: List devices.
- `POST /api/devices`: Add a device.
- `PUT /api/devices/<id>`: Update a device.
- `DELETE /api/devices/<id>`: Delete a device and its audit records.
- `POST /api/devices/<id>/wake`: Send a wake packet.

Device fields are `name`, `macAddress`, `broadcastAddress`, and optional `ipAddress` and `group`. Dashboard and API wakes share cooldown and audit rules.

[Back to README](../README.md)
