# Home Assistant devices

Configure the optional connection in **Settings → Home Assistant** using an instance origin such as `http://homeassistant.local:8123` and a long-lived access token from the Home Assistant user profile. Use an absolute HTTP(S) origin without credentials, a path, query, or fragment. Use a dedicated non-admin Home Assistant user where practical and grant only the access needed for the entities you intend to read and control. The dashboard has no user accounts of its own and must remain restricted to a trusted LAN. Existing saved connections load without entering the token again. The dashboard shows selected devices and read-only sensor snapshots; entity actions remain API-only.

Choose up to 256 devices under **Dashboard devices**, then use **Save Home Assistant settings**. Selections and visibility follow the Home Assistant category's Local/Global choice: Local stays in this browser profile; Global synchronizes with other Global Home Assistant categories using the server revision. The connection remains an installation resource; Connect/Disconnect requires Home Assistant Global and saves independently. Device names, areas, and models identify picker entries; identical labels gain a numbered distinction. Disabled devices are marked, and devices without supported sensors show a no-readings message. Numeric readings preserve Home Assistant's exact text and unit, with Unknown and Unavailable shown explicitly.

Stable opaque selection IDs are scoped to the canonical instance origin and device identity, not names or access tokens. Changing the origin does not reinterpret old selections as new devices. Same-origin token replacement preserves selections but invalidates old readings; disconnect clears displayed readings without deleting selection preferences. Reconnecting the same origin restores matching selections. Temporarily missing selections remain saved until explicitly unchecked. The picker provides removable missing-device entries without exposing raw IDs. A replacement instance behind the same origin cannot be distinguished automatically if it reuses the same device identities.

The upper half of the middle dashboard column shows only selected devices. Visible pages poll local connection status every five seconds, plus request latency. Device snapshots refresh every 30 seconds when selections exist or the Home Assistant picker is open, using the server's normal cache. Hidden pages suspend reads and refresh on return. **Snapshot fetched** is the browser fetch time, not the sensor observation timestamp. Failed reads retain same-connection snapshots and mark them stale; a confirmed connection change immediately clears them. Device responses exceeding 8 MiB are rejected visibly. This is not a live event stream, chart, trend, or alert system.

**Connect Home Assistant** validates the connection before saving it globally. Leave the token blank to reuse a readable saved token when the origin is unchanged; default ports and a trailing slash do not change the origin. First setup, a changed origin, or re-authentication requires a new token. Failed reconnects retain the last working connection and the form draft. Successful connects clear the token input. **Disconnect Home Assistant** asks for confirmation before deleting its saved URL and encrypted token. Closing Settings clears unsent token input without canceling an already submitted action.

Both actions save independently of **Save preferences**. Public saved status refreshes when Settings opens and every five seconds while the page is visible, plus request latency; closing Settings does not stop dashboard polling. Refresh failures retain the last confirmed status. Polls preserve dirty inputs and selection drafts, and old-session results cannot clear a newer draft. A timeout may occur after a server commit; check saved status before retrying. Connection writes retain existing last-successful-write semantics, without revision conflict protection. An opaque configuration identity distinguishes committed credential changes without returning secrets. Encryption-unavailable and re-authentication messages require fixing the server key or entering a new token, respectively. Private CA trust still requires server startup configuration below, never a browser bypass.

API clients can also configure it through `PUT /api/home-assistant` with `url` and `accessToken`, inspect public saved status through `GET /api/home-assistant`, and disconnect with `DELETE /api/home-assistant`.

The dashboard server connects to Home Assistant's `/api/websocket`, authenticates there, and reads the device registry, area registry, display entity registry, and current states before closing the connection. `GET /api/home-assistant/devices` returns the saved display name, area, manufacturer, model, disabled state, current sensor readings, and eligible controls. Adding `?refresh=1` bypasses the short snapshot cache. The dashboard and picker use `?controls=0`, which returns empty controls and issues no action tokens, so their polling cannot evict tokens held by API clients. Device responses carry an opaque configuration identity; a connection change during an awaited read returns HTTP 409 with `HOME_ASSISTANT_CONFIGURATION_CHANGED` instead of obsolete data.

