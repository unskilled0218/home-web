# Moonlight Wake-on-LAN parity plan

## Goal

Make the dashboard send the same standard UDP Wake-on-LAN signal that Moonlight uses for the selected device, so a PC that wakes from Moonlight also wakes from this service.

## Current finding

`src/wol.js` already builds the canonical 102-byte magic packet: six `FF` bytes followed by the target MAC address sixteen times. It enables UDP broadcast but sends only once to the device's stored broadcast address and configured port. Moonlight's documented/observed standard path sends that same packet as a UDP broadcast, normally to the host subnet broadcast address on port 9. The source code and a packet capture must establish the exact destination list, port selection, interface binding, and retry behavior of the Moonlight client the operator uses before implementation.

## Implementation sequence

1. Capture one successful Moonlight wake attempt on the same network and record the UDP destination address, destination port, payload bytes, packet count, spacing, source interface, and whether it uses the directed subnet broadcast, limited broadcast (`255.255.255.255`), or both.
2. Compare the capture with `createMagicPacket()` and `sendMagicPacket()` to identify the behavioral gap. Retain the existing MAC normalization and never change the packet payload unless the capture shows an authenticated/secure-on extension.
3. Extend the device/configuration model only as needed to represent Moonlight-equivalent delivery settings, with safe defaults for the observed network. Support an explicitly selected outbound interface or broadcast destination if automatic routing is unreliable in the deployment environment.
4. Update the sender to dispatch each required Moonlight-equivalent UDP datagram, await send completion, close sockets reliably, and return/audit a meaningful failure if no dispatch succeeds. Preserve the existing LAN-only API boundary and per-device cooldown.
5. Add unit tests for the exact payload plus destination/port/retry decisions, using an injected UDP socket or local UDP receiver. Add an integration test that compares the emitted datagrams with the saved Moonlight capture without transmitting beyond the test host.
6. Update the dashboard and README to explain the chosen broadcast/interface setting, clarify that a successful response confirms dispatch only, and include packet-capture troubleshooting steps for a PC that wakes from Moonlight but not this service.

## Acceptance criteria

- For the same MAC and network, the service emits the same number of UDP datagrams, destinations, ports, payload bytes, and materially equivalent timing as the captured Moonlight wake attempt.
- The existing valid 102-byte magic-packet behavior remains covered by automated tests.
- A failed send, invalid delivery setting, or unavailable interface produces an actionable, non-sensitive API/UI error and audit record.
- The implementation does not broaden the service's LAN-only access policy or claim that packet dispatch proves that the PC powered on.
