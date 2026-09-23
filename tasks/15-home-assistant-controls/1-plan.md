# Task 15: Control Home Assistant Devices

## Objective

Add safe on/off controls to the existing Home Assistant device cards. Associate controllable Home Assistant entities with their registry devices, show current power state, and let a trusted-LAN user send explicit turn-on or turn-off actions without exposing the long-lived token or allowing arbitrary Home Assistant service calls.

## Product Decisions

- Home Assistant registry devices are metadata containers and do not have a universal power action. Controls therefore target enabled entities associated with each device.
- The first control scope is binary power for the standard `light`, `switch`, `fan`, and `input_boolean` domains. Covers, locks, climate, media players, scenes, scripts, automations, numeric settings, brightness, color, speed, and arbitrary services are out of scope because their state and safety semantics differ.
- Each eligible entity appears as a separate control on its parent device card. A device with no eligible entities remains visible as a read-only card.
- Only `on` and `off` states are actionable. `unavailable`, `unknown`, missing, or malformed states are displayed but cannot be controlled.
- Disabled devices, disabled entities, hidden entities, and config/diagnostic entities receive no controls.
- A successful action means Home Assistant accepted and completed the service call. The dashboard refreshes afterward to display Home Assistant's resulting state; it does not claim the physical device changed when Home Assistant reports stale or unavailable state.
- The browser never receives registry device IDs or entity IDs and cannot choose a service domain, service name, target, or service data.

## Implementation Plan

### 1. Extend the bounded Home Assistant snapshot

- Expand the authenticated snapshot in `src/home-assistant.js` to request and correlate four bounded commands:
  - `config/device_registry/list`;
  - `config/area_registry/list`;
  - `config/entity_registry/list_for_display`;
  - `get_states`.
- Keep accepting out-of-order result messages by command ID and close the socket only after all required results arrive or a terminal error occurs.
- Validate the display-registry response shape, state array, command success flags, message sizes, and entry-count limits before normalization. Count entity and state inputs independently so one oversized upstream list cannot bypass the existing bound.
- Update the local TLS WebSocket fixture and injected fake sockets to answer the additional commands without weakening the existing authentication, timeout, malformed-message, cleanup, and private-CA coverage.

### 2. Normalize devices with internal control targets

- Extend `normalizeHomeAssistantDevices()` or replace it with a focused snapshot normalizer that joins:
  - entity display entry `di` to device registry `id`;
  - state `entity_id` to entity display entry `ei`;
  - device/area metadata through the existing area mapping.
- Retain device and entity identifiers only in the server-side normalized/cache shape so the application layer can authorize controls; remove them before every browser response.
- Build controls only when all of the following hold:
  - the parent device is valid and not disabled;
  - the entity belongs to `light`, `switch`, `fan`, or `input_boolean`;
  - the entity is enabled, not hidden, and has no config/diagnostic entity category;
  - a matching state exists.
- Normalize each control to bounded internal fields: entity ID, fixed domain, safe display name, and `on`, `off`, `unavailable`, or `unknown` state. Prefer a bounded state `friendly_name`, then the entity-registry display name, then a readable bounded entity-object fallback.
- Sort controls by display name and preserve the existing deterministic device area/name sorting. Include control names in browser search matching.
- Continue omitting connections, config-entry IDs, raw attributes, icons, upstream error payloads, and every unknown field.

### 3. Add a fixed service-call operation

- Add `controlEntity(settings, target, action)` to the Home Assistant client using a short-lived authenticated WebSocket request.
- Accept only a server-resolved target whose domain is in the fixed allowlist and only `turn_on` or `turn_off` actions.
- Send exactly one documented Home Assistant command:

```json
{
  "id": 1,
  "type": "call_service",
  "domain": "light",
  "service": "turn_on",
  "target": { "entity_id": "light.office" }
}
```

- Require the matching successful `result`, then close the socket and clear the cached snapshot. Treat command failure, malformed/duplicate/out-of-order responses, timeout, premature close, authentication rejection, and TLS/connectivity errors through the existing safe Home Assistant error boundary.
- Do not forward Home Assistant's raw service error message or response object. Return a fixed action failure message and never retry a mutating service call automatically.

