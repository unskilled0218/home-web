# Checks

```sh
npm test
npm run check
npm run test:browser
```

The tests validate bounded CalDAV discovery, REPORT/XML/iCalendar handling, Basic/Digest authentication, configuration migration, scoped private-CA TLS and encrypted credentials, Home Assistant WebSocket handling, Wake-on-LAN packet handling, Linkwarden credential storage and migration, collection trees, bookmark caching, and API behavior. Browser tests verify the root photo dashboard, legacy redirects, saved preferences, desktop/mobile Settings, rendered service data, and fullscreen. Browser tests require development dependencies (`npm ci`) and Playwright Chromium (`npx playwright install chromium`). A safe packet-dispatch integration test requires a disposable UDP receiver on the deployment network.

[Back to README](../README.md)
