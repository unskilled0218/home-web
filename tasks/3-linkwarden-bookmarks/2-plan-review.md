# Plan review

## Result

The plan is implementable within the dependency-free Node 24 application. Linkwarden collection retrieval will use its v1 collection-bookmarks endpoint with a Bearer API key, while the dashboard receives only normalized bookmark fields and masked configuration status.

## Implementation notes

- The encryption secret is optional at boot so Wake-on-LAN remains available when Linkwarden is not configured, but a valid base64-encoded 32-byte `LINKWARDEN_CONFIG_ENCRYPTION_KEY` is required before testing or saving an integration.
- A singleton SQLite row stores only AES-256-GCM ciphertext, IV, and authentication tag. Replacing URL or collection without submitting a key retains the encrypted key.
- The remote client has an injected fetch implementation for unit tests, limits responses, follows Linkwarden pagination links only on the configured origin, and retains a short-lived stale cache after refresh failures.
- API mutations retain the existing trusted-LAN and same-origin checks. No endpoint proxies client-provided URLs or returns credential material.
