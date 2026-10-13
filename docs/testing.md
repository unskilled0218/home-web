# Checks

```sh
npm test
npm run check
npm run test:browser
```

The tests validate CalDAV discovery/protocol handling, configuration migration, private-CA TLS and encrypted credentials, Home Assistant WebSocket handling, Wake-on-LAN packets, Linkwarden trees/caching, weather persistence/deadlines, and API behavior. Shared-settings checks cover atomic migration and competing revisions, complete canonical preferences, unavailable integration isolation, cached/offline behavior, delayed observer guards, per-service metadata deferral, visibility lifecycle, and configuration adoption.

Browser tests retain desktop/mobile layouts, service data, bookmark disclosure, cached weather timestamps, forms, and fullscreen. New multi-client cases use independent contexts against a real local server/store for cross-category changes, conflicts/drafts, legacy migration, remote weather/calendar/Linkwarden configuration, and live preference updates during a pending connection. A focused case launches actual Firefox alongside Chromium and checks propagation in both directions. Providers are injected or intercepted; no live integration account is required.

Integration Settings tests cover Home Assistant connect/re-authenticate/disconnect and URL/token rules, Wake-on-LAN device CRUD, duplicate MAC and IPv4 errors, confirmed audit deletion, server restart persistence, dirty drafts, delayed old-session results, independent polling, and hidden/persisted-page resumption. The runner starts the production server through IPC and uses its normal shutdown handler without requiring OS signal permission. Set `PLAYWRIGHT_PORT` to another free port if an old interrupted runner still owns port 3210, for example `PLAYWRIGHT_PORT=3212 npm run test:browser`. Stop stranded older runners from a shell with permission; no elevated operations are performed by these tests.

Install development dependencies with `npm ci`, then download both required browsers with `npx playwright install chromium firefox`. The default runner is Chromium, with Firefox launched only by the focused cross-engine case. Container system libraries must be installed by the operator when missing; do not silently skip engine verification. A safe packet-dispatch integration test still requires a disposable UDP receiver on the deployment network.

[Back to README](../README.md)