### 4. Authorize controls with opaque server tokens

- Add a bounded in-memory Home Assistant control-token store following the existing opaque Linkwarden collection-selection pattern.
- When serializing a device snapshot for the browser, replace every internal entity ID/domain pair with a cryptographically random control token. Bind each token to:
  - the exact saved Home Assistant configuration fingerprint;
  - the entity ID and fixed domain;
  - a short expiration time.
- Return only `{ controlToken, name, state, available }` for each control. Never return the entity ID, device ID, domain, platform, attributes, or token fingerprint.
- Resolve tokens only against the currently saved/decrypted Home Assistant settings. Reject missing, malformed, expired, evicted, or configuration-mismatched tokens without contacting Home Assistant.
- Clear all Home Assistant control tokens on reconnect and disconnect. Bound capacity for large installations and test expiry, eviction, collision handling, and cross-configuration rejection.
- Keep explicit `turn_on`/`turn_off` actions idempotent. Track each token while an action is in flight and reject a duplicate concurrent submission so double clicks cannot issue parallel service calls.

### 5. Add a narrow control API

- Inject the control-token store through `createDashboardServer()` for deterministic tests while constructing the production default at the server composition boundary.
- Add `POST /api/home-assistant/controls/:controlToken` under the existing private-address, Host, and Origin protections.
- Require a bounded JSON body containing only `{ "action": "turn_on" }` or `{ "action": "turn_off" }`; reject unknown properties and unsupported actions before resolving or contacting Home Assistant.
- Require readable saved credentials, resolve the opaque token against the current configuration fingerprint, invoke `controlEntity()`, and return a fixed success message after Home Assistant confirms the call.
- Keep action success separate from the subsequent snapshot refresh: the control route must not report failure after a service call has succeeded merely because a refresh fails.
- Use clear status classes: 400 for malformed input, 404 for an invalid or expired control token without revealing which case occurred, 409 for an action already in flight, and 503 for safe Home Assistant connection/action failures.
- Ensure failed actions never alter saved credentials or affect Linkwarden and Wake-on-LAN behavior.

### 6. Add accessible controls to device cards

- Update the Home Assistant section description so it no longer claims the integration is read-only.
- Render a compact control list inside each device card, with the normalized entity name, visible state text, and a button labelled **Turn on** or **Turn off**.
- Use native buttons, associate each button with its entity label, expose current `on` state with `aria-pressed`, and disable controls when unavailable or while their request is pending.
- On activation:
  1. mark only that control pending and prevent duplicate clicks;
  2. post the explicit desired action using its opaque token;
  3. announce Home Assistant's acceptance in the existing section status;
  4. force a separate device refresh to retrieve authoritative state and fresh control tokens;
  5. retain an accurate "action sent, refresh failed" distinction if the service succeeded but the follow-up snapshot fails.
- Guard action and refresh completions with the existing Home Assistant request generations so a stale result cannot repopulate controls after disconnect/reconnect.
- Render all upstream names and states with text properties only. Do not render entity IDs, accept arbitrary action data, or use optimistic state as authoritative.
- Extend current responsive styles minimally for control rows, pending buttons, on/off emphasis, and unavailable state without horizontal overflow on narrow screens.

### 7. Expand automated coverage

- Extend Home Assistant normalization tests for entity/device/state joining, each allowed domain, multiple controls per device, naming fallback, state mapping, sorting, and search.
- Prove disabled devices/entities, hidden entities, config/diagnostic entities, unsupported domains, orphan entities, missing states, duplicate IDs, malformed records, and oversized lists cannot create actionable controls.
- Extend WebSocket tests to cover four-command snapshot correlation and exact `call_service` payloads for both actions and every allowed domain.
- Test rejection of arbitrary domains, service names, entity IDs, service data, duplicate results, auth failures, command failures, timeout, close, and malformed messages. Assert raw access tokens, targets, and upstream errors never appear in public errors.
- Add control-token store tests for random issuance, expiry, capacity eviction, collision retries, fingerprint binding, and clear-on-configuration-change behavior.
- Extend API tests for:
  - public snapshots containing opaque control tokens but no Home Assistant IDs;
  - successful on/off control calls;
  - malformed bodies and extra fields;
  - forged, expired, and cross-configuration tokens;
  - concurrent duplicate suppression;
  - safe upstream failures;
  - successful action followed by independent refresh failure;
  - reconnect/disconnect invalidation;
  - unchanged encrypted credentials.
