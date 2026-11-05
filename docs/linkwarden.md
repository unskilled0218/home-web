# Linkwarden bookmarks

- [Linkwarden bookmarks](#linkwarden-bookmarks)
  - [Connect](#connect)
  - [Choose links](#choose-links)
  - [Refresh and limits](#refresh-and-limits)
  - [Private certificates](#private-certificates)
  - [API](#api)

## Connect

Open **Settings → Bookmarks**, choose Global, and enter the Linkwarden URL, username, and a least-privilege access token. Choose **Connect Linkwarden**.

The server validates and saves the shared connection, encrypting the token in SQLite. First startup creates the integration key automatically. Back up the database and key together; see [local setup](local-setup.md#encryption-key).

Leave the token blank only to reuse a readable saved token with the same URL and username. Re-authentication requires a token. Failed replacements keep the working connection. Disconnect deletes the saved connection and token. Connection actions save separately from bookmark choices.

## Choose links

1. Open **Dashboard bookmark links**.
2. Expand folders and check individual links, up to 256.
3. Choose **Save Bookmarks settings**.

Selections follow Bookmarks Local/Global scope. The dashboard shows only selected links, as a flat list. Links open a new tab without access to the dashboard's opener.

**Clear** empties the draft; save to apply it. **Reload folder** retries disclosed folders and selected-folder hints without discarding checkbox edits. Closing Settings discards unsaved selection changes.

Missing links stay saved and removable. If a selected link moves, **Use this folder** updates its discovery hint in the draft; save to keep the repair. Link identities depend on source, account, and bookmark ID, not names, URLs, or tokens.

Use the category's Desktop/Mobile visibility, scale, and fullscreen options to change presentation without disconnecting Linkwarden.

## Refresh and limits

Connection changes are detected about every five seconds. Catalog and loaded content refresh every five minutes while the page is visible, with up to four folder requests at once. Children load on demand; the dashboard does not fetch the whole account unnecessarily.

Temporary failures retain successful links with a stale label. Access denial removes protected content but keeps choices removable. Reconnect after fixing access. Failed or conflicting preference saves keep the draft; reload explicitly to discard it.

Limits are 256 collections, 16 folder levels, and 2,000 records or 2 MiB per collection. The browser retains at most 10,000 links or 8 MiB, prioritizing confirmed selections. Limit notices identify incomplete results. Use **Open Linkwarden** for content beyond dashboard limits.

## Private certificates

Place the public CA bundle at `certs/linkwarden-ca.pem`, then set this in `.env` and restart:

```dotenv
LINKWARDEN_CA_FILE=./certs/linkwarden-ca.pem
```

Trust affects Linkwarden only. Hostname checks remain enabled. Empty or unreadable CA files stop startup. Never include private keys or disable TLS checks.

## API

- `GET /api/linkwarden`: Saved status.
- `PUT /api/linkwarden`: Connect with `url`, `username`, and `accessToken`.
- `DELETE /api/linkwarden`: Disconnect.
- `GET /api/linkwarden/collections`: Folder tree and opaque request tokens.
- `GET /api/bookmarks?collection=<collectionToken>`: Direct folder records; add `&refresh=1` to refresh.

Persistent selection identities do not authorize requests. Expired request tokens return HTTP 400 with `COLLECTION_SELECTION_EXPIRED`; connection changes during retrieval return HTTP 409 with `LINKWARDEN_CONFIGURATION_CHANGED`.

[Back to README](../README.md)
