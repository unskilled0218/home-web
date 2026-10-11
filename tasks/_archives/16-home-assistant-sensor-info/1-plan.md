# Task 16: Display Home Assistant Sensor Information

## Objective

Show safe read-only measurements such as temperature, humidity, pressure, battery, air quality, power, and similar numeric Home Assistant sensor values on their parent device cards. Reuse the existing bounded entity/state snapshot, preserve the narrow control allowlist, and prevent raw attributes, identifiers, or arbitrary textual sensor data from reaching the browser.

## Product Decisions

- Sensor information comes from enabled `sensor` entities associated with a device-registry entry.
- The first version displays finite numeric states and the special `unavailable` or `unknown` states. Arbitrary textual/enum states are excluded because they may contain unbounded or sensitive integration-specific data and need domain-specific presentation.
- Use Home Assistant's current state string and `unit_of_measurement` as supplied. Home Assistant has already applied its configured unit preferences, so the dashboard will not convert, round, or reinterpret values.
- Temperature and humidity are examples, not a hardcoded pair. Any valid numeric `sensor` entity may appear, including pressure, battery, illuminance, moisture, CO2, particulate matter, energy, power, voltage, current, and signal strength.
- Hidden entities and entities categorized as `config` are excluded. Diagnostic sensors are included because battery and signal measurements commonly use that category.
- Disabled devices receive no readings. Devices without eligible readings remain visible with their existing metadata and controls.
- Sensor information remains snapshot-based and updates on initial load, cache expiry, explicit refresh, or the existing post-control refresh. Live subscriptions, history, trends, charts, thresholds, alerts, climate attributes, `binary_sensor` states, and sensor selection settings are out of scope.

## Implementation Plan

### 1. Normalize safe sensor measurements

- Extend the existing entity/state join in `src/home-assistant.js`; do not add another Home Assistant command because `config/entity_registry/list_for_display` and `get_states` already provide the required data.
- Decode `entityRegistry.entity_categories` so category indices can be distinguished. Preserve the current stricter behavior for actionable controls, while allowing diagnostic sensor entities and rejecting config-category sensors.
- Build a measurement only when all conditions hold:
  - the entity ID is a valid `sensor.*` ID;
  - it belongs to a valid, non-disabled device;
  - it is not hidden or categorized as config;
  - it has a matching state;
  - its state is `unavailable`, `unknown`, or a syntactically valid finite decimal/scientific number.
- Do not use permissive JavaScript coercion that accepts hexadecimal, blank strings, infinities, or partially numeric text. Validate the complete state string before converting only for a finite-number check, then retain the bounded original string for display.
- Normalize each reading to internal safe fields only:
  - bounded display name, preferring state `friendly_name`, then entity-registry display name, then a readable entity-object fallback;
  - bounded numeric value or null for unavailable/unknown;
  - bounded `unit_of_measurement` when present;
  - bounded `device_class` when present;
  - normalized status of `available`, `unavailable`, or `unknown`.
- Never copy raw state attributes, state-class metadata, timestamps, context, icons, entity IDs into the public shape, options, or unknown fields.
- Sort measurements deterministically by name and cap the count per device (for example, 100) after filtering/sorting so a single integration cannot create an unbounded card or response.
- Add a `measurements` array to every internal normalized device and keep existing device/control sorting and cache behavior unchanged.

### 2. Serialize an explicit public reading shape

- Extend `publicHomeAssistantDevices()` in `src/app.js` to map only `{ name, value, unit, deviceClass, status, available }` for measurements.
- Continue explicitly selecting public device and control fields rather than spreading internal objects.
- Omit Home Assistant device/entity IDs, domains, registry category indices, raw attributes, contexts, timestamps, and all unexpected internal properties.
- Keep measurements independent of opaque control tokens: readings never receive a token and cannot be submitted to the control endpoint.
- Ensure reconnect, disconnect, failed reconnect, snapshot caching, forced refresh, and post-action refresh continue to return the same safe public device structure with fresh readings.

### 3. Render readings on device cards

- Add a compact **Readings** region to each card that has measurements, separate from the existing **Controls** region.
- Use semantic name/value markup such as a `<dl>` with `<dt>` and `<dd>` rows.
- Display available readings as the bounded value followed by the Home Assistant-provided unit with readable spacing. Display `Unavailable` or `Unknown` instead of a numeric value for those statuses.
- Use text properties only. Do not use raw HTML, infer icons from device class, generate links, expose entity IDs, or attach interaction handlers to readings.
- Include measurement names, device classes, and units in device search matching; do not index rapidly changing values.
- Add minimal styles for aligned reading rows, emphasized values, muted units, and unavailable/unknown states while preserving the existing card density and mobile breakpoints.
- Update the section description to mention both current readings and supported controls without implying real-time streaming.

### 4. Add normalization and protocol coverage