- Extend browser-helper and static-markup tests for control search, pending-state handling, accessible labels/pressed state, stale response suppression, section copy, and unique IDs.
- Keep tests dependency-free with `node:test`; update the secure WebSocket fixture rather than adding a WebSocket package.

### 8. Documentation and release update

- Update `README.md` to explain that control applies to eligible entities attached to device-registry entries, list the four supported domains, and document unsupported control types.
- Explain the `call_service` flow, explicit targeting, opaque browser tokens, post-action refresh, and the distinction between action acceptance and observed physical state.
- Replace the prior read-only/least-privilege guidance with accurate permissions guidance: use a dedicated non-admin Home Assistant user where practical, grant only the access needed for the intended entities, and understand that the dashboard has no accounts and is for a trusted LAN only.
- Retain the existing custom-CA, encrypted-token, backup, TLS, and disconnect guidance.
- Add `tasks/15-home-assistant-controls/3-implemented.md` during implementation with design decisions, changed files, and exact verification evidence.
- Bump the minor version from `0.9.1` to `0.10.0` after implementation and verification pass.

## Verification

Run from the repository root:

```bash
npm test
npm run check
git diff --check
```

Also verify:

1. Connect to a representative fixture containing controllable and non-controllable entities; confirm only eligible controls appear under the correct device and no registry/entity IDs reach the browser.
2. Turn each supported domain on and off; confirm the exact fixed service call, one mutation per click, action status announcement, cache invalidation, and authoritative follow-up refresh.
3. Confirm unavailable/unknown, hidden, disabled, diagnostic/config, unsupported, orphaned, and malformed entities cannot be controlled.
4. Attempt forged tokens, stale tokens, tokens from an old Home Assistant configuration, extra JSON fields, unsupported actions, and rapid duplicate requests; confirm no service call occurs.
5. Confirm service rejection, authentication failure, timeout, disconnect, malformed response, TLS failure, and refresh-after-success failure produce accurate safe messages without leaking tokens, entity IDs, or upstream payloads.
6. Disconnect or reconnect while an action/refresh is pending and confirm stale controls/results do not reappear and saved credentials remain atomic.
7. Keyboard-test entity controls, focus behavior, disabled/pending states, `aria-pressed`, live status announcements, search, and narrow-screen layout.
8. Confirm Linkwarden, Wake-on-LAN, Home Assistant private-CA trust, and the existing read/cache/disconnect flows remain unchanged.
9. Against a real Home Assistant instance when available, verify current `list_for_display`, `get_states`, and `call_service` compatibility using a dedicated non-admin token.
10. If Docker is available, run `docker compose config` and exercise one control through the container. Record Docker or real-Home-Assistant unavailability rather than claiming those checks passed.

## Acceptance Criteria

- Device cards display current state and on/off controls for enabled `light`, `switch`, `fan`, and `input_boolean` entities associated with each device.
- The dashboard sends only fixed `turn_on` or `turn_off` service calls to a server-resolved allowlisted entity; the browser cannot select arbitrary Home Assistant targets or services.
- Browser responses contain opaque expiring control tokens and safe display fields, never Home Assistant device/entity IDs, credentials, raw attributes, or upstream payloads.
- Unavailable, unknown, hidden, disabled, diagnostic/config, unsupported, orphaned, malformed, and oversized records cannot produce actionable controls.
- Duplicate submissions are contained, mutating calls are never automatically retried, and action acceptance is not confused with physical-state confirmation or refresh success.
- Reconnect and disconnect invalidate old controls, and asynchronous action/refresh responses cannot restore stale state.
- Existing credentials, custom-CA trust, Home Assistant snapshot caching, Linkwarden, and Wake-on-LAN behavior remain intact.
- Automated tests cover normalization, protocol, token authorization, API behavior, frontend concurrency/accessibility, and regressions.
- Documentation, implementation record, and version `0.10.0` match the delivered behavior.
