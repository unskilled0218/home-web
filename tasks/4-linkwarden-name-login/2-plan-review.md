# Plan review

## API verification

Linkwarden's current v1 endpoint `GET /api/v1/collections` authenticates access tokens through the `Authorization: Bearer <token>` header and returns collections in a `response` array. The verified API does not accept username as an additional login credential; the supplied username will therefore be validated and saved as an operator-visible account label, while the access token remains the sole remote credential.

## Implementation notes

- The dashboard will request the complete authenticated collection list from a protected local endpoint. Each returned collection has only a name and a short-lived, in-memory opaque selection token; its numeric Linkwarden ID remains server-side.
- The token is bound to normalized URL, username, and access token fingerprint and expires quickly. Save and test reject mismatches, stale choices, and missing selections.
- SQLite migration will add username and collection-name columns to existing configuration rows. Existing integrations retain their encrypted key and ID but require re-authentication before they can be presented as a named account configuration.
- The current collection bookmark endpoint continues to use the server-owned resolved ID and Bearer authorization. Existing cache, timeout, size-limit, and safe-rendering behavior remains intact.
