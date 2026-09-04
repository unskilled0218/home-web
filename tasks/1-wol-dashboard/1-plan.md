# Wake-on-LAN dashboard plan

## Goal

Deliver a self-hosted web application for a trusted local LAN that sends Wake-on-LAN magic packets to several configured PCs from one clear, reliable dashboard, without user accounts or sign-in.

## Scope and decisions

- Build a small self-hosted full-stack service: browser dashboard, server-side API, and a persistent device configuration store.
- Keep MAC addresses, broadcast addresses, labels, and optional host metadata on the server; never construct or transmit magic packets in the browser.
- Do not implement users, roles, sessions, or authentication; the application is intended only for a trusted LAN.
- Bind the service to the local/private network interface only, document firewall or reverse-proxy network restrictions, reject non-LAN origins where applicable, rate-limit dispatches per device, and retain lightweight audit records.
- Treat a successful API response as packet dispatch, not proof that a sleeping machine powered on; reflect that distinction in the interface.

## Implementation sequence

1. Select the project runtime and framework, create the application structure, environment-variable template, linting, formatting, and test commands.
2. Define the device model (`id`, `name`, `macAddress`, `broadcastAddress`, optional `ipAddress`, `group`, `lastWakeRequestedAt`) and validation rules; provide an initial migration and a local seed/import path.
3. Implement the device-list API and a LAN-only `POST /devices/:id/wake` endpoint that validates device data, creates a standards-compliant magic packet, sends it through a configured UDP socket, records the attempt, and returns dispatch status without leaking unnecessary network details.
4. Add safeguards appropriate to a trusted LAN: per-device request throttling, structured audit logging, normalized MAC-address parsing, origin checks, clear handling for invalid addresses, unavailable network interfaces, UDP errors, and duplicate rapid requests.
5. Build the responsive dashboard with grouped/searchable device cards or rows, a one-click wake control, disabled/loading/success/failure states, accessible labels and keyboard operation, and a clear notice that dispatch does not confirm boot completion.
6. Add local device-management controls to create, edit, remove, and organize entries, with confirmation before destructive actions and full server-side validation.
7. Test packet construction and validation unit cases, LAN-only API and error paths, and browser flows for waking a single device, several selected devices, empty/error states, and accessibility; include a development-only UDP receiver/integration test where practical.
8. Document local deployment requirements: host placement on a network that can route broadcasts to the targets, binding only to a private interface, firewall or reverse-proxy LAN access restrictions, configurable UDP port/interface/broadcast policy, database backup, log retention, and operational limitations such as BIOS/NIC WoL settings and VLAN boundaries.

## Acceptance criteria

- Any device on the trusted local LAN can view configured PCs and dispatch a wake request for one or more selected PCs; no account is required.
- The server emits a valid magic packet for every accepted request and reports whether dispatch succeeded or failed.
- Invalid configuration, unauthorized access, repeat-request throttling, and network send failures produce actionable, non-sensitive UI and API responses.
- A local operator can manage the device inventory without source-code changes.
- Automated tests cover the packet, security boundary, and primary dashboard behavior, and setup/deployment documentation enables a maintainer to run the service safely.
