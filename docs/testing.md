# Tests

- [Tests](#tests)
  - [Run checks](#run-checks)
  - [Focused checks](#focused-checks)
  - [Packaging and releases](#packaging-and-releases)
  - [Memory benchmarks](#memory-benchmarks)
  - [Test boundaries](#test-boundaries)

## Run checks

Requires Node.js 24+. Install dependencies and browser binaries:

```sh
npm ci
npx playwright install chromium firefox
```

Ask the operator to install missing system libraries. Then run:

```sh
npm run check
npm test
npm run test:browser
git diff --check
```

Browser tests default to Chromium; a focused cross-engine case also launches Firefox. Missing engines mean blocked verification, not success. Set `PLAYWRIGHT_PORT=3212` if the default port 3210 is occupied; have an authorized shell stop stranded runners.

For bounded unit checks, use `npm test -- --test-timeout=10000`. Terminal cases have separate longer deadlines. Syntax-check changed test files individually when they are outside the syntax script's coverage.

## Focused checks

Settings, transfers, and Local services:

```sh
node --test test/dashboard-settings-scope.test.js test/dashboard-settings-transfer.test.js test/local-weather.test.js test/local-photo-manifest-api.test.js test/dashboard-settings-sync.test.js
npm run test:browser -- e2e/settings-scope.spec.js e2e/global-settings-transfer.spec.js
```

Photo discovery, rotation, lookahead, and recovery:

```sh
node --test test/photo-library.test.js test/large-photo-library-api.test.js test/photo-batch-sequence.test.js test/photo-lookahead.test.js test/photo-slideshow.test.js test/photo-slideshow-api.test.js test/local-photo-manifest-api.test.js
npm run test:browser -- e2e/server-photo-rotation.spec.js e2e/photo-display-recovery.spec.js
```

Weather, AQI, proxies, and transport cleanup:

```sh
node --test test/weather-provider.test.js test/weather-transport-lifecycle.test.js test/weather.test.js test/local-weather.test.js test/weather-api.test.js test/local-weather-api.test.js
```

Proxy-specific checks require Node 24.5+; record runtime prerequisite skips as unverified.

Widget layouts and display:

```sh
npm run test:browser -- e2e/dashboard-layout.spec.js e2e/background-display-options.spec.js
```

The full suite also covers CalDAV, Home Assistant, Linkwarden, Wake-on-LAN, encrypted credentials, private CA trust, development restarts, and shutdown ordering.

## Packaging and releases

Check an isolated production dependency tree:

```sh
node scripts/check-production.js
```

This uses temporary storage, installs locked production dependencies, and checks readiness, HTTP, key creation, and shutdown. It does not replace working dependencies or prove a built Docker image works.

Release fixtures require Python 3.11+, Bash, and Git, with no Python packages:

```sh
python3 -B -m unittest discover -s test/release-template -v
bash scripts/release.sh --validate
bash -n scripts/release.sh scripts/release-common.sh
node --check test/release-config.test.js
```

Fixtures use temporary repositories and fake publication tools. They do not publish or certify the live registry. Running `bash scripts/release.sh` without arguments is different: it authorizes real publication after verification. See [release operations](releases.md).

## Memory benchmarks

Run this in three fresh processes:

```sh
node --expose-gc scripts/benchmark-photo-library.js
```

It creates and removes 7,001 tiny local PNGs under `/tmp/opencode`, exercises traversal and refreshes, and reports memory/timing samples. Targets are peak RSS growth within 128 MiB and final settled heap growth within the larger of 4 MiB or 10% of warm settled heap. These are benchmark targets, not universal guarantees.

The `large-image resource` browser case in `e2e/server-photo-rotation.spec.js` reports `photoBrowserBenchmark` JSON. It checks decode behavior and application-owned image layers, not browser-process RSS.

Raspberry Pi/NFS performance, full-resolution decoding, and available memory need separate hardware checks. Record them as pending when target access is unavailable.

## Test boundaries

Automated tests use isolated storage, loopback services, temporary images, and injected providers. They do not need live integration accounts, mount NFS, or send real wake packets.

Live NFS checks require the staged [NFS troubleshooting](nfs-backgrounds.md#troubleshooting) procedure. Real packet delivery requires a disposable UDP receiver on the deployment network.

Terminal checks use Python 3's standard-library PTY support where available. Signal-denied environments report `EACCES` capability limits. An npm SIGINT exit is accepted only with independent evidence of clean server/supervisor shutdown, no owned leftovers, and a reusable port. Never treat a wrapper signal or timeout alone as cleanup proof.

[Back to README](../README.md)
