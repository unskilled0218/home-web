# Critical security and reliability fixes implementation

## Delivered

- Closed cross-origin saved-token reuse by requiring the normalized Linkwarden base URL and username to match the saved identity before a blank token can reuse encrypted credentials.
- Reject changed URL or username submissions with a blank token before any outbound request, while preserving unchanged blank-token reconnects and explicit-token migration to a new identity.
- Added strict `DASHBOARD_ALLOWED_HOSTS` parsing for exact hostnames and IPv4/IPv6 literals, automatic loopback aliases, canonical IPv6 comparison, and an explicit-host requirement for wildcard binds.
- Validated the Host header for every API request and required browser mutation Origins to match the same allowed hostname and port. Private client-address validation remains in place, and forwarded-host headers are not trusted.
- Parse request targets against a fixed internal base instead of an untrusted Host header and added a final asynchronous request error boundary that returns a generic failure without terminating the server.
- Hardened Linkwarden transport callbacks so malformed redirects and invalid/bodyless status responses become promise rejections rather than uncaught exceptions.
- Reject and close HTTP protocol upgrades so a 101 response cannot bypass status validation or leave the Linkwarden request pending after timeout.
- Extracted wake dispatch bookkeeping into a tested boundary that contains database/audit failures and preserves the truthful distinction between UDP dispatch success and persistence failure.
- Added Compose, environment-template, and README configuration for direct private IPs, private DNS names, reverse proxies, and wildcard binds without allowing wildcard Host trust.
- Added child-process and real HTTP fixture coverage for DNS rebinding attempts, allowed Host/Origin combinations, malformed and missing Host values, process liveness, blank-token identity changes, explicit-token migration, bodyless statuses, malformed redirects, protocol upgrades, canonical IPv6 hosts, and wake persistence failures.
- Bumped the application version from `0.7.0` to `0.7.1` as a critical security and reliability patch.

## Verification

- `npm test` passes with 32 tests.
- Syntax checks pass for every changed source and test JavaScript file.
- `git diff --check` passes.
- The child-dashboard security test proves unlisted/rebinding hosts cannot read devices or bookmarks, cannot mutate devices or Linkwarden configuration, and do not terminate the process after malformed or missing Host requests.
- Recording Linkwarden fixtures prove blank-token URL/username changes send no request or bearer token, leave the saved identity unchanged, allow unchanged reconnects, and permit an explicit-token identity migration.
- Real HTTP fixtures prove 101, 204, 205, 304, 500, and malformed redirect responses reject safely without callback exceptions or hanging upgraded sockets.
- Injected wake tests prove dispatch success remains successful when mark/audit persistence fails and failed dispatch remains contained when failure auditing also fails.
- A focused post-implementation review found HTTP 101 and expanded-IPv6 edge cases; both were corrected and covered before final verification.
- `docker compose config` was not run because the Docker CLI is not installed in this development container (`docker: command not found`).
- The warning-level findings in task 10, including the existing self-signed Linkwarden TLS policy, remain intentionally out of scope.