Readings include finite numeric `sensor` states such as temperature, humidity, pressure, battery, air quality, illuminance, moisture, energy, power, voltage, current, and signal strength. Home Assistant supplies the state and preferred unit; the API bounds and returns them without conversion or rounding. Diagnostic sensors are included, while hidden/config entities, disabled devices, orphaned sensors, arbitrary text/enum states, malformed values, and raw state attributes are excluded. `Unavailable` and `Unknown` sensors are returned explicitly.

Readings are cached snapshots updated during initial load, cache expiry, explicit refresh, and the refresh after a control action. They are not a live event stream or historical chart, and the dashboard does not calculate trends, thresholds, or alerts. Sensor rows are read-only and never receive control tokens.

On/off controls are available only for enabled, visible `light`, `switch`, `fan`, and `input_boolean` entities attached to a device-registry entry. Hidden, disabled, config/diagnostic, unavailable, unknown, orphaned, and unsupported entities cannot be controlled. Covers, locks, climate, media players, scenes, scripts, automations, brightness, color, speed, and arbitrary service data are intentionally unsupported.

API clients receive short-lived opaque control tokens instead of Home Assistant device or entity IDs. A control request can select only `turn_on` or `turn_off`; the server resolves its token and sends one fixed `call_service` command for the allowlisted entity. Mutating calls are never retried automatically. After Home Assistant accepts an action, clients should perform a separate forced refresh to read authoritative state. Acceptance confirms the service call completed, not that the physical device changed, and a later refresh failure does not undo or reclassify the accepted action.

The long-lived token is encrypted in `data/wol.db` with the same server key used for Linkwarden credentials. It is never returned to API clients. Send an empty `accessToken` to keep the saved token when the URL is unchanged; changing the URL requires a new token. A failed reconnect leaves the last working configuration intact. `DELETE /api/home-assistant` deletes the saved Home Assistant URL and token.

Normal certificate-chain and hostname verification applies to `https://` Home Assistant URLs. If Home Assistant uses a private CA, save only its public issuing CA/intermediate bundle and configure it before startup. For the supplied Compose service, set the dedicated `.env` variable and restart the container:

```sh
mkdir -p certs
cp /path/to/home-assistant-ca.pem certs/home-assistant-ca.pem
printf '\nHOME_ASSISTANT_CA_FILE=./certs/home-assistant-ca.pem\n' >> .env
docker compose up -d
```

For a direct Node run, use the same dedicated setting:

```sh
printf '\nHOME_ASSISTANT_CA_FILE=./certs/home-assistant-ca.pem\n' >> .env
npm start
```

The PEM file must contain one or more CA certificates and no private key. A self-signed leaf certificate can be used only when it is itself the trust anchor. The URL hostname must match the certificate SAN; adding a CA never bypasses hostname, expiration, or chain checks. Bundles are validated/loaded before connections at startup. Replacing certificate contents requires a server restart; editing/removing the `.env` path restarts a development child.

`HOME_ASSISTANT_CA_FILE` configures a Home Assistant-only Undici dispatcher for reads and service calls. It extends public/default trust without changing other HTTPS clients or a global dispatcher; `NODE_EXTRA_CA_CERTS` is not required and is not the Home Assistant alias. Host networking does not share host certificate stores. Compose's read-only cert mount makes `./certs/home-assistant-ca.pem` available inside `/app`; outside bundles require an explicit read-only bind and container-visible path. Use only public CA certificates, never a private key.

If a connection fails, verify network access, exact DNS name/IP SAN, full issuing chain, and certificate/system-clock validity. A trust error points to `HOME_ASSISTANT_CA_FILE`; a hostname error requires fixing the URL or certificate, not another CA. Some WebSocket failures remain generic, so check all these items when no narrower category is available. Plain HTTP sends the token over the local network; use only a trusted LAN.

[Back to README](../README.md)
