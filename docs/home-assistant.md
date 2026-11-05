# Home Assistant

- [Home Assistant](#home-assistant)
  - [Connect](#connect)
  - [Choose devices](#choose-devices)
  - [Private certificates](#private-certificates)
  - [API](#api)

## Connect

1. Open **Settings → Home Assistant** and choose Global.
2. Enter an origin such as `https://homeassistant.lan:8123` and a long-lived access token from your Home Assistant profile.
3. Choose **Connect Home Assistant**.

Use an HTTP(S) origin without credentials, paths, queries, or fragments. Prefer a dedicated non-admin account with only the required permissions. Plain HTTP exposes the token to the network.

The connection is shared; its token is encrypted in SQLite and never returned. Leave the token blank to reuse it at the same origin. A new origin or re-authentication requires a token. Failed reconnects keep the working connection. Disconnect requires confirmation and deletes saved credentials.

Connection actions save separately from display preferences. Closing Settings clears unsent token input, not a submitted action. After a timeout, check saved status before retrying.

## Choose devices

Select up to 256 devices under **Dashboard devices**, then choose **Save Home Assistant settings**. Selection, visibility, and scale follow the category's Local/Global choice.

The dashboard shows read-only numeric sensor readings with Home Assistant's exact text and units. Unknown and Unavailable states are explicit. Devices without supported readings show a message. Missing selections remain removable instead of disappearing automatically.

Selections belong to an instance origin and device identity, not a name or token. Replacing a token at the same origin preserves selections. Changing origins does not map them onto different devices.

Visible pages refresh selected snapshots about every 30 seconds. Hidden pages pause reads. **Snapshot fetched** means browser retrieval time, not sensor observation time. Failed reads retain same-connection data marked stale; connection changes clear old readings. This is not a live stream, chart, or alert system.

## Private certificates

Place the public CA/intermediate bundle at `certs/home-assistant-ca.pem`, then set this in `.env` and restart:

```dotenv
HOME_ASSISTANT_CA_FILE=./certs/home-assistant-ca.pem
```

The setting works for direct and Compose runs and affects Home Assistant only. `NODE_EXTRA_CA_CERTS` is not required. Use no private keys. Restart after replacing certificate contents.

The URL must match the certificate's hostname. CA trust does not bypass hostname, expiration, or chain checks. For failures, check reachability, DNS/IP certificate names, issuing chain, and system clock. Compose mounts `certs/` read-only; external files need an explicit mount.

## API

- `GET /api/home-assistant`: Public saved status.
- `PUT /api/home-assistant`: Connect with `url` and `accessToken`.
- `DELETE /api/home-assistant`: Disconnect.
- `GET /api/home-assistant/devices`: Device snapshots and eligible controls. Add `?refresh=1` for a forced refresh.

The server reads registries and states through `/api/websocket`. Dashboard reads use `?controls=0`, issuing no control tokens. Responses over 8 MiB are rejected. A connection change during retrieval returns HTTP 409 with `HOME_ASSISTANT_CONFIGURATION_CHANGED`.

Controls are API-only and limited to on/off for eligible `light`, `switch`, `fan`, and `input_boolean` entities. Short-lived opaque tokens identify allowed controls. Hidden, disabled, unavailable, diagnostic, and unsupported entities cannot be controlled. Arbitrary services and other actions are unsupported.

Mutations are not retried automatically. An accepted service call does not prove the physical device changed; refresh separately to confirm state.

[Back to README](../README.md)
