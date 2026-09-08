# Code review

## Result

No blocking findings after implementation review.

## Checked

- The browser receives collection names and random opaque selection tokens only. Access tokens, encrypted credentials, authorization headers, and Linkwarden numeric IDs are not serialized in local API responses.
- Selections are bound to normalized URL, username, and access-token fingerprint, expire after five minutes, and are invalidated by changed credentials or stale tokens.
- Linkwarden collection discovery and bookmark fetches use the verified Bearer-token protocol with bounded response parsing and existing timeout, cache, and pagination-origin protections.
- Existing configuration records are migrated without destructive changes, but must be re-authenticated before use because their previous API-key schema has no username or collection name.
