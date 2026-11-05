# goal

- [goal](#goal)
  - [command](#command)
  - [goal](#goal-1)

## command

- Fix the 25 weather-proxy test failures blocking release verification in `test/weather-provider.test.js`.
- Diagnose `ERR_INVALID_ARG_VALUE` failures for HTTPS proxies and lowercase proxy precedence, plus native `NO_PROXY` routing mismatches for wildcard domains, ports, and environment changes. Check Node.js and Undici compatibility; do not assume the root cause.
- Preserve proxy precedence, TLS certificate verification, and intended bypass behavior. Do not skip tests, weaken assertions, or bypass release verification.
- Run focused weather-provider tests and the full application suite. Record any remaining unrelated failures. Do not publish a release or access real credentials.

## goal

Diagnose and fix the weather-proxy failures so application tests no longer block release verification for these cases. Inspect the transport, isolated network fixtures, and Node.js/Undici compatibility while preserving proxy precedence, TLS validation, and intended bypass behavior. Verify focused tests and the full application suite without skipping checks, publishing a release, or accessing real credentials; record unrelated failures separately.
