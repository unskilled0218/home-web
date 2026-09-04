# Wake-on-LAN dashboard plan

## Goal

Deliver a web application that lets an authorized user send Wake-on-LAN magic packets to several configured PCs from one clear, reliable dashboard.

## Scope and decisions

- Build a small full-stack service: browser dashboard, server-side API, and a persistent device configuration store.
- Keep MAC addresses, broadcast addresses, labels, and optional host metadata on the server; never construct or transmit magic packets in the browser.
- Require authentication before exposing device data or allowing a wake action; use secure cookies, CSRF protection for state-changing requests, rate limits, and audit records.
- Treat a successful API response as packet dispatch, not proof that a sleeping machine powered on; reflect that distinction in the interface.

## Implementation sequence

1. Select the project runtime and framework, create the application structure, environment-variable template, linting, formatting, and test commands.
2. Define the device model (`id`, `name`, `macAddress`, `broadcastAddress`, optional `ipAddress`, `group`, `lastWakeRequestedAt`) and validation rules; provide an initial migration and a safe administrator-managed seed/import path.
3. Implement the authenticated device-list API and a protected `POST /devices/:id/wake` endpoint that validates authorization and device data, creates a standards-compliant magic packet, sends it through a configured UDP socket, records the attempt, and returns dispatch status without leaking internal network details.
4. Add safeguards: request throttling per user/device, structured audit logging, normalized MAC-address parsing, clear handling for invalid addresses, unavailable network interfaces, UDP errors, and duplicate rapid requests.
5. Build the responsive dashboard with grouped/searchable device cards or rows, a one-click wake control, disabled/loading/success/failure states, accessible labels and keyboard operation, and a clear notice that dispatch does not confirm boot completion.
6. Add device-management controls for authorized administrators to create, edit, remove, and organize entries, with confirmation before destructive actions and full server-side validation.
7. Test packet construction and validation unit cases, API authorization and error paths, and browser flows for waking a single device, several selected devices, empty/error states, and accessibility; include a development-only UDP receiver/integration test where practical.
8. Document deployment requirements: host placement on a network that can route broadcasts to the targets, configurable UDP port/interface/broadcast policy, HTTPS and session-secret configuration, database backup, log retention, and operational limitations such as BIOS/NIC WoL settings and VLAN boundaries.

## Acceptance criteria

- An authenticated user can see only permitted configured PCs and dispatch a wake request for one or more selected PCs.
- The server emits a valid magic packet for every accepted request and reports whether dispatch succeeded or failed.
- Invalid configuration, unauthorized access, repeat-request throttling, and network send failures produce actionable, non-sensitive UI and API responses.
- Administrators can manage the device inventory without source-code changes.
- Automated tests cover the packet, security boundary, and primary dashboard behavior, and setup/deployment documentation enables a maintainer to run the service safely.
