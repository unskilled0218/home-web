# implemented

- [implemented](#implemented)
  - [Changes And Diagnosis](#changes-and-diagnosis)
  - [Verification](#verification)
  - [Runtime Coverage And Limits](#runtime-coverage-and-limits)

## Changes And Diagnosis

- Implemented on new branch `82-weather-proxy-verification`. Reproduced the original weather-provider run: 62 tests, 25 failures including parent-test accounting. Log: `/tmp/opencode/82-weather-baseline.log`.
- Added the nested fetch cause stack to the test child's failure result. The HTTPS failures trace to `tls.connect`: `ERR_INVALID_ARG_VALUE`, property `options.servername`, value `127.0.0.1`, with `Setting the TLS ServerName to an IP address is not permitted`. Native bundled Undici and npm Undici both supplied the IP server name; the socket observer forwarded it unchanged. This was not an observer-signature defect or an actual certificate trust rejection. Diagnostic log: `/tmp/opencode/82-weather-cause.log`.
- Changed only the HTTPS proxy fixture URL to `https://localhost:<port>` and included `DNS:localhost` in its generated certificate. Child DNS still resolves the permitted hostname to loopback; HTTP proxies retain their IP URLs. Wrong-hostname tests now replace `localhost`, ensuring they still exercise an actual mismatch. Trusted requests succeed, while untrusted certificates and wrong hostnames still fail with the original restricted expected TLS codes.
- Native fetch on this runtime proxies the wildcard apex, contrary to the tests' assumed bypass. Weather deliberately bypasses the apex. Wildcard and environment-refresh tests now state both contracts explicitly: native comparisons exercise subdomain routing, while weather retains every original apex expectation and its subdomain case. No version thresholds, runtime skips, arbitrary outcomes, or new error-code allowances were introduced.
- Split native/weather loops into independent named subtests, so a native failure no longer prevents the corresponding weather case from running. Expanded all five TLS scenarios to both implementations. Existing startup, routing, connection-tuning, abort, and disposal assertions remain intact.
- No production transport, service, release-gate, dependency-version, or Dockerfile changes were needed. This fixes verification assumptions, not general IP-address HTTPS proxy support in Node 26. Documented the DNS-name recommendation and the distinction between weather and native wildcard contracts in `docs/dashboard.md`.
- Advanced the patch version to `0.17.50`, synchronized npm root metadata, release configuration, README and current-notes links, and added `docs/releases/0.17.50.md`. The release token default remains `~/.config/token/git`.

## Verification

- `node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js`: 168 passed, zero failed, zero skipped. Repeated successfully on the final changes. Logs: `/tmp/opencode/82-weather-final.log` and `/tmp/opencode/82-weather-repeat.log`.
- `npm test`: 820 passed, zero failed, zero skipped. Log: `/tmp/opencode/82-unit-final.log`. Increased counts reflect independent nested implementation tests and expanded TLS coverage, not skipped or deleted scenarios.
- `npm run check`: passed on version `0.17.50`.
- `node --test test/release-config.test.js`: six passed.
- `bash scripts/release.sh --validate`: passed without credentials or remote operations.
- `git diff --check`: passed. The lockfile changes only its two root version values; npm Undici remains pinned at `8.11.2`.

## Runtime Coverage And Limits

- Verified runtime: Node.js `v26.13.0`, native bundled Undici `8.12.2`, installed and lockfile npm Undici `8.11.2`.
- Deployment target: Node 24, as configured by `Dockerfile`. No Node 24 executable was available in the environment or existing temporary tooling. Requested an operator-provided Node 24.5+ runtime; deployment-version verification remains untested. No runtime support claim or minimum version was changed.
- The previously recorded ignored-secret Python release-fixture failure is unrelated and unchanged; the full Python release suite was not rerun for these JavaScript fixture-only changes. Passing application tests does not claim that every other release gate is green.
- Test traffic used isolated loopback targets/proxies, sanitized child environments, and generated fixture certificates only. No real credentials were accessed, no release was published, and the real no-argument release command was not invoked. The configuration tests used the local Compose parser, not a Docker daemon.