- Extend Home Assistant normalization tests with representative temperature, humidity, pressure, battery, power, and unitless numeric sensors.
- Cover integers, decimals, signed numbers, scientific notation, unavailable/unknown state, Unicode units, name fallback, deterministic sorting, and the per-device cap.
- Prove the following do not produce readings:
  - hidden or config-category sensors;
  - sensors on disabled or missing devices;
  - duplicate/malformed entity IDs;
  - missing states;
  - arbitrary text/enum/date/timestamp values;
  - blank, hexadecimal, `NaN`, positive/negative infinity, partially numeric, or overlong states;
  - non-sensor domains and unknown fields.
- Assert diagnostic-category sensors remain visible and raw/private attributes, identifiers, contexts, and timestamps are discarded.
- Keep the existing four-command WebSocket assertions and add sensor records to the injected and OpenSSL-backed secure fixtures so state/entity correlation is exercised over both normal and private-CA paths.
- Retain entry-count, message-size, malformed response, timeout, authentication, caching, and socket-cleanup regression coverage.

### 5. Add API and browser coverage

- Extend Home Assistant API tests so connection and device-list responses contain the normalized public measurement shape but no device/entity IDs, domains, raw attributes, contexts, or control tokens on readings.
- Confirm cached, forced, and post-control refresh responses update reading values without changing encrypted credentials or broadening the mutation API.
- Extend browser-helper tests for search by measurement name, device class, and unit while proving numeric values are not search keys.
- Add presentation-helper tests for available, unavailable, unknown, unitless, and Unicode-unit display text if formatting is extracted from rendering.
- Extend static markup/style checks to cover the updated section copy and semantic/read-only reading region without introducing duplicate IDs or inaccessible controls.
- Keep all tests dependency-free with `node:test`; do not add a DOM framework or Home Assistant package solely for this feature.

### 6. Documentation and release update

- Update `README.md` with the supported numeric `sensor` scope, examples such as temperature/humidity/battery/pressure/air quality/power, unit handling, diagnostic inclusion, and config/hidden/text-state exclusions.
- Explain that readings are snapshots governed by the existing cache and refresh behavior, not live telemetry or historical charts.
- Clarify that Home Assistant supplies state values and preferred units; the dashboard only bounds and renders them and does not perform conversions.
- Retain the existing control security, opaque token, credential encryption, custom CA, trusted-LAN, and action-versus-physical-state guidance.
- Add `tasks/16-home-assistant-sensor-info/3-implemented.md` during implementation with design decisions, changed files, and exact verification evidence.
- Bump the minor version from `0.10.0` to `0.11.0` after implementation and verification pass.

## Verification

Run from the repository root:

```bash
npm test
npm run check
git diff --check
```

Also verify:

1. Load a fixture with temperature, humidity, pressure, battery, air-quality, power, and unitless numeric sensors; confirm each appears under the correct device with its Home Assistant-provided unit.
2. Confirm signed/decimal/scientific values render safely and unavailable/unknown states have clear non-numeric presentation.
3. Confirm hidden, config-category, disabled-device, orphaned, malformed, textual, non-finite, partially numeric, and unsupported-domain entities do not appear.
4. Confirm diagnostic sensors remain visible and no raw attributes, Home Assistant IDs/domains, contexts, timestamps, or unexpected registry fields reach API responses or rendered markup.
5. Confirm sensor rows have no control token or action path and cannot broaden or invoke the existing control endpoint.
6. Refresh devices and perform a supported on/off action; confirm the resulting snapshot updates readings and controls independently without stale-response regressions.
7. Search by reading name, class, and unit; confirm current numeric values are not indexed and other device/control search behavior remains intact.
8. Keyboard- and screen-reader-check the semantic reading list, control separation, status announcements, and narrow-screen wrapping.
9. Confirm Linkwarden, Wake-on-LAN, encrypted Home Assistant credentials, private-CA trust, opaque controls, caching, reconnect, and disconnect continue to work unchanged.
10. Against a real Home Assistant instance when available, verify common sensor integrations, user-preferred temperature units, diagnostic categories, and unavailable states.
11. If Docker is available, run `docker compose config` and verify readings through the container. Record Docker or real-Home-Assistant unavailability rather than claiming those checks passed.

## Acceptance Criteria

- Eligible numeric Home Assistant `sensor` entities appear as bounded read-only readings on their parent device cards with Home Assistant-provided units.
- Temperature, humidity, and similar measurements are supported generically rather than through hardcoded entity IDs.
- Unavailable and unknown sensors are represented clearly; arbitrary text and malformed/non-finite values are excluded.
- Hidden/config entities, disabled devices, orphaned records, unsupported domains, and excess per-device readings cannot expand the public display unexpectedly.
- Diagnostic readings remain available, while raw attributes, identifiers, domains, contexts, timestamps, and unknown fields never reach the browser.
- Readings have no control token or mutation path and do not weaken the existing fixed Home Assistant control allowlist.
- Snapshot caching, forced refresh, post-control refresh, reconnect/disconnect, credential encryption, custom-CA trust, Linkwarden, and Wake-on-LAN behavior remain intact.
- Automated tests cover normalization, bounds, privacy, API serialization, search/presentation, secure WebSocket fixtures, and regressions.
- Documentation, implementation record, and version `0.11.0` match the delivered behavior.
