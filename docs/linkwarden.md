# Linkwarden bookmarks

Linkwarden is an optional backend integration with no bookmark interface on the photo dashboard. Existing connections remain saved and do not affect Home Assistant or Wake-on-LAN. The example environment configures the same persistent server-only encryption-key file for direct and Compose runs:

```sh
LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=./data/linkwarden-config-encryption.key npm start
```

Alternatively, generate a key once and provide that same value through the process environment on every run:

```sh
openssl rand -base64 32
```

Set that output as `LINKWARDEN_CONFIG_ENCRYPTION_KEY` and restart the service. API clients can connect through `PUT /api/linkwarden` with `url`, `username`, and a least-privilege `accessToken`. A successful connection validates access, encrypts the token in `data/wol.db`, and returns the available collection tree. `GET /api/linkwarden/collections` returns collections with short-lived opaque collection tokens instead of Linkwarden's numeric collection IDs. Use a token with `GET /api/bookmarks?collection=<collectionToken>` to load HTTP(S) URL records through Linkwarden's current search API; note, image, and archive-only records without a web URL are omitted. Each collection has an independent 60-second cache; add `&refresh=1` to refresh it explicitly. On a later reconnect, send an empty `accessToken` to retain the saved token. `DELETE /api/linkwarden` deletes the saved configuration and encrypted token.

The Linkwarden service must be reachable from the dashboard host. HTTPS certificate chains and hostnames are verified by default. If Linkwarden uses a private CA, save only the public CA bundle and configure it for these requests:

```sh
mkdir -p certs
cp /path/to/private-ca.pem certs/linkwarden-ca.pem
printf '\nLINKWARDEN_CA_FILE=./certs/linkwarden-ca.pem\n' >> .env
```

Unlike Home Assistant's process-wide `NODE_EXTRA_CA_CERTS`, the configured `LINKWARDEN_CA_FILE` extends trust only for Linkwarden requests; hostname verification remains enabled and other Node HTTPS traffic is unaffected. An unreadable or empty CA file stops startup with a configuration error. Protect and back up the database and encryption key together. Losing, deleting, or replacing the key makes saved credentials unrecoverable; changing it requires deliberately decrypting and re-encrypting the saved token while the old secret is available. A malformed or unreadable persisted key stops startup rather than silently replacing the secret. Existing saved URL, username, and encrypted-token data is retained when upgrading from the former single-collection configuration.

[Back to README](../README.md)
