# Operational checklist

- [Operational checklist](#operational-checklist)
  - [Server shutdown](#server-shutdown)

- The service host must be able to route broadcasts to each target subnet. Enter the correct broadcast address for each device, for example `192.168.1.255`.
- Wake requests use Moonlight-compatible static delivery: the standard 102-byte magic packet is sent to the saved IP address (when supplied), the saved directed broadcast address, `255.255.255.255`, and every active local IPv4 interface broadcast address, on UDP ports `9` and `47009`. A custom `WOL_PORT` is included too when it differs from those ports.
- If a PC wakes from Moonlight but not this dashboard, capture a Moonlight wake attempt on the dashboard host or target subnet and compare its destinations and ports with the audit entry. Confirm that the dashboard host can route broadcasts to the target VLAN; broadcasts generally do not cross routers.
- Allow UDP port 9 (or the configured `WOL_PORT`) on the host and network path. The port may differ for a target environment.
- Enable Wake-on-LAN in each target's BIOS/UEFI and NIC/operating-system power settings.
- VLANs and routed subnets commonly block broadcasts. Place the service appropriately or configure network forwarding deliberately.
- Keep the dashboard on a trusted LAN. It intentionally has no authentication, so do not expose it on an untrusted network.
- Back up `data/wol.db` and `data/linkwarden-config-encryption.key` together; the database contains the device inventory, wake attempt audit trail, and encrypted integration credentials, including the Baikal password when configured.

## Server shutdown

Ctrl+C/SIGINT and SIGTERM enter one shutdown path, including during asynchronous startup. Repeated signals do not start a second cleanup or a replacement server. Admission closes immediately; weather scheduling stops; handler promises are tracked separately from socket closure. SQLite closes only after startup, weather, and store-using handlers settle. Connections receive five seconds to drain before remaining owned sockets are destroyed. The overall deadline is 30 seconds; exceeding it forces this application process to exit nonzero without closing SQLite underneath runnable callbacks. Previously committed records remain persistent, but interrupted operations are not claimed completed.

A normal successful stop exits 0 and releases the port for immediate reuse. Startup/runtime/cleanup failure is nonzero. Development uses one polling/IPC supervisor rather than `node --watch`; it waits for child exit before restarting, and retains recoverable application failure until a corrected edit reaches readiness. Supervisor/spawn failure, native crash, failed cleanup, or unknown preparation ownership prevents automatic recovery. An owner IPC disconnect also requests child shutdown. An unresponsive child that cannot receive IPC or permitted OS signals is an operator-level cleanup blocker, not a successful stop.

Optional NFS with `NFS_MOUNT_MODE=on` and a nonempty `NFS_SOURCE` can create a separate preparation child. Its `execFile` timeout attempts a signal and does not prove the helper exited. The lifecycle tracks actual helper exit and rejects clean completion or replacement startup while ownership remains live/unknown. `NFS_MOUNT_MODE=off` and `on` with an empty source and safely pre-mounted directory create no preparation child. Where ordinary child termination is denied, use those configurations or ask the operator to provide that narrow capability; configuration is never silently rewritten and cleanup performs no new mount/unmount operations. Forced exit of the dashboard alone does not prove that a nested helper stopped.

See [local setup](local-setup.md) for direct launch commands when npm forwarding reports `EACCES`, and startup-only private-CA environment requirements. Do not suppress diagnostics, disable core dumps, or delete existing core files/logs as a shutdown fix.

See [Wake-on-LAN API](wake-on-lan.md) for device management.

[Back to README](../README.md)
