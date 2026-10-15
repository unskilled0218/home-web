# Brooks-Lint Review

**Mode:** PR Review
**Scope:** Branch `46-env-config-automatic-key` against `main`, merge base `ff8706b4f469dc4c241a5595e994ec4d2731bf29` through `52efc92`; 32 changed files, 434 insertions and 91 deletions. Risk-prioritized review, with detailed inspection of startup/key persistence, scoped Home Assistant transport, lifecycle ownership, Compose packaging, and changed tests.
**Health Score:** 95/100
**Trend:** 99 → 95 (−4) against the previous PR Review record, which reviewed this task's plan rather than implementation; scopes are not directly comparable.

Configuration and atomic key publication are coherent, but Home Assistant transport disposal can report completion before its owned connections close.

## Findings

### Warning

**Transport lifecycle — disposal does not confirm closure of upgraded WebSockets**

Symptom: `src/home-assistant.js:250-254,263-268` tracks default-factory WebSockets, but `dispose()` only requests `socket.close()`, immediately clears tracking, and awaits `dispatcher.destroy()`. Once upgraded, those connections are not closed by destroying the dispatcher's HTTP pool. A loopback reproduction upgraded a real Undici WebSocket, sent an unexpected authentication response, and ignored the client's Close frame. After the request failed and `await client.dispose()` completed, the server still had one live upgraded connection. `src/shutdown.js:44-47` consequently treats this incomplete disposal as successful cleanup. The added disposal test uses only an injected factory, and the TLS fixture explicitly destroys server-side sockets during teardown, so neither protects this case.

Source: Code Complete — Defensive Programming and error-handling discipline; A Philosophy of Software Design — Modules Should Be Deep. The transport boundary must hide and fulfill the ownership obligations its disposal operation promises.

Consequence: An uncooperative or stalled peer leaves owned sockets alive after disposal succeeds. Failed sessions can retain connections during normal operation, while shutdown can report `cleanupSafe: true` without confirming transport cleanup. The server's eventual `process.exit()` closes its handles, but that is not evidence that the transport disposal contract succeeded.

Remedy: Retain owned connection tracking until actual closure, and make disposal await those closures within the existing shutdown budget. Use supported transport APIs to abort owned connections when graceful Close cannot complete, or reject disposal when closure cannot be confirmed; do not use private Undici internals or dispose caller-owned factories. Add a real loopback peer that ignores Close and verify bounded cleanup, accurate lifecycle status, and no remaining owned connection after successful disposal.

## Review Coverage

- Production/runtime and packaging: `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml`, `package.json`, `public/index.html`, `src/config.js`, `src/home-assistant.js`, `src/linkwarden-key.js`, `src/server.js`, and `src/shutdown.js`.
- Verification code: `scripts/check-production.js`, `e2e/server-setup.js`, `test/config.test.js`, `test/home-assistant-api.test.js`, `test/home-assistant-tls.test.js`, `test/home-assistant.test.js`, `test/linkwarden-key.test.js`, `test/linkwarden-server.test.js`, `test/release-config.test.js`, `test/server-shutdown.test.js`, `test/shutdown.test.js`, and `test/startup-key.test.js`.
- Documentation/context: `README.md`, `docs/deployment.md`, `docs/home-assistant.md`, `docs/linkwarden.md`, `docs/local-setup.md`, `docs/nfs-backgrounds.md`, `docs/testing.md`, and `tasks/46-env-config-automatic-key/4-implemented.md`; task goal/plan/review read as supporting context.
- Generated `package-lock.json` skipped for decay analysis. No `.brooks-lint.yaml` exists; balanced defaults apply.
- Completed change-propagation, cognitive-load, duplication, accidental-complexity, dependency, domain-language, and quick test checks. No additional actionable findings survived context/tradeoff checks. The new dependency, startup ownership, deployment changes, and related tests serve the same stated feature rather than unrelated responsibilities. Test names and multi-assertion scenarios remain understandable; boundary fakes do not by themselves constitute mock abuse.

## Verification

- `npm run check`: passed.
- `git diff --check main...HEAD`: passed.
- `npm test -- --test-timeout=10000 --test-reporter=spec`: 314 tests, 313 passed, one failed, no skips. The failing case was `terminal Ctrl+C stops the npm launch without native watch teardown`, with exit code `-2` instead of `0` at `test/server-shutdown.test.js:112`. Its isolated rerun failed identically. Both direct-launch terminal cases and the changed key/config/TLS/disposal/Compose checks passed. The implementation report records a prior npm signal limitation, but this run produced no `EACCES` exemption; a fully green suite is not established. This review did not establish that the branch introduced this npm-launch failure.
- Real loopback WebSocket reproduction: an authentication/protocol failure followed by awaited disposal left one upgraded connection open after an additional 100ms. The reviewer explicitly destroyed that owned fixture socket and closed its server afterward. No real integration, user configuration, credentials, mount, or service was used.
- Browser tests, production-only dependency installation, and image builds were not repeated during review. Their prior results remain implementation-stage evidence in `4-implemented.md`, not new review verification.

## Summary

Address the transport disposal warning before relying on successful cleanup status, and resolve or explicitly characterize the reproducible npm terminal-test failure. This change exceeds 500 diff lines, making review size a change-propagation signal; here, the files are conceptually related, so size alone does not justify another finding. No implementation fixes were made.
