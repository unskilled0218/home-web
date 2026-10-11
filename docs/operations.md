# Operational checklist

- The service host must be able to route broadcasts to each target subnet. Enter the correct broadcast address for each device, for example `192.168.1.255`.
- Wake requests use Moonlight-compatible static delivery: the standard 102-byte magic packet is sent to the saved IP address (when supplied), the saved directed broadcast address, `255.255.255.255`, and every active local IPv4 interface broadcast address, on UDP ports `9` and `47009`. A custom `WOL_PORT` is included too when it differs from those ports.
- If a PC wakes from Moonlight but not this dashboard, capture a Moonlight wake attempt on the dashboard host or target subnet and compare its destinations and ports with the audit entry. Confirm that the dashboard host can route broadcasts to the target VLAN; broadcasts generally do not cross routers.
- Allow UDP port 9 (or the configured `WOL_PORT`) on the host and network path. The port may differ for a target environment.
- Enable Wake-on-LAN in each target's BIOS/UEFI and NIC/operating-system power settings.
- VLANs and routed subnets commonly block broadcasts. Place the service appropriately or configure network forwarding deliberately.
- Keep the dashboard on a trusted LAN. It intentionally has no authentication, so do not expose it on an untrusted network.
- Back up `data/wol.db` and `data/linkwarden-config-encryption.key` together; the database contains the device inventory, wake attempt audit trail, and encrypted integration credentials, including the Baikal password when configured.

See [Wake-on-LAN API](wake-on-lan.md) for device management.

[Back to README](../README.md)
