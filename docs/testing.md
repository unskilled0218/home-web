# Checks

```sh
npm test
npm run check
npm run test:browser
```

The tests validate CalDAV discovery/protocol handling, configuration migration, private-CA TLS and encrypted credentials, Home Assistant WebSocket handling, Wake-on-LAN packets, Linkwarden trees/caching, weather persistence/deadlines, and API behavior. Shared-settings checks cover atomic migration and competing revisions, complete canonical preferences, unavailable integration isolation, cached/offline behavior, delayed observer guards, per-service metadata deferral, visibility lifecycle, and configuration adoption.

Browser tests retain desktop/mobile layouts, service data, bookmark disclosure, cached weather timestamps, forms, and fullscreen. New multi-client cases use independent contexts against a real local server/store for cross-category changes, conflicts/drafts, legacy migration, remote weather/calendar/Linkwarden configuration, and live preference updates during a pending connection. A focused case launches actual Firefox alongside Chromium and checks propagation in both directions. Providers are injected or intercepted; no live integration account is required.

Integration Settings tests cover Home Assistant connect/re-authenticate/disconnect and URL/token rules, Wake-on-LAN device CRUD, duplicate MAC and IPv4 errors, confirmed audit deletion, server restart persistence, dirty drafts, delayed old-session results, independent polling, and hidden/persisted-page resumption. The runner starts the production server through IPC and uses its normal shutdown handler without requiring OS signal permission. Set `PLAYWRIGHT_PORT` to another free port if an old interrupted runner still owns port 3210, for example `PLAYWRIGHT_PORT=3212 npm run test:browser`. Stop stranded older runners from a shell with permission; no elevated operations are performed by these tests.

Shutdown tests exercise startup interruption, repeated requests/signals, deadlines, HTTP admission, unfinished uploads, keep-alive sockets, handler/audit/queued-mutation drainage, cleanup failures, SQLite ordering, and simulated NFS children through the existing command seam. No real mount operation is used. Development tests use temporary source trees and isolated databases, with fresh-child env precedence, actual private-CA HTTPS trust across reloads, failed-edit recovery, readiness, IPC loss, and parent/child timeout ordering.

Process tests distinguish three mechanisms: IPC/self-emitted lifecycle signals, userspace OS signal delivery, and actual terminal/process-group Ctrl+C. Owned-process SIGINT/SIGTERM probes are explicitly skipped with a capability diagnostic if the environment returns `EACCES`. Python 3's standard-library `pty` module drives terminal cases when installed and supported; install Python 3 through the operator if that verification prerequisite is absent. Terminal delivery can succeed when a userspace `kill()` is denied. npm forwarding is checked separately: a test that observes and reports npm `EACCES` does not claim silent npm shutdown passed. Direct development/normal launches are required to stop without the native watcher crash. Tests check only their owned PIDs, ports, and temporary directories for leftovers/core artifacts.

For bounded local verification use `npm test -- --test-timeout=10000`; terminal cases have their own longer bounded driver/fixture deadlines. Deferred fixture waits also have short explicit deadlines. A signal-denied environment cannot forcibly clean a permanently blocked process; fixtures must remain cooperative and tests must not create such a process intentionally.

Install development dependencies with `npm ci`, then download both required browsers with `npx playwright install chromium firefox`. The default runner is Chromium, with Firefox launched only by the focused cross-engine case. Container system libraries must be installed by the operator when missing; do not silently skip engine verification. A safe packet-dispatch integration test still requires a disposable UDP receiver on the deployment network.

Selected-bookmark tests cover shared choice persistence, never-configured versus empty preferences, exact bounded records, source/account identity, token renewal, selected-first cache reclamation, late-response protection, and genuinely over-budget content. Real-server browser cases cover a subset versus the lazy catalog, mouse/keyboard loopback popup navigation with no opener, restart and two-browser synchronization, dirty-draft conflicts, explicit moved-link hint repair/discard, access-denied label removal, the 256-link picker limit, and desktop/mobile/fullscreen presentation. Providers are stubbed and popup destinations remain loopback; no real Linkwarden account is contacted.

[Back to README](../README.md)
