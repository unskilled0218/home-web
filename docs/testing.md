# Checks

```sh
npm test
npm run check
npm run test:browser
```

The tests validate bounded CalDAV discovery, REPORT/XML/iCalendar handling, Basic/Digest authentication, configuration migration, scoped private-CA TLS and encrypted credentials, Home Assistant WebSocket handling, Wake-on-LAN packet handling, Linkwarden credential storage and migration, collection trees, bookmark caching, and API behavior. Weather checks use temporary SQLite stores, controlled timers, and mocked provider responses to verify restart persistence, hourly retrieval without browsers, independent failures, retry deadlines, bounded timezone eviction, shared-location races, request limits, and shutdown. Browser tests verify the root photo dashboard, legacy redirects, saved preferences, desktop/mobile Settings, rendered service data, cached weather and update times, shared-location save failures, local units/timezones, and fullscreen. Weather browser fixtures intercept same-origin APIs and geocoding, without live forecast providers. Browser tests require development dependencies (`npm ci`) and Playwright Chromium (`npx playwright install chromium`). A safe packet-dispatch integration test requires a disposable UDP receiver on the deployment network.

[Back to README](../README.md)
